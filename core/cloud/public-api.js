import { failure, ok } from './contracts.js';
import { validateCloudProject } from './project-validation.js';
import { SHARE_ID_PATTERN } from './share-url.js';

export function checkedPublicGame(value) {
  const runtime=({1:'fusuma-1',2:'fusuma-2',3:'fusuma-3'})[value?.project?.schemaVersion];
  if (value?.schemaVersion !== 1 || !runtime || value.runtimeVersion !== runtime ||
      !Number.isSafeInteger(value.publicationVersion) || value.publicationVersion < 1) return failure('SERVICE_UNAVAILABLE');
  const validated=validateCloudProject(value.project,{mode:'publish'});
  return validated.ok ? ok({
    schemaVersion:1,project:validated.data,runtimeVersion:runtime,publicationVersion:value.publicationVersion,
  }) : failure('SERVICE_UNAVAILABLE');
}
export async function fetchSharedGame({endpoint,shareId,fetchImpl=fetch,signal}) {
  if (!SHARE_ID_PATTERN.test(shareId)) return failure('UNAVAILABLE');
  if (!endpoint) return failure('NOT_CONFIGURED');
  let timer;
  const controller = new AbortController();
  const cancel=()=>controller.abort();
  signal?.addEventListener('abort',cancel,{once:true});
  if (signal?.aborted) controller.abort();
  try {
    const url = new URL(endpoint); url.search=''; url.searchParams.set('g',shareId);
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},15000);});
    const response=await Promise.race([fetchImpl(url.href,{method:'GET',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal}),timeout]);
    if (response.status===404) return failure('UNAVAILABLE');
    if (response.status===429) return failure('RATE_LIMIT',undefined,Math.max(1,Math.min(60,Number(response.headers.get('Retry-After'))||60)));
    if (!response.ok) return failure('SERVICE_UNAVAILABLE');
    return checkedPublicGame(await Promise.race([response.json(),timeout]));
  } catch { return failure('NETWORK'); }
  finally { clearTimeout(timer);signal?.removeEventListener('abort',cancel); }
}
