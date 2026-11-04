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
// Renders <wa-tree-item>s into a <wa-tree selection="leaf">: unread folders are lazy and load on first expand.
export function createFileTree({api,base,list,open,error=()=>{},active=()=>null,document:doc=globalThis.document}){
 // path -> {entries, open}; '' is the project folder. kinds holds links found to be files.
 let nodes=new Map(),kinds=new Map(),serial=0;
 const el=(tag,cls)=>{const n=doc.createElement(tag);if(cls)n.className=cls;return n;};
 const kindOf=(entry,path)=>kinds.get(path)??entry.type;
 async function read(path){const d=await api(base()+'/directory?path='+encodeURIComponent(path));if(!d?.success)throw Object.assign(Error('폴더를 열 수 없습니다.'),{notFolder:true});return d.entries;}
 const iconUrl=(name,kind,opened)=>`/vendor/file-icons/${iconName(name,kind,opened)}.svg`;
 function item(entry,path){
  const kind=kindOf(entry,path),node=nodes.get(path),it=el('wa-tree-item'),pic=el('img','tree-icon'),label=el('span','tree-name');
  it.dataset.path=path;it.dataset.kind=kind;it.dataset.name=entry.name;if(entry.size!==undefined)it.dataset.size=String(entry.size);it.title=path;
  pic.src=iconUrl(entry.name,kind,!!node?.open);pic.alt='';pic.setAttribute('aria-hidden','true');label.textContent=entry.name;it.append(pic,label);
  if(kind==='file'){if(active()===path)it.setAttribute('selected','');}
  else if(node?.entries){if(node.open)it.setAttribute('expanded','');it.append(...node.entries.map(e=>item(e,`${path}/${e.name}`)));}
  else it.setAttribute('lazy','');
  return it;
 }
 function render(){const root=nodes.get('');list.replaceChildren(...(root?.entries??[]).map(e=>item(e,e.name)));}
 const target=e=>e.target?.closest?.('wa-tree-item');
 list.addEventListener('wa-lazy-load',async e=>{
  const it=target(e);if(!it)return;const path=it.dataset.path,mine=serial;
  try{const entries=await read(path);if(mine!==serial)return;nodes.set(path,{entries,open:true});render();}
  catch(err){if(mine!==serial)return;it.removeAttribute('lazy');
   if(it.dataset.kind==='other'&&err.notFolder){kinds.set(path,'file');render();open(path,it.dataset.size?Number(it.dataset.size):undefined);return;}
   error(err);}
 });
 for(const [type,opened] of [['wa-expand',true],['wa-collapse',false]])list.addEventListener(type,e=>{
  const it=target(e),node=it&&nodes.get(it.dataset.path);if(!node)return;node.open=opened;
  const pic=it.querySelector?.(':scope>.tree-icon');if(pic)pic.src=iconUrl(it.dataset.name,it.dataset.kind,opened);
 });
 list.addEventListener('click',e=>{const it=target(e);if(it?.dataset.kind==='file')open(it.dataset.path,it.dataset.size?Number(it.dataset.size):undefined);});
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
 function clear(){serial++;nodes=new Map();kinds=new Map();list.replaceChildren();}
 return {reload,clear,render,get loaded(){return nodes.has('');}};
}
