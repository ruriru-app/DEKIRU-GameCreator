import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameLibrary} from '../app/account/account.js';
import {ok,failure} from '../core/cloud/contracts.js';

const id='10000000-0000-4000-8000-000000000001';
const row=()=>({id,version:2,title:'日本の歴史',questionCount:2,updatedAt:'2026-09-29T00:00:00Z',publication:{shareId:'G7m2Pk8wQ4t9R3vX6nYzAa',status:'published',version:1,sourceVersion:1,runtimeVersion:'fusuma-1'},publicationDirty:false});
const context=()=>({ownerId:'A',status:'active',plan:'free',limits:{games:20,publications:10},counts:{games:1,publications:1},capabilities:{save:true,publish:true}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(extra={}) {
  const calls=[];
  const api={getContext:async()=>ok(context()),listGames:async()=>ok([row()]),
    deleteGame:async args=>{calls.push(['delete',args]);return ok({id,deleted:true});},
    setPublished:async args=>{calls.push(['publish',args]);return ok({...row(),version:args.expectedVersion+1,publication:{...row().publication,status:args.published?'published':'stopped'}});},...extra};
  return{model:createGameLibrary({api}),calls};
}

test('library rejects signed-out and unknown game mutations; exposes only fetched rows',async()=>{
  const {model,calls}=fixture();
  assert.equal((await model.perform('delete',id,2)).error.code,'UNAUTHENTICATED');
  model.setUser({id:'A'});await model.refresh();
  assert.equal(model.getState().rows[0].title,'日本の歴史');
  assert.equal((await model.perform('delete','other-owner-id',2)).error.code,'FORBIDDEN');
  assert.deepEqual(calls,[]);
  const copy=model.getState();copy.rows[0].title='changed';
  assert.equal(model.getState().rows[0].title,'日本の歴史');
});

test('failed listing is an error, not a successful empty library; manual refresh recovers',async()=>{
  let failed=true;const {model}=fixture({listGames:async()=>failed?failure('NETWORK'):ok([])});
  model.setUser({id:'A'});await model.refresh();
  assert.equal(model.getState().status,'error');assert.equal(model.getState().error.code,'NETWORK');
  failed=false;await model.refresh();assert.equal(model.getState().status,'ready');assert.deepEqual(model.getState().rows,[]);
});

test('logout or identity change discards delayed lists and mutations from the previous owner',async()=>{
  const listing=deferred(),mutation=deferred();let slow=false;
  const {model}=fixture({listGames:()=>slow?listing.promise:Promise.resolve(ok([row()])),deleteGame:()=>mutation.promise});
  model.setUser({id:'A'});await model.refresh();
  const action=model.perform('delete',id,2);model.setUser(null);mutation.resolve(ok({id,deleted:true}));await action;
  assert.deepEqual(model.getState().rows,[]);assert.equal(model.getState().status,'signed-out');
  model.setUser({id:'A'});slow=true;const refresh=model.refresh();model.setUser({id:'B'});
  listing.resolve(ok([row()]));await refresh;
  assert.deepEqual(model.getState().rows,[]);assert.equal(model.getState().user.id,'B');
});

test('stop and resume keep share id, forward the confirmed version and update only one row',async()=>{
  const {model,calls}=fixture();model.setUser({id:'A'});await model.refresh();
  await model.perform('unpublish',id,2);
  assert.equal(calls[0][1].expectedVersion,2);assert.equal(calls[0][1].published,false);
  assert.equal(model.getState().rows[0].publication.status,'stopped');
  await model.perform('republish',id,3);
  assert.equal(calls[1][1].expectedVersion,3);assert.equal(calls[1][1].published,true);
  assert.equal(model.getState().rows[0].publication.shareId,'G7m2Pk8wQ4t9R3vX6nYzAa');
  assert.equal(model.getState().rows[0].version,4);
});

test('delete removes only its confirmed row; stale version conflicts never overwrite',async()=>{
  const {model,calls}=fixture();model.setUser({id:'A'});await model.refresh();
  assert.equal((await model.perform('delete',id,1)).error.code,'CONFLICT');assert.equal(calls.length,0);
  await model.perform('delete',id,2);assert.deepEqual(model.getState().rows,[]);
  assert.equal(calls[0][1].expectedVersion,2);
  const conflict=fixture({deleteGame:async()=>failure('CONFLICT')}).model;
  conflict.setUser({id:'A'});await conflict.refresh();await conflict.perform('delete',id,2);
  assert.equal(conflict.getState().rows.length,1);assert.equal(conflict.getState().error.code,'CONFLICT');
});

test('uncertain response retains exact retry id and blocks new writes or refresh until checked',async()=>{
  const attempt=deferred(),calls=[];const {model}=fixture({deleteGame:args=>{calls.push(args);return calls.length===1?attempt.promise:Promise.resolve(ok({id,deleted:true}));}});
  model.setUser({id:'A'});await model.refresh();
  const first=model.perform('delete',id,2);await model.perform('delete',id,2);assert.equal(calls.length,1);
  attempt.resolve(failure('NETWORK'));await first;
  assert.equal(model.getState().canRetry,true);await model.refresh();await model.perform('unpublish',id,2);assert.equal(calls.length,1);
  await model.retry();assert.deepEqual(calls[0],calls[1]);assert.equal(model.getState().canRetry,false);assert.deepEqual(model.getState().rows,[]);
});

test('destroy discards late response and releases listeners',async()=>{
  const listing=deferred();const {model}=fixture({listGames:()=>listing.promise});let notifications=0;
  model.subscribe(()=>notifications++);model.setUser({id:'A'});const wait=model.refresh();model.destroy();const before=notifications;
  listing.resolve(ok([row()]));await wait;assert.equal(notifications,before);assert.deepEqual(model.getState().rows,[]);
});
