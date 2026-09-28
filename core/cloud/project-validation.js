import { ok, failure } from './contracts.js';

export const CLOUD_LIMITS = Object.freeze({
  questions:200, bytes:262144, title:80, prompt:1000, displayAnswer:200, reading:200, romajiHint:800, id:128,
});
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keysMatch = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const validText = v => typeof v === 'string' && !v.includes('\u0000') && v.isWellFormed();
export function serializeCloudProject(p) {
  return JSON.stringify({
    schemaVersion:p.schemaVersion, title:p.title, gameType:p.gameType, templateId:p.templateId,
    settings:{volume:p.settings.volume,muted:p.settings.muted},
    questions:p.questions.map(q => ({id:q.id,prompt:q.prompt,displayAnswer:q.displayAnswer,reading:q.reading,romajiHint:q.romajiHint})),
  });
}
export function validateCloudProject(p, {mode = 'draft'} = {}) {
  if (!['draft','publish'].includes(mode) ||
      !keysMatch(p,['schemaVersion','title','gameType','templateId','settings','questions']) ||
      p.schemaVersion !== 1 || p.gameType !== 'typing' || p.templateId !== 'fusuma' ||
      !validText(p.title) || !Array.isArray(p.questions) ||
      !keysMatch(p.settings,['volume','muted']) || !Number.isFinite(p.settings.volume) ||
      p.settings.volume < 0 || p.settings.volume > 1 || typeof p.settings.muted !== 'boolean') return failure('VALIDATION');
  if ([...p.title].length > CLOUD_LIMITS.title || p.questions.length > CLOUD_LIMITS.questions) return failure('LIMIT');
  if (mode === 'publish' && (!p.title.trim() || p.questions.length === 0)) return failure('VALIDATION','公開にはセット名と1問以上の問題が必要です。');
  const ids = new Set();
  for (const [index,q] of p.questions.entries()) {
    if (!keysMatch(q,['id','prompt','displayAnswer','reading','romajiHint']) ||
        Object.values(q).some(v => !validText(v)) || !/^[A-Za-z0-9_-]{1,128}$/.test(q.id) || ids.has(q.id)) return failure('VALIDATION', (index+1)+'問目の形式またはIDを確認してください。');
    ids.add(q.id);
    for (const key of ['prompt','displayAnswer','reading','romajiHint']) {
      if ([...q[key]].length > CLOUD_LIMITS[key]) return failure('LIMIT',(index+1)+'問目の文字数が上限を超えています。');
      if (mode === 'publish' && key !== 'romajiHint' && !q[key].trim()) return failure('VALIDATION',(index+1)+'問目の問題・正解・よみを入力してください。');
    }
  }
  const serialized = serializeCloudProject(p);
  if (new TextEncoder().encode(serialized).byteLength > CLOUD_LIMITS.bytes) return failure('LIMIT','オンライン保存は1件256 KiB以下です。端末への保存は引き続き利用できます。');
  return ok(JSON.parse(serialized));
}
