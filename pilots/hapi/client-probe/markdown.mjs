// Deliberately small Markdown subset. All content becomes text nodes; never HTML.
export function safeLink(value){
 if(/[\s\u0000-\u001f]/.test(value))return null;
 try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
// Project-looking paths (optionally :line or #Lnn) become links the workspace opens; URLs and spaces never match.
export function pathTarget(value){
 const m=/^(~?\/?[\w.@+-]+(?:\/[\w.@+-]+)*\/?)(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)?$/.exec(value);
 return m&&(m[1].includes('/')||/[^.]\.[A-Za-z]\w{0,7}$/.test(m[1]))?m[1]:null;
}
export function inlineTokens(text){
 // Bare paths need a folder and an extension so ordinary words stay text.
 const result=[],pattern=/\\([\\`*_[\]])|(`+)([^`]+)\2|\*\*([^*]+)\*\*|\*([^*\n]+)\*|(!?)\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>()[\]`'"]+)|(?<![\w/.~-])((?:~?\/)?[\w.@+-]+(?:\/[\w.@+-]+)+\.[A-Za-z]\w{0,7}(?::\d+(?::\d+)?)?)/g;let start=0;
 for(const m of text.matchAll(pattern)){
  if(m.index>start)result.push({type:'text',text:text.slice(start,m.index)});
  let end=m.index+m[0].length;
  if(m[1])result.push({type:'text',text:m[1]});
  else if(m[2])result.push(pathTarget(m[3])?{type:'code',text:m[3],path:pathTarget(m[3])}:{type:'code',text:m[3]});
  else if(m[4])result.push({type:'strong',text:m[4]});
  else if(m[5])result.push({type:'em',text:m[5]});
  else if(!m[6]&&safeLink(m[8]))result.push({type:'link',text:m[7],href:safeLink(m[8])});
  else if(!m[6]&&pathTarget(m[8]))result.push({type:'path',text:m[7],path:pathTarget(m[8])});
  else if(m[9]){const url=m[9].replace(/[.,;:!?]+$/,'');end=m.index+url.length;result.push(safeLink(url)?{type:'link',text:url,href:safeLink(url)}:{type:'text',text:url});}
  else if(m[10])result.push({type:'path',text:m[10],path:pathTarget(m[10])});
  else result.push({type:'text',text:m[0]});
  start=end;
 }
 if(start<text.length)result.push({type:'text',text:text.slice(start)});return result;
}
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(s=>s.trim());
const divider=line=>line?.includes('|')&&cells(line).every(s=>/^:?-{3,}:?$/.test(s));
const listItem=line=>/^\s*(?:[-+*]|\d+[.)])\s+(.+)$/.exec(line);
export function parseMarkdown(text){
 const lines=String(text).replace(/\r\n?/g,'\n').split('\n'),out=[];let i=0;
 const special=n=>/^(#{1,6})\s|^\s*(`{3,}|~{3,})|^>\s?/.test(lines[n]??'')||listItem(lines[n]??'')||divider(lines[n+1]);
 while(i<lines.length){
  if(!lines[i].trim()){i++;continue;}
  const fence=/^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
  if(fence){const body=[];i++;while(i<lines.length&&!new RegExp('^\\s*'+fence[1][0]+'{'+fence[1].length+',}\\s*$').test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;out.push({type:'code',language:fence[2].trim().split(/\s/)[0],text:body.join('\n')});continue;}
  const h=/^(#{1,6})\s+(.+)$/.exec(lines[i]);if(h){out.push({type:'heading',level:Number(h[1].length),text:h[2]});i++;continue;}
  if(divider(lines[i+1])){const header=cells(lines[i]),rows=[];i+=2;while(i<lines.length&&lines[i].includes('|')&&lines[i].trim())rows.push(cells(lines[i++]));out.push({type:'table',header,rows});continue;}
  if(listItem(lines[i])){const items=[],ordered=/^\s*\d/.test(lines[i]);while(i<lines.length&&listItem(lines[i])&&/^\s*\d/.test(lines[i])===ordered)items.push(listItem(lines[i++])[1]);out.push({type:'list',ordered,items});continue;}
  if(/^>/.test(lines[i])){const body=[];while(i<lines.length&&/^>/.test(lines[i]))body.push(lines[i++].replace(/^>\s?/,''));out.push({type:'quote',text:body.join('\n')});continue;}
  const body=[lines[i++]];while(i<lines.length&&lines[i].trim()&&!special(i))body.push(lines[i++]);out.push({type:'paragraph',text:body.join('\n')});
 }return out;
}
function inline(parent,text,doc){for(const t of inlineTokens(text)){if(t.type==='text'){parent.append(doc.createTextNode(t.text));continue;}
 const e=doc.createElement(t.type==='link'||t.type==='path'?'a':t.type);e.textContent=t.text;
 if(t.type==='link'){e.href=t.href;e.target='_blank';e.rel='noopener noreferrer';}
 // The workspace opens data-path links (see app.mjs); href keeps them focusable.
 if(t.path){const a=t.type==='path'?e:doc.createElement('a');a.href='#';a.className='path-link';a.dataset.path=t.path;a.title=t.path+' 열기';if(a!==e)a.append(e);parent.append(a);continue;}
 parent.append(e);}}
export function copyButton(text,label,doc=document){const b=doc.createElement('button');b.type='button';b.className='copy-button';b.textContent=label;b.setAttribute('aria-label',label);b.onclick=async()=>{try{await navigator.clipboard.writeText(text);b.textContent='복사됨';}catch{b.textContent='복사 실패 · 직접 선택해 주세요';}};return b;}
export function renderMarkdown(text,doc=document){
 const root=doc.createElement('div');root.className='markdown';
 for(const b of parseMarkdown(text)){
  if(b.type==='code'){const box=doc.createElement('section'),bar=doc.createElement('div'),name=doc.createElement('span'),pre=doc.createElement('pre'),code=doc.createElement('code');box.className='code-block';bar.className='code-toolbar';name.textContent=b.language||'코드';bar.append(name,copyButton(b.text,'코드 복사',doc));code.textContent=b.text;pre.append(code);box.append(bar,pre);root.append(box);continue;}
  if(b.type==='table'){const wrap=doc.createElement('div'),table=doc.createElement('table'),head=doc.createElement('thead'),body=doc.createElement('tbody');wrap.className='markdown-table';wrap.tabIndex=0;wrap.setAttribute('aria-label','표 · 가로로 스크롤할 수 있습니다');for(const [index,row] of [b.header,...b.rows].entries()){const tr=doc.createElement('tr');for(const value of row){const cell=doc.createElement(index===0?'th':'td');inline(cell,value,doc);tr.append(cell);} (index===0?head:body).append(tr);}table.append(head,body);wrap.append(table);root.append(wrap);continue;}
  if(b.type==='list'){const e=doc.createElement(b.ordered?'ol':'ul');for(const item of b.items){const li=doc.createElement('li');inline(li,item,doc);e.append(li);}root.append(e);continue;}
  const e=doc.createElement(b.type==='heading'?'h'+Math.min(b.level+1,6):b.type==='quote'?'blockquote':'p');inline(e,b.text,doc);root.append(e);
 }return root;
}
