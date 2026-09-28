import test from 'node:test';
import assert from 'node:assert/strict';
import {saveAuthResume,takeAuthResume,clearAuthResume,RESUME_KEY} from '../core/cloud/auth-resume.js';
import {projectWith} from './fixtures/cloud-projects.mjs';
import {memoryStorage} from './fixtures/memory-storage.mjs';
const payload=()=>({project:projectWith(),pasteText:'まだ反映していない\t正解\tよみ',fileState:{dirty:true,previewDirty:true,unsavedChanges:true,hasProjectFile:false},cloudLink:null,returnTo:'Typing/creator/index.html'});
test('resume restores exact project, unsaved paste and file status once; 2-hour expiration',()=>{
  const storage=memoryStorage(),value=payload();
  assert.equal(saveAuthResume(storage,value,0).ok,true);
  assert.deepEqual(takeAuthResume(storage,7199999),value);assert.equal(takeAuthResume(storage,7199999),null);
  saveAuthResume(storage,value,0);assert.equal(takeAuthResume(storage,7200000),null);
  saveAuthResume(storage,value,100);assert.equal(takeAuthResume(storage,99),null);
});
test('resume never throws for quota failure, corruption or missing storage',()=>{
  assert.equal(saveAuthResume({setItem:()=>{throw Error('quota');}},payload(),0).ok,false);
  const storage=memoryStorage();storage.setItem(RESUME_KEY,'broken');
  assert.equal(takeAuthResume(storage,1),null);assert.equal(takeAuthResume(null,1),null);
  assert.doesNotThrow(()=>clearAuthResume(null));
});
test('resume accepts local projects beyond cloud size and rejects unknown envelope fields',()=>{
  const p=payload();p.project.questions[0].prompt='x'.repeat(300000);
  const storage=memoryStorage();assert.equal(saveAuthResume(storage,p,0).ok,true);
  assert.deepEqual(takeAuthResume(storage,1),p);
  assert.equal(saveAuthResume(storage,{...p,accessToken:'never'},0).ok,false);
});
test('external redirect and malformed file flags cannot be restored',()=>{
  const storage=memoryStorage();
  for(const returnTo of ['https://evil.invalid/','//evil.invalid/','../p/','Typing/creator/index.html?token=x']){
    assert.equal(saveAuthResume(storage,{...payload(),returnTo},0).ok,false);
  }
  const p=payload();p.fileState.dirty='false';assert.equal(saveAuthResume(storage,p,0).ok,false);
});
