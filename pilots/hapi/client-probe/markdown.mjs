// AI replies are parsed by markdown-it (html off) and built as DOM nodes from its tokens: never innerHTML.
import MarkdownIt from './vendor/markdown-it.mjs';
export function safeLink(value){
 if(/[\s\u0000-\u001f]/.test(value))return null;
 try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
// Project-looking paths (optionally :line or #Lnn) become links the workspace opens; URLs and spaces never match.
export function pathTarget(value){
 const m=/^(~?\/?[\w.@+-]+(?:\/[\w.@+-]+)*\/?)(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)?$/.exec(value);
 return m&&(m[1].includes('/')||/[^.]\.[A-Za-z]\w{0,7}$/.test(m[1]))?m[1]:null;
}
// Only explicit http(s) URLs autolink: fuzzy matching would turn handoff.md into a .md domain.
const md=new MarkdownIt({html:false,linkify:true,typographer:false}).disable('image');
md.linkify.set({fuzzyLink:false,fuzzyEmail:false});
md.validateLink=url=>!!(safeLink(url)||pathTarget(url));
// Bare paths need a folder and an extension so ordinary words stay text.
const barePath=/(?<![\w/.~-])((?:~?\/)?[\w.@+-]+(?:\/[\w.@+-]+)+\.[A-Za-z]\w{0,7}(?::\d+(?::\d+)?)?)/g;
const tags={paragraph:'p',bullet_list:'ul',ordered_list:'ol',list_item:'li',blockquote:'blockquote',strong:'strong',em:'em',s:'s',thead:'thead',tbody:'tbody',tr:'tr',th:'th',td:'td'};
function pathLink(child,path,doc){const a=doc.createElement('a');a.href='#';a.className='path-link';a.dataset.path=path;a.title=path+' 열기';a.append(child);return a;}
function text(parent,value,doc,inLink){
 // html is off, so a literal <br> in a table cell arrives as text; keep it as the line break the table meant.
 const parts=['TD','TH'].includes(parent.tagName)?value.split(/<br\s*\/?>/i):[value];
 parts.forEach((part,i)=>{if(i)parent.append(doc.createElement('br'));let start=0;
  if(!inLink)for(const m of part.matchAll(barePath)){if(m.index>start)parent.append(doc.createTextNode(part.slice(start,m.index)));parent.append(pathLink(doc.createTextNode(m[1]),pathTarget(m[1]),doc));start=m.index+m[1].length;}
  if(start<part.length)parent.append(doc.createTextNode(part.slice(start)));});
}
function codeBlock(t,doc){
 const box=doc.createElement('section'),bar=doc.createElement('div'),name=doc.createElement('span'),pre=doc.createElement('pre'),code=doc.createElement('code'),language=t.info.trim().split(/\s/)[0],body=t.content.replace(/\n$/,'');
 box.className='code-block';bar.className='code-toolbar';name.textContent=language||'코드';bar.append(name,copyButton(body,'코드 복사',doc));code.textContent=body;pre.append(code);box.append(bar,pre);return box;
}
function build(tokens,root,doc){
 const stack=[root],top=()=>stack.at(-1),inLink=()=>stack.some(e=>e.tagName==='A');
 for(const t of tokens){
  const name=t.type.replace(/_(open|close)$/,'');
  if(t.nesting===-1){stack.pop();continue;}
  if(t.type==='inline'){build(t.children,top(),doc);continue;}
  if(t.nesting===1){
   let e;
   if(t.hidden){stack.push(top());continue;}// tight list paragraphs add no element
   if(name==='heading')e=doc.createElement('h'+Math.min(Number(t.tag.slice(1))+1,6));
   else if(name==='table'){const wrap=doc.createElement('div'),table=doc.createElement('table');wrap.className='markdown-table';wrap.tabIndex=0;wrap.setAttribute('aria-label','표 · 가로로 스크롤할 수 있습니다');wrap.append(table);top().append(wrap);stack.push(table);continue;}
   else if(name==='link'){
    const href=t.attrGet('href'),link=safeLink(href);e=doc.createElement('a');
    if(link){e.href=link;e.target='_blank';e.rel='noopener noreferrer';}
    else{e.href='#';e.className='path-link';e.dataset.path=pathTarget(href);e.title=e.dataset.path+' 열기';}
   }else e=doc.createElement(tags[name]??'span');
   if(name==='ordered_list'&&Number(t.attrGet('start'))>1)e.setAttribute('start',t.attrGet('start'));
   top().append(e);stack.push(e);continue;
  }
  if(t.type==='text')text(top(),t.content,doc,inLink());
  else if(t.type==='softbreak')top().append(doc.createTextNode('\n'));
  else if(t.type==='hardbreak')top().append(doc.createElement('br'));
  else if(t.type==='code_inline'){const code=doc.createElement('code');code.textContent=t.content;const path=!inLink()&&pathTarget(t.content);top().append(path?pathLink(code,path,doc):code);}
  else if(t.type==='fence'||t.type==='code_block')top().append(codeBlock(t,doc));
  else if(t.type==='hr')top().append(doc.createElement('hr'));
  else if(t.content)text(top(),t.content,doc,inLink());// any other leaf stays plain text
 }
}
export function copyButton(text,label,doc=document){const b=doc.createElement('button');b.type='button';b.className='copy-button';b.textContent=label;b.setAttribute('aria-label',label);b.onclick=async()=>{try{await navigator.clipboard.writeText(text);b.textContent='복사됨';}catch{b.textContent='복사 실패 · 직접 선택해 주세요';}};return b;}
export function renderMarkdown(text,doc=document){
 const root=doc.createElement('div');root.className='markdown';build(md.parse(String(text),{}),root,doc);return root;
}
