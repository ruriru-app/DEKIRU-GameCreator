import { parseTabularRows, validateRows } from '../../core/data-importer.js';
import { createAudioManager } from '../../core/audio-manager.js';
import { createTemplateRegistry } from '../../core/template-registry.js';
import { buildStandaloneHtml, downloadStandaloneHtml, loadTemplateBundle } from '../../core/html-exporter.js';
import { normalizeReading, readingToRomaji, romajiToHiragana } from '../core/romaji-converter.js';
import { createTypingEngine } from '../core/typing-engine.js';
import { fusumaManifest } from '../templates/fusuma/manifest.js';
import { createFusumaEventController } from '../templates/fusuma/event-controller.js';
import { mountFusumaGame } from '../templates/fusuma/renderer.js';
import { createProjectStore } from './creator-state.js';
import { downloadProject, parseProjectFile, MAX_PROJECT_BYTES } from './project-file.js';

const typingSchema = [
  { key: 'prompt', label: '問題', required: true },
  { key: 'displayAnswer', label: '正解', required: true },
  { key: 'reading', label: 'よみ', required: true },
];

const sampleQuestions = [
  {
    id: 'sample-1',
    prompt: '743年、開墾した土地を永久に自分のものにしてよいと定めた法律は？',
    displayAnswer: '墾田永年私財法',
    reading: 'こんでんえいねんしざいほう',
    romajiHint: "konden'einenshizaihou",
  },
  {
    id: 'sample-2',
    prompt: '唐の都・長安にならって、710年につくられた都は？',
    displayAnswer: '平城京',
    reading: 'へいじょうきょう',
    romajiHint: 'heijoukyou',
  },
];

const store = createProjectStore({
  schemaVersion: 1,
  title: '奈良時代タイピング',
  gameType: 'typing',
  templateId: 'fusuma',
  settings: { volume: 0.8, muted: false },
  questions: sampleQuestions,
});

const registry = createTemplateRegistry();
registry.register(fusumaManifest);
const manifest = registry.get('typing', 'fusuma');
const audioManager = createAudioManager();

const elements = {
  title: document.querySelector('[data-role="set-title"]'),
  paste: document.querySelector('[data-role="paste-input"]'),
  errors: document.querySelector('[data-role="import-errors"]'),
  confirm: document.querySelector('[data-role="replace-confirm"]'),
  questionList: document.querySelector('[data-role="question-list"]'),
  questionCount: document.querySelector('[data-role="question-count"]'),
  saveState: document.querySelector('[data-role="save-state"]'),
  previewDirty: document.querySelector('[data-role="preview-dirty"]'),
  exportState: document.querySelector('[data-role="export-state"]'),
  gameHost: document.querySelector('[data-role="game-host"]'),
  volume: document.querySelector('[data-role="volume"]'),
  volumeOutput: document.querySelector('[data-role="volume-output"]'),
  mute: document.querySelector('[data-role="mute"]'),
  toast: document.querySelector('[data-role="toast"]'),
  exportButton: document.querySelector('[data-action="export-html"]'),
  saveButton: document.querySelector('[data-action="save-project"]'),
  openButton: document.querySelector('[data-action="open-project"]'),
  projectFile: document.querySelector('[data-role="project-file"]'),
  projectError: document.querySelector('[data-role="project-error"]'),
  projectConfirm: document.querySelector('[data-role="project-confirm"]'),
  projectSummary: document.querySelector('[data-role="project-summary"]'),
};

let pendingImport = null;
let toastTimer = null;
let exporting = false;
let pendingProject = null;
let readingProject = false;
const game = mountFusumaGame({
  host: elements.gameHost,
  project: store.getSnapshot(),
  manifest,
  audioManager,
  createEngine: createTypingEngine,
  convertRomaji: romajiToHiragana,
  createEventController: createFusumaEventController,
});
game.setVolume(store.getState().project.settings.volume);

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2800);
}

function currentRows() {
  return store.getState().project.questions.map((question, index) => ({
    sourceRow: index + 1,
    prompt: question.prompt,
    displayAnswer: question.displayAnswer,
    reading: question.reading,
  }));
}

function projectErrors() {
  return validateRows(currentRows(), typingSchema);
}

function renderImportErrors(errors) {
  elements.errors.replaceChildren();
  if (!errors.length) return;
  const list = document.createElement('ul');
  for (const error of errors) {
    const item = document.createElement('li');
    item.textContent = error.message;
    list.append(item);
  }
  elements.errors.append(list);
}

function questionField({ question, field, label, index }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'question-field';
  wrapper.textContent = label;
  const input = document.createElement('input');
  input.value = question[field] ?? '';
  input.dataset.field = field;
  input.autocomplete = 'off';
  const errorId = `question-${question.id}-${field}-error`;
  if (!input.value.trim()) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errorId);
    const error = document.createElement('span');
    error.className = 'field-error';
    error.id = errorId;
    error.textContent = `${index + 1}問目の「${label}」を入力してください。`;
    wrapper.append(input, error);
  } else {
    wrapper.append(input);
  }
  return wrapper;
}

function actionButton(action, label, title, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.disabled = disabled;
  return button;
}

function renderQuestions() {
  const questions = store.getState().project.questions;
  elements.questionList.replaceChildren();
  questions.forEach((question, index) => {
    const card = document.createElement('article');
    card.className = 'question-card';
    card.dataset.role = 'question-card';
    card.dataset.id = question.id;

    const head = document.createElement('div');
    head.className = 'question-card-head';
    const number = document.createElement('span');
    number.className = 'question-number';
    number.textContent = String(index + 1);
    const actions = document.createElement('div');
    actions.className = 'question-actions';
    actions.append(
      actionButton('move-up', '↑', `${index + 1}問目を上へ`, index === 0),
      actionButton('move-down', '↓', `${index + 1}問目を下へ`, index === questions.length - 1),
      actionButton('duplicate', '複製', `${index + 1}問目を複製`),
      actionButton('delete', '削除', `${index + 1}問目を削除`),
    );
    head.append(number, actions);

    const fields = document.createElement('div');
    fields.className = 'question-fields';
    fields.append(
      questionField({ question, field: 'prompt', label: '問題', index }),
      questionField({ question, field: 'displayAnswer', label: '正解', index }),
      questionField({ question, field: 'reading', label: 'よみ', index }),
    );
    const hint = document.createElement('p');
    hint.className = 'romaji-hint';
    hint.dataset.role = 'romaji-hint';
    hint.textContent = question.romajiHint || '—';
    fields.append(hint);
    card.append(head, fields);
    elements.questionList.append(card);
  });
}

function updateMeta(state) {
  elements.questionCount.textContent = String(state.project.questions.length);
  elements.saveState.textContent = state.unsavedChanges ? '未保存の変更あり' : state.hasProjectFile ? '保存後の変更なし' : '未保存';
  elements.previewDirty.hidden = !state.previewDirty;
  if (!exporting) elements.exportState.textContent = state.dirty ? '変更内容はHTMLに未反映です' : '児童に配るゲームを作る';
}

function showProjectError(message = '') {
  elements.projectError.textContent = message;
  elements.projectError.hidden = !message;
}

function closeProjectConfirmation() {
  pendingProject = null;
  elements.projectConfirm.close();
  elements.projectConfirm.hidden = true;
  elements.openButton.focus();
}

elements.saveButton.addEventListener('click', () => {
  showProjectError();
  try {
    const snapshot = store.getSnapshot();
    downloadProject(snapshot);
    store.markSaved(snapshot);
    showToast('編集用ファイルを作成しました。ダウンロード先をご確認ください。');
  } catch (error) {
    showProjectError(error.message || '保存用ファイルを作成できませんでした。内容は保持されています。');
  }
});

elements.openButton.addEventListener('click', () => {
  if (readingProject) return;
  elements.projectFile.value = '';
  elements.projectFile.click();
});

elements.projectFile.addEventListener('change', async () => {
  const file = elements.projectFile.files?.[0];
  if (!file || readingProject) return;
  readingProject = true;
  elements.openButton.disabled = true;
  elements.openButton.textContent = '読み込み中…';
  showProjectError();
  try {
    if (file.size > MAX_PROJECT_BYTES) throw new Error('問題セットのファイルは 5 MB 以下にしてください。');
    pendingProject = parseProjectFile(await file.text());
    elements.projectSummary.textContent = `${pendingProject.title || '（セット名なし）'} ／ ${pendingProject.questions.length}問`;
    elements.projectConfirm.hidden = false;
    elements.projectConfirm.showModal();
  } catch (error) {
    pendingProject = null;
    showProjectError(error.message || 'ファイルを開けませんでした。現在の内容は保持されています。');
  } finally {
    readingProject = false;
    elements.projectFile.value = '';
    elements.openButton.disabled = false;
    elements.openButton.textContent = '問題セットを開く';
  }
});

document.querySelector('[data-action="cancel-project-open"]').addEventListener('click', closeProjectConfirmation);
elements.projectConfirm.addEventListener('cancel', event => {
  event.preventDefault();
  closeProjectConfirmation();
});
document.querySelector('[data-action="confirm-project-open"]').addEventListener('click', () => {
  if (!pendingProject) return;
  store.loadProject(pendingProject);
  const project = store.getSnapshot();
  elements.title.value = project.title;
  elements.volume.value = String(project.settings.volume);
  elements.volumeOutput.textContent = `${Math.round(project.settings.volume * 100)}%`;
  elements.mute.checked = project.settings.muted;
  game.setVolume(project.settings.volume);
  game.setMuted(project.settings.muted);
  elements.paste.value = '';
  pendingImport = null;
  elements.confirm.hidden = true;
  renderQuestions();
  renderImportErrors(projectErrors());
  closeProjectConfirmation();
  elements.title.focus();
  showToast('問題セットを開きました。ゲームへの反映は「プレビューを再スタート」で行えます。');
});

function mapImportedRows(rows) {
  return rows.map((row) => {
    const reading = normalizeReading(row.reading);
    return {
      prompt: row.prompt,
      displayAnswer: row.displayAnswer,
      reading,
      romajiHint: readingToRomaji(reading),
    };
  });
}

function applyPendingImport() {
  if (!pendingImport) return;
  store.replaceQuestions(mapImportedRows(pendingImport.rows));
  renderImportErrors(pendingImport.errors);
  renderQuestions();
  elements.confirm.hidden = true;
  pendingImport = null;
  showToast('貼り付けた問題を読み込みました。');
}

function beginImport() {
  const parsed = parseTabularRows(elements.paste.value, typingSchema);
  pendingImport = parsed;
  if (store.getState().project.questions.length > 0 && parsed.rows.length > 0) {
    elements.confirm.hidden = false;
    elements.confirm.querySelector('[data-action="confirm-replace"]').focus();
  } else {
    applyPendingImport();
  }
}

function updateInlineField(input, questionId, field) {
  const card = input.closest('[data-role="question-card"]');
  const previousError = card.querySelector(`#${CSS.escape(`question-${questionId}-${field}-error`)}`);
  previousError?.remove();
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
  if (!input.value.trim()) {
    const error = document.createElement('span');
    error.className = 'field-error';
    error.id = `question-${questionId}-${field}-error`;
    error.textContent = `この「${field === 'prompt' ? '問題' : field === 'displayAnswer' ? '正解' : 'よみ'}」を入力してください。`;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', error.id);
    input.after(error);
  }
}

elements.title.value = store.getState().project.title;
elements.title.addEventListener('input', () => store.setTitle(elements.title.value));
document.querySelector('[data-action="load-paste"]').addEventListener('click', beginImport);
document.querySelector('[data-action="confirm-replace"]').addEventListener('click', applyPendingImport);
document.querySelector('[data-action="cancel-replace"]').addEventListener('click', () => {
  pendingImport = null;
  elements.confirm.hidden = true;
});

elements.questionList.addEventListener('input', (event) => {
  const input = event.target.closest('[data-field]');
  if (!input) return;
  const card = input.closest('[data-role="question-card"]');
  const id = card.dataset.id;
  const field = input.dataset.field;
  const patch = { [field]: field === 'reading' ? normalizeReading(input.value) : input.value };
  if (field === 'reading') {
    patch.romajiHint = readingToRomaji(patch.reading);
    card.querySelector('[data-role="romaji-hint"]').textContent = patch.romajiHint || '—';
  }
  store.updateQuestion(id, patch);
  updateInlineField(input, id, field);
});

elements.questionList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('[data-role="question-card"]').dataset.id;
  if (button.dataset.action === 'duplicate') store.duplicateQuestion(id);
  if (button.dataset.action === 'delete') store.removeQuestion(id);
  if (button.dataset.action === 'move-up') store.moveQuestion(id, -1);
  if (button.dataset.action === 'move-down') store.moveQuestion(id, 1);
  renderQuestions();
});

document.querySelector('[data-action="restart-preview"]').addEventListener('click', () => {
  const errors = projectErrors();
  renderImportErrors(errors);
  if (errors.length) {
    const firstInvalid = elements.questionList.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
    showToast('入力エラーを修正してから再スタートしてください。');
    return;
  }
  game.restart(store.getSnapshot());
  store.markPreviewed();
  showToast('最新の問題でプレビューを再スタートしました。');
});

elements.volume.addEventListener('input', () => {
  const value = Number(elements.volume.value);
  store.setVolume(value);
  game.setVolume(value);
  elements.volumeOutput.textContent = `${Math.round(value * 100)}%`;
});
elements.mute.addEventListener('change', () => {
  store.setMuted(elements.mute.checked);
  game.setMuted(elements.mute.checked);
});

elements.exportButton.addEventListener('click', async () => {
  if (exporting) return;
  const errors = projectErrors();
  renderImportErrors(errors);
  if (errors.length) {
    elements.questionList.querySelector('[aria-invalid="true"]')?.focus();
    showToast('入力エラーを修正してから書き出してください。');
    return;
  }

  exporting = true;
  const originalLabel = elements.exportButton.textContent;
  elements.exportButton.disabled = true;
  elements.exportButton.textContent = 'HTMLを準備中…';
  elements.exportState.textContent = '画像と音声をまとめています';

  try {
    const snapshot = store.getSnapshot();
    const bundle = await loadTemplateBundle(manifest);
    const html = buildStandaloneHtml({ project: snapshot, bundle });
    downloadStandaloneHtml({ html, filename: snapshot.title });
    store.markExported(snapshot);
    showToast('遊べるHTMLを書き出しました。');
  } catch (error) {
    console.error(error);
    elements.exportState.textContent = '書き出しに失敗しました。内容は保持されています';
    showToast('書き出しに失敗しました。もう一度お試しください。');
  } finally {
    exporting = false;
    elements.exportButton.disabled = false;
    elements.exportButton.textContent = originalLabel;
    if (!store.getState().dirty) elements.exportState.textContent = '遊べるHTMLを書き出しました';
    else if (elements.exportState.textContent === '画像と音声をまとめています') updateMeta(store.getState());
  }
});
store.subscribe(updateMeta);
renderQuestions();
updateMeta(store.getState());

window.addEventListener('beforeunload', (event) => {
  if (!store.getState().unsavedChanges) return;
  event.preventDefault();
  event.returnValue = '';
});

window.__DEKIRU_CREATOR__ = { store, game, manifest };
