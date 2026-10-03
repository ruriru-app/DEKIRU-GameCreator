import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalTestClients} from './local-supabase.mjs';
import {projectWith,projectBytes} from '../fixtures/cloud-projects.mjs';
import {serializeCloudProject,validateCloudProject} from '../../core/cloud/project-validation.js';
import {imageProject,pngImage,imageAtBytes,zeroComponentJpeg,invalidJpegScans} from '../fixtures/question-images.mjs';
import {imageProjectBytes,imageTextBytes} from '../fixtures/cloud-image-projects.mjs';
import {sharedProject,sharedProjectBytes,sharedTextBytes} from '../fixtures/shared-image-projects.mjs';
const args=(gameId=null,expectedVersion=0,project=projectWith())=>({requestId:randomUUID(),gameId,expectedVersion,projectText:serializeCloudProject(project)});
async function call(client,command,value) {
  const result=await client.rpc('mutate_game',{p_command:command,p_args:value});
  assert.equal(result.error,null,'RPC HTTP request should succeed');
  return result.data;
}
test('compact image boundaries and invalid pools agree across JS and SQL',async t=>{
  const {ownerA:a,admin,cleanup}=await createLocalTestClients();t.after(cleanup);
  admin.setImageWrites(true);admin.setSharedImageWrites(true);t.after(()=>{admin.setImageWrites(false);admin.setSharedImageWrites(false);});
  const cases=[sharedProject(),sharedProjectBytes(2097152),sharedProjectBytes(2097153),sharedTextBytes(262144),sharedTextBytes(262145),
    sharedProject(undefined,200),sharedProject(undefined,201),sharedProject(imageAtBytes(131072)),sharedProject(imageAtBytes(131073))];
  for(const change of [p=>p.questions[0].image.imageId='img99',p=>p.images.push({...p.images[0]}),p=>p.images.push({...p.images[0],id:'img2'}),p=>p.images[0].width=2,p=>p.questions[0].image.alt='😀'.repeat(101),p=>p.images[0].id='img01']){const p=sharedProject();change(p);cases.push(p);}
  for(const p of cases){
    const expected=validateCloudProject(p),text=serializeCloudProject(p),db=admin.validateProject(text);
    assert.equal(db.canonical,text,'canonical compact bytes match');assert.equal(db.validation.ok,expected.ok);
    if(!expected.ok)assert.equal(db.validation.error.code,expected.error.code);
    const actual=await call(a,'save',args(null,0,p));assert.equal(actual.ok,expected.ok);
    if(!expected.ok)assert.equal(actual.error.code,expected.error.code);
  }
});
test('compact writes require both gates; read, retry, ownership and snapshot semantics survive',async t=>{
  const {ownerA:a,ownerB:b,admin,cleanup}=await createLocalTestClients();t.after(cleanup);t.after(()=>{admin.setImageWrites(false);admin.setSharedImageWrites(false);});
  admin.setImageWrites(true);admin.setSharedImageWrites(false);
  assert.equal((await call(a,'save',args(null,0,sharedProject()))).error.code,'SERVICE_UNAVAILABLE');
  admin.setSharedImageWrites(true);admin.setImageWrites(false);
  assert.equal((await call(a,'save',args(null,0,sharedProject()))).error.code,'SERVICE_UNAVAILABLE');admin.setImageWrites(true);
  const request=args(null,0,sharedProject()),created=await call(a,'save',request);assert.equal(created.ok,true);
  assert.deepEqual(await call(a,'save',request),created);let game=created.data;
  assert.equal((await b.rpc('load_game',{p_game_id:game.id})).data.error.code,'UNAVAILABLE');
  const mutate=async command=>{const result=await call(a,command,{gameId:game.id,expectedVersion:game.version,requestId:randomUUID()});if(result.ok)game=result.data;return result;};
  assert.equal((await mutate('publish')).ok,true);const share=game.publication.shareId;assert.equal(game.publication.runtimeVersion,'fusuma-3');
  const draft=sharedProject();draft.questions[0].image.placement='right';game=(await call(a,'save',args(game.id,game.version,draft))).data;
  assert.equal((await admin.readShared(share)).data.project.questions[0].image.placement,'top');
  assert.equal((await mutate('publish')).ok,true);assert.equal(game.publication.shareId,share);
  admin.setSharedImageWrites(false);
  assert.equal((await a.rpc('load_game',{p_game_id:game.id})).data.ok,true);
  assert.equal((await admin.readShared(share)).data.project.schemaVersion,3);
  assert.equal((await mutate('publish')).error.code,'SERVICE_UNAVAILABLE');
  assert.equal((await mutate('unpublish')).ok,true);assert.equal((await admin.readShared(share)).data,null);
  assert.equal((await mutate('republish')).error.code,'SERVICE_UNAVAILABLE');
  admin.setSharedImageWrites(true);assert.equal((await mutate('republish')).ok,true);assert.equal(game.publication.shareId,share);
  assert.equal((await admin.readShared(share)).data.project.questions[0].image.placement,'right');
});
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

test('image projects have matching JS/DB validation and exact canonical capacity',async t=>{
  const {ownerA:a,admin,cleanup}=await createLocalTestClients();t.after(cleanup);
  admin.setImageWrites(true);t.after(()=>admin.setImageWrites(false));
  const cases=[imageProject(),imageProject(imageAtBytes(131072)),imageProject(imageAtBytes(131073)),
    imageProjectBytes(2097152),imageProjectBytes(2097153),imageTextBytes(262144),imageTextBytes(262145),
    imageProject({...pngImage,alt:'😀'.repeat(101)}),imageProject({...pngImage,width:2}),imageProject(zeroComponentJpeg),...invalidJpegScans().map(imageProject)];
  for(const p of cases){
    const expected=validateCloudProject(p),text=serializeCloudProject(p),db=admin.validateProject(text);
    assert.equal(db.canonical,text,'SQL and JS canonical bytes agree');
    assert.equal(db.validation.ok,expected.ok);
    if(!expected.ok)assert.equal(db.validation.error.code,expected.error.code);
    const actual=await call(a,'save',args(null,0,p));assert.equal(actual.ok,expected.ok);
    if(!expected.ok)assert.equal(actual.error.code,expected.error.code);
  }
});

test('real image ownership, immutable publication, same URL updates and release gate',async t=>{
  const {ownerA:a,ownerB:b,anon,admin,cleanup}=await createLocalTestClients();t.after(cleanup);
  admin.setImageWrites(false);t.after(()=>admin.setImageWrites(false));
  assert.equal((await call(a,'save',args(null,0,imageProject()))).error.code,'SERVICE_UNAVAILABLE');
  admin.setImageWrites(true);
  let game=(await call(a,'save',args(null,0,imageProject()))).data;
  assert.equal((await b.rpc('load_game',{p_game_id:game.id})).data.error.code,'UNAVAILABLE');
  assert.notEqual((await anon.rpc('load_game',{p_game_id:game.id})).error,null);
  const mutate=async command=>{const result=await call(a,command,{gameId:game.id,expectedVersion:game.version,requestId:randomUUID()});if(result.ok)game=result.data;return result;};
  assert.equal((await mutate('publish')).ok,true);const share=game.publication.shareId;
  const imageDraft=imageProject({...pngImage,placement:'right'});
  game=(await call(a,'save',args(game.id,game.version,imageDraft))).data;
  assert.equal((await admin.readShared(share)).data.project.questions[0].image.placement,'top','save does not update published picture');
  assert.equal((await mutate('publish')).ok,true);assert.equal(game.publication.shareId,share);
  assert.equal((await admin.readShared(share)).data.project.questions[0].image.placement,'right');
  admin.setImageWrites(false);
  assert.equal((await a.rpc('load_game',{p_game_id:game.id})).data.ok,true);
  assert.equal((await mutate('publish')).error.code,'SERVICE_UNAVAILABLE');
  assert.equal((await mutate('unpublish')).ok,true);assert.equal((await admin.readShared(share)).data,null);
  assert.equal((await mutate('republish')).error.code,'SERVICE_UNAVAILABLE');
  admin.setImageWrites(true);assert.equal((await mutate('republish')).ok,true);
  assert.equal((await admin.readShared(share)).data.project.questions[0].image.placement,'right');
  assert.notEqual((await anon.rpc('read_shared_game',{p_share_id:share})).error,null,'direct anonymous DB reads remain closed');
  admin.setImageWrites(false);assert.equal((await mutate('delete')).ok,true);assert.equal((await admin.readShared(share)).data,null);
});
