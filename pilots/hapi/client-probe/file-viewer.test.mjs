import test from 'node:test';import assert from 'node:assert/strict';
import {createFileTabs,resolveRelative} from './file-viewer.mjs';

function fakeDocument(){const nodes=[];return {nodes,createElementNS(ns,tag){return this.createElement(tag);},createElement(tag){const n={tag,children:[],hidden:false,attrs:{},classes:new Set(),
 classList:{toggle(c,on){on?n.classes.add(c):n.classes.delete(c);}},
 append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];if(k==='src')delete this.src;},
 querySelectorAll(){return [];}};nodes.push(n);return n;}};}
const settle=()=>new Promise(r=>setTimeout(r,5));
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
