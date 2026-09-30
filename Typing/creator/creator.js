import { parseTabularRows, validateRows } from '../../core/data-importer.js';
import { createAudioManager } from '../../core/audio-manager.js';
import { createTemplateRegistry } from '../../core/template-registry.js';
import { buildStandaloneHtml, downloadStandaloneHtml, loadTemplateBundle } from '../../core/html-exporter.js';
import { normalizeReading, readingToRomaji, romajiToHiragana } from '../core/romaji-converter.js';
import { createTypingEngine } from '../core/typing-engine.js';
import { fusumaManifest } from '../templates/fusuma/manifest.js';
import { createFusumaEventController } from '../templates/fusuma/event-controller.js';
import { mountFusumaGame, mountFusumaQuestionPreview } from '../templates/fusuma/renderer.js';
import { createPreviewController } from './preview-controller.js';
import { createQuestionImageController } from './question-image-controller.js';
import { createProjectStore } from './creator-state.js';
import { downloadProject, parseProjectFile, MAX_PROJECT_BYTES } from './project-file.js';
import {createCloudState} from '../../core/cloud/cloud-state.js';
import {loadBrowserCloud} from '../../core/cloud/browser-client.js';
import {mountCloudControls} from './cloud-controls.js';

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
let appliedPasteText = '';
let authNavigation = false;
let cloudControls = null;
const cloudState = createCloudState({getProject:store.getSnapshot});
const images = createQuestionImageController({store});
const canCommit = () => !images.getState().busy;
const preview = createPreviewController({
  store,host:elements.gameHost,manifest,audioManager,
  mountGame:options=>mountFusumaGame({...options,createEngine:createTypingEngine,
    convertRomaji:romajiToHiragana,createEventController:createFusumaEventController}),
  mountQuestion:mountFusumaQuestionPreview,onStateChange:updatePreviewState,
});

function guardImages() {
  if(canCommit())return true;
  showToast('画像を処理中です。完了してから操作してください。');return false;
}

function updatePreviewState(state=preview.getState()) {
  for(const card of elements.questionList.children){
    const selected=state.mode==='question'&&card.dataset.id===state.selectedId;
    card.classList.toggle('is-previewed',selected);
    card.querySelector('[data-action=preview-question]')?.setAttribute('aria-pressed',String(selected));
  }
  const label=document.querySelector('[data-role=preview-mode]');
  const index=store.getSnapshot().questions.findIndex(q=>q.id===state.selectedId);
  label.textContent=state.mode==='game'?'ゲーム全体':index<0?'問題を選んでください':`${index+1}問目を確認中`;
}

function imageControls() {
  const area=document.createElement('div');area.className='question-image-editor';
  area.innerHTML='<div class="image-editor-head"><span>問題の画像 <small>（任意）</small></span><button type="button" class="secondary-button compact" data-action="choose-image">画像を追加</button><button type="button" data-action="remove-image" hidden>画像を外す</button></div><input type="file" data-role="question-image-file" accept="image/jpeg,image/png,image/webp" aria-label="問題の画像を選ぶ" hidden><div class="image-options" hidden><img data-role="image-thumbnail" loading="lazy" alt="選択した問題の画像"><label>配置<select data-role="image-placement"><option value="top">問題文の上</option><option value="bottom">問題文の下</option><option value="left">問題文の左</option><option value="right">問題文の右</option></select></label><label>画像の説明<input data-role="image-alt" maxlength="200" value="問題の画像" autocomplete="off"></label></div><p data-role="image-status" role="status" aria-live="polite"></p>';
  return area;
}

function syncImageControls() {
  const state=images.getState(),project=store.getSnapshot();
  for(const card of elements.questionList.children){
    const question=project.questions.find(q=>q.id===card.dataset.id);if(!question)continue;
    const picture=question.image,pending=state.pendingIds.includes(question.id);
    const area=card.querySelector('.question-image-editor');
    area.querySelector('[data-action=choose-image]').textContent=picture?'画像を差し替える':'画像を追加';
    area.querySelector('[data-action=remove-image]').hidden=!picture&&!pending;
    area.querySelector('.image-options').hidden=!picture&&!pending;
    const thumb=area.querySelector('[data-role=image-thumbnail]');thumb.hidden=!picture;
    if(picture){
      if(thumb.getAttribute('src')!==picture.dataUrl)thumb.src=picture.dataUrl;
      for(const [role,value] of [['image-placement',picture.placement],['image-alt',picture.alt]]){
        const input=area.querySelector(`[data-role=${role}]`);
        if(document.activeElement!==input&&!pending)input.value=value;
      }
    }else thumb.removeAttribute('src');
    const status=area.querySelector('[data-role=image-status]');
    status.textContent=state.errors[question.id]||(pending?'画像を調整中…':picture?`${picture.width} × ${picture.height} px`:'JPEG・PNG・WebPを選べます（元画像10 MBまで）。');
    status.classList.toggle('project-error',Boolean(state.errors[question.id]));
  }
  elements.saveButton.disabled=state.busy;
  elements.exportButton.disabled=state.busy||exporting;
  const bytes=new TextEncoder().encode(JSON.stringify(project)).byteLength;
  document.querySelector('[data-role=image-capacity]').textContent=`教材データ：約 ${Math.ceil(bytes/1024)} KiB ／ オンライン上限 ${project.schemaVersion===2?'2 MiB':'256 KiB'}（文章のみ256 KiBまで）`;
}

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
      actionButton('preview-question', 'プレビュー', `${index + 1}問目をプレビュー`),
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
    card.append(head, fields, imageControls());
    elements.questionList.append(card);
  });
  updatePreviewState();
  syncImageControls();
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
  if(!guardImages())return;
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
  cloudControls?.detach();
  images.reset();
  store.loadProject(pendingProject);
  syncProjectFields();
  elements.paste.value = '';
  appliedPasteText = '';
  closeProjectConfirmation();
  elements.title.focus();
  showToast('問題セットを開きました。ゲームへの反映は「プレビューを再スタート」で行えます。');
});

function syncProjectFields() {
  images.reset();
  preview.reset();
  const project = store.getSnapshot();
  elements.title.value = project.title;
  elements.volume.value = String(project.settings.volume);
  elements.volumeOutput.textContent = `${Math.round(project.settings.volume * 100)}%`;
  elements.mute.checked = project.settings.muted;
  preview.setVolume(project.settings.volume);
  preview.setMuted(project.settings.muted);
  pendingImport = null;
  elements.confirm.hidden = true;
  renderQuestions();
  renderImportErrors(projectErrors());
}

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
  images.reset();
  store.replaceQuestions(mapImportedRows(pendingImport.rows));
  preview.reset();
  renderImportErrors(pendingImport.errors);
  renderQuestions();
  elements.confirm.hidden = true;
  pendingImport = null;
  appliedPasteText = elements.paste.value;
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
  if(event.target.matches('[data-role=image-alt]')){
    images.setAlt(event.target.closest('[data-role=question-card]').dataset.id,event.target.value);return;
  }
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

elements.questionList.addEventListener('change',event=>{
  const id=event.target.closest('[data-role=question-card]')?.dataset.id;if(!id)return;
  if(event.target.matches('[data-role=question-image-file]')){
    const file=event.target.files?.[0];event.target.value='';
    if(file)void images.select(id,file);
  }
  if(event.target.matches('[data-role=image-placement]'))images.setPlacement(id,event.target.value);
});

elements.questionList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('[data-role="question-card"]').dataset.id;
  if(button.dataset.action==='preview-question'){
    preview.selectQuestion(id);
    if(matchMedia('(max-width: 880px)').matches)document.querySelector('.preview-pane').scrollIntoView({block:'start',behavior:'smooth'});
    return;
  }
  if(button.dataset.action==='choose-image'){button.closest('[data-role=question-card]').querySelector('[data-role=question-image-file]').click();return;}
  if(button.dataset.action==='remove-image'){images.remove(id);return;}
  if (button.dataset.action === 'duplicate') store.duplicateQuestion(id);
  if (button.dataset.action === 'delete') store.removeQuestion(id);
  if (button.dataset.action === 'move-up') store.moveQuestion(id, -1);
  if (button.dataset.action === 'move-down') store.moveQuestion(id, 1);
  renderQuestions();
});

function showFullPreview(restart=false) {
  const errors = projectErrors();
  renderImportErrors(errors);
  if (errors.length) {
    const firstInvalid = elements.questionList.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
    showToast('入力エラーを修正してから再スタートしてください。');
    return;
  }
  try{restart?preview.restartGame():preview.showGame();}
  catch(error){showToast(error.message);}
}
document.querySelector('[data-action="restart-preview"]').addEventListener('click',()=>showFullPreview(true));
document.querySelector('[data-action="preview-game"]').addEventListener('click',()=>showFullPreview());

elements.volume.addEventListener('input', () => {
  const value = Number(elements.volume.value);
  store.setVolume(value);
  preview.setVolume(value);
  elements.volumeOutput.textContent = `${Math.round(value * 100)}%`;
});
elements.mute.addEventListener('change', () => {
  store.setMuted(elements.mute.checked);
  preview.setMuted(elements.mute.checked);
});

elements.exportButton.addEventListener('click', async () => {
  if (exporting) return;
  if (!guardImages()) return;
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
    if(!canCommit()||JSON.stringify(snapshot)!==JSON.stringify(store.getSnapshot()))throw Error('準備中に変更がありました。最新の内容でもう一度書き出してください。');
    const html = buildStandaloneHtml({ project: snapshot, bundle });
    downloadStandaloneHtml({ html, filename: snapshot.title });
    store.markExported(snapshot);
    showToast('遊べるHTMLを書き出しました。');
  } catch (error) {
    console.error(error);
    elements.exportState.textContent = '書き出しに失敗しました。内容は保持されています';
    showToast(error.message||'書き出しに失敗しました。もう一度お試しください。');
  } finally {
    exporting = false;
    elements.exportButton.disabled = !canCommit();
    elements.exportButton.textContent = originalLabel;
    if (!store.getState().dirty) elements.exportState.textContent = '遊べるHTMLを書き出しました';
    else if (elements.exportState.textContent === '画像と音声をまとめています') updateMeta(store.getState());
  }
});
store.subscribe(updateMeta);
store.subscribe(syncImageControls);
images.subscribe(syncImageControls);
renderQuestions();
updateMeta(store.getState());

window.addEventListener('beforeunload', (event) => {
  if (authNavigation) return;
  const unappliedPaste=elements.paste.value!==appliedPasteText?elements.paste.value:'';
  const warn=!canCommit()||(cloudControls?cloudControls.shouldWarnOnLeave():Boolean(store.getState().unsavedChanges||unappliedPaste.trim()));
  if (!warn) return;
  event.preventDefault();
  event.returnValue = '';
});

window.__DEKIRU_CREATOR__ = { store, preview, images, manifest };

void (async()=>{
  const cloud=await loadBrowserCloud();
  const incoming=new URL(location.href),ids=incoming.searchParams.getAll('game');
  const gameId=ids.length===1&&/^[0-9a-fA-F-]{36}$/.test(ids[0])?ids[0]:null;
  cloudControls=mountCloudControls({
    root:document.querySelector('[data-role="cloud-controls"]'),store,cloudState,...cloud,gameId,
    getPasteText:()=>elements.paste.value,
    getUnappliedPaste:()=>elements.paste.value!==appliedPasteText?elements.paste.value:'',
    setPasteText:text=>{elements.paste.value=text;appliedPasteText='';},
    onProjectLoaded:syncProjectFields,onAuthNavigation:value=>{authNavigation=value;},
    canCommit,subscribeCommitState:images.subscribe,
    returnTo:'Typing/creator/index.html'+(gameId?'?game='+gameId:''),
  });
  await cloudControls.ready;
})().catch(()=>{
  document.querySelector('[data-role="cloud-controls"]').textContent='オンライン機能を確認できませんでした。問題の編集・端末への保存・HTML書き出しは利用できます。';
});
