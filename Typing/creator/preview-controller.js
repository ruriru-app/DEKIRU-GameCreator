export function createPreviewController({store,host,manifest,audioManager,mountGame,mountQuestion,onStateChange=()=>{}}) {
  let mode='game',selectedId=null,view=null,destroyed=false;
  let previousIds=store.getSnapshot().questions.map(q=>q.id);
  const getState=()=>({mode,selectedId});
  const notify=()=>onStateChange(getState());
  const dispose=()=>{view?.destroy();audioManager.stopAll();view=null;};
  function fit() {
    const parent=host.parentElement;if(!parent)return;
    if(mode==='question'&&globalThis.matchMedia('(min-width: 881px)').matches){
      host.style.width='1280px';host.style.transformOrigin='top left';
      host.style.transform='scale('+parent.clientWidth/1280+')';parent.style.height=parent.clientWidth*9/16+'px';
    }else{host.style.width='100%';host.style.transform='';parent.style.height='';}
  }
  function createGame() {
    const project=store.getSnapshot();
    view=mountGame({host,project,manifest,audioManager});
    audioManager.setVolume(project.settings.volume);audioManager.setMuted(project.settings.muted);
  }
  function showGame() {
    if(destroyed)return;
    const project=store.getSnapshot();
    if(!project.questions.length||project.questions.some(q=>['prompt','displayAnswer','reading'].some(k=>!q[k].trim())))throw Error('問題・正解・よみを入力してからゲーム全体を確認してください。');
    dispose();mode='game';fit();createGame();store.markPreviewed();notify();
  }
  function selectQuestion(id) {
    if(destroyed||!store.getSnapshot().questions.some(q=>q.id===id))return;
    selectedId=id;
    if(mode!=='question'){dispose();mode='question';fit();view=mountQuestion({host,project:store.getSnapshot(),questionId:id,manifest});}
    else view.update({project:store.getSnapshot(),questionId:id});
    notify();
  }
  createGame();
  const unsubscribe=store.subscribe(({project})=>{
    if(destroyed)return;
    const ids=project.questions.map(q=>q.id);
    if(selectedId&&!ids.includes(selectedId)){
      const index=previousIds.indexOf(selectedId);
      selectedId=ids[Math.min(Math.max(index,0),ids.length-1)]??null;
    }
    previousIds=ids;
    if(mode==='question')view.update({project,questionId:selectedId});
    notify();
  });
  const observer=host.parentElement&&typeof ResizeObserver!=='undefined'?new ResizeObserver(fit):null;
  observer?.observe(host.parentElement);
  globalThis.addEventListener?.('resize',fit);
  return {
    getState,selectQuestion,showGame,
    restartGame(){showGame();view?.start();},
    setVolume:value=>audioManager.setVolume(value),
    setMuted:value=>audioManager.setMuted(value),
    reset(){
      if(destroyed)return;
      dispose();mode='question';selectedId=null;previousIds=store.getSnapshot().questions.map(q=>q.id);
      fit();view=mountQuestion({host,project:store.getSnapshot(),questionId:null,manifest});notify();
    },
    destroy(){if(destroyed)return;destroyed=true;unsubscribe();observer?.disconnect();globalThis.removeEventListener?.('resize',fit);dispose();},
  };
}
