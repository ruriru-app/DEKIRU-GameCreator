import test from 'node:test';
import assert from 'node:assert/strict';
import {packProjectImages} from '../core/project-image-pool.js';
import {validateCloudProject,serializeCloudProject} from '../core/cloud/project-validation.js';
import {createOwnerApi} from '../core/cloud/owner-api.js';
import {checkedPublicGame} from '../core/cloud/public-api.js';
import {createSharedGameHandler} from '../supabase/functions/shared-game/handler.js';
import {createCloudEditor} from '../Typing/creator/cloud-controls.js';
import {createProjectStore} from '../Typing/creator/creator-state.js';
import {createCloudState} from '../core/cloud/cloud-state.js';
import {resolveRuntime} from '../p/runtime-registry.js';
import {imageProject,imageAtBytes} from './fixtures/question-images.mjs';
const meta={id:'g',version:1,publication:null,publicationDirty:false};
function repeated(){const p=imageProject(imageAtBytes(100000));p.questions=Array.from({length:25},(_,i)=>({...p.questions[0],id:'q'+i}));return p;}
test('new wire format is validated without expanding public responses',async()=>{
  const p=packProjectImages(repeated()),envelope={schemaVersion:1,project:p,runtimeVersion:'fusuma-3',publicationVersion:1};
  assert.equal(validateCloudProject(p).ok,true);
  assert.deepEqual(checkedPublicGame(envelope).data,envelope);
  assert.equal(checkedPublicGame({...envelope,runtimeVersion:'fusuma-2'}).ok,false);
  assert.equal(typeof (await resolveRuntime('fusuma-3')).mount,'function');
  const handler=createSharedGameHandler({lookup:async()=>envelope,consumeLimit:async()=>({allowed:true}),getClientAddress:()=> 'test',hashAddress:()=> 'hash',allowedOrigins:[]});
  const response=await handler(new Request('https://example.com/?g=G7m2Pk8wQ4t9R3vX6nYzAa'));
  assert.equal(response.status,200);const text=await response.text();assert.ok(Buffer.byteLength(text)<200000);
  assert.deepEqual(JSON.parse(text),envelope);
});
test('owner API packs only when enabled and expands validated loads',async()=>{
  const p=repeated(),calls=[],api=createOwnerApi({client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,data:name==='load_game'?{...meta,project:packProjectImages(p)}:meta}};}}});
  const args={gameId:null,expectedVersion:0,requestId:'r',project:p};
  assert.equal((await api.saveDraft(args)).error.code,'LIMIT');assert.equal(calls.length,0);
  assert.equal((await api.saveDraft({...args,useSharedImages:true})).ok,true);
  assert.equal(JSON.parse(calls[0].args.p_args.projectText).schemaVersion,3);
  assert.ok(Buffer.byteLength(calls[0].args.p_args.projectText)<2097152);
  assert.equal(Object.hasOwn(calls[0].args.p_args,'useSharedImages'),false);
  assert.deepEqual((await api.loadGame('g')).data.project,p);
});
test('save retry captures format and request id; expanded snapshots preserve dirty tracking',async()=>{
  let enabled=true,first=true;const calls=[];
  const p=repeated(),store=createProjectStore(p),cloudState=createCloudState({getProject:store.getSnapshot});
  const api=createOwnerApi({client:{rpc:async(name,args)=>{calls.push(args.p_args);if(first){first=false;return{status:0};}return{data:{ok:true,data:meta}};}}});
  const editor=createCloudEditor({store,cloudState,api,questionImagesEnabled:()=>true,sharedImagesEnabled:()=>enabled});editor.setUser({id:'owner'});
  assert.equal((await editor.save()).error.code,'NETWORK');enabled=false;
  assert.equal((await editor.retry()).ok,true);assert.deepEqual(calls[0],calls[1]);
  assert.equal(cloudState.isCloudSaved(store.getSnapshot()),true);
  store.setTitle('changed');assert.equal(cloudState.isCloudSaved(store.getSnapshot()),false);
});
test('malformed compact loads cannot enter editor state',async()=>{
  const p=packProjectImages(imageProject());p.questions[0].image.imageId='img99';
  const api=createOwnerApi({client:{rpc:async()=>({data:{ok:true,data:{...meta,project:p}}})}});
  assert.equal((await api.loadGame('g')).ok,false);
  assert.equal(validateCloudProject(p).ok,false);
});
