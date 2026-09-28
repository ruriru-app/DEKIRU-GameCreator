import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalTestClients} from './local-supabase.mjs';
import {projectWith,projectBytes} from '../fixtures/cloud-projects.mjs';
import {serializeCloudProject,validateCloudProject} from '../../core/cloud/project-validation.js';
const args=(gameId=null,expectedVersion=0,project=projectWith())=>({requestId:randomUUID(),gameId,expectedVersion,projectText:serializeCloudProject(project)});
async function call(client,command,value) {
  const result=await client.rpc('mutate_game',{p_command:command,p_args:value});
  assert.equal(result.error,null,'RPC HTTP request should succeed');
  return result.data;
}
test('real JWTs enforce ownership, atomic quotas, version conflicts and lost-response retries',async t=>{
  const {ownerA:a,ownerB:b,anon,admin,cleanup}=await createLocalTestClients();t.after(cleanup);
  assert.notEqual((await anon.rpc('list_games')).error,null,'anonymous cannot invoke owner RPC');
  const created=[];
  for(let i=0;i<19;i++){
    const result=await call(a,'save',args());assert.equal(result.ok,true);created.push(result.data);
  }
  admin.resetRates(a.id);
  const race=await Promise.all([call(a,'save',args()),call(a,'save',args())]);
  assert.equal(race.filter(r=>r.ok).length,1,'only one remaining save slot succeeds');
  assert.equal(race.find(r=>!r.ok).error.code,'LIMIT');
  const game=created[0];
  assert.equal((await b.rpc('load_game',{p_game_id:game.id})).data.error.code,'UNAVAILABLE');
  assert.equal((await call(b,'delete',{...args(game.id,1),projectText:undefined})).error.code,'UNAVAILABLE');
  const update=args(game.id,1);
  const first=await call(a,'save',update),retry=await call(a,'save',update);
  assert.deepEqual(retry,first,'lost response does not perform operation twice');
  assert.equal((await call(a,'save',args(game.id,1))).error.code,'CONFLICT');
  admin.resetRates(a.id);
  for(const game of created.slice(1,10)){
    assert.equal((await call(a,'publish',{gameId:game.id,expectedVersion:1,requestId:randomUUID()})).ok,true);
  }
  const publish=await Promise.all(created.slice(10,12).map(game=>call(a,'publish',{gameId:game.id,expectedVersion:1,requestId:randomUUID()})));
  assert.equal(publish.filter(r=>r.ok).length,1,'only one remaining publish slot succeeds');
  assert.equal(publish.find(r=>!r.ok).error.code,'LIMIT');
});
test('browser and DB validators agree at UTF8 capacity, Unicode and numeric boundaries',async t=>{
  const {ownerA:a,admin,cleanup}=await createLocalTestClients();t.after(cleanup);
  const cases=[projectBytes(262144),projectBytes(262145),projectWith(201)];
  for(const volume of [0,0.000001,1e-7,0.12345678901234567,1]){
    const p=projectWith();p.settings.volume=volume;cases.push(p);
  }
  const emoji=projectWith();emoji.title='😀'.repeat(81);cases.push(emoji);
  const lone=projectWith();lone.questions[0].prompt='\ud800';cases.push(lone);
  for(const p of cases){
    const expected=validateCloudProject(p,{mode:'draft'});
    const actual=await call(a,'save',args(null,0,p));
    assert.equal(actual.ok,expected.ok);
    if(!expected.ok) assert.equal(actual.error.code,expected.error.code);
  }
  admin.resetRates(a.id);
});
