import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeProject,parseProjectFile,MAX_PROJECT_BYTES} from '../Typing/creator/project-file.js';
import {normalizeProjectData} from '../core/project-format.js';
import {imageProject,imageAtBytes} from './fixtures/question-images.mjs';

function repeated() {
  const p=imageProject(),imgs=Array.from({length:8},(_,i)=>imageAtBytes(1000+i));
  p.questions=Array.from({length:25},(_,i)=>({...p.questions[0],id:'q'+i,image:{...imgs[i%8],placement:i%2?'left':'top',alt:'説明'+i}}));
  return p;
}
function pooled() {
  const p=imageProject(),{dataUrl,width,height,placement,alt}=p.questions[0].image;
  return {...p,schemaVersion:3,questions:[{...p.questions[0],image:{imageId:'img1',placement,alt}}],images:[{id:'img1',dataUrl,width,height}]};
}
test('local saves store 25 attachments as 8 assets without changing content or input',()=>{
  const p=repeated(),before=structuredClone(p),text=serializeProject(p),wire=JSON.parse(text);
  assert.equal(wire.version,3);assert.equal(wire.project.images.length,8);
  assert.equal(wire.project.questions[8].image.imageId,'img1');
  assert.equal(wire.project.images[7].id,'img8');
  assert.deepEqual(parseProjectFile(text),before);assert.deepEqual(p,before);
  const decoded=parseProjectFile(text);decoded.questions[0].image.alt='changed';
  assert.equal(decoded.questions[8].image.alt,'説明8');
  delete decoded.questions[0].image;assert.ok(decoded.questions[8].image);
});
test('version 3 expands for editing and old 1/2 files still load',()=>{
  assert.deepEqual(normalizeProjectData(pooled()),imageProject());
  for(const version of [1,2]) {
    const p=imageProject();p.schemaVersion=version;if(version===1)delete p.questions[0].image;
    assert.deepEqual(parseProjectFile(JSON.stringify({format:'dekiru-game-creator',version,project:p})),p);
  }
});
test('version 3 rejects missing, duplicate, unused, noncanonical and malformed assets/references',()=>{
  const cases=[
    p=>p.questions[0].image.imageId='img2',p=>p.images.push({...p.images[0]}),
    p=>p.images.push({...p.images[0],id:'img2'}),p=>p.images[0].id='img01',
    p=>p.images[0].width=2,p=>p.images[0].dataUrl='https://example.com/image.png',
    p=>p.images[0].extra=true,p=>p.questions[0].image.extra=true,p=>p.extra=true,
    p=>p.questions=Array.from({length:201},(_,i)=>({...p.questions[0],id:'q'+i})),
    p=>p.images=Array.from({length:201},(_,i)=>({...p.images[0],id:'img'+(i+1)})),
    p=>p.questions[0].image.alt='x'.repeat(201),p=>p.questions[0].image.placement='middle',
    p=>{p.questions=Array.from({length:200},(_,i)=>({...p.questions[0],id:'q'+i,prompt:'x'.repeat(200000)}));}
  ];
  for(const mutate of cases){const p=pooled();mutate(p);assert.throws(()=>normalizeProjectData(p));}
});
test('local file cap is measured after packing; oversized input leaves source unchanged',()=>{
  const p=imageProject(imageAtBytes(131072));p.questions=Array.from({length:32},(_,i)=>({...p.questions[0],id:'q'+i}));
  assert.ok(JSON.stringify(p).length>MAX_PROJECT_BYTES);
  const text=serializeProject(p);assert.ok(text.length<200000);assert.deepEqual(parseProjectFile(text),p);
  const huge=imageProject();huge.title='x'.repeat(MAX_PROJECT_BYTES);
  assert.throws(()=>serializeProject(huge),/5 MB/);assert.equal(huge.title.length,MAX_PROJECT_BYTES);
  assert.throws(()=>parseProjectFile(' '.repeat(MAX_PROJECT_BYTES+1)),/5 MB/);
});
