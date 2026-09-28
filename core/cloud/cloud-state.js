import {serializeCloudProject} from './project-validation.js';
const clone=value=>structuredClone(value);
const same=(a,b)=>a && b && serializeCloudProject(a)===serializeCloudProject(b);
export function createCloudState({getProject}) {
  let ownerId=null,gameMeta=null,savedProject=null,pending=null;
  const listeners=new Set();
  function isCloudSaved(project) {return Boolean(ownerId && savedProject && same(project,savedProject));}
  function getState() {
    const cloudDirty=!isCloudSaved(getProject());
    return {ownerId,gameMeta:clone(gameMeta),cloudDirty,
      publicationDirty:Boolean(gameMeta?.publicationDirty || (gameMeta?.publication && cloudDirty)),
      pendingRequestId:pending?.requestId??null};
  }
  function notify() {for(const fn of listeners) fn(getState());}
  return {
    getState,isCloudSaved,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    attach({ownerId:owner,record}){
      ownerId=owner;const {project,...meta}=record;
      savedProject=clone(project);gameMeta=clone(meta);pending=null;notify();
    },
    detach(){ownerId=null;gameMeta=null;savedProject=null;pending=null;notify();},
    beginSave({ownerId:owner,requestId,snapshot}){
      if(ownerId && ownerId!==owner) return false;
      ownerId=owner;pending={requestId,snapshot:clone(snapshot)};notify();return true;
    },
    markSaved({ownerId:owner,requestId,snapshot,meta}){
      if(owner!==ownerId || pending?.requestId!==requestId || !same(pending.snapshot,snapshot)) return false;
      savedProject=clone(pending.snapshot);gameMeta=clone(meta);pending=null;notify();return true;
    },
    markPublished({ownerId:owner,meta}){
      if(owner!==ownerId || !gameMeta || meta.id!==gameMeta.id || meta.version<gameMeta.version) return false;
      gameMeta=clone(meta);notify();return true;
    },
  };
}
