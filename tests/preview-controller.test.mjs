import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectStore} from '../Typing/creator/creator-state.js';
import {imageProject,pngImage} from './fixtures/question-images.mjs';
const mod=await import('../Typing/creator/preview-controller.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function setup(){
  assert.equal(typeof mod.createPreviewController,'function');
  const p=imageProject();p.questions.push({...p.questions[0],id:'q2'},{...p.questions[0],id:'q3'});
  const store=createProjectStore(p),events=[],views=[];
  // Replace DOM mounts/audio device only; lifecycle decisions and store are real.
  const mount=kind=>args=>{const view={kind,project:args.project,questionId:args.questionId,destroy(){events.push('destroy-'+kind);},update(next){Object.assign(view,next);},start(){events.push('start');}};views.push(view);return view;};
  const audioManager={stopAll(){events.push('stop-audio');},setVolume(v){events.push(['volume',v]);},setMuted(v){events.push(['muted',v]);}};
  const preview=mod.createPreviewController({store,host:{},manifest:{},audioManager,mountGame:mount('game'),mountQuestion:mount('question')});
  return {store,preview,events,views};
}
test('selecting a question stops active game/audio without modifying saved state',()=>{
  const {store,preview,events,views}=setup(),before=store.getState();
  preview.selectQuestion('q2');assert.deepEqual(store.getState(),before);
  assert.deepEqual(preview.getState(),{mode:'question',selectedId:'q2'});
  assert.ok(events.indexOf('destroy-game')<events.indexOf('stop-audio'));
  assert.equal(views.at(-1).questionId,'q2');
  store.setQuestionImage('q2',{...pngImage,placement:'left'});
  assert.equal(views.at(-1).project.questions[1].image.placement,'left');
  assert.equal(store.getState().previewDirty,true);preview.destroy();
});
test('ID follows reorder; deletion chooses next then previous then empty',()=>{
  const {store,preview}=setup();preview.selectQuestion('q2');store.moveQuestion('q2',-1);
  assert.equal(preview.getState().selectedId,'q2');
  store.removeQuestion('q2');assert.equal(preview.getState().selectedId,'q1');
  preview.selectQuestion('q3');store.removeQuestion('q3');assert.equal(preview.getState().selectedId,'q1');
  store.removeQuestion('q1');assert.equal(preview.getState().selectedId,null);preview.destroy();
});
test('returning to full game uses latest project/settings and marks only preview clean',()=>{
  const {store,preview,events,views}=setup();preview.selectQuestion('q1');store.setTitle('新版');store.setMuted(true);
  preview.setMuted(true);preview.setVolume(.2);preview.showGame();
  assert.equal(views.at(-1).kind,'game');assert.equal(views.at(-1).project.title,'新版');
  assert.equal(events.includes('start'),false,'return shows start cover');
  assert.equal(store.getState().previewDirty,false);assert.equal(store.getState().unsavedChanges,true);
  preview.restartGame();assert.equal(events.at(-1),'start');preview.destroy();
});
test('incomplete questions remain previewable but cannot start full game; reset clears selection',()=>{
  const {store,preview,views}=setup();preview.selectQuestion('q1');
  store.updateQuestion('q1',{reading:''});const count=views.length;
  assert.throws(()=>preview.showGame());assert.equal(views.length,count);
  assert.equal(preview.getState().mode,'question');preview.reset();
  assert.equal(preview.getState().selectedId,null);preview.destroy();
});
