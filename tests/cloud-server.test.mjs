import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {projectWith} from './fixtures/cloud-projects.mjs';
import {imageProject} from './fixtures/question-images.mjs';
import {canonicalAddress, createDailyAddressHasher, readVerifiedAddress} from '../supabase/functions/shared-game/client-address.js';
import {createSharedGameServer, readServerEnvironment} from '../supabase/functions/shared-game/server.js';

const origin='https://ruriru-app.github.io';
const service='https://abcdefghijklmnopqrst.supabase.co';
const shareId='G7m2Pk8wQ4t9R3vX6nYzAa';
// Synthetic test-only values. Never use these outside this test process.
const key='sb_secret_fake_test_key_not_a_real_credential';
const hmacKey='test-only-secret-with-at-least-32-bytes';
const environment={SUPABASE_URL:service,SUPABASE_SECRET_KEYS:JSON.stringify({default:key}),
  DEKIRU_RATE_HMAC_KEY:hmacKey,DEKIRU_CLIENT_IP_MODE:'cloudflare-verified'};
const request=(headers={},method='GET')=>new Request(`${service}/functions/v1/shared-game?g=${shareId}`,{
  method,headers:{'CF-Connecting-IP':'192.0.2.9',Origin:origin,...headers},
});
const snapshot=()=>({schemaVersion:1,project:projectWith(),runtimeVersion:'fusuma-1',publicationVersion:1});
function setup(extra={}) {
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options,args:JSON.parse(options.body)});
    return Response.json(url.endsWith('consume_shared_read')?{allowed:true,retry_after_seconds:0}:snapshot());
  };
  return {calls,handler:createSharedGameServer({environment,fetchImpl,now:()=>new Date('2026-09-29T23:59:59Z'),...extra})};
}

test('server environment uses only host secrets, rejects malformed modern key dictionaries',()=>{
  const settings=readServerEnvironment(name=>environment[name]);
  assert.equal(settings.serverKey,key);
  assert.equal(settings.serviceUrl,service);
  assert.equal(settings.clientIpMode,'cloudflare-verified');
  assert.equal(readServerEnvironment(name=>({...environment,SUPABASE_SECRET_KEYS:'broken',SUPABASE_SERVICE_ROLE_KEY:'fallback'})[name]),null);
  assert.equal(readServerEnvironment(name=>({...environment,SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_publishable_wrong'})})[name]),null);
});

test('address parser canonicalizes IPv6/mapped IPv4, rejects hostnames, ports, lists and ambiguous IPv4',()=>{
  for(const [input,want] of [['192.0.2.9','192.0.2.9'],['2001:0DB8:0000:0:0:0:0:1','2001:db8::1'],
    ['::ffff:192.0.2.9','192.0.2.9'],['::ffff:c000:209','192.0.2.9']]) assert.equal(canonicalAddress(input),want);
  for(const input of ['',null,'localhost','127.1','0177.0.0.1','0x7f000001','300.1.1.1','1.1.1.1:443',
    '[2001:db8::1]','fe80::1%eth0','192.0.2.1, 192.0.2.2','192.0.2.9/path']) assert.equal(canonicalAddress(input),null);
});

test('no client header can turn on trust or supply an unverified forwarding fallback',()=>{
  assert.equal(readVerifiedAddress(request(),''),null);
  assert.equal(readVerifiedAddress(request({'DEKIRU_CLIENT_IP_MODE':'cloudflare-verified'}),''),null);
  assert.equal(readVerifiedAddress(request({'X-Forwarded-For':'203.0.113.2'}),'cloudflare-verified'),'192.0.2.9');
  for(const value of ['', '192.0.2.9, 203.0.113.1','bad']) {
    assert.equal(readVerifiedAddress(request({'CF-Connecting-IP':value,'X-Forwarded-For':'203.0.113.2','X-Real-IP':'203.0.113.3'}),'cloudflare-verified'),null);
  }
});

test('opaque address token is domain-separated HMAC-SHA256 and rotates at UTC day boundary',async()=>{
  const hash=createDailyAddressHasher(hmacKey);
  const token=await hash('192.0.2.9','2026-09-29');
  const expected=createHmac('sha256',hmacKey).update('dekiru/shared-read/v1\n2026-09-29\n192.0.2.9').digest('hex');
  assert.equal(token,expected);assert.match(token,/^[a-f0-9]{64}$/);
  assert.notEqual(token,await hash('192.0.2.9','2026-09-30'));
  assert.notEqual(token,await createDailyAddressHasher(hmacKey+'changed')('192.0.2.9','2026-09-29'));
  assert.equal(token,await hash('::ffff:192.0.2.9','2026-09-29'));
  assert.throws(()=>createDailyAddressHasher('too-short'));
  await assert.rejects(hash('bad','2026-09-29'));
  await assert.rejects(hash('192.0.2.9','untrusted-date'));
});

test('server sends only the opaque hash and share ID to two fixed RPCs using host credentials',async()=>{
  const {calls,handler}=setup();
  const res=await handler(request({Authorization:'Bearer attacker',apikey:'attacker','X-Forwarded-For':'203.0.113.7'}));
  assert.equal(res.status,200);assert.deepEqual(await res.json(),snapshot());
  assert.equal(res.headers.get('Cache-Control'),'no-store');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,service+'/rest/v1/rpc/consume_shared_read');
  assert.equal(calls[1].url,service+'/rest/v1/rpc/read_shared_game');
  assert.deepEqual(Object.keys(calls[0].args),['p_client_hash']);
  assert.match(calls[0].args.p_client_hash,/^[a-f0-9]{64}$/);
  assert.deepEqual(calls[1].args,{p_share_id:shareId});
  for(const call of calls){
    const headers=new Headers(call.options.headers);
    assert.equal(headers.get('apikey'),key);
    assert.notEqual(headers.get('Authorization'),'Bearer attacker');
    assert.equal(call.options.method,'POST');assert.equal(call.options.redirect,'error');
    assert.doesNotMatch(call.options.body,/192\.0\.2|203\.0\.113|attacker/);
  }
});

test('missing or unsafe deployment settings keep the endpoint closed without contacting the database',async()=>{
  for(const overrides of [{DEKIRU_CLIENT_IP_MODE:''},{DEKIRU_CLIENT_IP_MODE:'x-forwarded-for'},
    {DEKIRU_RATE_HMAC_KEY:''},{SUPABASE_SECRET_KEYS:'{}'},
    {SUPABASE_URL:'https://attacker.invalid'},{SUPABASE_URL:service+'/wrong'},
    {SUPABASE_URL:'http://abcdefghijklmnopqrst.supabase.co'}]) {
    const {calls,handler}=setup({environment:{...environment,...overrides}});
    const res=await handler(request());assert.equal(res.status,503);assert.equal(calls.length,0);
    assert.doesNotMatch(await res.text(),/secret|HMAC|attacker|postgres/);
  }
  const {calls,handler}=setup();
  assert.equal((await handler(request({},'OPTIONS'))).status,204);
  assert.equal((await handler(request({},'POST'))).status,405);
  assert.equal((await handler(request({Origin:'https://bad.invalid'}))).status,403);
  assert.equal((await handler(request({'CF-Connecting-IP':''}))).status,503);
  assert.equal(calls.length,0);
});

test('rate limit stops lookup, while bad database responses return sanitized unavailable errors',async()=>{
  let calls=0;
  const limited=setup({fetchImpl:async()=>{calls++;return Response.json({allowed:false,retry_after_seconds:17});}});
  const response=await limited.handler(request());assert.equal(response.status,429);assert.equal(calls,1);
  assert.equal(response.headers.get('Retry-After'),'17');
  for(const reply of [()=>new Response('secret SQL error',{status:500}),()=>new Response('invalid json'),()=>Response.json(null)]) {
    const {handler}=setup({fetchImpl:async()=>reply()});const res=await handler(request());
    assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/secret|SQL|json/);
  }
});

test('server aborts stalled RPC headers and bodies without automatic retries', {timeout:2000},async()=>{
  for(const stallBody of [false,true]){
    let calls=0,signal;
    const {handler}=setup({rpcTimeoutMs:25,fetchImpl:async(url,options)=>{
      calls++;signal=options.signal;
      return stallBody?new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'application/json'}}):new Promise(()=>{});
    }});
    const res=await handler(request());assert.equal(res.status,503);assert.equal(calls,1);assert.equal(signal.aborted,true);
  }
});

test('legacy injected service key is supported only when the modern dictionary is absent',async()=>{
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const legacy=[encode({alg:'HS256'}),encode({role:'service_role'}),'testSignature'].join('.');
  const env={...environment,SUPABASE_SECRET_KEYS:undefined,SUPABASE_SERVICE_ROLE_KEY:legacy};
  const {calls,handler}=setup({environment:env});
  assert.equal((await handler(request())).status,200);
  assert.equal(new Headers(calls[0].options.headers).get('Authorization'),`Bearer ${legacy}`);
  const anon=[encode({alg:'HS256'}),encode({role:'anon'}),'testSignature'].join('.');
  assert.equal(readServerEnvironment(name=>({...env,SUPABASE_SERVICE_ROLE_KEY:anon})[name]),null);
});

test('committed self-contained deployment bundle starts closed without secrets and agrees with the source',async()=>{
  const source=await readFile(new URL('../supabase/functions/shared-game/index.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bimport\s|\bexport\s/);
  let serve,fetchCount=0;
  const sandbox={Deno:{env:{get:()=>undefined},serve:handler=>{serve=handler;}},
    fetch:async()=>{fetchCount++;throw new Error('Must not fetch');},
    Request,Response,Headers,URL,TextEncoder,AbortController,crypto,atob,btoa,setTimeout,clearTimeout};
  runInNewContext(source,sandbox,{timeout:1000});
  assert.equal(typeof serve,'function');
  const response=await serve(request());
  assert.equal(response.status,503);assert.equal(fetchCount,0);
  const {calls,handler}=setup();
  sandbox.Deno.env.get=name=>environment[name];
  sandbox.fetch=async(url,options)=>{
    calls.push({url,body:options.body});
    return Response.json(url.endsWith('consume_shared_read')?{allowed:true}:snapshot());
  };
  runInNewContext(source,{...sandbox},{timeout:1000});
  const actual=await serve(request());
  const expected=await handler(request());
  assert.equal(actual.status,expected.status);
  assert.deepEqual(await actual.json(),await expected.json());
  const pictured={schemaVersion:1,project:imageProject(),runtimeVersion:'fusuma-2',publicationVersion:2};
  sandbox.fetch=async url=>Response.json(url.endsWith('consume_shared_read')?{allowed:true}:pictured);
  runInNewContext(source,{...sandbox},{timeout:1000});
  const imageResponse=await serve(request());assert.equal(imageResponse.status,200);
  assert.deepEqual(await imageResponse.json(),pictured,'generated endpoint retains v2 image');
});
