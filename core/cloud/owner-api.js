import { failure, ERROR_MESSAGES } from './contracts.js';
import { validateCloudProject, serializeCloudProject } from './project-validation.js';

export function createOwnerApi({client}) {
  async function rpc(name,args) {
    if (!client) return failure('NOT_CONFIGURED');
    const controller = new AbortController();
    let timer;
    try {
      const timeout = new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},15000);});
      const request = client.rpc(name,args);
      const response = await Promise.race([request.abortSignal ? request.abortSignal(controller.signal) : request, timeout]);
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
    loadGame:id=>rpc('load_game',{p_game_id:id}),
    saveDraft:args=>{
      const result=validateCloudProject(args.project,{mode:'draft'});
      return result.ok ? mutate('save',args) : Promise.resolve(result);
    },
    publishGame:args=>mutate('publish',args),
    setPublished:args=>mutate(args.published ? 'republish' : 'unpublish',args),
    deleteGame:args=>mutate('delete',args),
  };
}
