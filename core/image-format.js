// Header/container checks before decoding. Pixel decoding remains the browser's job.
function invalid() { throw new Error('画像の形式またはデータが正しくありません。'); }
const crcTable = new Uint32Array(256);
for (let n=0;n<256;n++) {
  let c=n;
  for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1;
  crcTable[n]=c;
}
export function readImageInfo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) invalid();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const text=(i,n)=>String.fromCharCode(...bytes.subarray(i,i+n));
  const finish=(mime,width,height)=>{
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1) invalid();
    return {mime,width,height};
  };
  if (bytes[0]===137 && text(1,7)==='PNG\r\n\x1a\n') {
    let pos=8,width,height,hasData=false;
    while(pos+12<=bytes.length) {
      const length=view.getUint32(pos),end=pos+12+length,kind=text(pos+4,4);
      if(end>bytes.length) invalid();
      let crc=0xffffffff;
      for(let i=pos+4;i<end-4;i++) crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);
      if(((crc^0xffffffff)>>>0)!==view.getUint32(end-4)) invalid();
      if(pos===8 && (kind!=='IHDR'||length!==13)) invalid();
      if(kind==='IHDR') {
        if(pos!==8) invalid();
        width=view.getUint32(pos+8);height=view.getUint32(pos+12);
        const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
        if(!depths[bytes[pos+17]]?.includes(bytes[pos+16])||bytes[pos+18]||bytes[pos+19]||bytes[pos+20]>1) invalid();
      }
      if(kind==='IDAT' && length>0) hasData=true;
      if(kind==='IEND') {
        if(length!==0||end!==bytes.length||!hasData) invalid();
        return finish('image/png',width,height);
      }
      pos=end;
    }
    invalid();
  }
  if(bytes[0]===255 && bytes[1]===216) {
    let pos=2,width,height,scan=false,hasScan=false;
    while(pos<bytes.length) {
      if(scan) {
        while(pos<bytes.length && bytes[pos]!==255) pos++;
        if(pos>=bytes.length) invalid();
      }
      if(bytes[pos++]!==255) invalid();
      while(bytes[pos]===255) pos++;
      const marker=bytes[pos++];
      if(scan && (marker===0 || (marker>=208&&marker<=215))) continue;
      scan=false;
      if(marker===217) {
        if(pos!==bytes.length||!hasScan) invalid();
        return finish('image/jpeg',width,height);
      }
      if(marker===0||marker===216||marker===undefined||marker===1||(marker>=208&&marker<=215)||pos+2>bytes.length) invalid();
      const length=view.getUint16(pos),end=pos+length;
      if(length<2||end>bytes.length) invalid();
      if([192,193,194].includes(marker)) {
        if(width!==undefined||length<8||length!==8+3*bytes[pos+7]||bytes[pos+2]!==8) invalid();
        height=view.getUint16(pos+3);width=view.getUint16(pos+5);
      }
      if(marker===218) {
        if(width===undefined||length<6||length!==6+2*bytes[pos+2]) invalid();
        scan=true;hasScan=true;
      }
      pos=end;
    }
    invalid();
  }
  if(text(0,4)==='RIFF' && text(8,4)==='WEBP') {
    if(view.getUint32(4,true)+8!==bytes.length) invalid();
    let pos=12,width,height,hasPixels=false;
    while(pos+8<=bytes.length) {
      const kind=text(pos,4),length=view.getUint32(pos+4,true),data=pos+8,end=data+length;
      if(end>bytes.length) invalid();
      if(kind==='VP8X') {
        if(pos!==12||length!==10) invalid();
        width=1+bytes[data+4]+256*bytes[data+5]+65536*bytes[data+6];
        height=1+bytes[data+7]+256*bytes[data+8]+65536*bytes[data+9];
      } else if(kind==='VP8 ') {
        if(length<10||bytes[data]&1||bytes[data+3]!==157||bytes[data+4]!==1||bytes[data+5]!==42) invalid();
        const w=view.getUint16(data+6,true)&16383,h=view.getUint16(data+8,true)&16383;
        if(width!==undefined&&(width!==w||height!==h)) invalid();
        width=w;height=h;hasPixels=true;
      } else if(kind==='VP8L') {
        if(length<5||bytes[data]!==47||(bytes[data+4]>>>5)!==0) invalid();
        const bits=view.getUint32(data+1,true),w=(bits&16383)+1,h=((bits>>>14)&16383)+1;
        if(width!==undefined&&(width!==w||height!==h)) invalid();
        width=w;height=h;hasPixels=true;
      } else if(kind==='ANMF' && length>=16 && width!==undefined) hasPixels=true;
      pos=end+(length&1);
    }
    if(pos!==bytes.length||!hasPixels) invalid();
    return finish('image/webp',width,height);
  }
  invalid();
}
