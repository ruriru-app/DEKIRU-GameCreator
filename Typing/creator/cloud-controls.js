import {ok,failure} from '../../core/cloud/contracts.js';
import {validateCloudProject,serializeCloudProject} from '../../core/cloud/project-validation.js';
import {publicConfig} from '../../core/cloud/config.js';
import {saveAuthResume,takeAuthResume,clearAuthResume} from '../../core/cloud/auth-resume.js';
import {buildShareUrl} from '../../core/cloud/share-url.js';
import {downloadProject} from './project-file.js';

const same=(a,b)=>serializeCloudProject(a)===serializeCloudProject(b);
export function createCloudEditor({store,cloudState,api}) {
  let user=null,epoch=0,busy=false,pending=null,savedRecord=null,conflict=false;
  const listeners=new Set();
  function getState(){return {user:user?{...user}:null,busy,conflict,canRetry:Boolean(pending),...cloudState.getState()};}
  function notify(){for(const fn of listeners) fn(getState());}
  function detach(){epoch++;busy=false;pending=null;savedRecord=null;conflict=false;cloudState.detach();notify();}
  const gate=()=>!user?failure('UNAUTHENTICATED'):busy||pending?failure('VALIDATION','前の操作の確認が必要です。「通信を再確認」を押してください。'):null;
  async function execute(operation) {
    const ticket=epoch;busy=true;notify();
    let result;
    try {result=await api[operation.method](operation.args);} catch {result=failure('NETWORK');}
    if(ticket!==epoch) return failure('CONFLICT','ログイン状態または開いている教材が変わったため、古い応答を反映しませんでした。');
    busy=false;
    if(!result.ok) {
      // Only transport uncertainty needs the exact same request id. No automatic retry.
      pending=result.error.code==='NETWORK'?operation:null;
      if(result.error.code==='CONFLICT')conflict=true;
      notify();return result;
    }
    pending=null;conflict=false;
    if(operation.method==='saveDraft') {
      cloudState.markSaved({ownerId:user.id,requestId:operation.args.requestId,snapshot:operation.args.project,meta:result.data});
      savedRecord={...structuredClone(result.data),project:structuredClone(operation.args.project)};
    } else {
      cloudState.markPublished({ownerId:user.id,meta:result.data});
      if(savedRecord) savedRecord={...savedRecord,...structuredClone(result.data)};
    }
    notify();return result;
  }
  async function save({copy=false}={}) {
    const error=gate();if(error) return error;
    const snapshot=store.getSnapshot(),checked=validateCloudProject(snapshot,{mode:'draft'});
    if(!checked.ok) return checked;
    const meta=copy?null:cloudState.getState().gameMeta,requestId=crypto.randomUUID();
    cloudState.beginSave({ownerId:user.id,requestId,snapshot});
    return execute({method:'saveDraft',args:{gameId:meta?.id??null,expectedVersion:meta?.version??0,project:snapshot,requestId}});
  }
  async function publish() {
    const error=gate();if(error) return error;
    const confirmed=store.getSnapshot(),checked=validateCloudProject(confirmed,{mode:'publish'}),ticket=epoch;
    if(!checked.ok) return checked;
    if(!cloudState.isCloudSaved(confirmed)) {
      const saved=await save();if(!saved.ok) return saved;
    }
    if(ticket!==epoch || !same(confirmed,store.getSnapshot())) return failure('CONFLICT','保存中に編集がありました。新しい内容を確認してから配布してください。');
    const meta=cloudState.getState().gameMeta;
    return execute({method:'publishGame',args:{gameId:meta.id,expectedVersion:meta.version,requestId:crypto.randomUUID()}});
  }
  return {
    getState,save,publish,detach,saveCopy:()=>save({copy:true}),
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    setUser(value) {
      if(user?.id!==value?.id) detach();
      user=value?{...value}:null;notify();
    },
    retry(){return !user?Promise.resolve(failure('UNAUTHENTICATED')):!pending||busy?Promise.resolve(failure('VALIDATION')):execute(pending);},
    async load(id,{canReplace=()=>true,onLoaded=()=>{}}={}) {
      const error=gate();if(error) return error;
      const ticket=epoch,snapshot=store.getSnapshot();busy=true;notify();
      let result;try {result=await api.loadGame(id);} catch {result=failure('NETWORK');}
      if(ticket!==epoch) return failure('CONFLICT');
      busy=false;
      if(!same(snapshot,store.getSnapshot())||!canReplace()){notify();return failure('CONFLICT','読み込み中に編集がありました。現在の内容は置き換えていません。');}
      if(result.ok) {
        conflict=false;
        store.loadProject(result.data.project,{source:'cloud'});
        savedRecord=structuredClone(result.data);cloudState.attach({ownerId:user.id,record:savedRecord});
        onLoaded();
      }
      notify();return result;
    },
    restoreLink(link) {
      if(link?.ownerId!==user?.id) return false;
      savedRecord=structuredClone(link.record);cloudState.attach(link);notify();return true;
    },
    getResumeLink(){return user && savedRecord?{ownerId:user.id,record:structuredClone(savedRecord)}:null;},
    shouldWarnOnLeave(unappliedPaste='') {
      return Boolean(unappliedPaste.trim() || pending || (store.getState().unsavedChanges && !cloudState.isCloudSaved(store.getSnapshot())));
    },
    destroy(){detach();listeners.clear();},
  };
}

/** Keep DOM, authentication and dialogs out of the game runtime. */
export function mountCloudControls({
  root,store,auth,api,cloudState,getPasteText,setPasteText,
  configured=publicConfig.enabled,appBaseUrl=publicConfig.appBaseUrl,storage,
  onProjectLoaded=()=>{},getUnappliedPaste=getPasteText,onAuthNavigation=()=>{},
  returnTo='Typing/creator/index.html',gameId=null,
  copyText=text=>navigator.clipboard.writeText(text),
}) {
  const editor=createCloudEditor({store,cloudState,api});
  let destroyed=false,identityRevision=0,context=null,activeChoice=null,authNavigating=false;
  const page=root.ownerDocument.defaultView;
  function setAuthNavigation(value){authNavigating=value;onAuthNavigation(value);}
  async function onPageShow(event){
    if(!event.persisted||destroyed)return;
    // A cached Back return already has the live draft: never restore the older snapshot.
    if(authNavigating){setAuthNavigation(false);clearAuthResume(storage);}
    const revision=identityRevision;
    const result=await auth.getUser().catch(()=>failure('NETWORK'));
    if(!destroyed&&revision===identityRevision)setIdentity(result.ok?result.data:null);
  }
  page?.addEventListener('pageshow',onPageShow);
  root.innerHTML='<h2>オンライン保存・URLで配布</h2><p data-cloud-identity></p><p data-cloud-summary></p><div class="project-actions"><button class="secondary-button" type="button" data-cloud-action="login">Googleでログイン</button><button class="secondary-button" type="button" data-cloud-action="logout">ログアウト</button><a class="back-link" href="../../app/account/index.html">マイゲーム</a></div><div class="project-actions cloud-actions"><button class="secondary-button" type="button" data-cloud-action="save">オンライン保存</button><button class="secondary-button" type="button" data-cloud-action="publish">共有URLを作る</button><button class="secondary-button" type="button" data-cloud-action="retry" hidden>通信を再確認</button></div><p data-cloud-save-state></p><div data-cloud-link hidden><label>配布用URL<input data-cloud-url readonly aria-label="配布用URL"></label><button class="secondary-button" type="button" data-cloud-action="copy">URLをコピー</button></div><p role="status" aria-live="polite" data-cloud-message></p><small>保存しただけでは公開されません。リンクを知っている人が遊べます。個人情報は問題に入れないでください。自動保存ではありません。</small>';
  root.insertAdjacentHTML('beforeend','<div data-cloud-recovery hidden><p>別の場所の更新とは分けて、今の編集内容を残せます。最新版を読み直す場合は、この画面の内容を置き換える前に確認します。</p><div class="project-actions"><button class="secondary-button" type="button" data-cloud-action="reload">保存版を読み直す</button><button class="secondary-button" type="button" data-cloud-action="save-copy">別の教材として保存</button></div></div>');
  const q=s=>root.querySelector(s),buttons=Object.fromEntries(['login','logout','save','publish','retry','copy','reload','save-copy'].map(a=>[a,q('[data-cloud-action="'+a+'"]')]));
  function message(text){q('[data-cloud-message]').textContent=text;}
  function render() {
    const state=editor.getState(),pub=state.gameMeta?.publication;
    q('[data-cloud-identity]').textContent=!configured?'オンライン機能は準備中です。問題セットの保存・HTML書き出しは利用できます。':state.user?(state.user.email||'作成者')+' でログイン中':'オンライン保存・URL配布には、作成者のログインが必要です。遊ぶ人のログインは不要です。';
    q('[data-cloud-summary]').textContent=context?'無料試験運用：保存 '+context.counts.games+' / '+context.limits.games+'件・公開 '+context.counts.publications+' / '+context.limits.publications+'件':'';
    buttons.login.hidden=Boolean(state.user);buttons.login.disabled=!configured||state.busy;
    buttons.logout.hidden=!state.user;buttons.logout.disabled=state.busy;
    for(const a of ['save','publish']) buttons[a].disabled=!configured||!state.user||state.busy||state.canRetry;
    buttons.retry.hidden=!state.canRetry;buttons.retry.disabled=state.busy;
    q('[data-cloud-recovery]').hidden=!state.conflict;
    buttons.reload.hidden=!state.gameMeta;
    for(const a of ['reload','save-copy'])buttons[a].disabled=!configured||!state.user||state.busy||state.canRetry;
    buttons.publish.textContent=pub?'配布内容を更新':'共有URLを作る';
    q('[data-cloud-save-state]').textContent=state.busy?'通信中…':!state.gameMeta?'オンラインには未保存です':state.cloudDirty?'オンライン保存後に変更があります':state.publicationDirty?'オンライン保存済み・配布内容には未反映です':'オンライン保存済み';
    let url='';if(pub?.status==='published') {try{url=buildShareUrl(appBaseUrl,pub.shareId);}catch{}}
    q('[data-cloud-url]').value=url;q('[data-cloud-link]').hidden=!url;
  }
  async function refreshContext(){
    if(!configured||!editor.getState().user)return;
    const revision=identityRevision;
    const result=await api.getContext().catch(()=>failure('NETWORK'));
    if(destroyed||revision!==identityRevision)return;
    context=result.ok?result.data:null;render();
  }
  function setIdentity(user) {
    if(destroyed)return;
    identityRevision++;context=null;editor.setUser(user);render();
    void refreshContext();
  }
  function choose(title,description,choices) {
    if(activeChoice)return Promise.resolve('cancel');
    return new Promise(resolve=>{
      const dialog=root.ownerDocument.createElement('dialog');
      dialog.className='project-dialog';
      const heading=root.ownerDocument.createElement('h2');heading.textContent=title;
      const text=root.ownerDocument.createElement('p');text.textContent=description;
      const actions=root.ownerDocument.createElement('div');actions.className='project-actions';
      const previous=root.ownerDocument.activeElement;
      function finish(value){dialog.close();dialog.remove();activeChoice=null;previous?.focus();resolve(value);}
      for(const [value,label] of choices){
        const button=root.ownerDocument.createElement('button');button.type='button';button.className='secondary-button';
        button.textContent=label;button.dataset.choice=value;button.addEventListener('click',()=>finish(value));actions.append(button);
      }
      dialog.append(heading,text,actions);root.append(dialog);
      dialog.addEventListener('cancel',e=>{e.preventDefault();finish('cancel');});
      activeChoice=()=>finish('cancel');dialog.showModal();actions.firstElementChild.focus();
    });
  }
  async function report(work,success) {
    message('');const result=await work;if(destroyed)return;
    message(result.ok?success:result.error.message+(result.error.code==='NETWORK'?' 成否を確認するには「通信を再確認」を押してください。':''));
    render();if(result.ok)void refreshContext();
  }
  async function login() {
    const state=store.getState(),{dirty,previewDirty,unsavedChanges,hasProjectFile}=state;
    const saved=saveAuthResume(storage,{project:state.project,pasteText:getPasteText(),fileState:{dirty,previewDirty,unsavedChanges,hasProjectFile},cloudLink:editor.getResumeLink(),returnTo});
    if(!saved.ok){message(saved.error.message);return;}
    setAuthNavigation(true);
    const result=await auth.startGoogleSignIn({returnTo});
    if(!result.ok){setAuthNavigation(false);clearAuthResume(storage);message(result.error.message);}
  }
  async function logout() {
    const choice=await choose('ログアウトしますか？','編集中の問題をこの画面に残すか、編集用ファイルに保存して画面から消すかを選べます。公開したゲームは停止されません。',[['cancel','キャンセル'],['keep','編集内容を残す'],['clear','ファイル保存して消す']]);
    if(choice==='cancel')return;
    if(choice==='clear'){
      if(getUnappliedPaste().trim()){message('貼り付け欄に未反映の内容があります。問題に反映するか、別に控えてからやり直してください。');return;}
      try{const snapshot=store.getSnapshot();downloadProject(snapshot);store.markSaved(snapshot);}
      catch{message('ファイルを保存できなかったため、内容は消していません。');return;}
    }
    const result=await auth.signOut();
    if(!result.ok){message(result.error.message);return;}
    setIdentity(null);
    if(choice==='clear'){
      store.loadProject({...store.getSnapshot(),title:'',questions:[]},{source:'temporary'});
      setPasteText('');onProjectLoaded();
    }
    message('ログアウトしました。');
  }
  const handlers={
    login,logout,
    save:()=>report(editor.save(),'オンライン保存しました。配布内容は変更していません。'),
    retry:()=>report(editor.retry(),'前の操作の結果を確認しました。続けて配布する場合は、内容を確認して「共有URLを作る／配布内容を更新」を押してください。'),
    'save-copy':()=>report(editor.saveCopy(),'別の教材としてオンライン保存しました。元の教材と配布内容は変更していません。'),
    reload:async()=>{
      const state=editor.getState(),snapshot=store.getSnapshot(),pasteBefore=getPasteText();
      if(!state.gameMeta||state.busy||state.canRetry)return;
      const choice=await choose('保存版を読み直しますか？','この画面の編集内容と貼り付け欄を、オンラインの最新版に置き換えます。残したい場合はキャンセルし、別の教材として保存するか、編集用ファイルへ保存してください。',[['cancel','キャンセル'],['confirm','置き換えて読み直す']]);
      if(choice!=='confirm')return;
      const unchanged=()=>!destroyed&&editor.getState().user?.id===state.user?.id&&
        editor.getState().gameMeta?.id===state.gameMeta.id&&same(snapshot,store.getSnapshot())&&getPasteText()===pasteBefore;
      if(!unchanged()){message('確認中に編集内容やログイン状態が変わりました。置き換えていません。');return;}
      await report(editor.load(state.gameMeta.id,{canReplace:unchanged,
        onLoaded:()=>{setPasteText('');onProjectLoaded();}}),'オンラインの最新版を読み込みました。プレビューには再スタートで反映できます。');
    },
    publish:async()=>{
      if(getUnappliedPaste().trim()){message('貼り付け欄に未反映の内容があります。先に「問題を読み込む」で確認してください。');return;}
      const snapshot=store.getSnapshot(),owner=editor.getState().user?.id;
      const choice=await choose('この内容を配布しますか？',(snapshot.title||'（セット名なし）')+' ／ '+snapshot.questions.length+'問。リンクを知っている人が閲覧できます。個人情報を含まないか確認してください。',[['cancel','キャンセル'],['confirm','この内容で配布する']]);
      if(choice!=='confirm')return;
      if(owner!==editor.getState().user?.id||!same(snapshot,store.getSnapshot())){message('確認中に内容やログイン状態が変わりました。もう一度確認してください。');return;}
      await report(editor.publish(),'配布内容を更新しました。下のURLをコピーして渡せます。');
    },
    copy:async()=>{
      try{await copyText(q('[data-cloud-url]').value);message('URLをコピーしました。');}
      catch{q('[data-cloud-url]').focus();q('[data-cloud-url]').select();message('自動コピーができませんでした。URL欄から手動でコピーしてください。');}
    },
  };
  for(const [name,fn] of Object.entries(handlers)) buttons[name].addEventListener('click',fn);
  const unsubStore=store.subscribe(render),unsubEditor=editor.subscribe(render);
  const unsubAuth=auth.subscribe(setIdentity);
  render();
  const revision=identityRevision;
  const ready=(async()=>{
    const restored=takeAuthResume(storage);
    if(restored){store.restoreEditingSession(restored);setPasteText(restored.pasteText);onProjectLoaded();}
    const result=await auth.getUser();
    if(destroyed)return;
    if(revision===identityRevision) setIdentity(result.ok?result.data:null);
    if(!result.ok)message(result.error.message);
    if(restored?.cloudLink)editor.restoreLink(restored.cloudLink);
    if(gameId&&!restored&&editor.getState().user){
      if(editor.shouldWarnOnLeave(getUnappliedPaste())){
        const choice=await choose('オンラインの教材を開きますか？','今の編集内容を置き換えます。残したい場合はキャンセルしてファイル保存してください。',[['cancel','キャンセル'],['confirm','置き換えて開く']]);
        if(choice!=='confirm')return;
      }
      const pasteBefore=getPasteText();
      const loaded=await editor.load(gameId,{canReplace:()=>getPasteText()===pasteBefore,
        onLoaded:()=>{setPasteText('');onProjectLoaded();}});
      if(loaded.ok){message('オンラインの教材を開きました。プレビューへの反映は再スタートで行えます。');}
      else message(loaded.error.message);
    }
    render();
  })();
  return {
    ready,editor,
    detach(){editor.detach();message('');render();},
    shouldWarnOnLeave:()=>editor.shouldWarnOnLeave(getUnappliedPaste()),
    destroy(){destroyed=true;identityRevision++;page?.removeEventListener('pageshow',onPageShow);activeChoice?.();unsubStore();unsubEditor();unsubAuth();editor.destroy();for(const [name,fn]of Object.entries(handlers))buttons[name].removeEventListener('click',fn);},
  };
}
