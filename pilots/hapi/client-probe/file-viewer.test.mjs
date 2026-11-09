import test from 'node:test';import assert from 'node:assert/strict';
import {createFileTabs,resolveRelative} from './file-viewer.mjs';

function fakeDocument(){const nodes=[];return {nodes,createElementNS(ns,tag){return this.createElement(tag);},createElement(tag){const n={tag,children:[],hidden:false,attrs:{},classes:new Set(),
 classList:{toggle(c,on){on?n.classes.add(c):n.classes.delete(c);}},
 append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];if(k==='src')delete this.src;},
 querySelectorAll(){return [];}};nodes.push(n);return n;}};}
const settle=()=>new Promise(r=>setTimeout(r,5));
// Waits for an async result (hashing, editor load) instead of a fixed delay; fails after 2s.
async function waitFor(check){for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('timed out');}
const b64=s=>Buffer.from(s).toString('base64');
function setup(files){
 const doc=fakeDocument(),calls=[],host=doc.createElement('section'),strip=doc.createElement('div'),view=doc.createElement('section');
 const api=async path=>{calls.push(path);const p=decodeURIComponent(path.split('path=')[1]);if(path.includes('/file-link'))return {url:'/file-raw/abc'};if(!(p in files))throw Error('파일 없음');return {success:true,content:b64(files[p]),size:files[p].length};};
 const hljs={langs:new Set(['javascript','markdown']),getLanguage(l){return this.langs.has(l);},registerLanguage(l){this.langs.add(l);},highlight(t,{language}){return {value:`<hl ${language}>${t}`};}};
 const libs={highlight:async()=>hljs,grammar:async l=>{if(l!=='swift')throw Error('none');return ()=>({});},markdown:async()=>class{render(t){return `<md>${t}`;}}};
 const tabs=createFileTabs({api,base:()=>'/api/sessions/s',strip,view,host,document:doc,libs});
 const find=text=>doc.nodes.findLast(n=>n.textContent===text);
 const deep=(n,f)=>f(n)?n:n.children?.map(c=>deep(c,f)).find(Boolean);
 return {doc,calls,host,strip,view,tabs,find,inView:f=>deep(view,f)};
}
test('opening a file adds a center tab beside the chat, reopening reuses it, closing returns to the chat',async()=>{
 const s=setup({'src/a.mjs':'let a=1\nlet b=2','x.swift':'let x'});
 assert.equal(s.strip.hidden,true);
 s.tabs.open('src/a.mjs');await settle();
 assert.equal(s.strip.hidden,false);assert.equal(s.host.classes.has('file-tab-active'),true);
 assert.deepEqual(s.strip.children.map(n=>n.textContent??n.children[0].textContent),['대화','a.mjs']);
 assert.equal(s.inView(n=>n.tag==='code').innerHTML,'<hl javascript>let a=1\nlet b=2');assert.equal(s.inView(n=>n.className==='code-gutter').textContent,'1\n2');
 s.tabs.open('x.swift');await settle();assert.equal(s.inView(n=>n.tag==='code').innerHTML,'<hl swift>let x');
 s.tabs.open('src/a.mjs');assert.deepEqual(s.tabs.paths,['src/a.mjs','x.swift']);assert.equal(s.calls.filter(c=>c.includes('a.mjs')).length,1);
 s.find('대화').onclick();assert.equal(s.tabs.active,null);assert.equal(s.view.hidden,true);assert.equal(s.host.classes.has('file-tab-active'),false);
 s.tabs.clear();assert.equal(s.strip.hidden,true);
});
test('media streams from a file link; huge or binary files are not shown as text',async()=>{
 const s=setup({'bin.dat':'ab\0cd'});
 s.tabs.open('movie.mov');await settle();
 const video=s.inView(n=>n.tag==='video');assert.equal(video.src,'/file-raw/abc');assert.equal(video.controls,true);assert.ok(s.calls.at(-1).endsWith('/file-link?path=movie.mov'));
 s.tabs.open('huge.log',{size:50*1024*1024});await settle();assert.match(s.inView(n=>n.tag==='p').textContent,/너무 큽니다/);assert.ok(!s.calls.some(c=>c.includes('huge.log')));
 s.tabs.open('bin.dat');await settle();assert.match(s.inView(n=>n.tag==='p').textContent,/텍스트가 아닌/);
 s.tabs.open('missing.txt');await settle();assert.equal(s.inView(n=>n.tag==='p').textContent,'파일 없음');
});
test('markdown opens in reading mode and toggles to the source',async()=>{
 const s=setup({'README.md':'# Hi'});
 s.tabs.open('README.md');await settle();assert.equal(s.inView(n=>n.className==='markdown-view').innerHTML,'<md># Hi');
 s.find('원본').onclick();await settle();assert.equal(s.inView(n=>n.tag==='code').innerHTML,'<hl markdown># Hi');assert.ok(s.find('보기'));
});
test('links inside a file resolve within the project folder only',()=>{
 assert.equal(resolveRelative('docs/a.md','b.md'),'docs/b.md');
 assert.equal(resolveRelative('docs/a.md','../img/x.png#top'),'img/x.png');
 assert.equal(resolveRelative('docs/a.md','/README.md'),'README.md');
 assert.equal(resolveRelative('docs/a.md','dir%20name/c.md'),'docs/dir name/c.md');
 for(const bad of ['../../x','https://x.y','javascript:alert(1)','//evil','#frag','',null])assert.equal(resolveRelative('docs/a.md',bad),null);
});
test('the vendored markdown-it escapes raw HTML and drops script links; highlight.js loads grammars',async()=>{
 const MarkdownIt=(await import('./vendor/markdown-it.mjs')).default,md=new MarkdownIt({html:false});
 const html=md.render('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](https://a.b) ![i](x.png)\n\n| a |\n|---|\n| b |');
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript'));assert.ok(html.includes('href="https://a.b"'));assert.ok(html.includes('<table>'));
 const hljs=(await import('./vendor/highlight.mjs')).default;assert.ok(hljs.getLanguage('javascript'));assert.ok(!hljs.getLanguage('dockerfile'));
 hljs.registerLanguage('dockerfile',(await import('./vendor/hljs-languages/dockerfile.mjs')).default);assert.match(hljs.highlight('FROM node',{language:'dockerfile'}).value,/hljs-keyword/);
});
test('a change from the chat opens as its own read-only diff tab beside the file',async()=>{
 const s=setup({});
 s.tabs.openDiff({path:'src/a.mjs',diff:'@@ 변경 @@\n-x=1\n+x=2',label:'src/a.mjs · 이번 턴의 변경'});await settle();
 assert.deepEqual(s.tabs.paths,['diff:src/a.mjs']);assert.equal(s.calls.length,0);
 assert.deepEqual(s.strip.children.map(n=>n.textContent??n.children[0].textContent),['대화','a.mjs · 변경']);
 assert.deepEqual(s.inView(n=>n.className==='diff-view').children.map(c=>[c.className,c.textContent]),[['diff-hunk','@@ 변경 @@'],['diff-del','-x=1'],['diff-add','+x=2']]);
 s.tabs.openDiff({path:'src/a.mjs',diff:'@@ 변경 @@\n+y',label:'x'});await settle();assert.equal(s.tabs.paths.length,1);
});

// Editing: the real editor (CodeMirror) is replaced by a fake that exposes its text and callbacks.
async function sha(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function editSetup(files,{editable=true,saveResult}={}){
 const doc=fakeDocument(),host=doc.createElement('section'),strip=doc.createElement('div'),view=doc.createElement('section'),saves=[],asks=[];let editor=null,answer=false;
 const api=async path=>{const p=decodeURIComponent(path.split('path=')[1]);if(!(p in files))throw Error('파일 없음');return {success:true,content:b64(files[p]),size:Buffer.byteLength(files[p])};};
 const libs={highlight:async()=>({getLanguage:()=>false,registerLanguage(){}}),grammar:async()=>{throw Error('none');},markdown:async()=>class{render(t){return t;}},
  editor:async()=>({create:o=>{editor={...o,text:o.text,focused:false,destroyed:false};return {get text(){return editor.text;},focus(){editor.focused=true;},destroy(){editor.destroyed=true;}};}})};
 const save=async(path,content,expectedHash)=>{saves.push({path,content,expectedHash});return saveResult?saveResult(path,content,expectedHash):{success:true,hash:'h'+saves.length};};
 const tabs=createFileTabs({api,base:()=>'/api/sessions/s',strip,view,host,document:doc,libs,editable:()=>editable,save,confirm:m=>{asks.push(m);return answer;}});
 const deep=(n,f)=>f(n)?n:n.children?.map(c=>deep(c,f)).find(Boolean);
 return {tabs,saves,asks,view,get editor(){return editor;},set answer(v){answer=v;},button:text=>deep(view,n=>n.tag==='button'&&n.textContent===text),inView:f=>deep(view,f)};
}
test('on this Mac existing UTF-8 text files open straight in the editor; everything else stays read-only',async()=>{
 let s=editSetup({'a.js':'x'},{editable:false});s.tabs.open('a.js');await waitFor(()=>s.inView(n=>n.tag==='code'));assert.equal(s.editor,null);
 s=editSetup({'a.js':'x','bin.dat':'a\0b','mixed.txt':'a\r\nb\nc'});
 s.tabs.open('a.js');await waitFor(()=>s.editor);assert.equal(s.editor.path,'a.js');assert.equal(s.editor.text,'x');assert.equal(s.editor.focused,false,'opening does not grab the keyboard');
 assert.equal(s.inView(n=>n.tag==='code'),undefined);assert.equal(s.button('편집'),undefined);
 const opened=s.editor;
 s.tabs.open('bin.dat');await waitFor(()=>/텍스트가 아닌/.test(s.inView(n=>n.tag==='p')?.textContent??''));assert.equal(s.editor,opened);assert.match(s.inView(n=>n.tag==='p').textContent,/텍스트가 아닌/);
 s.tabs.open('big.log',{size:2*1024*1024});await settle();assert.equal(s.editor,opened);
 s.tabs.open('mixed.txt');await waitFor(()=>s.inView(n=>n.tag==='code'));assert.equal(s.editor,opened);assert.match(s.inView(n=>n.tag==='p').textContent,/줄바꿈/);assert.ok(s.inView(n=>n.tag==='code'));
 s.tabs.openDiff({path:'a.js',diff:'+x',label:'x'});await settle();assert.equal(s.editor,opened);assert.ok(s.inView(n=>n.className==='diff-view'));
});
test('markdown opens in reading view; 원본 goes straight to the editor and 보기 asks before dropping edits',async()=>{
 const s=editSetup({'README.md':'# Hi'});s.tabs.open('README.md');await waitFor(()=>s.inView(n=>n.className==='markdown-view'));
 assert.equal(s.editor,null);assert.ok(s.inView(n=>n.className==='markdown-view'));
 s.button('원본').onclick();await waitFor(()=>s.editor);assert.equal(s.editor.text,'# Hi');
 s.editor.text='# Hello';s.editor.onChange();s.answer=false;s.button('보기').onclick();await settle();assert.equal(s.asks.length,1);assert.equal(s.editor.destroyed,false);
 s.answer=true;s.button('보기').onclick();await waitFor(()=>s.inView(n=>n.className==='markdown-view'));assert.equal(s.editor.destroyed,true);assert.ok(s.inView(n=>n.className==='markdown-view'));
});
test('saving sends the loaded hash, keeps line endings and chains the new hash',async()=>{
 const s=editSetup({'.env':'A=1\r\nB=2\r\n'});s.tabs.open('.env');await waitFor(()=>s.editor);
 assert.equal(s.editor.text,'A=1\r\nB=2\r\n');assert.equal(s.editor.lineSeparator,'\r\n');assert.equal(s.editor.path,'.env');
 assert.equal(s.button('저장').disabled,true);
 s.editor.text='A=1\r\nB=3\r\n';s.editor.onChange();assert.equal(s.button('저장').disabled,false);assert.equal(s.tabs.unsaved,true);
 await s.editor.onSave();
 assert.deepEqual(s.saves[0],{path:'.env',content:'A=1\r\nB=3\r\n',expectedHash:await sha('A=1\r\nB=2\r\n')});
 assert.equal(s.tabs.unsaved,false);assert.equal(s.button('저장').disabled,true);assert.match(s.inView(n=>n.className==='file-edit-state').textContent,/저장했습니다/);
 s.editor.text='A=2\r\nB=3\r\n';s.editor.onChange();s.button('저장').onclick();await waitFor(()=>s.saves.length===2);assert.equal(s.saves[1].expectedHash,'h1');
});
test('a conflicting or unconfirmed save keeps the edits and never retries by itself',async()=>{
 let calls=0;const s=editSetup({'a.js':'one'},{saveResult:()=>{calls++;if(calls===1){const e=Error('불러온 뒤 다른 곳에서 파일이 바뀌어 저장하지 않았습니다.');e.reason='FILE_CHANGED';throw e;}throw Error('network');}});
 s.tabs.open('a.js');await waitFor(()=>s.editor);
 s.editor.text='mine';s.editor.onChange();await s.editor.onSave();await settle();
 assert.match(s.inView(n=>n.className==='file-edit-state error').textContent,/다른 곳에서 파일이 바뀌어/);assert.equal(s.editor.text,'mine');assert.equal(s.tabs.unsaved,true);
 await s.editor.onSave();await settle();assert.match(s.inView(n=>n.className==='file-edit-state error').textContent,/저장 결과를 확인하지 못했습니다/);
 await settle();assert.equal(calls,2,'no automatic retry');
});
test('unsaved edits are not dropped by closing, reloading or switching away without asking',async()=>{
 const s=editSetup({'a.js':'one'});s.tabs.open('a.js');await waitFor(()=>s.editor);const first=s.editor;
 s.editor.text='two';s.editor.onChange();s.answer=false;
 s.button('새로고침').onclick();await settle();assert.equal(s.asks.length,1);assert.equal(first.destroyed,false);
 assert.equal(s.tabs.confirmDiscard(),false);assert.equal(s.asks.length,2);assert.deepEqual(s.tabs.paths,['a.js']);
 s.answer=true;s.button('새로고침').onclick();await waitFor(()=>s.editor!==first);assert.equal(first.destroyed,true);assert.notEqual(s.editor,first);assert.equal(s.editor.text,'one');assert.equal(s.tabs.unsaved,false);
});
test('editor languages follow the file name; unknown files edit as plain text',async()=>{
 const {editorLanguage}=await import('./editor-languages.mjs');
 assert.deepEqual(editorLanguage('src/App.tsx'),{kind:'lezer',module:'lang-javascript',fn:'javascript',options:{jsx:true,typescript:true}});
 for(const [p,m] of [['.env','legacy-properties'],['app/.env.local','legacy-properties'],['prod.env','legacy-properties'],['Dockerfile','legacy-dockerfile'],['run.sh','legacy-shell'],['a/b.py','lang-python'],['c.yml','lang-yaml'],['Cargo.toml','legacy-toml'],['x.md','lang-markdown']])assert.equal(editorLanguage(p)?.module,m,p);
 for(const p of ['LICENSE','notes.txt','a.unknown','','.'])assert.equal(editorLanguage(p),null,p);
 const files=new Set((await import('node:fs')).readdirSync(new URL('./vendor/codemirror/',import.meta.url)));
 for(const p of ['a.js','a.json','a.css','a.html','a.md','a.py','a.yaml','a.sh','.env','a.toml','a.go','a.rs','a.swift','a.sql','Dockerfile']){const l=editorLanguage(p);assert.ok(files.has(l.module+'.js'),p);
  const m=await import(`./vendor/codemirror/${l.module}.js`);assert.equal(typeof m[l.kind==='lezer'?l.fn:l.name]==='function'||typeof m[l.name]==='object',true,p);}
});
