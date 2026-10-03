import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth,RETURN_KEY,AUTH_STORAGE_KEY} from '../core/cloud/auth.js';
import {memoryStorage} from './fixtures/memory-storage.mjs';
import {saveAuthResume,takeAuthResume,RESUME_KEY,RESUME_TTL} from '../core/cloud/auth-resume.js';
import {imageProject,imageAtBytes} from './fixtures/question-images.mjs';
const appBaseUrl='https://ruriru-app.github.io/DEKIRU-GameCreator/';
test('auth resume compacts both live and last-saved projects and restores independent images',()=>{
  const project=imageProject(imageAtBytes(100000));project.questions=Array.from({length:25},(_,i)=>({...project.questions[0],id:'q'+i}));
  const payload={project,pasteText:'',fileState:{dirty:true,previewDirty:true,unsavedChanges:true,hasProjectFile:false},cloudLink:{ownerId:'a',record:{id:'g',version:1,project}},returnTo:'Typing/creator/index.html'};
  const storage=memoryStorage();assert.equal(saveAuthResume(storage,payload,100).ok,true);
  const raw=storage.getItem(RESUME_KEY);assert.ok(raw.length<300000);
  const saved=JSON.parse(raw);assert.equal(saved.payload.project.images.length,1);assert.equal(saved.payload.cloudLink.record.project.images.length,1);
  const restored=takeAuthResume(storage,101);assert.deepEqual(restored.project,project);assert.deepEqual(restored.cloudLink.record.project,project);
  assert.equal(storage.getItem(RESUME_KEY),null);
  storage.setItem(RESUME_KEY,JSON.stringify({createdAt:100,payload}));assert.deepEqual(takeAuthResume(storage,101).project,project);
  assert.equal(saveAuthResume({setItem(){throw Error('quota');}},payload,100).ok,false);
  saveAuthResume(storage,payload,100);assert.equal(takeAuthResume(storage,100+RESUME_TTL),null);
});
function fixture(storage=memoryStorage()) {
  const calls=[];
  const client={auth:{
    getUser:async()=>({data:{user:{id:'owner-a',email:'example@example.invalid'}},error:null}),
    signInWithOAuth:async options=>{calls.push(options);return {data:{url:'https://auth.invalid'},error:null};},
    exchangeCodeForSession:async code=>{calls.push(code);return {data:{user:{id:'owner-a'}},error:null};},
    signOut:async()=>({error:null}),
    onAuthStateChange:callback=>{calls.push(callback);return {data:{subscription:{unsubscribe(){}}}};},
  }};
  return {client,storage,calls,auth:createAuth({client,storage,appBaseUrl})};
}
test('Google login uses fixed callback and only identity scopes',async()=>{
  const f=fixture();assert.equal((await f.auth.startGoogleSignIn({returnTo:'Typing/creator/index.html'})).ok,true);
  assert.equal(f.calls[0].provider,'google');
  assert.equal(f.calls[0].options.redirectTo,appBaseUrl+'app/account/callback.html');
  assert.equal(f.calls[0].options.scopes,'openid email profile');
  assert.ok(f.storage.getItem(RETURN_KEY));
});
test('unsafe return or inaccessible storage blocks redirect before calling provider',async()=>{
  const f=fixture();assert.equal((await f.auth.startGoogleSignIn({returnTo:'https://evil.invalid'})).ok,false);
  assert.equal(f.calls.length,0);
  const broken=fixture({setItem(){throw Error('quota');}});
  assert.equal((await broken.auth.startGoogleSignIn({returnTo:'app/account/index.html'})).ok,false);
  assert.equal(broken.calls.length,0);
});
test('callback exchanges code once only on allowed callback; cancellation keeps resume available',async()=>{
  const f=fixture();await f.auth.startGoogleSignIn({returnTo:'Typing/creator/index.html'});
  const result=await f.auth.completeCallback(appBaseUrl+'app/account/callback.html?code=one');
  assert.equal(result.ok,true);assert.equal(result.data.returnTo,appBaseUrl+'Typing/creator/index.html');
  assert.equal(f.calls.filter(x=>x==='one').length,1);
  assert.equal((await f.auth.completeCallback('https://evil.invalid/?code=stolen')).ok,false);
  assert.equal((await f.auth.completeCallback(appBaseUrl+'app/account/callback.html?error=access_denied')).ok,false);
});
test('logout removes only application session state, not other apps; identity events propagate',async()=>{
  const f=fixture();f.storage.setItem(AUTH_STORAGE_KEY,'token');f.storage.setItem(AUTH_STORAGE_KEY+'-code-verifier','verifier');
  f.storage.setItem('another-app','keep');
  const users=[];const unsub=f.auth.subscribe(user=>users.push(user));
  f.calls[0]('SIGNED_IN',{user:{id:'owner-b'}});assert.equal(users[0].id,'owner-b');unsub();
  assert.equal((await f.auth.signOut()).ok,true);
  assert.equal(f.storage.getItem(AUTH_STORAGE_KEY),null);
  assert.equal(f.storage.getItem(AUTH_STORAGE_KEY+'-code-verifier'),null);
  assert.equal(f.storage.getItem('another-app'),'keep');
});
