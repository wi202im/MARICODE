// Command palette and in-conversation find. Shortcuts to existing buttons/sessions only; no new permissions.
const norm=s=>String(s??'').toLowerCase();
export function paletteMatches(items,query,limit=30){
 const q=norm(query).trim();if(!q)return items.slice(0,limit);
 const scored=[];
 items.forEach((item,i)=>{const label=norm(item.label),hay=label+' '+norm(item.detail)+' '+norm(item.keywords);
  const score=label.startsWith(q)?0:label.split(/\s+/).some(w=>w.startsWith(q))?1:label.includes(q)?2:hay.includes(q)?3:-1;
  if(score>=0)scored.push({item,score,i});});
 return scored.sort((a,b)=>a.score-b.score||a.i-b.i).slice(0,limit).map(s=>s.item);
}
export function findRanges(text,query){
 const q=norm(query);if(!q.trim())return [];
 const t=norm(text),out=[];for(let i=t.indexOf(q);i>=0;i=t.indexOf(q,i+q.length))out.push([i,i+q.length]);return out;
}
export function createPalette({root,input,list,items}){
 let rows=[],active=0,opener=null;
 const doc=root.ownerDocument;
 function render(){
  rows=paletteMatches(items(),input.value);active=Math.min(active,Math.max(0,rows.length-1));
  list.replaceChildren(...(rows.length?rows.map((r,i)=>{const b=doc.createElement('button');b.type='button';b.id='palette-option-'+i;b.className='palette-option'+(i===active?' active':'');b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===active));
   const g=doc.createElement('span');g.className='palette-group';g.textContent=r.group;const l=doc.createElement('span');l.className='palette-label';l.textContent=r.label;b.append(g,l);
   if(r.hint){const h=doc.createElement('kbd');h.textContent=r.hint;b.append(h);}else if(r.detail){const d=doc.createElement('span');d.className='palette-detail';d.textContent=r.detail;b.append(d);}
   b.onmousedown=e=>e.preventDefault();b.onclick=()=>run(r);return b;}):[Object.assign(doc.createElement('p'),{className:'palette-empty',textContent:'일치하는 항목이 없습니다.'})]));
  input.setAttribute('aria-activedescendant',rows.length?'palette-option-'+active:'');
  list.querySelector('.active')?.scrollIntoView({block:'nearest'});
 }
 function open(){opener=doc.activeElement;root.hidden=false;input.value='';active=0;render();input.focus();}
 function close(){root.hidden=true;if(opener?.isConnected)opener.focus();}
 function run(r){close();r.run();}
 input.addEventListener('input',()=>{active=0;render();});
 input.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(rows.length){active=(active+(e.key==='ArrowDown'?1:rows.length-1))%rows.length;render();}}
  else if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();if(rows[active])run(rows[active]);}
  else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
 });
 root.addEventListener('mousedown',e=>{if(e.target===root)close();});
 return {open,close,get isOpen(){return !root.hidden;}};
}
// Highlights matches inside the conversation with the CSS Custom Highlight API (no DOM rewriting).
export function createFind({bar,input,count,scope}){
 const doc=bar.ownerDocument,view=doc.defaultView,supported=!!(view.CSS?.highlights&&view.Highlight);
 let ranges=[],current=-1;
 function collect(){
  ranges=[];const walker=doc.createTreeWalker(scope(),view.NodeFilter.SHOW_TEXT);
  for(let n=walker.nextNode();n;n=walker.nextNode()){if(n.parentElement?.closest('button,.copy-button'))continue;for(const [a,b] of findRanges(n.data,input.value)){const r=doc.createRange();r.setStart(n,a);r.setEnd(n,b);ranges.push(r);}}
 }
 function paint(){
  if(supported){view.CSS.highlights.set('find-all',new view.Highlight(...ranges));const now=new view.Highlight(...(ranges[current]?[ranges[current]]:[]));now.priority=1;view.CSS.highlights.set('find-current',now);}
  count.textContent=input.value.trim()?(ranges.length?`${current+1}/${ranges.length}`:'0건'):'';
  const r=ranges[current];if(r){const el=r.startContainer.parentElement;el?.scrollIntoView({block:'center'});}
 }
 function update(){collect();current=ranges.length?0:-1;paint();}
 function step(d){if(!ranges.length)return;current=(current+d+ranges.length)%ranges.length;paint();}
 function open(){bar.hidden=false;input.focus();input.select();if(input.value)update();}
 function close(){bar.hidden=true;ranges=[];current=-1;if(supported){view.CSS.highlights.delete('find-all');view.CSS.highlights.delete('find-current');}count.textContent='';}
 input.addEventListener('input',update);
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();step(e.shiftKey?-1:1);}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}});
 return {open,close,refresh(){if(!bar.hidden&&input.value){const keep=current;collect();current=ranges.length?Math.min(Math.max(keep,0),ranges.length-1):-1;paint();}},get isOpen(){return !bar.hidden;}};
}
