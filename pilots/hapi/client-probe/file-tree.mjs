// Project file tree for the right panel: folders expand in place, files open as center tabs.
// Icons are Material Icon Theme SVGs in vendor/file-icons (a subset; anything else uses the generic icon).
const folders=new Set(['src','docs','test','node','git','public','images','components','lib','scripts','config','dist','github','resource','app','ios','android']);
const folderAlias={source:'src',doc:'docs',tests:'test','__tests__':'test',spec:'test',node_modules:'node','.git':'git',static:'public',img:'images',assets:'resource',resources:'resource',
 script:'scripts',bin:'scripts','.config':'config',build:'dist',out:'dist','.github':'github',apps:'app'};
const byName={'package.json':'nodejs','package-lock.json':'npm','.npmrc':'npm','yarn.lock':'yarn','pnpm-lock.yaml':'pnpm','bun.lock':'bun','bun.lockb':'bun',dockerfile:'docker','docker-compose.yml':'docker',
 '.gitignore':'git','.gitattributes':'git','.gitmodules':'git',makefile:'makefile','.editorconfig':'editorconfig',license:'license','license.md':'license','license.txt':'license','.env':'tune'};
const byExt={js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'react',tsx:'react_ts',ts:'typescript',mts:'typescript',cts:'typescript',swift:'swift',md:'markdown',markdown:'markdown',json:'json',
 png:'image',jpg:'image',jpeg:'image',gif:'image',webp:'image',bmp:'image',ico:'image',avif:'image',heic:'image',svg:'svg',mp4:'video',mov:'video',m4v:'video',webm:'video',
 mp3:'audio',m4a:'audio',wav:'audio',aac:'audio',ogg:'audio',flac:'audio',pdf:'pdf',html:'html',htm:'html',css:'css',scss:'sass',sass:'sass',py:'python',go:'go',rs:'rust',java:'java',
 kt:'kotlin',kts:'kotlin',rb:'ruby',php:'php',c:'c',h:'h',cpp:'cpp',cc:'cpp',hpp:'hpp',cs:'csharp',sh:'console',zsh:'console',bash:'console',yml:'yaml',yaml:'yaml',xml:'xml',plist:'xml',
 lock:'lock',toml:'toml',log:'log',zip:'zip',gz:'zip',tgz:'zip',tar:'zip',dmg:'zip',ttf:'font',otf:'font',woff:'font',woff2:'font',pem:'certificate',crt:'certificate',cer:'certificate',key:'key',
 env:'tune',txt:'document',rtf:'document',doc:'document',docx:'document',sql:'database',db:'database',sqlite:'database',vue:'vue',ini:'settings',conf:'settings',cfg:'settings',applescript:'applescript'};
export function iconName(name,type,open=false){
 const lower=name.toLowerCase();
 if(type==='directory'){const f=folders.has(lower)?lower:folderAlias[lower];return (f?'folder-'+f:'folder')+(open?'-open':'');}
 if(type==='other')return 'folder-link'+(open?'-open':'');
 if(/^readme(\.|$)/.test(lower))return 'readme';
 const dot=lower.lastIndexOf('.');
 if(lower==='.env'||lower.startsWith('.env.'))return 'tune';
 return byName[lower]??(dot>0?byExt[lower.slice(dot+1)]:undefined)??'file';
}
export function createFileTree({api,base,list,open,error=()=>{},active=()=>null,document:doc=globalThis.document}){
 // path -> {entries|null, open}; '' is the project folder. 'other' entries are links: tried as a folder first.
 let nodes=new Map(),serial=0;
 const el=(tag,cls)=>{const n=doc.createElement(tag);if(cls)n.className=cls;return n;};
 async function read(path){const d=await api(base()+'/directory?path='+encodeURIComponent(path));if(!d?.success)throw Object.assign(Error('폴더를 열 수 없습니다.'),{notFolder:true});return d.entries;}
 function row(entry,path,depth){
  const node=nodes.get(path);
  const li=el('li'),btn=el('button','tree-row'),chevron=el('span','tree-chevron'),icon=el('img','tree-icon'),label=el('span','tree-name');
  btn.type='button';btn.style.paddingLeft=`${8+depth*14}px`;btn.dataset.kind=entry.type;btn.title=path;label.textContent=entry.name;
  icon.src=`/vendor/file-icons/${iconName(entry.name,entry.type,!!node?.open)}.svg`;icon.alt='';icon.setAttribute('aria-hidden','true');
  if(entry.type==='file'){chevron.classList?.add('none');if(active()===path)btn.classList?.add('active');}
  else{chevron.textContent=node?.open?'▾':'▸';btn.setAttribute('aria-expanded',String(!!node?.open));}
  btn.append(chevron,icon,label);li.append(btn);
  btn.onclick=()=>entry.type==='file'?open(path,entry.size):toggle(path,entry);
  if(node?.open&&node.entries){const ul=el('ul');ul.append(...node.entries.map(e=>row(e,path?`${path}/${e.name}`:e.name,depth+1)));li.append(ul);}
  return li;
 }
 function render(){const root=nodes.get('');list.replaceChildren(...(root?.entries??[]).map(e=>row(e,e.name,0)));}
 async function toggle(path,entry){
  const node=nodes.get(path);
  if(node?.open){node.open=false;render();return;}
  const mine=serial;
  try{const entries=node?.entries??await read(path);if(mine!==serial)return;nodes.set(path,{entries,open:true});render();}
  catch(e){if(mine!==serial)return;if(entry.type==='other'&&e.notFolder){open(path,entry.size);return;}error(e);}
 }
 async function reload(){
  const mine=++serial,opened=[...nodes].filter(([,n])=>n.open).map(([p])=>p);
  try{
   const fresh=new Map([['',{entries:await read(''),open:true}]]);
   // Keep folders that were open and still exist.
   for(const p of opened.filter(Boolean).sort((a,b)=>a.split('/').length-b.split('/').length)){
    const parent=p.split('/').slice(0,-1).join('/');if(!fresh.get(parent)?.entries?.some(e=>e.name===p.split('/').pop()))continue;
    try{fresh.set(p,{entries:await read(p),open:true});}catch{}
   }
   if(mine!==serial)return false;nodes=fresh;render();return true;
  }catch(e){if(mine===serial){list.replaceChildren();error(e);}return false;}
 }
 function clear(){serial++;nodes=new Map();list.replaceChildren();}
 function collapse(){for(const [p,n] of nodes)if(p)n.open=false;render();}
 return {reload,clear,collapse,render,get loaded(){return nodes.has('');}};
}
