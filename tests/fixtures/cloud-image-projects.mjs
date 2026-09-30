import {imageProject,imageAtBytes} from './question-images.mjs';
import {projectBytes} from './cloud-projects.mjs';
export function imageProjectBytes(size) {
  const p=imageProject(imageAtBytes(131072));
  p.questions=Array.from({length:12},(_,i)=>({...p.questions[0],id:'q'+i,image:{...p.questions[0].image}}));
  // Independent of the production serializer, so dropping images cannot fake a boundary.
  const overhead=Buffer.byteLength(JSON.stringify(p))-p.questions[11].image.dataUrl.length;
  const remaining=size-overhead-'data:image/jpeg;base64,'.length;
  const imageBytes=Math.floor(remaining/4)*3;
  p.questions[11].image=imageAtBytes(imageBytes);
  const padding=size-Buffer.byteLength(JSON.stringify(p));
  if(padding<0||padding>3)throw Error('fixture boundary');p.title+='x'.repeat(padding);
  if(Buffer.byteLength(JSON.stringify(p))!==size)throw Error('fixture size');
  return p;
}
export function imageTextBytes(size) {
  const p=projectBytes(size);p.schemaVersion=2;p.questions[0].image=imageAtBytes(1024);return p;
}
