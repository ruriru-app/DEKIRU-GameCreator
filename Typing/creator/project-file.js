import {normalizeProjectData} from '../../core/project-format.js';
import {packProjectImages} from '../../core/project-image-pool.js';

export const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function checkSize(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new Error('問題セットのファイルは 5 MB 以下にしてください。');
  }
}

export function serializeProject(project) {
  const checked = packProjectImages(normalizeProjectData(project));
  const text = JSON.stringify({ format: 'dekiru-game-creator', version: checked.schemaVersion, project: checked }, null, 2) + '\n';
  checkSize(text);
  return text;
}

export function parseProjectFile(text) {
  if (typeof text !== 'string') throw new Error('ファイルを文字として読み取れませんでした。');
  checkSize(text);
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('ファイルを読み取れません。「問題セットを保存」で作った .dekiru.json ファイルを選んでください。'); }
  if (!record(data) || data.format !== 'dekiru-game-creator') {
    throw new Error('編集用の問題セットではありません。.dekiru.json ファイルを選んでください（遊ぶためのHTMLは開けません）。');
  }
  if (![1,2,3].includes(data.version) || data.version !== data.project?.schemaVersion) throw new Error('このファイルのバージョンには対応していません。');
  return normalizeProjectData(data.project);
}

export function projectFilename(title) {
  const name = String(title ?? '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80).replace(/[ .]+$/, '');
  return `DEKIRU-${name || '問題セット'}.dekiru.json`;
}

export function downloadProject(project) {
  const blob = new Blob([serializeProject(project)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = projectFilename(project.title);
  link.hidden = true;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
