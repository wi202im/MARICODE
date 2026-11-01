import {selectedFiles,validateFiles,fileBase64,attachmentMetadata} from './attachments.mjs';
export function createAttachmentComposer({form,prompt,context,upload,changed,notice}){
 const drafts=new Map(),list=document.createElement('div'),picker=document.createElement('input'),button=document.createElement('button');let renderedKey='';
 list.className='attachment-list';list.setAttribute('aria-label','전송할 첨부파일');picker.type='file';picker.multiple=true;picker.hidden=true;
 button.type='button';button.className='attach-button';button.textContent='＋';button.title='파일 첨부 · 이미지/파일 붙여넣기 · 끌어놓기';button.setAttribute('aria-label','파일 첨부');
 form.prepend(list,picker);form.querySelector('.composer-footer').prepend(button);prompt.required=false;
 const entries=()=>drafts.get(context().id)??[];
 const blocked=()=>{const c=context();return !c.id||!c.connected||!c.active||c.busy||c.pending;};
 function add(files){
  if(!files.length)return;if(blocked()){notice('연결된 세션에서 이전 요청을 확인한 뒤 첨부해 주세요.');return;}
  try{const prior=entries();validateFiles(files,prior);const added=files.map(file=>({id:crypto.randomUUID(),file,name:file.name||'clipboard.png',type:file.type||'application/octet-stream',size:file.size,state:'local',preview:/^image\/(png|jpeg|webp|gif)$/.test(file.type)?URL.createObjectURL(file):null}));drafts.set(context().id,[...prior,...added]);notice('첨부를 준비했습니다. 보내기를 누를 때 선택한 서버로 업로드합니다.');changed();}catch(e){notice(e.message);}
 }
 button.onclick=()=>picker.click();picker.onchange=()=>{add(Array.from(picker.files));picker.value='';};
 form.addEventListener('paste',e=>{const files=selectedFiles(e.clipboardData);if(files.length){e.preventDefault();add(files);}});
 form.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types??[]).includes('Files')){e.preventDefault();form.classList.add('file-drop');}});
 form.addEventListener('dragleave',e=>{if(!form.contains(e.relatedTarget))form.classList.remove('file-drop');});
 form.addEventListener('drop',e=>{form.classList.remove('file-drop');const files=selectedFiles(e.dataTransfer);if(files.length){e.preventDefault();add(files);}});
 function clear(id=context().id){for(const entry of drafts.get(id)??[])if(entry.preview)URL.revokeObjectURL(entry.preview);drafts.delete(id);render();}
 function render(){
  button.disabled=blocked();const owner=context().id,selected=entries(),disabled=!!context().busy||!!context().pending;
  const key=JSON.stringify([owner,disabled,selected.map(e=>[e.id,e.state])]);
  if(key===renderedKey)return;renderedKey=key;list.hidden=!selected.length;list.replaceChildren();
  if(entries().length){const hint=document.createElement('small');hint.className='attachment-draft-note';hint.textContent='첨부 초안은 현재 창에서만 유지됩니다.';list.append(hint);}
  for(const [index,entry] of selected.entries()){
   const card=document.createElement('div');card.className='attachment-chip '+entry.state;
   if(entry.preview){const image=document.createElement('img');image.src=entry.preview;image.alt=entry.name;card.append(image);}
   const label=document.createElement('span'),name=document.createElement('strong'),state=document.createElement('small');name.textContent=entry.name;
   state.textContent=`${Math.ceil(entry.size/1024)} KB · ${{local:'전송 시 업로드',uploading:'업로드 중',ready:'업로드 완료',unknown:'결과 미확인 · 재전송 안 함'}[entry.state]}`;label.append(name,state);card.append(label);
   const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.id='attachment-remove-'+entry.id;remove.setAttribute('aria-label',`${entry.name} 첨부 제거 (${index+1}/${selected.length})`);remove.disabled=disabled;
   remove.onclick=()=>{if(context().id!==owner||context().busy||context().pending)return;if(entry.preview)URL.revokeObjectURL(entry.preview);drafts.set(owner,entries().filter(e=>e!==entry));changed();};card.append(remove);list.append(card);
  }
 }
 return {render,clear,clearAll(){for(const id of drafts.keys())clear(id);},get count(){return entries().length;},get uncertain(){return entries().some(e=>e.state==='unknown');},metadata(){if(entries().some(e=>e.state!=='ready'))throw Error('첨부 업로드 상태를 확인해 주세요.');return entries().map(e=>e.metadata);},
  async prepare(){const id=context().id,selected=entries();
   for(const entry of selected){
    if(context().id!==id)throw Error('전송 대상이 바뀌었습니다.');if(entry.state==='ready')continue;if(entry.state!=='local')throw Error('첨부 결과가 미확인입니다. 자동으로 다시 업로드하지 않습니다.');
    entry.state='uploading';render();
    try{const content=await fileBase64(entry.file);const result=await upload(id,{requestId:entry.id,filename:entry.name,mimeType:entry.type,content});entry.metadata=attachmentMetadata(entry,result);entry.state='ready';}
    catch(e){entry.state='unknown';throw e;}finally{render();}
   }
   return selected.map(e=>e.metadata);
  }
 };
}
