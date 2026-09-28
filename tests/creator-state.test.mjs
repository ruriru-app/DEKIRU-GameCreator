import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectStore } from '../Typing/creator/creator-state.js';

const initialProject = {
  schemaVersion: 1,
  title: '歴史セット',
  gameType: 'typing',
  templateId: 'fusuma',
  settings: { volume: 0.8, muted: false },
  questions: [
    { id: 'q1', prompt: '問題1', displayAnswer: '答え1', reading: 'こたえ', romajiHint: 'kotae' },
    { id: 'q2', prompt: '問題2', displayAnswer: '答え2', reading: 'へいじょうきょう', romajiHint: 'heijoukyou' },
  ],
};

function setup() {
  let next = 10;
  return createProjectStore(initialProject, { idFactory: () => `q${next++}` });
}

test('title and question field edits mark project and preview dirty', () => {
  const store = setup();
  store.setTitle('新しいセット');
  store.updateQuestion('q1', { prompt: '新しい問題' });

  const state = store.getState();
  assert.equal(state.project.title, '新しいセット');
  assert.equal(state.project.questions[0].prompt, '新しい問題');
  assert.equal(state.dirty, true);
  assert.equal(state.previewDirty, true);
});

test('replace, duplicate, remove, and move keep stable independent question ids', () => {
  const store = setup();
  store.replaceQuestions([
    { prompt: 'A', displayAnswer: 'A答', reading: 'えー', romajiHint: 'e-' },
    { prompt: 'B', displayAnswer: 'B答', reading: 'びー', romajiHint: 'bi-' },
  ]);
  const [first, second] = store.getState().project.questions;
  assert.deepEqual([first.id, second.id], ['q10', 'q11']);

  store.duplicateQuestion(first.id);
  let questions = store.getState().project.questions;
  assert.deepEqual(questions.map((question) => question.id), ['q10', 'q12', 'q11']);

  store.moveQuestion('q11', -1);
  store.removeQuestion('q10');
  questions = store.getState().project.questions;
  assert.deepEqual(questions.map((question) => question.id), ['q11', 'q12']);
  assert.equal(questions[1].prompt, 'A');
});

test('volume and mute changes clamp values and notify subscribers', () => {
  const store = setup();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });

  store.setVolume(2);
  store.setMuted(true);
  unsubscribe();
  store.setMuted(false);

  const state = store.getState();
  assert.equal(state.project.settings.volume, 1);
  assert.equal(state.project.settings.muted, false);
  assert.equal(notifications, 2);
  assert.equal(state.dirty, true);
});

test('markPreviewed clears only previewDirty and markExported clears export dirty state', () => {
  const store = setup();
  store.setTitle('変更');
  store.markPreviewed();
  assert.equal(store.getState().previewDirty, false);
  assert.equal(store.getState().dirty, true);

  store.markExported();
  assert.equal(store.getState().dirty, false);
  assert.equal(store.getState().previewDirty, false);
});

test('getState and getSnapshot cannot mutate stored questions', () => {
  const store = setup();
  const state = store.getState();
  const snapshot = store.getSnapshot();
  state.project.questions[0].prompt = '外部変更';
  snapshot.questions.pop();

  assert.equal(store.getState().project.questions[0].prompt, '問題1');
  assert.equal(store.getState().project.questions.length, 2);
});

test('editable-file save state is independent of HTML export and preview state', () => {
  const store = setup();
  assert.equal(store.getState().unsavedChanges, false);
  store.setTitle('保存する変更');
  assert.equal(store.getState().unsavedChanges, true);
  store.markExported();
  assert.equal(store.getState().unsavedChanges, true);
  assert.equal(store.getState().previewDirty, true);
  store.markSaved(store.getSnapshot());
  assert.equal(store.getState().unsavedChanges, false);
  assert.equal(store.getState().hasProjectFile, true);
  assert.equal(store.getState().previewDirty, true);
});

test('opening a project replaces a clone and leaves the current game pending explicit restart', () => {
  const store = setup();
  assert.equal(typeof store.loadProject, 'function');
  const loaded = structuredClone(initialProject);
  loaded.title = '保存していたセット';
  loaded.settings.muted = true;
  store.loadProject(loaded);
  loaded.title = '外部変更';
  assert.equal(store.getSnapshot().title, '保存していたセット');
  assert.equal(store.getState().unsavedChanges, false);
  assert.equal(store.getState().hasProjectFile, true);
  assert.equal(store.getState().previewDirty, true);
  assert.equal(store.getState().dirty, true);
  store.updateQuestion('q1', { reading: 'へんこう' });
  assert.equal(store.getState().unsavedChanges, true);
});

test('an earlier save/export snapshot cannot mark newer edits saved or previewed', () => {
  const store = setup();
  store.setTitle('書き出し開始');
  const snapshot = store.getSnapshot();
  store.setTitle('その間の変更');
  store.markExported(snapshot);
  assert.equal(store.getState().dirty, true);
  assert.equal(store.getState().previewDirty, true);
  assert.equal(typeof store.markSaved, 'function');
  store.markSaved(snapshot);
  assert.equal(store.getState().unsavedChanges, true);
});
