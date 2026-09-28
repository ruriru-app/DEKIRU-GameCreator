/** @typedef {{schemaVersion:1,title:string,gameType:'typing',templateId:'fusuma',settings:{volume:number,muted:boolean},questions:Array<{id:string,prompt:string,displayAnswer:string,reading:string,romajiHint:string}>}} Project */
/** @typedef {{shareId:string,status:'published'|'stopped',version:number,sourceVersion:number,runtimeVersion:'fusuma-1'}} Publication */
/** @typedef {{id:string,version:number,title:string,questionCount:number,updatedAt:string,publication:Publication|null,publicationDirty:boolean}} GameMeta */
/** @typedef {GameMeta & {project:Project}} GameRecord */
/** @typedef {{ownerId:string,status:'active'|'disabled',plan:'free',limits:object,counts:object,capabilities:object}} Context */
/** @template T @typedef {{ok:true,data:T}|{ok:false,error:{code:string,message:string,retryAfterSeconds?:number}}} Result */
/** @typedef {{schemaVersion:1,project:Project,runtimeVersion:'fusuma-1',publicationVersion:number}} PublicGame */

export const ERROR_MESSAGES = Object.freeze({
  NOT_CONFIGURED: 'オンライン機能は準備中です。端末への保存は利用できます。',
  UNAUTHENTICATED: '作成者のログインが必要です。',
  FORBIDDEN: 'この操作は許可されていません。',
  UNAVAILABLE: 'このゲームは現在公開されていません。',
  VALIDATION: '問題データの形式を確認してください。',
  LIMIT: '無料試験運用の上限を超えています。',
  RATE_LIMIT: '操作が集中しています。少し待ってからお試しください。',
  CONFLICT: '別の場所で更新されています。上書きせず内容を確認してください。',
  REQUEST_MISMATCH: '再試行する操作の内容が変わりました。',
  NETWORK: '通信を確認し、もう一度お試しください。編集中の内容はそのままです。',
  SERVICE_UNAVAILABLE: 'オンライン機能を利用できません。しばらくしてからお試しください。',
});
export const ok = data => ({ok:true, data});
export function failure(code, message = ERROR_MESSAGES[code], retryAfterSeconds) {
  return {ok:false, error:{code, message, ...(retryAfterSeconds === undefined ? {} : {retryAfterSeconds})}};
}
