// @-mentions of project files in the composer. Picking a file inserts "@path " as text; the AI reads the file
// itself (nothing is attached). Candidates come from HAPI's file search inside the session folder.
export function mentionQuery(text,caret=text.length){
 const m=/(^|\s)@([^\s@]{0,200})$/.exec(String(text??'').slice(0,caret));
 return m?{term:m[2],start:caret-m[2].length-1}:null;
}
export function insertMention(text,caret,query,path){
 const before=text.slice(0,query.start),after=text.slice(caret).replace(/^\S*/,'');
 const insert='@'+path+(after.startsWith(' ')?'':' ');
 return {text:before+insert+after,caret:before.length+insert.length};
}
export function createFileMentions({input,list,search,delay=150,setTimer=setTimeout,clearTimer=clearTimeout}){
 let items=[],active=0,serial=0,timer=null,query=null;
 const doc=input.ownerDocument;
 function close(){items=[];if(!list.hidden&&list.dataset.owner==='mention'){list.hidden=true;list.replaceChildren();}input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
 function choose(item){
  const caret=input.selectionStart??input.value.length,now=mentionQuery(input.value,caret);if(!now){close();return;}
  const next=insertMention(input.value,caret,now,item.fullPath);input.value=next.text;input.setSelectionRange?.(next.caret,next.caret);
  input.dispatchEvent(new Event('input',{bubbles:true}));close();input.focus();
 }
 function render(){
  if(!items.length){close();return;}
  list.dataset.owner='mention';
  list.replaceChildren(...items.map((item,i)=>{const b=doc.createElement('button');b.type='button';b.id='mention-option-'+i;b.className='command-option mention-option'+(i===active?' active':'');b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===active));
   const name=doc.createElement('span');name.className='command-name';name.textContent=item.fileName;const dir=doc.createElement('span');dir.className='command-description';dir.textContent=item.filePath||'프로젝트 폴더';b.append(name,dir);
   b.onmousedown=e=>e.preventDefault();b.onclick=()=>choose(item);return b;}));
  list.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-activedescendant','mention-option-'+active);
 }
 function update(){
  query=mentionQuery(input.value,input.selectionStart??input.value.length);clearTimer(timer);
  if(!query){close();return;}
  const ticket=++serial,term=query.term;
  timer=setTimer(async()=>{try{const files=await search(term);if(ticket!==serial)return;items=(files??[]).filter(f=>typeof f?.fullPath==='string').slice(0,12);active=0;render();}catch{if(ticket===serial)close();}},delay);
 }
 input.addEventListener('input',update);
 input.addEventListener('blur',()=>setTimeout(close,100));
 // Registered before the Enter-to-send binding, which skips events this handler already handled.
 input.addEventListener('keydown',e=>{
  if(list.hidden||list.dataset.owner!=='mention'||!items.length||e.isComposing||e.keyCode===229)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:items.length-1))%items.length;render();}
  else if((e.key==='Enter'&&!e.shiftKey)||e.key==='Tab'){e.preventDefault();choose(items[active]);}
  else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
 });
 return {reset(){serial++;clearTimer(timer);close();}};
}
