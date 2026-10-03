import {normalizeQuestionImage,IMAGE_PLACEMENTS} from './question-image.js';

const MAX_EXPANDED_BYTES=36*1024*1024;
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,list)=>record(v)&&Object.keys(v).every(k=>list.includes(k));
const bad=()=>{throw Error('問題画像の共有データが正しくないか、容量上限を超えています。');};
const size=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;

// The editor owns independent image objects; only persistence shares image bytes.
export function packProjectImages(project) {
  if(!project.questions.some(q=>q.image)) return structuredClone(project);
  const images=[],byData=new Map();
  const questions=project.questions.map(q=>{
    if(!q.image)return {...q};
    const {dataUrl,width,height,placement,alt}=q.image;
    let asset=byData.get(dataUrl);
    if(asset&&(asset.width!==width||asset.height!==height))bad();
    if(!asset){asset={id:'img'+(images.length+1),dataUrl,width,height};images.push(asset);byData.set(dataUrl,asset);}
    return {...q,image:{imageId:asset.id,placement,alt}};
  });
  const packed={...project,settings:{...project.settings},schemaVersion:3,questions,images};
  // Apply the same bounded pool validation to local writes and reads.
  unpackProjectImages(packed);
  return packed;
}

export function unpackProjectImages(project) {
  if(project?.schemaVersion!==3)return project;
  if(!keys(project,['schemaVersion','title','gameType','templateId','settings','questions','images'])||
    !Array.isArray(project.images)||!project.images.length||project.images.length>200||
    !Array.isArray(project.questions)||project.questions.length>200)bad();
  const assets=new Map(),dataUrls=new Set(),used=new Set();
  for(const a of project.images){
    if(!keys(a,['id','dataUrl','width','height'])||typeof a.id!=='string'||!/^img[1-9][0-9]{0,2}$/.test(a.id)||Number(a.id.slice(3))>200||assets.has(a.id)||dataUrls.has(a.dataUrl))bad();
    const checked=normalizeQuestionImage({dataUrl:a.dataUrl,width:a.width,height:a.height,placement:'top',alt:''});
    assets.set(a.id,checked);dataUrls.add(a.dataUrl);
  }
  // Bound strings and estimate the full JSON before constructing expanded objects.
  let bytes=256;
  for(const k of ['title','gameType','templateId']){
    if(typeof project[k]!=='string'||project[k].length>MAX_EXPANDED_BYTES)bad();
    bytes+=size(project[k]);
  }
  for(const q of project.questions){
    if(!keys(q,['id','prompt','displayAnswer','reading','romajiHint','image']))bad();
    bytes+=128;
    for(const k of ['id','prompt','displayAnswer','reading','romajiHint']){
      if(typeof q[k]!=='string'||q[k].length>MAX_EXPANDED_BYTES)bad();
      bytes+=size(q[k]);
    }
    if(Object.hasOwn(q,'image')){
      const ref=q.image;
      if(!keys(ref,['imageId','placement','alt'])||!assets.has(ref.imageId)||!IMAGE_PLACEMENTS.includes(ref.placement)||typeof ref.alt!=='string'||ref.alt.length>200||ref.alt.includes('\0')||!ref.alt.isWellFormed())bad();
      used.add(ref.imageId);bytes+=size({...assets.get(ref.imageId),placement:ref.placement,alt:ref.alt});
    }
    if(bytes>MAX_EXPANDED_BYTES)bad();
  }
  if(bytes>MAX_EXPANDED_BYTES||used.size!==assets.size)bad();
  const {images,...rest}=project;
  return {...rest,schemaVersion:2,questions:project.questions.map(q=>q.image?{...q,image:{...assets.get(q.image.imageId),placement:q.image.placement,alt:q.image.alt}}:{...q})};
}
