import {imageProject,imageAtBytes,pngImage} from './question-images.mjs';
import {projectBytes} from './cloud-projects.mjs';
// Built independently of the production pool/serializer for JS/SQL parity tests.
export function sharedProject(image=pngImage,count=2){
  const p=imageProject(image),{dataUrl,width,height,placement,alt}=image;
  return {...p,schemaVersion:3,questions:Array.from({length:count},(_,i)=>({...p.questions[0],id:'q'+i,image:{imageId:'img1',placement,alt}})),images:[{id:'img1',dataUrl,width,height}]};
}
export function sharedProjectBytes(size){
  const p=sharedProject();p.questions=[];p.images=[];
  for(let i=0;i<12;i++){
    const q=sharedProject(imageAtBytes(131072-i)).questions[0];q.id='q'+i;q.image.imageId='img'+(i+1);p.questions.push(q);
    const {dataUrl,width,height}=imageAtBytes(131072-i);p.images.push({id:'img'+(i+1),dataUrl,width,height});
  }
  const last=p.images.at(-1),remaining=size-(Buffer.byteLength(JSON.stringify(p))-last.dataUrl.length)-'data:image/jpeg;base64,'.length;
  last.dataUrl=imageAtBytes(Math.floor(remaining/4)*3).dataUrl;
  const padding=size-Buffer.byteLength(JSON.stringify(p));if(padding<0||padding>3)throw Error('fixture size');p.title+='x'.repeat(padding);
  if(Buffer.byteLength(JSON.stringify(p))!==size)throw Error('fixture size');return p;
}
export function sharedTextBytes(size){
  const p=projectBytes(size),fixture=sharedProject();p.schemaVersion=3;p.questions[0].image=fixture.questions[0].image;p.images=fixture.images;return p;
}
