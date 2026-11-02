// Engine-reported slash commands (/name) and skills ($name), inserted as text the way HAPI's own
// composer does; HAPI forwards them to the engine. Nothing is executed from the list itself.
export function commandQuery(text){
 const m=/^([/$])([^\s/$]*)$/.exec(String(text??''));
 return m?{prefix:m[1],term:m[2].toLowerCase()}:null;
}
export function commandMatches(lists,query,limit=8){
 if(!query)return [];
 const rows=(query.prefix==='/'?lists?.commands:lists?.skills)??[];
 const valid=rows.filter(r=>typeof r?.name==='string'&&/^[\w.:-]+$/.test(r.name));
 const name=r=>r.name.toLowerCase(),starts=valid.filter(r=>name(r).startsWith(query.term)),contains=valid.filter(r=>!name(r).startsWith(query.term)&&name(r).includes(query.term));
 return [...starts,...contains].slice(0,limit).map(r=>({text:query.prefix+r.name,description:typeof r.description==='string'?r.description:''}));
}
export function createCommandSuggest({input,list,load}){
 let lists=null,owner=null,items=[],active=0,serial=0;
 const doc=input.ownerDocument;
 function close(){items=[];list.hidden=true;list.replaceChildren();input.removeAttribute('aria-activedescendant');input.setAttribute('aria-expanded','false');}
 function choose(item){input.value=item.text+' ';input.dispatchEvent(new Event('input',{bubbles:true}));close();input.focus();}
 function render(){
  if(!items.length){close();return;}
  list.replaceChildren(...items.map((item,i)=>{const b=doc.createElement('button');b.type='button';b.id='command-option-'+i;b.className='command-option'+(i===active?' active':'');b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===active));
   const name=doc.createElement('span');name.className='command-name';name.textContent=item.text;b.append(name);
   if(item.description){const d=doc.createElement('span');d.className='command-description';d.textContent=item.description;b.append(d);}
   b.onmousedown=e=>e.preventDefault();b.onclick=()=>choose(item);return b;}));
  list.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-activedescendant','command-option-'+active);
 }
 async function update(){
  const query=commandQuery(input.value),key=load.key();if(!query||!key){close();return;}
  if(owner!==key){owner=key;lists=null;const ticket=++serial;try{const r=await load.fetch();if(ticket!==serial||owner!==key)return;lists=r;}catch{lists={commands:[],skills:[]};}}
  if(!lists)return;
  const now=commandQuery(input.value);items=commandMatches(lists,now);active=0;render();
 }
 input.addEventListener('input',update);
 input.addEventListener('blur',()=>setTimeout(close,100));
 // Registered before the Enter-to-send binding, which skips events this handler already handled.
 input.addEventListener('keydown',e=>{
  if(list.hidden||!items.length||e.isComposing||e.keyCode===229)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:items.length-1))%items.length;render();}
  else if((e.key==='Enter'&&!e.shiftKey)||e.key==='Tab'){e.preventDefault();choose(items[active]);}
  else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
 });
 return {reset(){serial++;owner=null;lists=null;close();}};
}
