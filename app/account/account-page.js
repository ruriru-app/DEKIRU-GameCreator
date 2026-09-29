import {loadBrowserCloud} from '../../core/cloud/browser-client.js';
import {mountAccountPage} from './account.js';
const root=document.querySelector('[data-account-root]');
try{
  const cloud=await loadBrowserCloud();
  const page=mountAccountPage({root,...cloud});
  await page.ready;
  window.addEventListener('pagehide',()=>page.destroy(),{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
}catch{root.querySelector('p').textContent='オンライン機能を利用できません。登録不要の問題作成とファイル保存は利用できます。';}
