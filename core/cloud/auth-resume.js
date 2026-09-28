import {serializeProject,parseProjectFile} from '../../Typing/creator/project-file.js';
import {ok,failure} from './contracts.js';
export const RESUME_KEY='dekiru-gamecreator.auth-resume.v1';
export const RESUME_TTL=7200000;
export function isSafeReturnTo(value) {
  return typeof value==='string' && /^(?:app\/account\/index\.html|Typing\/creator\/index\.html(?:\?game=[0-9a-fA-F-]{36})?)$/.test(value);
}
function checkedPayload(value) {
  if (!value || Object.keys(value).some(k=>!['project','pasteText','fileState','cloudLink','returnTo'].includes(k)) ||
      !isSafeReturnTo(value.returnTo) || typeof value.pasteText!=='string' || !value.fileState ||
      Object.keys(value.fileState).length!==4 ||
      ['dirty','previewDirty','unsavedChanges','hasProjectFile'].some(k=>typeof value.fileState[k]!=='boolean')) throw Error('Invalid resume');
  const project=parseProjectFile(serializeProject(value.project));
  let cloudLink=null;
  if (value.cloudLink) {
    if (Object.keys(value.cloudLink).some(k=>!['ownerId','record'].includes(k)) ||
        typeof value.cloudLink.ownerId!=='string' || !value.cloudLink.record ||
        typeof value.cloudLink.record.id!=='string' || !Number.isSafeInteger(value.cloudLink.record.version)) throw Error('Invalid cloud link');
    const record=value.cloudLink.record;
    cloudLink={ownerId:value.cloudLink.ownerId,record:{
      id:record.id,version:record.version,title:record.title,questionCount:record.questionCount,
      updatedAt:record.updatedAt,publication:record.publication,publicationDirty:record.publicationDirty,
      project:parseProjectFile(serializeProject(record.project)),
    }};
  }
  return {project,pasteText:value.pasteText,fileState:{...value.fileState},cloudLink,returnTo:value.returnTo};
}
export function saveAuthResume(storage,payload,nowMs=Date.now()) {
  try {
    const data=checkedPayload(payload);
    storage.setItem(RESUME_KEY,JSON.stringify({createdAt:nowMs,payload:data}));
    return ok(null);
  } catch {return failure('VALIDATION','ログイン前の一時保存ができませんでした。先に編集用ファイルを保存してください。');}
}
export function takeAuthResume(storage,nowMs=Date.now()) {
  try {
    const raw=storage.getItem(RESUME_KEY);
    if (!raw) return null;
    const saved=JSON.parse(raw);
    if (!Number.isFinite(saved.createdAt) || nowMs<saved.createdAt || nowMs-saved.createdAt>=RESUME_TTL) {clearAuthResume(storage);return null;}
    const result=checkedPayload(saved.payload);
    storage.removeItem(RESUME_KEY);
    return result;
  } catch {clearAuthResume(storage);return null;}
}
export function clearAuthResume(storage) {try {storage?.removeItem(RESUME_KEY);} catch {}}
