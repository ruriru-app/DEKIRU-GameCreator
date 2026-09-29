import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export async function createLocalTestClients() {
  let config;
  try {config=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
  catch {throw Error('Local Supabase must be running; production targets are prohibited.');}
  const base=new URL(config.API_URL);
  if (base.protocol!=='http:' || !['127.0.0.1','localhost'].includes(base.hostname) || base.port!=='54321') throw Error('Only throwaway localhost:54321 is allowed.');
  if (!config.ANON_KEY || !config.SERVICE_ROLE_KEY) throw Error('Local-only test credentials unavailable.');
  const made=[];
  async function request(path,token,body,method='POST') {
    const response=await fetch(new URL(path,base),{method,redirect:'error',headers:{
      apikey:config.ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json',
    },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    if (!response.ok) {
      const body=await response.json().catch(()=>({}));
      const code=typeof body.error_code==='string' && /^[a-z_]{1,80}$/.test(body.error_code)?body.error_code:'request_failed';
      return {data:null,error:{status:response.status,code}};
    }
    return {data:response.status===204?null:await response.json(),error:null};
  }
  const rpcClient=token=>({rpc:(name,args={})=>request('/rest/v1/rpc/'+name,token,args)});
  async function owner() {
    const email=randomUUID()+'@dekiru-test.invalid',password=randomUUID()+randomUUID();
    const created=await request('/auth/v1/admin/users',config.SERVICE_ROLE_KEY,{email,password,email_confirm:true});
    if (created.error || !created.data?.id) throw Error('Could not create local-only fixture user.');
    const id=created.data.id; made.push(id);
    const signed=await request('/auth/v1/token?grant_type=password',config.ANON_KEY,{email,password});
    if (signed.error || !signed.data?.access_token) throw Error('Could not authenticate local fixture: '+JSON.stringify(signed.error));
    return {...rpcClient(signed.data.access_token),id};
  }
  const admin={
    resetRates(ownerId) {
      if (!made.includes(ownerId) || !/^[0-9a-f-]{36}$/.test(ownerId)) throw Error('Only this fixture owner may be changed.');
      execFileSync('docker',['exec','supabase_db_dekiru-gamecreator-test','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',
        "update private.accounts set minute_count=0,day_count=0 where owner_id='"+ownerId+"';"],{stdio:['ignore','pipe','pipe']});
    },
  };
  async function cleanup() {
    for(const id of made) await request('/auth/v1/admin/users/'+id,config.SERVICE_ROLE_KEY,undefined,'DELETE');
    made.length=0;
  }
  try {return {ownerA:await owner(),ownerB:await owner(),anon:rpcClient(config.ANON_KEY),admin,cleanup};}
  catch(error){await cleanup();throw error;}
}
