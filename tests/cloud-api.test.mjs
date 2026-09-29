import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerApi } from '../core/cloud/owner-api.js';
import { fetchSharedGame } from '../core/cloud/public-api.js';
import { readCloudConfig } from '../core/cloud/config.js';
import { projectWith } from './fixtures/cloud-projects.mjs';
const id = 'G7m2Pk8wQ4t9R3vX6nYzAa';
const endpoint = 'https://project.supabase.co/functions/v1/shared-game';
test('approved trial configuration is valid, can be disabled, and rejects privileged keys or arbitrary fields', () => {
  const configured=readCloudConfig();
  assert.equal(configured.enabled,true);
  assert.equal(configured.supabaseUrl,'https://xrqgsujvduyxtrbegzri.supabase.co');
  assert.match(configured.publishableKey,/^sb_publishable_/);
  assert.equal(readCloudConfig({...configured,enabled:false}).enabled,false);
  assert.throws(() => readCloudConfig({enabled:true,serviceRoleKey:'secret'}));
});
test('owner mutations forward stable retry IDs and optimistic versions without owner identity', async () => {
  const calls = [];
  const client = {rpc: async (name,args) => {calls.push({name,args});return {data:{ok:true,data:{id:'saved',version:1}},error:null};}};
  const api = createOwnerApi({client}), args = {gameId:null,expectedVersion:0,project:projectWith(),requestId:crypto.randomUUID()};
  assert.equal((await api.saveDraft(args)).ok,true);
  await api.saveDraft(args);
  assert.deepEqual(calls[0],calls[1]); assert.equal(calls[0].name,'mutate_game');
  assert.equal(calls[0].args.p_command,'save');
  assert.equal(calls[0].args.p_args.requestId,args.requestId);
  assert.equal(Object.hasOwn(calls[0].args.p_args,'ownerId'),false);
  assert.equal(JSON.parse(calls[0].args.p_args.projectText).title,args.project.title);
});
test('owner layer distinguishes conflict, transport failure and configuration; sanitizes backend text', async () => {
  assert.equal((await createOwnerApi({client:null}).listGames()).error.code,'NOT_CONFIGURED');
  const api = createOwnerApi({client:{rpc:async()=>({data:{ok:false,error:{code:'CONFLICT',message:'private sql secret'}}})}});
  const result = await api.listGames();
  assert.equal(result.error.code,'CONFLICT'); assert.doesNotMatch(result.error.message,/secret/);
  const broken = createOwnerApi({client:{rpc:()=>{throw new Error('network secret');}}});
  assert.equal((await broken.listGames()).error.code,'NETWORK');
});
test('owner and public requests time out in 15 seconds without automatic retries', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0;
  const task=createOwnerApi({client:{rpc:()=>{calls++;return new Promise(()=>{});}}}).listGames();
  t.mock.timers.tick(15000);
  assert.equal((await task).error.code,'NETWORK'); assert.equal(calls,1);
  const request = fetchSharedGame({endpoint,shareId:id,fetchImpl:()=>new Promise(()=>{})});
  t.mock.timers.tick(15000); assert.equal((await request).error.code,'NETWORK');
});

test('SDK-returned fetch failures and gateway errors remain uncertain and retryable',async()=>{
  for(const status of [0,502,503,504]){
    const api=createOwnerApi({client:{rpc:async()=>({status,data:null,error:{code:'',message:'sensitive transport detail'}})}});
    const result=await api.saveDraft({gameId:null,expectedVersion:0,project:projectWith(),requestId:crypto.randomUUID()});
    assert.equal(result.error.code,'NETWORK');assert.doesNotMatch(result.error.message,/sensitive/);
  }
});
test('public GET is anonymous and no-store; whitelisted data only', async () => {
  let call;
  const result=await fetchSharedGame({endpoint,shareId:id,fetchImpl:async(url,options)=>{
    call={url,options}; return Response.json({schemaVersion:1,project:projectWith(),runtimeVersion:'fusuma-1',publicationVersion:2,ownerId:'do-not-leak'});
  }});
  assert.equal(result.ok,true); assert.equal(Object.hasOwn(result.data,'ownerId'),false);
  assert.equal(call.options.cache,'no-store'); assert.equal(call.options.credentials,'omit');
  assert.equal(call.options.headers,undefined); assert.equal(new URL(call.url).searchParams.get('g'),id);
});
test('public missing, service unavailable, rate limit, malformed and network remain distinct', async () => {
  for (const [status,code] of [[404,'UNAVAILABLE'],[503,'SERVICE_UNAVAILABLE'],[429,'RATE_LIMIT']]) {
    const result=await fetchSharedGame({endpoint,shareId:id,fetchImpl:async()=>new Response('',{status,headers:{'Retry-After':'60'}})});
    assert.equal(result.error.code,code);
  }
  const bad=projectWith();bad.assetUrl='https://bad';
  const result=await fetchSharedGame({endpoint,shareId:id,fetchImpl:async()=>Response.json({schemaVersion:1,project:bad,runtimeVersion:'fusuma-1',publicationVersion:1})});
  assert.equal(result.ok,false);
  assert.equal((await fetchSharedGame({endpoint,shareId:'bad',fetchImpl:()=>{throw Error('must not fetch');}})).error.code,'UNAVAILABLE');
});

test('public timeout also covers an indefinitely streaming response body', {timeout:1000}, async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const request=fetchSharedGame({endpoint,shareId:id,fetchImpl:async()=>({
    status:200,ok:true,json:()=>new Promise(()=>{}),
  })});
  // Let the header response resolve before the body stalls.
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(15000);
  assert.equal((await request).error.code,'NETWORK');
});
