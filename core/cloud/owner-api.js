import { failure, ERROR_MESSAGES } from './contracts.js';
import { validateCloudProject, prepareCloudProject, serializeCloudProject } from './project-validation.js';
import {normalizeProjectData} from '../project-format.js';

export function createOwnerApi({client}) {
  async function rpc(name,args) {
    if (!client) return failure('NOT_CONFIGURED');
    const controller = new AbortController();
    let timer;
    try {
      const timeout = new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},15000);});
      const request = client.rpc(name,args);
      const response = await Promise.race([request.abortSignal ? request.abortSignal(controller.signal) : request, timeout]);
      // postgrest-js resolves fetch failures with status 0 instead of throwing.
      // Gateway failures also leave write success uncertain: preserve the retry id.
      if(response.status===0 || response.status>=500) return failure('NETWORK');
      if (response.error) return failure(response.error.code === 'PGRST301' ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE');
      const result = response.data;
      if (result?.ok === true) return {ok:true,data:result.data};
      const code = result?.error?.code;
      return failure(Object.hasOwn(ERROR_MESSAGES,code) ? code : 'SERVICE_UNAVAILABLE', undefined,
        Number.isFinite(result?.error?.retryAfterSeconds) ? result.error.retryAfterSeconds : undefined);
    } catch { return failure('NETWORK'); }
    finally { clearTimeout(timer); }
  }
  function mutate(command,{gameId,expectedVersion,requestId,...rest}) {
    const args = {gameId,expectedVersion,requestId};
    if (command === 'save') args.projectText = serializeCloudProject(rest.project);
    return rpc('mutate_game',{p_command:command,p_args:args});
  }
  return {
    getContext:()=>rpc('creator_context'),
    listGames:()=>rpc('list_games'),
    loadGame:async id=>{
      const result=await rpc('load_game',{p_game_id:id});if(!result.ok)return result;
      const checked=validateCloudProject(result.data?.project);
      if(!checked.ok)return failure('SERVICE_UNAVAILABLE');
      try{return {ok:true,data:{...result.data,project:normalizeProjectData(checked.data)}};}
      catch{return failure('SERVICE_UNAVAILABLE');}
    },
    saveDraft:args=>{
      const result=prepareCloudProject(args.project,{mode:'draft',sharedImagesEnabled:args.useSharedImages===true});
      return result.ok ? mutate('save',{...args,project:result.data}) : Promise.resolve(result);
    },
    publishGame:args=>mutate('publish',args),
    setPublished:args=>mutate(args.published ? 'republish' : 'unpublish',args),
    deleteGame:args=>mutate('delete',args),
  };
}
