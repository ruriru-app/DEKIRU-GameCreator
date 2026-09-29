import {parseShareId} from '../core/cloud/share-url.js';
import {fetchSharedGame} from '../core/cloud/public-api.js';
import {failure} from '../core/cloud/contracts.js';
import {resolveRuntime} from './runtime-registry.js';

export function createSharedPlayerSession({host,pageUrl,endpoint,fetchImpl,loadRuntime=resolveRuntime}) {
  let state={status:'idle',error:null},runtime=null,controller=null,epoch=0,destroyed=false;
  const listeners=new Set(),getState=()=>structuredClone(state);
  function update(status,error=null){state={status,error};if(!destroyed)for(const fn of listeners)fn(getState());}
  function stop(){epoch++;controller?.abort();controller=null;runtime?.destroy();runtime=null;}
  return{
    getState,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    async load(){
      if(destroyed||state.status==='loading')return;
      stop();const ticket=epoch,shareId=parseShareId(pageUrl);
      update('loading');
      if(!shareId){update('error',failure('UNAVAILABLE').error);return;}
      controller=new AbortController();
      const result=await fetchSharedGame({endpoint,shareId,fetchImpl,signal:controller.signal});
      if(destroyed||ticket!==epoch)return;
      if(!result.ok){update('error',result.error);return;}
      try{
        const loaded=await loadRuntime(result.data.runtimeVersion);
        if(destroyed||ticket!==epoch)return;
        runtime=loaded.mount({host,project:result.data.project});update('ready');
      }catch{if(!destroyed&&ticket===epoch)update('error',failure('SERVICE_UNAVAILABLE').error);}
    },
    deactivate(){stop();update('idle');},
    destroy(){destroyed=true;stop();listeners.clear();state={status:'idle',error:null};},
  };
}

export async function startSharedPlayer({host,pageUrl,endpoint,fetchImpl,loadRuntime=resolveRuntime}){
  const doc=host.ownerDocument,windowRef=doc.defaultView;
  host.innerHTML='<section class="player-message" role="status" aria-live="polite"><div><h1>DEKIRU Game Creator</h1><p data-player-message>ゲームを読み込んでいます…</p><button type="button" data-player-retry hidden>もう一度読み込む</button></div></section><div id="game-host" hidden></div>';
  const gameHost=host.querySelector('#game-host'),screen=host.querySelector('.player-message'),message=host.querySelector('[data-player-message]'),retry=host.querySelector('[data-player-retry]');
  const session=createSharedPlayerSession({host:gameHost,pageUrl,endpoint,fetchImpl,loadRuntime});
  function render(state){
    gameHost.hidden=state.status!=='ready';screen.hidden=state.status==='ready';
    if(state.status!=='error'){message.textContent='ゲームを読み込んでいます…';retry.hidden=true;return;}
    const code=state.error.code;
    message.textContent=code==='NETWORK'?'通信を確認し、もう一度読み込んでください。':state.error.message;
    if(code==='RATE_LIMIT')message.textContent+=' '+(state.error.retryAfterSeconds||60)+'秒ほど待ってください。';
    retry.hidden=['UNAVAILABLE','NOT_CONFIGURED'].includes(code);
  }
  const unsubscribe=session.subscribe(render),reload=()=>session.load(),leave=()=>session.deactivate(),resume=event=>{if(event.persisted)void session.load();};
  retry.addEventListener('click',reload);windowRef.addEventListener('pagehide',leave);windowRef.addEventListener('pageshow',resume);
  await session.load();
  return{destroy(){unsubscribe();session.destroy();retry.removeEventListener('click',reload);windowRef.removeEventListener('pagehide',leave);windowRef.removeEventListener('pageshow',resume);host.replaceChildren();}};
}
