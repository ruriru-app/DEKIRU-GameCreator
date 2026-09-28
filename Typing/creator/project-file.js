export const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkedProject(value) {
  if (!record(value) || value.schemaVersion !== 1) {
    throw new Error('対応していない問題セットの形式・バージョンです。');
  }
  if (value.gameType !== 'typing' || value.templateId !== 'fusuma') {
    throw new Error('この作成画面は Typing「和室・襖」の問題セットに対応しています。');
  }
  if (typeof value.title !== 'string' || !Array.isArray(value.questions)) {
    throw new Error('セット名または問題一覧の形式が正しくありません。');
  }
  const settings = value.settings;
  if (!record(settings) || !Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > 1 || typeof settings.muted !== 'boolean') {
    throw new Error('音量・ミュート設定の形式が正しくありません。');
  }
  const ids = new Set();
  const questions = value.questions.map((question, index) => {
    if (!record(question) || typeof question.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(question.id) ||
      ['prompt', 'displayAnswer', 'reading', 'romajiHint'].some(key => typeof question[key] !== 'string')) {
      throw new Error(`${index + 1}問目のデータ形式が正しくありません。`);
    }
    if (ids.has(question.id)) throw new Error('問題のIDが重複しています。');
    ids.add(question.id);
    // Import only editable data; files cannot supply code, templates or asset URLs.
    return { id: question.id, prompt: question.prompt, displayAnswer: question.displayAnswer, reading: question.reading, romajiHint: question.romajiHint };
  });
  return {
    schemaVersion: 1, title: value.title, gameType: 'typing', templateId: 'fusuma',
    settings: { volume: settings.volume, muted: settings.muted }, questions,
  };
}

function checkSize(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new Error('問題セットのファイルは 5 MB 以下にしてください。');
  }
}

export function serializeProject(project) {
  const text = JSON.stringify({ format: 'dekiru-game-creator', version: 1, project: checkedProject(project) }, null, 2) + '\n';
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
  if (data.version !== 1) throw new Error('このファイルのバージョンには対応していません。');
  return checkedProject(data.project);
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
