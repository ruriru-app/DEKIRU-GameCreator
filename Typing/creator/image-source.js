import {readImageInfo} from '../../core/image-format.js';

function invalid(){throw new Error('画像の形式またはデータが正しくありません。');}

// Camera JPEGs may append auxiliary images after the primary EOI marker.
// Walk segments rather than searching for FF D9: EXIF can contain a thumbnail.
function primaryJpegEnd(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let pos=2,scan=false;
  while(pos<bytes.length){
    if(scan)while(pos<bytes.length&&bytes[pos]!==255)pos++;
    if(bytes[pos++]!==255)invalid();
    while(bytes[pos]===255)pos++;
    const marker=bytes[pos++];
    if(scan&&(marker===0||(marker>=208&&marker<=215)))continue;
    scan=false;
    if(marker===217)return pos;
    if(marker===undefined||marker===0||marker===216||marker===1||
      (marker>=208&&marker<=215)||pos+2>bytes.length)invalid();
    const length=view.getUint16(pos);
    if(length<2||pos+length>bytes.length)invalid();
    scan=marker===218;
    pos+=length;
  }
  invalid();
}

// Source-only preparation. The primary image still passes strict validation,
// then the caller decodes and re-encodes it; appended bytes are never saved.
// Do not use this to relax validation of saved projects or shared images.
export function readQuestionImageSource(bytes){
  const primary=bytes instanceof Uint8Array&&bytes[0]===255&&bytes[1]===216
    ?bytes.subarray(0,primaryJpegEnd(bytes)):bytes;
  return {bytes:primary,info:readImageInfo(primary)};
}
