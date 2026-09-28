import test from 'node:test';
import assert from 'node:assert/strict';

const files = await import('../Typing/creator/project-file.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const project = {
  schemaVersion: 1, title: '奈良時代 <春>', gameType: 'typing', templateId: 'fusuma',
  settings: { volume: 0.35, muted: true },
  questions: [
    { id: 'q2', prompt: '都は？', displayAnswer: '平城京', reading: 'へいじょうきょう', romajiHint: 'heijoukyou' },
    { id: 'q1', prompt: '法律は？', displayAnswer: '墾田永年私財法', reading: 'こんでんえいねんしざいほう', romajiHint: "konden'einenshizaihou" },
  ],
};
function api() {
  assert.equal(typeof files.serializeProject, 'function', 'editable project serialization is available');
  assert.equal(typeof files.parseProjectFile, 'function', 'editable project parsing is available');
  return files;
}
const envelope = (value = project) => JSON.stringify({ format: 'dekiru-game-creator', version: 1, project: value });

test('save/open preserves Japanese text, order, ids, hints and audio settings', () => {
  const { serializeProject, parseProjectFile } = api();
  const text = serializeProject(project);
  assert.equal(JSON.parse(text).format, 'dekiru-game-creator');
  assert.deepEqual(parseProjectFile(text), project);
});
test('incomplete and empty drafts can be saved without requiring playable questions', () => {
  const { serializeProject, parseProjectFile } = api();
  const draft = structuredClone(project);
  draft.title = '';
  draft.questions[0].reading = '';
  draft.questions[0].romajiHint = '';
  assert.deepEqual(parseProjectFile(serializeProject(draft)), draft);
  draft.questions = [];
  assert.deepEqual(parseProjectFile(serializeProject(draft)), draft);
});
test('invalid JSON, unrelated files and future formats are rejected', () => {
  const { parseProjectFile } = api();
  for (const text of ['broken', '<html>game</html>', '{}', JSON.stringify(project),
    JSON.stringify({ format: 'dekiru-game-creator', version: 2, project })]) {
    assert.throws(() => parseProjectFile(text), /ファイル|形式|バージョン/);
  }
});
test('unsupported game types, templates and project versions cannot replace the editor', () => {
  const { parseProjectFile } = api();
  for (const patch of [{ gameType: 'quiz' }, { templateId: '../other' }, { schemaVersion: 99 }]) {
    assert.throws(() => parseProjectFile(envelope({ ...project, ...patch })), /対応|形式|バージョン/);
  }
});
test('invalid settings and non-text question data are rejected rather than silently lost', () => {
  const { parseProjectFile } = api();
  for (const settings of [{ volume: -1, muted: false }, { volume: 2, muted: false }, { volume: 0.8, muted: 'false' }]) {
    assert.throws(() => parseProjectFile(envelope({ ...project, settings })), /音量|設定/);
  }
  for (const patch of [{ prompt: {} }, { reading: null }, { displayAnswer: 9 }, { id: '' }, { romajiHint: [] }]) {
    assert.throws(() => parseProjectFile(envelope({ ...project, questions: [{ ...project.questions[0], ...patch }] })), /問題|形式/);
  }
});
test('duplicate ids are rejected so row edits cannot target another question', () => {
  const { parseProjectFile } = api();
  assert.throws(() => parseProjectFile(envelope({ ...project, questions: [project.questions[0], project.questions[0]] })), /ID|重複/);
});
test('unknown executable and asset fields are not imported; text remains literal', () => {
  const { parseProjectFile } = api();
  const input = structuredClone(project);
  input.script = 'alert(1)';
  input.settings.audio = 'https://example.invalid/audio';
  input.questions[0].onload = 'alert(2)';
  input.questions[0].prompt = '<img src=x onerror=alert(3)>';
  const parsed = parseProjectFile(envelope(input));
  assert.equal(parsed.script, undefined);
  assert.equal(parsed.settings.audio, undefined);
  assert.equal(parsed.questions[0].onload, undefined);
  assert.equal(parsed.questions[0].prompt, '<img src=x onerror=alert(3)>');
});
test('UTF-8 BOM files are accepted and files exceeding 5 MB are rejected', () => {
  const { parseProjectFile } = api();
  assert.deepEqual(parseProjectFile('\uFEFF' + envelope()), project);
  assert.throws(() => parseProjectFile(' '.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
});
test('download filenames are safe on Windows and clearly editable JSON', () => {
  api();
  assert.equal(files.projectFilename('  春/秋:クイズ?  '), 'DEKIRU-春_秋_クイズ_.dekiru.json');
  assert.equal(files.projectFilename(''), 'DEKIRU-問題セット.dekiru.json');
  assert.equal(files.projectFilename('CON'), 'DEKIRU-CON.dekiru.json');
});
