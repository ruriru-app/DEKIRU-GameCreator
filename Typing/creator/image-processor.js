import {readQuestionImageSource} from './image-source.js';
import {normalizeQuestionImage,QUESTION_IMAGE_LIMITS as limits} from '../../core/question-image.js';

export async function processQuestionImage(file,{signal,placement='top',alt='問題の画像'}={}) {
  const checkAbort=()=>{if(signal?.aborted)throw new DOMException('画像処理を中止しました。','AbortError');};
  checkAbort();
  if(!(file instanceof Blob)||file.size>limits.sourceBytes||file.size===0) throw Error('元の画像は10 MiB以下にしてください。');
  const sourceBytes=new Uint8Array(await file.arrayBuffer());checkAbort();
  const {bytes:source,info}=readQuestionImageSource(sourceBytes);
  if(Math.max(info.width,info.height)>limits.sourceSide||info.width*info.height>limits.sourcePixels) throw Error('画像の寸法は長辺8192px・2500万画素以下にしてください。');
  let bitmap,canvas;
  try {
    // A new Blob uses the inspected MIME, not the filename or untrusted file.type.
    bitmap=await createImageBitmap(new Blob([source],{type:info.mime}),{imageOrientation:'from-image'});
    checkAbort();
    if(Math.max(bitmap.width,bitmap.height)>limits.sourceSide||bitmap.width*bitmap.height>limits.sourcePixels) throw Error('画像の寸法・画素数が大きすぎます。');
    const originalSide=Math.max(bitmap.width,bitmap.height);
    const candidates=[...new Set([1280,1024,800,640].map(n=>Math.min(n,originalSide)))];
    canvas=document.createElement('canvas');
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw Error('このブラウザーで画像処理を開始できません。');
    for(const side of candidates) {
      checkAbort();
      canvas.width=Math.max(1,Math.round(bitmap.width*side/originalSide));
      canvas.height=Math.max(1,Math.round(bitmap.height*side/originalSide));
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      let alpha=false;
      for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255){alpha=true;break;}
      const mime=alpha?'image/png':'image/jpeg';
      for(const quality of (alpha?[undefined]:[.85,.75,.65])) {
        checkAbort();
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,quality));
        checkAbort();
        if(!blob)throw Error('画像を変換できませんでした。別の画像を選んでください。');
        if(blob.size>limits.bytes)continue;
        const bytes=new Uint8Array(await blob.arrayBuffer());checkAbort();
        let binary='';
        for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        return normalizeQuestionImage({dataUrl:'data:'+mime+';base64,'+btoa(binary),width:canvas.width,height:canvas.height,placement,alt});
      }
    }
    throw Error('画質を保ったまま128 KiB以下にできません。余白や細かな模様の少ない、別の画像を選んでください。');
  } finally {
    bitmap?.close();
    if(canvas){canvas.width=0;canvas.height=0;}
  }
}
