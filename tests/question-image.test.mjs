import test from 'node:test';
import assert from 'node:assert/strict';
import {jpegImage,pngImage,jpegBase64,pngBase64,webpBase64,bytesFrom,dataUrl,imageAtBytes,imageProject} from './fixtures/question-images.mjs';
import {serializeProject,parseProjectFile,MAX_PROJECT_BYTES} from '../Typing/creator/project-file.js';
import {createProjectStore} from '../Typing/creator/creator-state.js';
import {saveAuthResume,takeAuthResume} from '../core/cloud/auth-resume.js';
import {memoryStorage} from './fixtures/memory-storage.mjs';
import {zeroComponentJpeg,invalidJpegScans} from './fixtures/question-images.mjs';
import {validateCloudProject} from '../core/cloud/project-validation.js';
const formats = await import('../core/image-format.js').catch(e => {if(e.code==='ERR_MODULE_NOT_FOUND') return {};throw e;});
const images = await import('../core/question-image.js').catch(e => {if(e.code==='ERR_MODULE_NOT_FOUND') return {};throw e;});
const api = () => {assert.equal(typeof images.normalizeQuestionImage,'function');return images.normalizeQuestionImage;};

test('headers identify real JPEG PNG WebP and reject truncated/corrupt containers', () => {
  assert.equal(typeof formats.readImageInfo,'function');
  for (const [base64,mime] of [[jpegBase64,'image/jpeg'],[pngBase64,'image/png'],[webpBase64,'image/webp']]) {
    const bytes=bytesFrom(base64);
    assert.deepEqual(formats.readImageInfo(bytes),{mime,width:1,height:1});
    for (const count of [0,1,8,bytes.length-1]) assert.throws(()=>formats.readImageInfo(bytes.slice(0,count)));
    const corrupt=bytes.slice();corrupt[0]=0;
    assert.throws(()=>formats.readImageInfo(corrupt));
  }
  const png=bytesFrom(pngBase64);png[20]=1; // IHDR width no longer agrees with CRC.
  assert.throws(()=>formats.readImageInfo(png));
});
test('saved images enforce actual dimensions, types, exact keys and canonical base64', () => {
  const normalize=api();
  for (const value of [jpegImage,pngImage]) {assert.deepEqual(normalize(value),value);assert.notEqual(normalize(value),value);}
  for (const patch of [{width:2},{height:0},{width:1.5},{width:1281},{placement:'center'},{alt:'あ'.repeat(201)},
    {alt:'bad\0text'},{src:'ignored'},{dataUrl:'https://example.invalid/a.jpg'},{dataUrl:'blob:x'},
    {dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'},{dataUrl:'data:image/webp;base64,'+webpBase64},
    {dataUrl:pngImage.dataUrl.replace('image/png','image/jpeg')},{dataUrl:pngImage.dataUrl+' '},
    {dataUrl:'data:image/png;base64,@@@@'},{dataUrl:dataUrl(bytesFrom(pngBase64).slice(0,-1),'image/png')}]) {
    assert.throws(()=>normalize({...pngImage,...patch}),JSON.stringify(patch));
  }
  const incomplete={...pngImage};delete incomplete.alt;assert.throws(()=>normalize(incomplete));
  assert.equal(normalize({...pngImage,alt:'あ'.repeat(200)}).alt.length,200);
});
test('zero-component JPEG cannot be imported, exported, or published',()=>{
  assert.throws(()=>api()(zeroComponentJpeg));
  assert.throws(()=>serializeProject(imageProject(zeroComponentJpeg)));
  assert.equal(validateCloudProject(imageProject(zeroComponentJpeg),{mode:'publish'}).ok,false);
});
test('JPEG scans require nonempty distinct components declared by their frame',()=>{
  for(const image of invalidJpegScans())assert.throws(()=>api()(image));
});
test('128 KiB encoded image boundary accepts exact size but rejects one extra byte', () => {
  const normalize=api();
  assert.equal(bytesFrom(imageAtBytes(131072).dataUrl.split(',')[1]).length,131072);
  assert.equal(normalize(imageAtBytes(131072)).width,1);
  assert.throws(()=>normalize(imageAtBytes(131073)));
});
test('project v2 file round trip never drops images and rejects mismatched versions/keys', () => {
  const p=imageProject(), text=serializeProject(p);
  assert.equal(JSON.parse(text).version,3);
  assert.deepEqual(parseProjectFile(text),p);
  for (const version of [1,3]) assert.throws(()=>parseProjectFile(JSON.stringify({format:'dekiru-game-creator',version,project:p})));
  for (const location of ['project','settings','question']) {
    const bad=structuredClone(p);
    (location==='project'?bad:location==='settings'?bad.settings:bad.questions[0]).surprise=1;
    assert.throws(()=>serializeProject(bad));
  }
  const duplicate=structuredClone(p);duplicate.questions.push(duplicate.questions[0]);
  assert.throws(()=>serializeProject(duplicate));
  assert.throws(()=>serializeProject({...p,schemaVersion:1}));
});
test('v1 serialization remains byte identical and exact 5 MiB file is accepted', () => {
  const p=imageProject();p.schemaVersion=1;delete p.questions[0].image;
  const expected=JSON.stringify({format:'dekiru-game-creator',version:1,project:p},null,2)+'\n';
  assert.equal(serializeProject(p),expected);
  const base=JSON.stringify({format:'dekiru-game-creator',version:1,project:p});
  const padded=base+' '.repeat(MAX_PROJECT_BYTES-new TextEncoder().encode(base).length);
  assert.deepEqual(parseProjectFile(padded),p);
  assert.throws(()=>parseProjectFile(padded+' '));
});
test('store promotes only for a real image edit, duplicates independently and never downgrades', () => {
  const p=imageProject();p.schemaVersion=1;delete p.questions[0].image;
  const store=createProjectStore(p,{idFactory:()=> 'q2'});let notifications=0;store.subscribe(()=>notifications++);
  assert.equal(typeof store.setQuestionImage,'function');
  store.setQuestionImage('missing',pngImage);assert.equal(notifications,0);assert.equal(store.getSnapshot().schemaVersion,1);
  store.setQuestionImage('q1',pngImage);assert.equal(store.getSnapshot().schemaVersion,2);
  assert.equal(store.getState().unsavedChanges,true);assert.equal(store.getState().previewDirty,true);
  store.duplicateQuestion('q1');store.markSaved();
  const old=store.getSnapshot();
  store.setQuestionImage('q1',{...pngImage,placement:'left'});store.markSaved(old);
  assert.equal(store.getState().unsavedChanges,true);
  assert.equal(store.getSnapshot().questions[1].image.placement,'top');
  store.setQuestionImage('q1',null);store.setQuestionImage('q2',null);
  assert.equal(store.getSnapshot().schemaVersion,2);
  assert.equal('image' in store.getSnapshot().questions[0],false);
});
test('login resume keeps image data and reports quota failure without modifying the editor', () => {
  const p={project:imageProject(imageAtBytes(131072)),pasteText:'',fileState:{dirty:true,previewDirty:true,unsavedChanges:true,hasProjectFile:false},cloudLink:null,returnTo:'Typing/creator/index.html'};
  const storage=memoryStorage();assert.equal(saveAuthResume(storage,p,0).ok,true);
  assert.deepEqual(takeAuthResume(storage,1),p);
  const original=structuredClone(p);
  assert.equal(saveAuthResume({setItem(){throw Error('QuotaExceededError');}},p,0).ok,false);
  assert.deepEqual(p,original);
});
