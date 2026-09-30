import {readImageInfo} from './image-format.js';
export const QUESTION_IMAGE_LIMITS=Object.freeze({bytes:131072,side:1280,alt:200,sourceBytes:10485760,sourceSide:8192,sourcePixels:25000000});
export const IMAGE_PLACEMENTS=Object.freeze(['top','bottom','left','right']);
export function normalizeQuestionImage(value) {
  const bad=()=>{throw new Error('問題の画像が正しくありません。JPEG/PNG・長辺1280px・128 KiB以下の画像にしてください。');};
  if(!value||typeof value!=='object'||Array.isArray(value)) bad();
  const keys=['dataUrl','width','height','placement','alt'];
  if(Object.keys(value).length!==5||keys.some(k=>!Object.hasOwn(value,k))) bad();
  const {dataUrl,width,height,placement,alt}=value;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>1280 ||
    !IMAGE_PLACEMENTS.includes(placement)||typeof alt!=='string'||alt.length>200||alt.includes('\0')||!alt.isWellFormed() ||
    typeof dataUrl!=='string'||dataUrl.length>175000) bad();
  const match=/^data:(image\/(?:jpeg|png));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(dataUrl);
  if(!match||!match[2]) bad();
  const binary=atob(match[2]);
  if(binary.length>131072||btoa(binary)!==match[2]) bad();
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),info=readImageInfo(bytes);
  if(info.mime!==match[1]||info.width!==width||info.height!==height) bad();
  return {dataUrl,width,height,placement,alt};
}
