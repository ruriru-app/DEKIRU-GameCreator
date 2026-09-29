import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedPlayerSession} from '../p/player.js';
import {resolveRuntime} from '../p/runtime-registry.js';
import {projectWith} from './fixtures/cloud-projects.mjs';
const pageUrl='https://ruriru-app.github.io/DEKIRU-GameCreator/p/?g=G7m2Pk8wQ4t9R3vX6nYzAa';
const endpoint='https://project.supabase.co/functions/v1/shared-game';
const game=()=>({schemaVersion:1,project:projectWith(2),runtimeVersion:'fusuma-1',publicationVersion:1});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(extra={}){
 const calls=[],mounted=[],disposed=[];
 const session=createSharedPlayerSession({pageUrl,endpoint,host:{},fetchImpl:async(url,options)=>{calls.push({url,options});return response(game());},loadRuntime:async version=>({mount:args=>{mounted.push({version,...args});return{destroy(){disposed.push(true);}};}}),...extra});
 return{session,calls,mounted,disposed};
}
test('only fixed share id fetches anonymous no-store data and mounts the allowed snapshot',async()=>{
 const {session,calls,mounted}=fixture();await session.load();
 assert.equal(session.getState().status,'ready');assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
 assert.equal(calls[0].url,endpoint+'?g=G7m2Pk8wQ4t9R3vX6nYzAa');assert.equal(mounted[0].project.questions.length,2);assert.equal(mounted[0].version,'fusuma-1');
 session.destroy();
});
test('invalid and duplicate ids never fetch or load runtime',async()=>{
 for(const query of ['?g=bad','?g=G7m2Pk8wQ4t9R3vX6nYzAa&g=G7m2Pk8wQ4t9R3vX6nYzAa','?g=G7m2Pk8wQ4t9R3vX6nYzAa#x']){
  const {session,calls,mounted}=fixture({pageUrl:'https://example.invalid/p/'+query});await session.load();
  assert.equal(session.getState().error.code,'UNAVAILABLE');assert.equal(calls.length,0);assert.equal(mounted.length,0);
 }
});
test('stopped 404, service 503 and network failures stay distinct with no automatic retry',async()=>{
 for(const [status,want] of [[404,'UNAVAILABLE'],[503,'SERVICE_UNAVAILABLE'],[429,'RATE_LIMIT']]){
  let calls=0;const {session,mounted}=fixture({fetchImpl:async()=>{calls++;return response({},status);}});await session.load();
  assert.equal(session.getState().error.code,want);assert.equal(mounted.length,0);assert.equal(calls,1);
 }
 const {session}=fixture({fetchImpl:async()=>{throw Error('offline');}});await session.load();assert.equal(session.getState().error.code,'NETWORK');
});
test('arbitrary runtime and injected project URLs are rejected before any game code runs',async()=>{
 const values=[{...game(),runtimeVersion:'evil'}, {...game(),project:{...projectWith(1),assets:{image:'https://attacker.invalid/x'}}}];
 for(const body of values){const {session,mounted}=fixture({fetchImpl:async()=>response(body)});await session.load();assert.equal(session.getState().error.code,'SERVICE_UNAVAILABLE');assert.equal(mounted.length,0);}
 await assert.rejects(()=>resolveRuntime('https://attacker.invalid/code.js'));
});
test('page departure stops runtime and a restored page fetches publication state before showing it',async()=>{
 let stopped=false;const calls=[];
 const {session,disposed}=fixture({fetchImpl:async(url,options)=>{calls.push(options);return response(stopped?{}:game(),stopped?404:200);}});
 await session.load();session.deactivate();assert.equal(disposed.length,1);assert.notEqual(session.getState().status,'ready');
 stopped=true;await session.load();assert.equal(calls.length,2);assert.equal(calls[1].cache,'no-store');assert.equal(session.getState().error.code,'UNAVAILABLE');
});
test('departure during fetch or runtime load never mounts a delayed game; repeated load is single-flight',async()=>{
 const http=deferred();const {session,mounted}=fixture({fetchImpl:()=>http.promise});
 const load=session.load();session.deactivate();http.resolve(response(game()));await load;assert.equal(mounted.length,0);
 const runtime=deferred(),late=[];const f=fixture({loadRuntime:()=>runtime.promise});
 const first=f.session.load();await new Promise(r=>setImmediate(r));await f.session.load();assert.equal(f.calls.length,1);
 f.session.destroy();runtime.resolve({mount:()=>late.push(true)});await first;assert.deepEqual(late,[]);
});
