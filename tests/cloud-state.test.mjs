import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudState} from '../core/cloud/cloud-state.js';
import {createProjectStore} from '../Typing/creator/creator-state.js';
import {projectWith} from './fixtures/cloud-projects.mjs';
const meta=(overrides={})=>({id:'game-a',version:1,title:'教材',questionCount:1,updatedAt:'2026-09-29T00:00:00Z',publication:null,publicationDirty:false,...overrides});
test('cloud save never marks newer edits saved, and does not affect file or preview states',()=>{
  const store=createProjectStore(projectWith()),state=createCloudState({getProject:store.getSnapshot});
  const snapshot=store.getSnapshot();
  state.beginSave({ownerId:'a',requestId:'request',snapshot});
  store.setTitle('新しい編集');
  assert.equal(state.markSaved({ownerId:'a',requestId:'request',snapshot,meta:meta()}),true);
  assert.equal(state.isCloudSaved(store.getSnapshot()),false);
  assert.equal(store.getState().hasProjectFile,false);assert.equal(store.getState().previewDirty,true);
  store.markExported();assert.equal(state.getState().cloudDirty,true);
});
test('account change and file replacement invalidate all delayed save responses',()=>{
  let project=projectWith();const state=createCloudState({getProject:()=>project});
  state.beginSave({ownerId:'a',requestId:'first',snapshot:project});
  state.detach();
  assert.equal(state.markSaved({ownerId:'a',requestId:'first',snapshot:project,meta:meta()}),false);
  state.attach({ownerId:'b',record:{...meta({id:'b-game'}),project}});
  assert.equal(state.markPublished({ownerId:'a',meta:meta({version:2})}),false);
  assert.equal(state.getState().gameMeta.id,'b-game');
});
test('publication content changes are tracked independently from draft and version',()=>{
  let project=projectWith();const state=createCloudState({getProject:()=>project});
  state.attach({ownerId:'a',record:{...meta({publication:{shareId:'G7m2Pk8wQ4t9R3vX6nYzAa',version:1,status:'published'},publicationDirty:false}),project}});
  assert.equal(state.getState().publicationDirty,false);
  project={...project,title:'編集'};
  assert.equal(state.getState().publicationDirty,true);
  state.beginSave({ownerId:'a',requestId:'save',snapshot:project});
  state.markSaved({ownerId:'a',requestId:'save',snapshot:project,meta:meta({version:3,publicationDirty:true,publication:{version:1}})});
  assert.equal(state.isCloudSaved(project),true);assert.equal(state.getState().publicationDirty,true);
  state.markPublished({ownerId:'a',meta:meta({version:4,publicationDirty:false,publication:{version:2}})});
  assert.equal(state.getState().publicationDirty,false);
});
test('state clones prevent accidental changes and request/snapshot mismatch is ignored',()=>{
  const project=projectWith(),state=createCloudState({getProject:()=>project}),snapshot=structuredClone(project);
  state.beginSave({ownerId:'a',requestId:'one',snapshot});
  assert.equal(state.markSaved({ownerId:'a',requestId:'wrong',snapshot,meta:meta()}),false);
  assert.equal(state.markSaved({ownerId:'a',requestId:'one',snapshot:{...snapshot,title:'different'},meta:meta()}),false);
  state.markSaved({ownerId:'a',requestId:'one',snapshot,meta:meta()});
  state.getState().gameMeta.id='changed';assert.equal(state.getState().gameMeta.id,'game-a');
});
test('cloud and temporary loads do not pretend there is a saved file; restore keeps all flags',()=>{
  const store=createProjectStore(projectWith());
  store.loadProject(projectWith(2),{source:'cloud'});
  assert.equal(store.getState().hasProjectFile,false);
  assert.equal(store.getState().unsavedChanges,true);
  const fileState={dirty:true,previewDirty:false,unsavedChanges:false,hasProjectFile:true};
  store.restoreEditingSession({project:projectWith(3),fileState});
  for(const [key,value] of Object.entries(fileState)) assert.equal(store.getState()[key],value);
  assert.equal(store.getSnapshot().questions.length,3);
  store.loadProject(projectWith(),{source:'file'});
  assert.equal(store.getState().hasProjectFile,true);assert.equal(store.getState().unsavedChanges,false);
});
