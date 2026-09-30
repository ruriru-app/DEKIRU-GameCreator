import {processQuestionImage} from './image-processor.js';
import {IMAGE_PLACEMENTS} from '../../core/question-image.js';

export function createQuestionImageController({store,processImage=processQuestionImage,onStateChange=()=>{}}) {
  const pending=new Map(),listeners=new Set([onStateChange]);
  let errors={},epoch=0,destroyed=false;
  const question=id=>store.getSnapshot().questions.find(q=>q.id===id);
  const getState=()=>({busy:pending.size>0,pendingIds:[...pending.keys()],errors:{...errors}});
  const notify=()=>{const state=getState();for(const listener of listeners)listener(state);};
  const cancel=id=>{pending.get(id)?.abort.abort();pending.delete(id);};
  const reset=()=>{
    epoch++;
    for(const id of pending.keys())cancel(id);
    errors={};notify();
  };
  const unsubscribe=store.subscribe(({project})=>{
    const ids=new Set(project.questions.map(q=>q.id));let changed=false;
    for(const id of pending.keys())if(!ids.has(id)){cancel(id);changed=true;}
    for(const id of Object.keys(errors))if(!ids.has(id)){delete errors[id];changed=true;}
    if(changed)notify();
  });
  function setMetadata(id,key,value) {
    if(destroyed)return;
    if(key==='placement'&&!IMAGE_PLACEMENTS.includes(value))throw Error('画像の配置が正しくありません。');
    if(key==='alt'&&(typeof value!=='string'||value.length>200||value.includes('\0')||!value.isWellFormed()))throw Error('画像の説明は200文字以内にしてください。');
    const q=question(id);if(!q)return;
    if(pending.has(id))pending.get(id)[key]=value;
    if(q.image)store.setQuestionImage(id,{...q.image,[key]:value});
  }
  return {
    getState,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    async select(id,file) {
      const q=question(id);if(destroyed||!q)return;
      cancel(id);delete errors[id];
      const job={abort:new AbortController(),epoch,placement:q.image?.placement??'top',alt:q.image?.alt??'問題の画像'};
      pending.set(id,job);notify();
      const current=()=>!destroyed&&job.epoch===epoch&&pending.get(id)===job&&Boolean(question(id));
      try {
        const image=await processImage(file,{signal:job.abort.signal,placement:job.placement,alt:job.alt});
        if(current())store.setQuestionImage(id,{...image,placement:job.placement,alt:job.alt});
      } catch(error) {
        if(current()&&error?.name!=='AbortError')errors[id]=error.message||'画像を追加できませんでした。';
      } finally {
        if(pending.get(id)===job){pending.delete(id);notify();}
      }
    },
    remove(id){if(destroyed)return;cancel(id);delete errors[id];store.setQuestionImage(id,null);notify();},
    setPlacement:(id,value)=>setMetadata(id,'placement',value),
    setAlt:(id,value)=>setMetadata(id,'alt',value),
    reset,
    destroy(){if(destroyed)return;reset();destroyed=true;unsubscribe();listeners.clear();},
  };
}
