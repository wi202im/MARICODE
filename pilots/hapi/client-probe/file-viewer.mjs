import {icon} from './icons.mjs';
import {diffLines} from './git-status.mjs';
import {fileKind,mediaType,highlightLanguage,highlightLimit,textReadLimit} from './file-kinds.mjs';
// Center file tabs: chat stays the first tab, files open beside it.
// Text comes through the Hub file read; media through a short-lived link streamed by this server.
// On this Mac's own screen an existing UTF-8 text file can be edited (CodeMirror) and saved through
// the server, which refuses the save when the file changed since it was loaded (hash of the loaded bytes).
const defaultLibs={
 markdown:()=>import('/vendor/markdown-it.mjs').then(m=>m.default),
 highlight:()=>import('/vendor/highlight.mjs').then(m=>m.default),
 grammar:name=>import(`/vendor/hljs-languages/${name}.mjs`).then(m=>m.default),
 editor:()=>import('/code-editor.mjs')
};
export const editLimit=1024*1024;
const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const maxTabs=12;
export const formatBytes=n=>n<1024?`${n} B`:n<1024**2?`${(n/1024).toFixed(1)} KB`:n<1024**3?`${(n/1024**2).toFixed(1)} MB`:`${(n/1024**3).toFixed(1)} GB`;
// A link inside a project file, resolved against that file; null when it leaves the folder or is not a path.
export function resolveRelative(from,href){
 if(!href||/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(href))return null;
 let path;try{path=decodeURIComponent(href.split(/[?#]/)[0]);}catch{return null;}
 if(!path)return null;
 const parts=path.startsWith('/')?[]:from.split('/').slice(0,-1);
 for(const p of path.split('/')){if(!p||p==='.')continue;if(p==='..'){if(!parts.length)return null;parts.pop();}else parts.push(p);}
 return parts.join('/')||null;
}
export function createFileTabs({api,base,strip,view,host,document:doc=globalThis.document,libs=defaultLibs,notice=()=>{},editable=()=>false,save=null,confirm:ask=m=>globalThis.confirm?.(m)??false}){
 let tabs=[],active=null,serial=0,md=null,hljs=null;
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const name=path=>path.split('/').pop();
 function renderStrip(){
  strip.hidden=!tabs.length;host?.classList.toggle('file-tab-active',!!active);view.hidden=!active;
  const chat=el('button','대화','center-tab-main');chat.type='button';chat.setAttribute('role','tab');chat.setAttribute('aria-selected',String(!active));chat.onclick=()=>show(null);
  const items=[chat];
  for(const t of tabs){
   const item=el('div',undefined,'center-tab'+(t===active?' active':'')),open=el('button',t.title??name(t.path)),close=el('button',undefined,'center-tab-close');close.append(icon('close',doc));
   open.type=close.type='button';open.title=t.path;open.setAttribute('role','tab');open.setAttribute('aria-selected',String(t===active));open.onclick=()=>show(t);
   close.setAttribute('aria-label',`${t.title??name(t.path)} 닫기`);close.onclick=()=>closeTab(t);item.append(open,close);items.push(item);
  }
  strip.replaceChildren(...items);
 }
 function show(t){active=t;view.replaceChildren(...(t?[t.pane]:[]));renderStrip();}
 const discard='저장하지 않은 변경이 있습니다. 버릴까요?';
 function closeTab(t){const i=tabs.indexOf(t);if(i<0)return;if(t.dirty&&!ask(discard))return;tabs.splice(i,1);t.editor?.destroy();t.dispose?.();if(active===t)show(tabs[i]??tabs[i-1]??null);else renderStrip();}
 async function highlighter(language){
  hljs??=await libs.highlight();
  if(!hljs.getLanguage(language)&&/^[a-z0-9-]{1,40}$/.test(language)){try{hljs.registerLanguage(language,await libs.grammar(language));}catch{}}
  return hljs.getLanguage(language)?hljs:null;
 }
 async function codeView(text,path){
  const lines=text.split('\n'),wrap=el('div',undefined,'code-view'),gutter=el('pre',lines.map((_,i)=>i+1).join('\n'),'code-gutter'),pre=el('pre'),code=el('code',undefined,'hljs');
  gutter.setAttribute('aria-hidden','true');pre.append(code);wrap.append(gutter,pre);
  const h=text.length<=highlightLimit?await highlighter(highlightLanguage(path)).catch(()=>null):null;
  if(h)code.innerHTML=h.highlight(text,{language:highlightLanguage(path),ignoreIllegals:true}).value;else code.textContent=text;
  return wrap;
 }
 async function markdownView(text,t){
  if(!md){hljs??=await libs.highlight().catch(()=>null);
   md=new (await libs.markdown())({html:false,linkify:false,typographer:false,highlight:(code,lang)=>hljs?.getLanguage(lang)?hljs.highlight(code,{language:lang,ignoreIllegals:true}).value:''});}
  const box=el('article',undefined,'markdown-view');box.innerHTML=md.render(text);
  for(const a of box.querySelectorAll('a[href]')){
   const href=a.getAttribute('href'),target=resolveRelative(t.path,href);
   if(/^https?:\/\//i.test(href)){a.target='_blank';a.rel='noopener noreferrer';}
   else if(target){a.removeAttribute('href');a.tabIndex=0;a.setAttribute('role','link');a.title=target;a.onclick=()=>open(target);}
   else if(!href.startsWith('#'))a.removeAttribute('href');
  }
  for(const img of box.querySelectorAll('img')){
   const src=img.getAttribute('src'),target=resolveRelative(t.path,src);img.removeAttribute('src');
   if(target&&mediaType(target)?.startsWith('image/'))mediaLink(target).then(url=>{img.src=url;}).catch(()=>{});
  }
  return box;
 }
 const mediaLink=path=>api(base()+'/file-link?path='+encodeURIComponent(path)).then(r=>r.url);
 async function body(t){
  if(t.diff!==undefined){const pre=el('pre',undefined,'diff-view');for(const l of diffLines(t.diff))pre.append(el('span',l.text,'diff-'+l.kind));return pre;}
  const kind=fileKind(t.path);
  if(['image','video','audio','pdf'].includes(kind)){
   const url=await mediaLink(t.path);
   if(kind==='image'){const img=el('img');img.alt=t.path;img.src=url;return img;}
   if(kind==='pdf'){const frame=el('iframe');frame.title=t.path;frame.src=url;return frame;}
   const media=el(kind);media.controls=true;media.preload='metadata';media.src=url;t.dispose=()=>{media.pause?.();media.removeAttribute('src');};return media;
  }
  if(t.size>textReadLimit)return el('p',`${formatBytes(t.size)} 파일은 미리보기하기에 너무 큽니다. Finder나 편집기에서 열어 주세요.`,'file-view-note');
  const f=await api(base()+'/file?path='+encodeURIComponent(t.path));
  if(!f?.success||typeof f.content!=='string')throw Error('파일을 열 수 없습니다.');
  const bytes=Uint8Array.from(atob(f.content),c=>c.charCodeAt(0));t.size=f.size??bytes.length;
  if(bytes.subarray(0,8000).includes(0))return el('p','텍스트가 아닌 파일이라 미리보기를 지원하지 않습니다.','file-view-note');
  t.text=new TextDecoder().decode(bytes);t.hash=editable()&&save&&bytes.length<=editLimit?await sha256(bytes):null;
  return kind==='markdown'&&t.mode!=='source'?markdownView(t.text,t):codeView(t.text,t.path);
 }
 async function load(t){
  const mine=++serial;t.loading=mine;
  const head=el('div',undefined,'file-pane-head'),title=el('strong',t.label??t.path),meta=el('small',t.size?formatBytes(t.size):'');title.title=t.path;head.append(title,meta);
  if(t.diff===undefined&&fileKind(t.path)==='markdown'){const mode=el('button',t.mode==='source'?'보기':'원본');mode.type='button';mode.onclick=()=>{t.mode=t.mode==='source'?'view':'source';load(t);};head.append(mode);}
  const reload=el('button','새로고침');reload.type='button';reload.onclick=()=>load(t);head.append(reload);
  const content=el('div',undefined,'file-pane-body');content.append(el('p','불러오는 중…','file-view-note'));
  t.pane.replaceChildren(head,content);t.content=content;
  try{const b=await body(t);if(t.loading!==mine)return;meta.textContent=t.size?formatBytes(t.size):'';content.replaceChildren(b);
   if(t.diff===undefined&&typeof t.hash==='string'&&editable()){const edit=el('button','편집');edit.type='button';edit.title='이 Mac에서 파일을 편집합니다';edit.onclick=()=>startEdit(t);head.insertBefore?head.insertBefore(edit,reload):head.append(edit);}}
  catch(e){if(t.loading!==mine)return;content.replaceChildren(el('p',e.message.includes('(403)')?'프로젝트 밖의 링크이거나 접근할 수 없는 경로입니다.':e.message.includes('(415)')?'이 형식은 바로 재생할 수 없습니다.':e.message,'file-view-note error'));}
 }
 async function startEdit(t){
  const text=t.text,crlf=text.includes('\r\n');
  if(/\r(?!\n)/.test(text)||crlf&&/(^|[^\r])\n/.test(text)){t.content?.replaceChildren(el('p','줄바꿈 형식(CRLF·LF)이 섞인 파일은 편집할 수 없습니다. 형식을 바꾸지 않도록 읽기 전용으로 둡니다.','file-view-note error'));return;}
  const mine=++serial;t.loading=mine;t.editing=true;t.dirty=false;
  const head=el('div',undefined,'file-pane-head'),title=el('strong',t.path),state=el('small','','file-edit-state'),saveButton=el('button','저장'),done=el('button','편집 끝내기');
  title.title=t.path;saveButton.type=done.type='button';saveButton.title='저장 (⌘S)';saveButton.disabled=true;head.append(title,state,saveButton,done);
  const content=el('div',undefined,'file-pane-body file-editor');t.pane.replaceChildren(head,content);
  const status=(text,error=false)=>{state.textContent=text;state.className='file-edit-state'+(error?' error':'');};
  const sync=()=>{saveButton.disabled=!t.dirty||!!t.saving;};
  const changed=()=>{t.dirty=t.editor.text!==t.text;if(!t.saving)status(t.dirty?'수정됨 · ⌘S로 저장':'');sync();};
  async function write(){
   if(!t.dirty||t.saving)return;t.saving=true;sync();status('저장 중…');const next=t.editor.text;
   try{const r=await save(t.path,next,t.hash);t.text=next;t.hash=r.hash;if(Number.isFinite(r.size))t.size=r.size;t.dirty=t.editor.text!==t.text;
    status(`저장했습니다 · ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}${t.dirty?' · 이후 수정됨':''}`);}
   catch(e){status(e.reason?e.message:'저장 결과를 확인하지 못했습니다. 자동으로 다시 저장하지 않습니다. 다시 저장해도 파일이 그사이 바뀌었으면 덮어쓰지 않습니다.',true);}
   finally{t.saving=false;sync();}
  }
  saveButton.onclick=()=>write();
  done.onclick=()=>{if(t.dirty&&!ask(discard))return;t.editor?.destroy();t.editor=null;t.editing=false;t.dirty=false;load(t);};
  try{const lib=await libs.editor();if(t.loading!==mine)return;
   t.editor=lib.create({parent:content,text,path:t.path,lineSeparator:crlf?'\r\n':'\n',onChange:changed,onSave:write,document:doc});t.editor.focus();}
  catch{t.editing=false;content.replaceChildren(el('p','편집기를 불러오지 못했습니다.','file-view-note error'));}
 }
 function open(path,{size}={}){
  let t=tabs.find(x=>x.path===path);
  if(!t){t={path,size,mode:'view',pane:el('div',undefined,'file-pane')};tabs.push(t);if(tabs.length>maxTabs)closeTab(tabs.find(x=>x!==t));load(t);}
  show(t);notice(editable()?'파일 보기 · 텍스트 파일은 편집할 수 있습니다':'읽기 전용 파일 보기');return t;
 }
 // A change from the chat: the diff the AI's edit made, read-only, in its own tab beside the file itself.
 function openDiff({path,diff,label,key='diff:'+path,title=`${name(path)} · 변경`}){
  let t=tabs.find(x=>x.path===key);
  if(t){t.diff=diff;t.label=label;load(t);}else{t={path:key,title,diff,label,mode:'view',pane:el('div',undefined,'file-pane')};tabs.push(t);if(tabs.length>maxTabs)closeTab(tabs.find(x=>x!==t));load(t);}
  show(t);return t;
 }
 function clear(){for(const t of tabs){t.editor?.destroy();t.dispose?.();}tabs=[];show(null);}
 // Before something replaces every tab (session switch, logout): ask once if edits would be lost.
 function confirmDiscard(){return !tabs.some(t=>t.dirty)||ask('저장하지 않은 파일 변경이 있습니다. 버리고 이동할까요?');}
 renderStrip();
 return {open,openDiff,clear,show,confirmDiscard,get unsaved(){return tabs.some(t=>t.dirty);},get active(){return active?.path??null;},get paths(){return tabs.map(t=>t.path);}};
}
