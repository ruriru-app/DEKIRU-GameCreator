import {readCloudConfig} from '../core/cloud/config.js';
import {startSharedPlayer} from './player.js';
const host=document.querySelector('[data-player-root]');
try{
  const config=readCloudConfig();
  await startSharedPlayer({host,pageUrl:window.location.href,endpoint:config.enabled?config.sharedEndpoint:''});
}catch{host.querySelector('p').textContent='ゲームを読み込めませんでした。しばらくしてから開き直してください。';}
