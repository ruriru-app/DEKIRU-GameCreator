import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCloudProject,serializeCloudProject} from '../core/cloud/project-validation.js';
import {checkedPublicGame} from '../core/cloud/public-api.js';
import {resolveRuntime} from '../p/runtime-registry.js';
import {createCloudState} from '../core/cloud/cloud-state.js';
import {imageProject,pngImage,imageAtBytes} from './fixtures/question-images.mjs';
import {imageProjectBytes,imageTextBytes} from './fixtures/cloud-image-projects.mjs';

test('v2 is strict, canonical and preserves image data; v1 never accepts an image',()=>{
  const p=imageProject(),result=validateCloudProject(p);assert.equal(result.ok,true);assert.deepEqual(result.data,p);
  const reverse=structuredClone(p);reverse.questions[0].image=Object.fromEntries(Object.entries(p.questions[0].image).reverse());
  assert.equal(serializeCloudProject(reverse),JSON.stringify(p));
  for(const mutate of [p=>p.schemaVersion=1,p=>p.questions[0].extra=true,p=>p.questions[0].image.name='file',
    p=>p.questions[0].image.width=2,p=>p.questions[0].image.dataUrl=p.questions[0].image.dataUrl.replace('png','jpeg'),
    p=>p.questions[0].image=imageAtBytes(131073),p=>p.questions[0].image.alt='😀'.repeat(101)]){
    const bad=imageProject();mutate(bad);assert.equal(validateCloudProject(bad).ok,false);
  }
});
test('image project capacity is exact canonical 2 MiB, with independent 256 KiB text cap',()=>{
  for(const [p,ok] of [[imageProjectBytes(2097152),true],[imageProjectBytes(2097153),false],[imageTextBytes(262144),true],[imageTextBytes(262145),false]]){
    for(const q of p.questions){assert.ok([...q.prompt].length<=1000);assert.ok([...q.romajiHint].length<=800);}
    assert.equal(validateCloudProject(p,{mode:'publish'}).ok,ok);
  }
  assert.equal(Buffer.byteLength(serializeCloudProject(imageProjectBytes(2097152))),2097152);
});
test('image-only changes remain unsaved and do not change a published snapshot',()=>{
  const p=imageProject();let live=structuredClone(p);
  const state=createCloudState({getProject:()=>live});state.attach({ownerId:'a',record:{id:'g',version:1,project:p,publication:null}});
  live.questions[0].image={...pngImage,placement:'left'};
  assert.equal(state.isCloudSaved(live),false);assert.notEqual(serializeCloudProject(p),serializeCloudProject(live));
});
test('outer sharing envelope stays v1, project and runtime versions must agree',async()=>{
  const envelope={schemaVersion:1,project:imageProject(),runtimeVersion:'fusuma-2',publicationVersion:1};
  assert.equal(checkedPublicGame(envelope).ok,true);
  assert.equal(checkedPublicGame({...envelope,runtimeVersion:'fusuma-1'}).ok,false);
  assert.equal(checkedPublicGame({...envelope,schemaVersion:2}).ok,false);
  assert.equal(typeof (await resolveRuntime('fusuma-2')).mount,'function');
  await assert.rejects(()=>resolveRuntime('https://evil.invalid/code.js'));
});
