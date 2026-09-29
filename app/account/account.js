import {ok,failure} from '../../core/cloud/contracts.js';
import {buildShareUrl} from '../../core/cloud/share-url.js';

/** The current identity owns every outstanding read and mutation. */
export function createGameLibrary({api}) {
  let user=null,rows=[],context=null,status='signed-out',error=null,busy=false,pending=null,epoch=0,destroyed=false;
  const listeners=new Set();
  const getState=()=>structuredClone({user,rows,context,status,error,busy,canRetry:Boolean(pending)});
  const notify=()=>{if(!destroyed)for(const fn of listeners)fn(getState());};
  const gate=()=>!user?failure('UNAUTHENTICATED'):busy||pending?failure('VALIDATION','前の通信を確認してから操作してください。'):null;
  async function call(method,args){try{return await api[method](args);}catch{return failure('NETWORK');}}
  async function execute(operation) {
    const ticket=epoch;busy=true;error=null;notify();
    const result=await call(operation.method,operation.args);
    if(destroyed||ticket!==epoch)return failure('CONFLICT');
    busy=false;pending=!result.ok&&result.error.code==='NETWORK'?operation:null;
    if(result.ok){
      rows=operation.method==='deleteGame'?rows.filter(row=>row.id!==operation.args.gameId):rows.map(row=>row.id===operation.args.gameId?structuredClone(result.data):row);
      if(context)context.counts={...context.counts,games:rows.length,publications:rows.filter(row=>row.publication?.status==='published').length};
    }else error=result.error;
    notify();return result;
  }
  return {
    getState,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    setUser(value){
      if(user?.id!==value?.id){epoch++;rows=[];context=null;error=null;busy=false;pending=null;status=value?'idle':'signed-out';}
      user=value?{...value}:null;notify();
    },
    async refresh(){
      const blocked=gate();if(blocked)return blocked;
      const ticket=epoch;busy=true;status='loading';error=null;notify();
      const [games,info]=await Promise.all([call('listGames'),call('getContext')]);
      if(destroyed||ticket!==epoch)return failure('CONFLICT');
      busy=false;
      if(games.ok&&info.ok){rows=structuredClone(games.data);context=structuredClone(info.data);status='ready';}
      else{rows=[];context=null;status='error';error=(!games.ok?games:info).error;}
      notify();return error?{ok:false,error}:ok(rows);
    },
    async perform(command,id,expectedVersion){
      const blocked=gate();if(blocked)return blocked;
      const row=rows.find(row=>row.id===id);
      if(!row)return failure('FORBIDDEN');
      if(row.version!==expectedVersion)return failure('CONFLICT');
      if(!['delete','unpublish','republish'].includes(command))return failure('VALIDATION');
      if(command!=='delete'&&!row.publication)return failure('VALIDATION');
      return execute({method:command==='delete'?'deleteGame':'setPublished',args:{gameId:id,expectedVersion,requestId:crypto.randomUUID(),...(command==='delete'?{}:{published:command==='republish'})}});
    },
    retry(){return !user?Promise.resolve(failure('UNAUTHENTICATED')):!pending||busy?Promise.resolve(failure('VALIDATION')):execute(pending);},
    destroy(){destroyed=true;epoch++;rows=[];context=null;user=null;pending=null;listeners.clear();},
  };
}

export function mountAccountPage({root,auth,api,appBaseUrl,configured=true,copyText=text=>navigator.clipboard.writeText(text)}) {
  const model=createGameLibrary({api}),doc=root.ownerDocument;
  let destroyed=false,identityRevision=0,cancelChoice=null;
  root.innerHTML='<section class="account-heading"><p class="eyebrow">MY GAMES</p><h1>マイゲーム</h1><p data-identity></p><div class="account-actions"><button type="button" data-action="login">Googleでログイン</button><button type="button" data-action="logout" hidden>ログアウト</button><button type="button" data-action="refresh" hidden>一覧を再読み込み</button><button type="button" data-action="retry" hidden>通信を再確認</button></div></section><p data-limits></p><p data-status role="status" aria-live="polite"></p><p data-message role="status" aria-live="polite"></p><div data-games></div><p class="account-note">オンライン保存しただけでは公開されません。公開停止・削除をしても、すでに読み込まれたゲームやダウンロード済みのHTMLは回収できません。</p><p><a href="../../Typing/creator/index.html">新しいタイピング教材を作る</a> · <a href="./privacy.html">保存とプライバシーについて</a></p>';
  const q=selector=>root.querySelector(selector);
  function message(value){q('[data-message]').textContent=value;}
  function button(action,text){const node=doc.createElement('button');node.type='button';node.dataset.action=action;node.textContent=text;return node;}
  function render(){
    const state=model.getState();
    q('[data-identity]').textContent=!configured?'オンライン機能は準備中です。登録不要の問題作成・ファイル保存は利用できます。':state.user?(state.user.email||'作成者')+' でログイン中':'保存した教材を見るには、作成者のログインが必要です。遊ぶ人のログインは不要です。';
    q('[data-action="login"]').hidden=Boolean(state.user);q('[data-action="login"]').disabled=!configured;
    for(const name of ['logout','refresh']){q('[data-action="'+name+'"]').hidden=!state.user;q('[data-action="'+name+'"]').disabled=state.busy;}
    q('[data-action="refresh"]').disabled=state.busy||state.canRetry;
    q('[data-action="retry"]').hidden=!state.canRetry;q('[data-action="retry"]').disabled=state.busy;
    const info=state.context;
    q('[data-limits]').textContent=info?'無料試験運用：保存 '+info.counts.games+' / '+info.limits.games+'件・公開 '+info.counts.publications+' / '+info.limits.publications+'件':'';
    q('[data-status]').textContent=state.status==='loading'?'一覧を読み込んでいます…':state.status==='error'?'一覧を取得できませんでした。'+state.error.message:state.error?state.error.message+(state.canRetry?' 操作が完了したか不明です。「通信を再確認」で確認してください。':''):state.status==='ready'&&!state.rows.length?'保存した教材はまだありません。':'';
    const list=q('[data-games]');list.replaceChildren();
    for(const row of state.rows){
      const article=doc.createElement('article');article.className='game-card';article.dataset.game=row.id;
      const heading=doc.createElement('h2');heading.textContent=row.title||'（セット名なし）';
      const detail=doc.createElement('p'),date=new Date(row.updatedAt);
      detail.textContent=row.questionCount+'問'+(Number.isNaN(date.valueOf())?'':' · 更新 '+date.toLocaleString('ja-JP'));
      const status=doc.createElement('p');status.className='publication-status';
      status.textContent=!row.publication?'下書き（未公開）':row.publication.status==='published'?'公開中':'公開停止中';
      if(row.publicationDirty)status.textContent+=' · 下書きの変更は配布内容に未反映';
      const actions=doc.createElement('div');actions.className='account-actions';
      // Only server-issued UUIDs can become an editor link.
      if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)){
        const edit=doc.createElement('a');edit.dataset.action='edit';edit.textContent='編集する';
        const url=new URL('Typing/creator/index.html',appBaseUrl);url.searchParams.set('game',row.id);edit.href=url.href;actions.append(edit);
      }
      if(row.publication){
        let url='';try{url=buildShareUrl(appBaseUrl,row.publication.shareId);}catch{}
        if(url){
          const label=doc.createElement('label');label.textContent='配布用URL';
          const input=doc.createElement('input');input.dataset.shareUrl='';input.readOnly=true;input.value=url;input.setAttribute('aria-label','配布用URL');label.append(input);article.append(label);
          actions.append(button('copy','URLをコピー'));
        }
        actions.append(button(row.publication.status==='published'?'unpublish':'republish',row.publication.status==='published'?'公開を停止':'同じ配布内容で再開'));
      }
      actions.append(button('delete','削除する'));
      for(const control of actions.querySelectorAll('button'))control.disabled=state.busy||state.canRetry;
      article.prepend(heading,detail,status);article.append(actions);list.append(article);
    }
  }
  function confirm(title,description){
    if(cancelChoice)return Promise.resolve(false);
    return new Promise(resolve=>{
      const dialog=doc.createElement('dialog');dialog.className='account-dialog';
      const heading=doc.createElement('h2');heading.id='account-confirm-title';heading.textContent=title;dialog.setAttribute('aria-labelledby',heading.id);
      const text=doc.createElement('p');text.textContent=description;
      const actions=doc.createElement('div');actions.className='account-actions';
      const cancel=button('cancel','キャンセル'),accept=button('confirm','確認して実行');cancel.dataset.choice='cancel';accept.dataset.choice='confirm';
      const previous=doc.activeElement;
      function finish(value){dialog.close();dialog.remove();cancelChoice=null;if(previous?.isConnected)previous.focus();else q('[data-action="refresh"]').focus();resolve(value);}
      cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);cancelChoice=()=>finish(false);
      dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});actions.append(cancel,accept);dialog.append(heading,text,actions);root.append(dialog);dialog.showModal();cancel.focus();
    });
  }
  async function identity(user){
    if(destroyed)return;
    identityRevision++;cancelChoice?.();message('');model.setUser(user);
    if(configured&&user)await model.refresh();
  }
  async function click(event){
    const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
    const action=target.dataset.action;if(['edit','confirm','cancel'].includes(action))return;
    if(action==='login'){
      const result=await auth.startGoogleSignIn({returnTo:'app/account/index.html'});
      if(!destroyed&&!result.ok)message(result.error.message);return;
    }
    if(action==='logout'){
      const owner=model.getState().user?.id;
      if(!await confirm('ログアウトしますか？','この画面のアカウント情報と一覧を消します。公開中の教材は停止されません。'))return;
      if(owner!==model.getState().user?.id)return;
      const result=await auth.signOut();if(destroyed)return;
      if(result.ok)await identity(null);else message(result.error.message);return;
    }
    message('');
    if(action==='refresh'){await model.refresh();return;}
    if(action==='retry'){await model.retry();return;}
    const article=target.closest('[data-game]'),state=model.getState(),row=state.rows.find(item=>item.id===article?.dataset.game);
    if(!row)return;
    if(action==='copy'){
      const input=article.querySelector('[data-share-url]');
      try{await copyText(input.value);if(!destroyed&&state.user?.id===model.getState().user?.id)message('URLをコピーしました。');}
      catch{if(!destroyed&&input.isConnected){input.focus();input.select();message('自動コピーできませんでした。URL欄から手動でコピーしてください。');}}return;
    }
    const prompt={delete:['教材を削除しますか？','下書きとオンラインの公開データを削除します。取り消せません。必要ならキャンセルし、編集画面で問題セットをファイル保存してください。'],unpublish:['公開を停止しますか？','このURLから新しく遊ぶことができなくなります。下書きと共有URLは残ります。'],republish:['配布を再開しますか？','以前に配布した内容を同じURLで再開します。下書きの変更は反映しません。リンクを知っている人が閲覧できます。']}[action];
    if(!prompt)return;
    if(!await confirm(prompt[0],(row.title||'（セット名なし）')+' ／ '+row.questionCount+'問。'+prompt[1]))return;
    if(destroyed||state.user?.id!==model.getState().user?.id)return;
    const result=await model.perform(action,row.id,row.version);
    if(!destroyed&&state.user?.id===model.getState().user?.id)message(result.ok?'操作を反映しました。':result.error.message);
  }
  root.addEventListener('click',click);
  const unsubscribe=model.subscribe(render),unsubscribeAuth=auth.subscribe(identity);render();
  const revision=identityRevision;
  const ready=(async()=>{
    const result=await auth.getUser();if(destroyed||revision!==identityRevision)return;
    if(result.ok)await identity(result.data);else message(result.error.message);
  })();
  return{ready,model,destroy(){destroyed=true;identityRevision++;cancelChoice?.();unsubscribeAuth();unsubscribe();model.destroy();root.removeEventListener('click',click);root.replaceChildren();}};
}
