import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectStore} from '../Typing/creator/creator-state.js';
import {imageProject,pngImage,jpegImage} from './fixtures/question-images.mjs';
const module=await import('../Typing/creator/question-image-controller.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function setup() {
  assert.equal(typeof module.createQuestionImageController,'function');
  const store=createProjectStore(imageProject()),pending=[];
  const controller=module.createQuestionImageController({store,processImage:(file,options)=>new Promise((resolve,reject)=>pending.push({file,options,resolve,reject}))});
  return {store,pending,controller};
}
test('last image selection wins even if earlier decoding ignores abort and finishes later',async()=>{
  const {store,pending,controller:c}=setup();
  const a=c.select('q1','A'),b=c.select('q1','B');
  assert.equal(c.getState().busy,true);assert.deepEqual(c.getState().pendingIds,['q1']);
  assert.equal(pending[0].options.signal.aborted,true);
  pending[1].resolve(pngImage);await b;pending[0].resolve(jpegImage);await a;
  assert.deepEqual(store.getSnapshot().questions[0].image,pngImage);
  assert.equal(c.getState().busy,false);c.destroy();
});
test('deletion, remove, reset with reused ID, and destroy prevent stale results',async()=>{
  for(const action of ['delete','remove','reset','destroy']) {
    const {store,pending,controller:c}=setup(),p=c.select('q1','A');
    if(action==='delete')store.removeQuestion('q1');
    if(action==='remove')c.remove('q1');
    if(action==='reset'){c.reset();const fresh=imageProject();delete fresh.questions[0].image;store.loadProject(fresh);}
    if(action==='destroy')c.destroy();
    const before=store.getSnapshot();pending[0].resolve(jpegImage);await p;
    assert.deepEqual(store.getSnapshot(),before,action);assert.equal(c.getState().busy,false);
    c.destroy();
  }
});
test('processing keeps latest placement and alt edits; failure preserves existing image',async()=>{
  const {store,pending,controller:c}=setup(),a=c.select('q1','A');
  c.setPlacement('q1','right');c.setAlt('q1','変更した説明');
  pending[0].resolve(jpegImage);await a;
  assert.deepEqual(store.getSnapshot().questions[0].image,{...jpegImage,placement:'right',alt:'変更した説明'});
  const before=store.getSnapshot(),b=c.select('q1','too large');
  pending[1].reject(Error('128 KiB 以下にできません'));await b;
  assert.deepEqual(store.getSnapshot(),before);assert.match(c.getState().errors.q1,/128 KiB/);
  c.remove('q1');assert.equal(c.getState().errors.q1,undefined);c.destroy();
});
test('subscriptions track busy state without marking project dirty on failed selection',async()=>{
  const {store,pending,controller:c}=setup(),states=[];store.markSaved();
  const off=c.subscribe(s=>states.push(s.busy)),p=c.select('q1','invalid');
  pending[0].reject(Error('invalid'));await p;
  assert.deepEqual(states,[true,false]);assert.equal(store.getState().unsavedChanges,false);
  off();c.reset();assert.deepEqual(states,[true,false]);c.destroy();
});
