import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createFileTree,iconName} from './file-tree.mjs';
// vscode-tree's own selection event (mouse or keyboard), outside a render.
const list_select=(s,name)=>s.list.handlers['vsc-tree-select']({detail:[s.row(name)]});

function fakeDocument(){return {createTextNode:t=>({text:t,children:[]}),createElement(tag){const n={tag,children:[],attrs:{},dataset:{},
 append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},hasAttribute(k){return k in this.attrs;},
 closest(sel){return sel==='vscode-tree-item'&&tag==='vscode-tree-item'?this:null;},handlers:{},addEventListener(type,f){this.handlers[type]=f;}};return n;}};}
const items=n=>[...(n.tag==='vscode-tree-item'?[n]:[]),...(n.children??[]).flatMap(items)];
const label=r=>r.children.find(c=>'text' in c).text,icons=r=>r.children.filter(c=>c.tag==='img').map(c=>c.attrs.slot+':'+c.src.split('/').pop());
function setup(tree){
 const doc=fakeDocument(),list=doc.createElement('vscode-tree'),reads=[],opened=[],errors=[];
 const api=async path=>{const p=decodeURIComponent(path.split('path=')[1]);reads.push(p);if(!(p in tree))return {success:false};return {success:true,entries:tree[p]};};
 const t=createFileTree({api,base:()=>'/api/sessions/s',list,open:(p,size)=>opened.push([p,size]),error:e=>errors.push(e.message),active:()=>'src/a.mjs',document:doc,Observer:null});
 const row=name=>items(list).find(r=>label(r)===name);
 // vscode-tree writes its own data-path index onto items; the tree must not rely on it.
 const toggle=async(name,on=true)=>{const r=row(name);r.dataset.path='0';if(on)r.attrs.open='';else delete r.attrs.open;await t.toggled(r);};
 return {t,list,reads,opened,errors,row,toggle,click:name=>list.handlers.click({target:row(name)})};
}
test('folders are branches that load when first opened; files open with their size; links try folder then file',async()=>{
 const s=setup({'':[{name:'src',type:'directory'},{name:'kona',type:'other'},{name:'notes',type:'other',size:4},{name:'README.md',type:'file',size:5}],src:[{name:'a.mjs',type:'file',size:3}],kona:[{name:'x.swift',type:'file'}]});
 await s.t.reload();
 assert.deepEqual(items(s.list).map(r=>[label(r),'branch' in r.attrs]),[['src',true],['kona',true],['notes',true],['README.md',false]]);
 assert.deepEqual(icons(s.row('src')),['icon-branch:folder-src.svg','icon-branch-opened:folder-src-open.svg']);assert.deepEqual(icons(s.row('README.md')),['icon-leaf:readme.svg']);
 await s.toggle('src');assert.ok('open' in s.row('src').attrs);assert.ok('selected' in s.row('a.mjs').attrs);
 await new Promise(r=>setTimeout(r));s.click('a.mjs');list_select(s,'README.md');s.click('src');assert.deepEqual(s.opened,[['src/a.mjs',3],['README.md',5]]);
 await s.toggle('kona');assert.ok(s.row('x.swift'));
 await s.toggle('notes');assert.deepEqual(s.opened.at(-1),['notes',4]);assert.equal(s.row('notes').dataset.kind,'file');assert.deepEqual(s.errors,[]);
 await s.toggle('src',false);s.t.render();assert.equal('open' in s.row('src').attrs,false);assert.equal(s.reads.filter(p=>p==='src').length,1);
});
test('refresh keeps open folders that still exist; clear drops a late answer',async()=>{
 const tree={'':[{name:'src',type:'directory'},{name:'old',type:'directory'}],src:[{name:'a.mjs',type:'file'}],old:[]};
 const s=setup(tree);await s.t.reload();await s.toggle('src');await s.toggle('old');
 tree['']=[{name:'src',type:'directory'}];delete tree.old;
 assert.equal(await s.t.reload(),true);assert.ok(s.row('a.mjs'));assert.equal(s.row('old'),undefined);
 const late=s.t.reload();s.t.clear();assert.equal(await late,false);assert.deepEqual(items(s.list),[]);
 const broken=setup({});assert.equal(await broken.t.reload(),false);assert.deepEqual(broken.errors,['폴더를 열 수 없습니다.']);
});
test('every icon the tree can name is vendored',()=>{
 const names=['a.ts','b.tsx','c.jsx','Package.json','Dockerfile','.gitignore','LICENSE','x.mov','y.pdf','z.lock','.env.local','w.unknown','q.plist','m.h','n.hpp'].map(n=>iconName(n,'file'));
 for(const f of ['src','docs','tests','node_modules','.github','build','assets','random'])for(const o of [false,true])names.push(iconName(f,'directory',o));
 names.push(iconName('x','other'),iconName('x','other',true));
 for(const n of names)assert.ok(existsSync(new URL(`vendor/file-icons/${n}.svg`,import.meta.url)),n);
 assert.equal(iconName('.env.local','file'),'tune');assert.equal(iconName('w.unknown','file'),'file');
});
test('the selection a render makes does not open a file',async()=>{
 const s=setup({'':[{name:'README.md',type:'file',size:5}]});await s.t.reload();list_select(s,'README.md');assert.deepEqual(s.opened,[]);
 await new Promise(r=>setTimeout(r));list_select(s,'README.md');assert.deepEqual(s.opened,[['README.md',5]]);
});
