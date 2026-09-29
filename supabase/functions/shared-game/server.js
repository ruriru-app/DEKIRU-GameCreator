import {createSharedGameHandler} from './handler.js';
import {createDailyAddressHasher,readVerifiedAddress} from './client-address.js';

const allowedOrigins=['https://ruriru-app.github.io'];

/** Only read injected server settings. No request, browser storage or query overrides. */
export function readServerEnvironment(getEnv) {
  try {
    const serviceUrl=getEnv('SUPABASE_URL');
    if (typeof serviceUrl!=='string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(serviceUrl)) return null;
    const modern=getEnv('SUPABASE_SECRET_KEYS');
    let serverKey,legacy=false;
    if (modern!==undefined && modern!==null) {
      const values=JSON.parse(modern);
      serverKey=values?.default;
      if (typeof serverKey!=='string' || !/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(serverKey)) return null;
    } else {
      serverKey=getEnv('SUPABASE_SERVICE_ROLE_KEY');
      if (typeof serverKey!=='string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(serverKey)) return null;
      const payload=serverKey.split('.')[1].replaceAll('-','+').replaceAll('_','/');
      if (JSON.parse(atob(payload)).role!=='service_role') return null;
      legacy=true;
    }
    const hashSecret=getEnv('DEKIRU_RATE_HMAC_KEY');
    if (typeof hashSecret!=='string' || new TextEncoder().encode(hashSecret).length<32) return null;
    const clientIpMode=getEnv('DEKIRU_CLIENT_IP_MODE');
    if (clientIpMode!=='cloudflare-verified') return null;
    return {serviceUrl:serviceUrl.replace(/\/$/,''),serverKey,legacy,hashSecret,clientIpMode};
  } catch { return null; }
}

export function createSharedGameServer({environment,fetchImpl=fetch,now=()=>new Date(),rpcTimeoutMs=5000}) {
  const getEnv=typeof environment==='function'?environment:name=>environment?.[name];
  const settings=readServerEnvironment(getEnv);
  const hashAddress=settings?createDailyAddressHasher(settings.hashSecret):async()=>null;
  const timeoutMs=Number.isFinite(rpcTimeoutMs)&&rpcTimeoutMs>0?Math.min(rpcTimeoutMs,5000):5000;

  // Only two fixed RPCs; deliberately no general SQL/table access or forwarded credentials.
  const rpc=async (name,args)=>{
    if (!settings || !['consume_shared_read','read_shared_game'].includes(name)) throw new Error('Unavailable');
    const controller=new AbortController();
    let timer;
    const headers={'Content-Type':'application/json',apikey:settings.serverKey};
    if (settings.legacy) headers.Authorization=`Bearer ${settings.serverKey}`;
    try {
      const timeout=new Promise((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(new Error('Unavailable'));},timeoutMs);
      });
      const operation=(async()=>{
        const response=await fetchImpl(`${settings.serviceUrl}/rest/v1/rpc/${name}`,{
          method:'POST',headers,body:JSON.stringify(args),redirect:'error',
          cache:'no-store',credentials:'omit',signal:controller.signal,
        });
        if (!response.ok) {controller.abort();throw new Error('Unavailable');}
        return await response.json();
      })();
      // Includes response-body reading, so a stalled body cannot hang the worker.
      return await Promise.race([operation,timeout]);
    } finally { clearTimeout(timer); }
  };
  return createSharedGameHandler({
    allowedOrigins,now,hashAddress,
    getClientAddress:request=>settings?readVerifiedAddress(request,settings.clientIpMode):null,
    consumeLimit:hash=>rpc('consume_shared_read',{p_client_hash:hash}),
    lookup:shareId=>rpc('read_shared_game',{p_share_id:shareId}),
  });
}
