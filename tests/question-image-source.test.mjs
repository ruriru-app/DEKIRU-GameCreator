import test from 'node:test';
import assert from 'node:assert/strict';
import {readImageInfo} from '../core/image-format.js';
import {normalizeQuestionImage} from '../core/question-image.js';
import {jpegBase64,pngBase64,webpBase64,bytesFrom,jpegImage,dataUrl,invalidJpegScans} from './fixtures/question-images.mjs';

const sourceModule=await import('../Typing/creator/image-source.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
function readSource(bytes){
  assert.equal(typeof sourceModule.readQuestionImageSource,'function','source-only JPEG preparation is implemented');
  return sourceModule.readQuestionImageSource(bytes);
}
const join=(...parts)=>Uint8Array.from(parts.flatMap(part=>Array.from(part)));
const jpeg=bytesFrom(jpegBase64);

test('camera JPEG with an auxiliary JPEG imports only the primary image without changing source bytes',()=>{
  // The supplied camera JPEG has a main JPEG followed by an auxiliary JPEG.
  // Reproduce the structure with synthetic pixels, never the private worksheet.
  const source=join(jpeg,jpeg),before=source.slice();
  const result=readSource(source);
  assert.deepEqual(result.info,{mime:'image/jpeg',width:1,height:1});
  assert.deepEqual(result.bytes,jpeg);
  assert.deepEqual(source,before);
  assert.throws(()=>readImageInfo(source),'saved-image validation remains strict');
  assert.throws(()=>normalizeQuestionImage({...jpegImage,dataUrl:dataUrl(source)}));
});
test('JPEG thumbnails and end markers inside metadata do not replace the primary image',()=>{
  const app1=join([255,225,(jpeg.length+2)>>8,(jpeg.length+2)&255],jpeg);
  const primary=join(jpeg.slice(0,2),app1,jpeg.slice(2));
  assert.deepEqual(readSource(join(primary,jpeg)).bytes,primary);
});
test('ordinary JPEG PNG and WebP source data remain unchanged',()=>{
  for(const [base64,mime] of [[jpegBase64,'image/jpeg'],[pngBase64,'image/png'],[webpBase64,'image/webp']]){
    const bytes=bytesFrom(base64),result=readSource(bytes);
    assert.deepEqual(result.bytes,bytes);
    assert.deepEqual(result.info,{mime,width:1,height:1});
  }
});
test('invalid or truncated primary JPEGs are still rejected before browser decoding',()=>{
  for(const bytes of [jpeg.slice(0,-1),new Uint8Array([255,216,255,225,255,255]),join([255,216,255,217],jpeg),
    ...invalidJpegScans().map(image=>bytesFrom(image.dataUrl.split(',')[1]))]){
    assert.throws(()=>readSource(bytes),/画像の形式またはデータが正しくありません/);
  }
});
