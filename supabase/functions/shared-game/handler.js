import { checkedPublicGame } from '../../../core/cloud/public-api.js';
import { failure } from '../../../core/cloud/contracts.js';
import { parseShareId } from '../../../core/cloud/share-url.js';

export function createSharedGameHandler({lookup,consumeLimit,getClientAddress,hashAddress,now=()=>new Date(),allowedOrigins}) {
  return async request => {
    const origin=request.headers.get('Origin');
    const headers={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if (allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin']=origin;
    const respond=(status,body,extra={})=>new Response(body===null?null:JSON.stringify(body),{status,headers:{...headers,...extra}});
    if (origin && !allowedOrigins.includes(origin)) return respond(403,failure('FORBIDDEN'));
    if (request.method==='OPTIONS') return respond(204,null,{'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
    if (request.method!=='GET') return respond(405,failure('UNAVAILABLE'),{'Allow':'GET, OPTIONS'});
    try {
      // Only the deployment adapter may extract an address guaranteed by its platform.
      const address=await getClientAddress(request);
      if (!address) return respond(503,failure('SERVICE_UNAVAILABLE'));
      const hash=await hashAddress(address,now().toISOString().slice(0,10));
      if (typeof hash!=='string' || !hash) return respond(503,failure('SERVICE_UNAVAILABLE'));
      const limit=await consumeLimit(hash);
      if (limit?.allowed===false) {
        const seconds=Math.max(1,Math.min(60,Number(limit.retry_after_seconds)||60));
        return respond(429,failure('RATE_LIMIT',undefined,seconds),{'Retry-After':String(seconds)});
      }
      if (limit?.allowed!==true) return respond(503,failure('SERVICE_UNAVAILABLE'));
      const shareId=parseShareId(request.url);
      if (!shareId) return respond(404,failure('UNAVAILABLE'));
      const value=await lookup(shareId);
      if (!value) return respond(404,failure('UNAVAILABLE'));
      const validated=checkedPublicGame(value);
      return validated.ok ? respond(200,validated.data) : respond(503,failure('SERVICE_UNAVAILABLE'));
    } catch { return respond(503,failure('SERVICE_UNAVAILABLE')); }
  };
}
