import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createFileTree,iconName} from './file-tree.mjs';

function fakeDocument(){return {createElement(tag){const n={tag,children:[],attrs:{},dataset:{},
 append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
 closest(sel){return sel==='wa-tree-item'&&tag==='wa-tree-item'?this:null;},querySelector(){return this.children.find(c=>c.className==='tree-icon');},
 handlers:{},addEventListener(type,f){this.handlers[type]=f;}};return n;}};}
const items=n=>[...(n.tag==='wa-tree-item'?[n]:[]),...n.children.flatMap(items)];
const label=r=>r.children[1].textContent,icon=r=>r.children[0].src.split('/').pop();
function setup(tree){
 const doc=fakeDocument(),list=doc.createElement('wa-tree'),reads=[],opened=[],errors=[];
 const api=async path=>{const p=decodeURIComponent(path.split('path=')[1]);reads.push(p);if(!(p in tree))return {success:false};return {success:true,entries:tree[p]};};
 const t=createFileTree({api,base:()=>'/api/sessions/s',list,open:(p,size)=>opened.push([p,size]),error:e=>errors.push(e.message),active:()=>'src/a.mjs',document:doc});
 const row=name=>items(list).find(r=>label(r)===name),fire=(type,name)=>list.handlers[type]({target:row(name)});
 return {t,list,reads,opened,errors,row,fire};
}
const settle=()=>new Promise(r=>setTimeout(r));
test('folders load on first expand with icons; files open with their size; links try folder then file',async()=>{
 const s=setup({'':[{name:'src',type:'directory'},{name:'kona',type:'other'},{name:'notes',type:'other',size:4},{name:'README.md',type:'file',size:5}],src:[{name:'a.mjs',type:'file',size:3}],kona:[{name:'x.swift',type:'file'}]});
 await s.t.reload();
 assert.deepEqual(items(s.list).map(r=>[label(r),icon(r),'lazy' in r.attrs]),[['src','folder-src.svg',true],['kona','folder-link.svg',true],['notes','folder-link.svg',true],['README.md','readme.svg',false]]);
 s.fire('wa-lazy-load','src');await settle();
 assert.equal(icon(s.row('src')),'folder-src-open.svg');assert.ok('expanded' in s.row('src').attrs);assert.ok('selected' in s.row('a.mjs').attrs);
 s.fire('click','a.mjs');s.fire('click','README.md');s.fire('click','src');assert.deepEqual(s.opened,[['src/a.mjs',3],['README.md',5]]);
 s.fire('wa-lazy-load','kona');await settle();assert.ok(s.row('x.swift'));
 s.fire('wa-lazy-load','notes');await settle();assert.deepEqual(s.opened.at(-1),['notes',4]);assert.equal(s.row('notes').dataset.kind,'file');assert.deepEqual(s.errors,[]);
 s.fire('wa-collapse','src');assert.equal(icon(s.row('src')),'folder-src.svg');
 s.t.render();assert.equal('expanded' in s.row('src').attrs,false);assert.equal(s.reads.filter(p=>p==='src').length,1);
});
test('refresh keeps open folders that still exist; clear drops a late answer',async()=>{
 const tree={'':[{name:'src',type:'directory'},{name:'old',type:'directory'}],src:[{name:'a.mjs',type:'file'}],old:[]};
 const s=setup(tree);await s.t.reload();s.fire('wa-lazy-load','src');await settle();s.fire('wa-lazy-load','old');await settle();
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
