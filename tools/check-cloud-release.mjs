import {readFileSync, readdirSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicConfig as defaultConfig, readCloudConfig} from '../core/cloud/config.js';

const requiredFiles = ['index.html','app/index.html','app/account/index.html','app/account/callback.html',
  'app/account/callback.js','app/account/account.js','app/account/account-page.js','app/account/account.css',
  'app/account/privacy.html','Typing/creator/index.html','core/cloud/config.js','core/cloud/browser-client.js',
  'p/index.html','p/player.js','p/player-page.js','p/player.css','p/runtime-registry.js',
  'vendor/supabase.js','vendor/THIRD_PARTY_NOTICES.md','docs/cloud-operations.md'];
const protectedPath = file => file.startsWith('Typing/core/') || file.startsWith('Typing/templates/fusuma/') ||
  ['core/audio-manager.js','core/html-exporter.js'].includes(file);
const textFile = /\.(?:[cm]?js|json|html|css|map|svg|md|txt|ya?ml|toml)$/i;
const privateFile = /(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:env|pem|key|p12|pfx)|[^/]+\.dekiru\.json)$/i;
function hasSecret(text) {
  if (/sb_secret_[A-Za-z0-9_-]{8,}|GOCSPX-[A-Za-z0-9_-]{8,}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text)) return true;
  if (/["']?(?:client_secret|service_role_key|SUPABASE_SERVICE_ROLE_KEY|HMAC_SECRET|DB_PASSWORD)["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i.test(text)) return true;
  for (const jwt of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {if (JSON.parse(Buffer.from(jwt[1],'base64url').toString()).role === 'service_role') return true;} catch {}
  }
  return false;
}

/** Read-only local gate. Passing it is NOT approval or proof of a hosted deployment. */
export function checkCloudRelease({repoRoot, publicConfig, baseline}) {
  const errors=new Set(), warnings=['HOSTED_ACCEPTANCE_REQUIRED','SECRET_SCAN_IS_HEURISTIC'];
  const fail=code=>errors.add(code), files=new Map();
  if (!publicConfig?.enabled) fail('CLOUD_NOT_CONFIGURED');
  try {readCloudConfig(publicConfig);} catch {fail('INVALID_PUBLIC_CONFIG');}
  if (hasSecret(JSON.stringify(publicConfig) || '')) fail('SECRET_IN_DISTRIBUTION');
  try {
    const url=new URL('p/',publicConfig.appBaseUrl);url.searchParams.set('g','G7m2Pk8wQ4t9R3vX6nYzAa');
    if (url.href.length>80) fail('SHARE_URL_TOO_LONG');
  } catch {fail('INVALID_PUBLIC_CONFIG');}

  function collect(relative) {
    const absolute=path.join(repoRoot,relative);
    let stat;try {stat=lstatSync(absolute);} catch {return;}
    if (stat.isSymbolicLink()) {fail('UNSAFE_DISTRIBUTION_LINK');return;}
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute)) collect(`${relative}/${entry}`);
    } else if (stat.isFile()) files.set(relative,absolute);
  }
  // Only served application artifacts; test fixtures contain deliberately fake secrets.
  for (const entry of ['index.html','app','core','Typing','p','vendor','dist']) collect(entry);
  for (const entry of readdirSync(repoRoot,{withFileTypes:true})) {
    if (entry.name!=='.git' && !entry.isDirectory()) collect(entry.name);
  }
  for (const file of requiredFiles) {
    try {if (!lstatSync(path.join(repoRoot,file)).isFile()) fail('PUBLIC_FILE_MISSING');}
    catch {fail('PUBLIC_FILE_MISSING');}
  }
  try {if (!lstatSync(path.join(repoRoot,'supabase/functions/shared-game/index.ts')).isFile()) fail('PUBLIC_ENDPOINT_ADAPTER_MISSING');}
  catch {fail('PUBLIC_ENDPOINT_ADAPTER_MISSING');}
  for (const [file,absolute] of files) {
    if (privateFile.test(file)) fail('PRIVATE_FILE_IN_DISTRIBUTION');
    if (textFile.test(file) && hasSecret(readFileSync(absolute,'utf8'))) fail('SECRET_IN_DISTRIBUTION');
  }

  const expected=baseline?.files;
  if (!expected || !Object.keys(expected).length || Object.keys(expected).some(file=>!protectedPath(file) || file.split('/').includes('..'))) {
    fail('INVALID_BASELINE');
  } else {
    for (const file of new Set([...Object.keys(expected),...files.keys()].filter(protectedPath))) {
      if (!files.has(file) || !expected[file]) {fail('PROTECTED_RUNTIME_CHANGED');continue;}
      let bytes=readFileSync(files.get(file));
      if (/\.(js|css)$/.test(file)) bytes=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
      if (createHash('sha256').update(bytes).digest('hex')!==expected[file]) fail('PROTECTED_RUNTIME_CHANGED');
    }
  }
  try {
    const html=readFileSync(path.join(repoRoot,'app/account/privacy.html'),'utf8');
    const contacts=[...html.matchAll(/<a\b[^>]*\bdata-support-contact\b[^>]*>/gi)];
    const valid=contacts.some(([tag])=>{
      const href=tag.match(/\bhref\s*=\s*["']mailto:([^"'\s?]+)["']/i)?.[1];
      return href && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(href) &&
        !/(?:\.invalid|@example\.(?:com|net))$/i.test(href);
    });
    if (!valid) fail('SUPPORT_CONTACT_MISSING');
  } catch {fail('SUPPORT_CONTACT_MISSING');}
  return {ok:errors.size===0,errors:[...errors],warnings};
}

const here=fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1])===here) {
  const repoRoot=path.resolve(path.dirname(here),'..');
  let baseline;try {baseline=JSON.parse(readFileSync(path.join(repoRoot,'tests/fixtures/runtime-baseline.json'),'utf8'));} catch {}
  const result=checkCloudRelease({repoRoot,publicConfig:defaultConfig,baseline});
  // Codes only: never echo matching credentials, contact addresses or file contents.
  console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}
