import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedGameHandler } from '../supabase/functions/shared-game/handler.js';
import { projectWith } from './fixtures/cloud-projects.mjs';
const id='G7m2Pk8wQ4t9R3vX6nYzAa', origin='https://ruriru-app.github.io';
const request=(query='g='+id,options={})=>new Request('https://api.invalid/shared-game?'+query,options);
function setup(extra={}) {
  return createSharedGameHandler({
    lookup:async()=>({schemaVersion:1,project:projectWith(),runtimeVersion:'fusuma-1',publicationVersion:1,ownerId:'private'}),
    consumeLimit:async()=>({allowed:true,retry_after_seconds:0}),
    getClientAddress:()=> '192.0.2.1',hashAddress:async(address,date)=>'hmac-'+date,
    now:()=>new Date('2026-09-29T01:00:00Z'), allowedOrigins:[origin],...extra,
  });
}
test('server exposes one whitelisted snapshot with no-store and allowed CORS', async () => {
  const res=await setup()(request(undefined,{headers:{Origin:origin}}));
  assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'no-store');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(Object.hasOwn(await res.json(),'ownerId'),false);
});
test('unknown, stopped, deleted and malformed IDs share the same unavailable response', async () => {
  const missing=setup({lookup:async()=>null}), body=await(await missing(request())).text();
  for(const query of ['g=bad','g='+id+'&g='+id,'g='+id+'&ownerId=other','']) {
    const res=await missing(request(query));assert.equal(res.status,404);assert.equal(await res.text(),body);
  }
});
test('server refuses extra methods; CORS never substitutes for access checks', async () => {
  assert.equal((await setup()(request(undefined,{method:'POST'}))).status,405);
  assert.equal((await setup()(request(undefined,{method:'OPTIONS',headers:{Origin:origin}}))).status,204);
  const unknown=await setup()(request(undefined,{headers:{Origin:'https://evil.invalid'}}));
  assert.equal(unknown.status,403);assert.equal(unknown.headers.get('Access-Control-Allow-Origin'),null);
});
test('server consumes opaque daily hash; limits 600 requests and exposes retry-after', async () => {
  let count=0,hash;
  const handler=setup({consumeLimit:async value=>{hash=value;return {allowed:++count<=600,retry_after_seconds:60};}});
  for(let i=0;i<600;i++) assert.equal((await handler(request())).status,200);
  const res=await handler(request());assert.equal(res.status,429);
  assert.equal(res.headers.get('Retry-After'),'60');assert.equal(hash,'hmac-2026-09-29');
});
test('untrusted address, unavailable database, bad runtime or data fail closed without details', async () => {
  for(const overrides of [
    {getClientAddress:()=>null},
    {lookup:async()=>{throw Error('SQL secret');}},
    {consumeLimit:async()=>{throw Error('secret');}},
    {lookup:async()=>({project:projectWith(),runtimeVersion:'javascript:bad'})},
  ]) {
    const res=await setup(overrides)(request()); assert.equal(res.status,503);
    assert.doesNotMatch(await res.text(),/secret|SQL/);
    assert.equal(res.headers.get('Cache-Control'),'no-store');
  }
});
