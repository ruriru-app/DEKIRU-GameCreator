// Original 1×1 synthetic pixels, not personal or remote images.
export const jpegBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwKiiivgj6M//Z';
export const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY0gJ0GgAAANVAV3Gr6LbAAAAAElFTkSuQmCC';
export const webpBase64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
export const bytesFrom = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
export const dataUrl = (bytes, mime = 'image/jpeg') => 'data:' + mime + ';base64,' + btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
export const jpegImage = {dataUrl:'data:image/jpeg;base64,' + jpegBase64,width:1,height:1,placement:'top',alt:'問題の画像'};
export const pngImage = {...jpegImage,dataUrl:'data:image/png;base64,' + pngBase64};
export function imageAtBytes(size) {
  const original = bytesFrom(jpegBase64), result = new Uint8Array(size);
  if (size < original.length + 4) throw Error('Fixture too small');
  result.set(original.subarray(0, 2));
  let offset = 2, remaining = size - original.length;
  while (remaining) {
    let total = Math.min(65537, remaining);
    if (remaining - total > 0 && remaining - total < 4) total -= 4;
    result.set([255,254,(total-2) >> 8,(total-2) & 255], offset);
    offset += total; remaining -= total;
  }
  result.set(original.subarray(2), offset);
  return {...jpegImage,dataUrl:dataUrl(result)};
}
export function imageProject(image = pngImage) {
  return {schemaVersion:2,title:'画像の練習',gameType:'typing',templateId:'fusuma',
    settings:{volume:0.5,muted:true},
    questions:[{id:'q1',prompt:'これは何？',displayAnswer:'丸',reading:'まる',romajiHint:'maru',image:structuredClone(image)}]};
}
