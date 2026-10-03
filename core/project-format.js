import {normalizeQuestionImage} from './question-image.js';
import {unpackProjectImages} from './project-image-pool.js';
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>Object.keys(v).every(k=>allowed.includes(k));
export function normalizeProjectData(value,{strictKeys=false}={}) {
  value=unpackProjectImages(value);
  if(!record(value)||![1,2].includes(value.schemaVersion)) throw Error('対応していない問題セットの形式・バージョンです。');
  if(value.gameType!=='typing'||value.templateId!=='fusuma') throw Error('この作成画面は Typing「和室・襖」の問題セットに対応しています。');
  const strict=strictKeys||value.schemaVersion===2,settings=value.settings;
  if(typeof value.title!=='string'||!Array.isArray(value.questions)||
    (strict&&!keys(value,['schemaVersion','title','gameType','templateId','settings','questions']))) throw Error('セット名または問題一覧の形式が正しくありません。');
  if(!record(settings)||!Number.isFinite(settings.volume)||settings.volume<0||settings.volume>1||typeof settings.muted!=='boolean'||
    (strict&&!keys(settings,['volume','muted']))) throw Error('音量・ミュート設定の形式が正しくありません。');
  const ids=new Set();
  const questions=value.questions.map((q,i)=>{
    if(!record(q)||typeof q.id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(q.id)||
      ['prompt','displayAnswer','reading','romajiHint'].some(k=>typeof q[k]!=='string')||
      (strict&&!keys(q,['id','prompt','displayAnswer','reading','romajiHint',...(value.schemaVersion===2?['image']:[])]))) throw Error((i+1)+'問目のデータ形式が正しくありません。');
    if(ids.has(q.id)) throw Error('問題のIDが重複しています。');
    ids.add(q.id);
    const normalized={id:q.id,prompt:q.prompt,displayAnswer:q.displayAnswer,reading:q.reading,romajiHint:q.romajiHint};
    if(Object.hasOwn(q,'image')) {
      if(value.schemaVersion!==2) throw Error('画像付き問題にはバージョン2が必要です。');
      normalized.image=normalizeQuestionImage(q.image);
    }
    return normalized;
  });
  return {schemaVersion:value.schemaVersion,title:value.title,gameType:'typing',templateId:'fusuma',settings:{volume:settings.volume,muted:settings.muted},questions};
}
