import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudEditor} from '../Typing/creator/cloud-controls.js';
import {createProjectStore} from '../Typing/creator/creator-state.js';
import {createCloudState} from '../core/cloud/cloud-state.js';
import {projectWith} from './fixtures/cloud-projects.mjs';
import {ok,failure} from '../core/cloud/contracts.js';
const meta={id:'game-a',version:1,title:'教材',questionCount:1,publication:null,publicationDirty:false};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function setup(overrides={}) {
  const store=createProjectStore(projectWith()),cloudState=createCloudState({getProject:store.getSnapshot}),calls=[];
  const api={
    saveDraft:async value=>{calls.push(['save',value]);return ok({...meta,version:value.expectedVersion+1});},
    publishGame:async value=>{calls.push(['publish',value]);return ok({...meta,version:value.expectedVersion+1,publication:{shareId:'G7m2Pk8wQ4t9R3vX6nYzAa',status:'published',version:1}});},
    loadGame:async()=>ok({...meta,project:projectWith()}),
    ...overrides,
  };
  const editor=createCloudEditor({store,cloudState,api});
  editor.setUser({id:'a'});
  return {store,cloudState,calls,api,editor};
}
test('save and publish are separate; publish uses saved version and preserves local flags',async()=>{
  const {editor,store,cloudState,calls}=setup();store.setTitle('編集した題名');
  assert.equal((await editor.save()).ok,true);
  assert.deepEqual(calls.map(c=>c[0]),['save']);
  assert.equal(store.getState().unsavedChanges,true);
  assert.equal(cloudState.isCloudSaved(store.getSnapshot()),true);
  await editor.publish();
  assert.deepEqual(calls.map(c=>c[0]),['save','publish']);
  assert.equal(calls[1][1].expectedVersion,1);
});
test('new edits during save remain unsaved and prevent publishing an unconfirmed snapshot',async()=>{
  const gate=deferred(),{editor,store,calls,cloudState}=setup({saveDraft:()=>gate.promise});
  const work=editor.publish();store.setTitle('保存中に編集');gate.resolve(ok(meta));
  const result=await work;assert.equal(result.ok,false);
  assert.equal(cloudState.isCloudSaved(store.getSnapshot()),false);
  assert.equal(calls.length,0);
});
test('account changes and opening a file invalidate late responses and old game ids',async()=>{
  const gate=deferred(),s=setup({saveDraft:()=>gate.promise});
  const work=s.editor.save();s.editor.setUser({id:'b'});gate.resolve(ok(meta));await work;
  assert.equal(s.cloudState.getState().gameMeta,null);
  const next=setup();await next.editor.save();
  next.editor.detach();next.store.loadProject(projectWith(2));await next.editor.save();
  assert.equal(next.calls.at(-1)[1].gameId,null);
});
test('network retry reuses the exact mutation even when the editor changes; repeated clicks do not duplicate',async()=>{
  const gate=deferred(),calls=[];
  const {editor,store,cloudState}=setup({saveDraft:async a=>{calls.push(a);return calls.length===1?gate.promise:ok(meta);}});
  const first=editor.save();assert.equal((await editor.save()).ok,false);
  gate.resolve(failure('NETWORK'));await first;
  store.setTitle('通信後の変更');
  assert.equal(editor.getState().canRetry,true);
  assert.equal((await editor.save()).ok,false);
  await editor.retry();
  assert.deepEqual(calls[1],calls[0]);assert.equal(cloudState.isCloudSaved(store.getSnapshot()),false);
  assert.equal(editor.getState().canRetry,false);
});
test('validation, conflicts and unauthenticated state do not publish or discard edits',async()=>{
  const s=setup({saveDraft:async()=>failure('CONFLICT')});
  s.store.setTitle('保存していない内容');
  assert.equal((await s.editor.publish()).error.code,'CONFLICT');
  assert.equal(s.store.getSnapshot().title,'保存していない内容');
  assert.equal(s.calls.length,0);
  s.editor.setUser(null);assert.equal((await s.editor.save()).error.code,'UNAUTHENTICATED');
  s.editor.setUser({id:'a'});s.store.setTitle('');assert.equal((await s.editor.publish()).error.code,'VALIDATION');
});
test('cloud load never falsely marks file saved; late load after edits cannot replace them',async()=>{
  const s=setup();await s.editor.load('game-a');
  assert.equal(s.store.getState().hasProjectFile,false);
  assert.equal(s.cloudState.isCloudSaved(s.store.getSnapshot()),true);
  const gate=deferred(),next=setup({loadGame:()=>gate.promise});
  const work=next.editor.load('game-a');next.store.setTitle('読み込み中の編集');gate.resolve(ok({...meta,project:projectWith(2)}));
  assert.equal((await work).error.code,'CONFLICT');
  assert.equal(next.store.getSnapshot().title,'読み込み中の編集');
});
test('resume link uses last saved snapshot, not unsaved local edits; leaving warns for unapplied paste',async()=>{
  const s=setup();await s.editor.save();s.store.setTitle('まだ保存していない');
  assert.equal(s.editor.getResumeLink().record.project.title,projectWith().title);
  assert.equal(s.editor.shouldWarnOnLeave(''),true);
  s.store.markSaved();assert.equal(s.editor.shouldWarnOnLeave(''),false);
  assert.equal(s.editor.shouldWarnOnLeave('未反映の表'),true);
});
