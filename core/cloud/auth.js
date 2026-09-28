import {ok,failure} from './contracts.js';
import {isSafeReturnTo,clearAuthResume,RESUME_TTL} from './auth-resume.js';
export const AUTH_STORAGE_KEY='dekiru-gamecreator.auth.v1';
export const RETURN_KEY='dekiru-gamecreator.auth-return.v1';
export function createAuth({client,storage,appBaseUrl}) {
  const callback=new URL('app/account/callback.html',appBaseUrl).href;
  const defaultReturn=new URL('Typing/creator/index.html',appBaseUrl).href;
  return {
    async getUser() {
      if (!client) return ok(null);
      try {
        const {data,error}=await client.auth.getUser();
        if (error) return error.name==='AuthSessionMissingError' ? ok(null) : failure('UNAUTHENTICATED');
        return ok(data.user ? {id:data.user.id,email:data.user.email??''} : null);
      } catch {return failure('NETWORK');}
    },
    subscribe(fn) {
      if (!client) return ()=>{};
      const {data}=client.auth.onAuthStateChange((_event,session)=>{
        fn(session?.user ? {id:session.user.id,email:session.user.email??''} : null);
      });
      return ()=>data.subscription.unsubscribe();
    },
    async startGoogleSignIn({returnTo}) {
      if (!client) return failure('NOT_CONFIGURED');
      if (!isSafeReturnTo(returnTo)) return failure('VALIDATION');
      try {storage.setItem(RETURN_KEY,JSON.stringify({returnTo,createdAt:Date.now()}));}
      catch {return failure('VALIDATION','一時保存を利用できないため、ログイン画面へ移動しません。');}
      try {
        const {error}=await client.auth.signInWithOAuth({provider:'google',options:{
          redirectTo:callback,scopes:'openid email profile',
        }});
        return error ? failure('UNAUTHENTICATED') : ok(null);
      } catch {return failure('NETWORK');}
    },
    async completeCallback(input) {
      let returnTo=defaultReturn;
      try {
        const saved=JSON.parse(storage.getItem(RETURN_KEY)||'null');
        storage.removeItem(RETURN_KEY);
        if (saved && Date.now()>=saved.createdAt && Date.now()-saved.createdAt<RESUME_TTL && isSafeReturnTo(saved.returnTo)) returnTo=new URL(saved.returnTo,appBaseUrl).href;
        const url=new URL(input);
        if (url.origin+url.pathname!==callback || url.searchParams.getAll('code').length!==1 ||
            !url.searchParams.get('code') || url.searchParams.has('error') || url.hash || !client) {
          return {...failure('UNAUTHENTICATED'),returnTo};
        }
        const {error}=await client.auth.exchangeCodeForSession(url.searchParams.get('code'));
        return error ? {...failure('UNAUTHENTICATED'),returnTo} : ok({returnTo});
      } catch {return {...failure('NETWORK'),returnTo};}
    },
    async signOut() {
      if (!client) return failure('NOT_CONFIGURED');
      try {
        const {error}=await client.auth.signOut({scope:'local'});
        if (error) return failure('NETWORK');
        for (const key of [AUTH_STORAGE_KEY,AUTH_STORAGE_KEY+'-code-verifier',AUTH_STORAGE_KEY+'-user',RETURN_KEY]) storage.removeItem(key);
        clearAuthResume(storage);
        return ok(null);
      } catch {return failure('NETWORK');}
    },
  };
}
