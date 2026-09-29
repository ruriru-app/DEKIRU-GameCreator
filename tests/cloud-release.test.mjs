import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkCloudRelease} from '../tools/check-cloud-release.mjs';

const config = {enabled:true, supabaseUrl:'https://example.supabase.co', publishableKey:'sb_publishable_fixture',
  appBaseUrl:'https://ruriru-app.github.io/DEKIRU-GameCreator/', sharedEndpoint:'https://example.supabase.co/functions/v1/shared-game'};
function fixture(t) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'dekiru-release-test-'));
  t.after(() => rmSync(repoRoot, {recursive:true, force:true}));
  function put(file, text = '') {const target=path.join(repoRoot,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,text);}
  for (const file of ['index.html','app/index.html','app/account/index.html','app/account/callback.html',
    'app/account/callback.js','app/account/account.js','app/account/account-page.js','app/account/account.css',
    'Typing/creator/index.html','core/cloud/config.js','core/cloud/browser-client.js',
    'p/index.html','p/player.js','p/player-page.js','p/player.css','p/runtime-registry.js',
    'vendor/supabase.js','vendor/THIRD_PARTY_NOTICES.md','docs/cloud-operations.md','supabase/functions/shared-game/index.ts']) put(file,'fixture');
  put('app/account/privacy.html','<a data-support-contact href="mailto:support@example.org">問い合わせ</a>');
  const protectedFile='Typing/core/engine.js', original='export const ready = true;\n';
  put(protectedFile,original);
  const baseline={commit:'fixture',files:{[protectedFile]:createHash('sha256').update(original).digest('hex')}};
  return {repoRoot, baseline, put, check:(publicConfig=config)=>checkCloudRelease({repoRoot,publicConfig,baseline})};
}

// Removing any gate below would let the corresponding unsafe fixture ship.
test('release checker accepts complete safe fixtures without changing any files',t=>{
  const f=fixture(t), before=readFileSync(path.join(f.repoRoot,'Typing/core/engine.js'));
  const result=f.check();assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.errors,[]);
  assert.deepEqual(readFileSync(path.join(f.repoRoot,'Typing/core/engine.js')),before);
  assert.ok(result.warnings.includes('HOSTED_ACCEPTANCE_REQUIRED'));
});
test('release checker blocks disabled and invalid public configuration',t=>{
  const f=fixture(t);assert.ok(f.check({...config,enabled:false}).errors.includes('CLOUD_NOT_CONFIGURED'));
  assert.ok(f.check({...config,sharedEndpoint:'https://other.example/functions/v1/shared-game'}).errors.includes('INVALID_PUBLIC_CONFIG'));
});
test('release checker blocks privileged keys and never echoes their values',t=>{
  const f=fixture(t), secret='sb_secret_'+'only-a-fake-value-123456789';
  f.put('app/leaked-config.json',JSON.stringify({key:secret}));
  let result=f.check();assert.ok(result.errors.includes('SECRET_IN_DISTRIBUTION'));assert.ok(!JSON.stringify(result).includes(secret));
  f.put('app/leaked-config.json','{}');
  const fakeJwt=[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from('{"role":"service_role"}').toString('base64url'),'not-a-real-signature'].join('.');
  f.put('vendor/accidental.txt',fakeJwt);assert.ok(f.check().errors.includes('SECRET_IN_DISTRIBUTION'));
});
test('release checker blocks private key files and OAuth secret assignments',t=>{
  const f=fixture(t);f.put('core/oauth.json',JSON.stringify({client_secret:'not-a-real-oauth-secret'}));
  assert.ok(f.check().errors.includes('SECRET_IN_DISTRIBUTION'));
  f.put('core/oauth.json','{}');f.put('app/forgotten.env','DB_PASSWORD=fake');
  assert.ok(f.check().errors.includes('PRIVATE_FILE_IN_DISTRIBUTION'));
});
test('release checker also catches root-level accidental configuration leaks',t=>{
  const f=fixture(t);f.put('forgotten-config.js',"const key='sb_secret_only-a-fake-value-123456789';");
  assert.ok(f.check().errors.includes('SECRET_IN_DISTRIBUTION'));
  f.put('forgotten-config.js','');f.put('.env','PRIVATE_VALUE=fake');
  assert.ok(f.check().errors.includes('PRIVATE_FILE_IN_DISTRIBUTION'));
});
test('release checker rejects changed, missing and newly added protected runtime files',t=>{
  const f=fixture(t);f.put('Typing/core/engine.js','changed');
  assert.ok(f.check().errors.includes('PROTECTED_RUNTIME_CHANGED'));
  f.put('Typing/core/engine.js','export const ready = true;\r\n');assert.equal(f.check().ok,true);
  f.put('Typing/core/extra.js','extra');assert.ok(f.check().errors.includes('PROTECTED_RUNTIME_CHANGED'));
});
test('release checker rejects an unfilled or unsafe support contact',t=>{
  const f=fixture(t);
  for (const content of ['<p>準備中</p>','<a data-support-contact href="mailto:">未設定</a>',
    '<a data-support-contact href="javascript:alert(1)">連絡</a>',
    '<a data-support-contact href="mailto:support@example.invalid">連絡</a>']) {
    f.put('app/account/privacy.html',content);assert.ok(f.check().errors.includes('SUPPORT_CONTACT_MISSING'),content);
  }
});
test('release checker rejects URLs beyond 80 characters',t=>{
  const f=fixture(t);assert.ok(f.check({...config,appBaseUrl:'https://example.org/'+'very-long-path/'.repeat(5)}).errors.includes('SHARE_URL_TOO_LONG'));
});
test('release checker blocks missing delivery files and absent deployment adapter',t=>{
  const f=fixture(t);rmSync(path.join(f.repoRoot,'p/player.js'));
  assert.ok(f.check().errors.includes('PUBLIC_FILE_MISSING'));
  rmSync(path.join(f.repoRoot,'supabase/functions/shared-game/index.ts'));
  assert.ok(f.check().errors.includes('PUBLIC_ENDPOINT_ADAPTER_MISSING'));
});
