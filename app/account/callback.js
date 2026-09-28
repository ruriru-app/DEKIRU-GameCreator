import {readCloudConfig} from '../../core/cloud/config.js';
import {createAuth} from '../../core/cloud/auth.js';
const incoming=location.href;
// Remove authorization values before loading the SDK or making any request.
history.replaceState(null,'',location.pathname);
const status=document.querySelector('#status'),back=document.querySelector('#return');
try {
  const config=readCloudConfig();
  let client=null;
  if (config.enabled) {
    const {createCloudClient}=await import('../../vendor/supabase.js');
    client=createCloudClient(config,sessionStorage);
  }
  const auth=createAuth({client,storage:sessionStorage,appBaseUrl:config.appBaseUrl});
  const result=await auth.completeCallback(incoming);
  const destination=result.ok ? result.data.returnTo : result.returnTo;
  if (result.ok) location.replace(destination);
  else {
    status.textContent='ログインを完了できませんでした。編集画面に戻ると、一時保存できた内容を復元します。';
    if (destination) back.href=destination;
    back.hidden=false;
  }
} catch {
  status.textContent='ログインを確認できませんでした。編集画面へ戻ってください。';
  back.hidden=false;
}
