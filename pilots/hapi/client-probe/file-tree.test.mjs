import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createFileTree,iconName} from './file-tree.mjs';

function fakeDocument(){return {createElementNS(ns,tag){return this.createElement(tag);},createElement(tag){const n={tag,children:[],attrs:{},style:{},dataset:{},classes:new Set(),
 classList:{add(c){n.classes.add(c);}},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(k,v){this.attrs[k]=v;}};return n;}};}
const rows=n=>[...(n.tag==='button'&&n.className==='tree-row'?[n]:[]),...n.children.flatMap(rows)];
const label=r=>r.children[2].textContent,icon=r=>r.children[1].src.split('/').pop();
function setup(tree){
 const doc=fakeDocument(),list=doc.createElement('ul'),reads=[],opened=[],errors=[];
 const api=async path=>{const p=decodeURIComponent(path.split('path=')[1]);reads.push(p);if(!(p in tree))return {success:false};return {success:true,entries:tree[p]};};
 const t=createFileTree({api,base:()=>'/api/sessions/s',list,open:(p,size)=>opened.push([p,size]),error:e=>errors.push(e.message),active:()=>'src/a.mjs',document:doc});
 return {t,list,reads,opened,errors,row:name=>rows(list).find(r=>label(r)===name)};
}
const settle=()=>new Promise(r=>setTimeout(r));
test('folders expand in place with icons; files open with their size; links try folder then file',async()=>{
 const s=setup({'':[{name:'src',type:'directory'},{name:'kona',type:'other'},{name:'notes',type:'other'},{name:'README.md',type:'file',size:5}],src:[{name:'a.mjs',type:'file',size:3}],kona:[{name:'x.swift',type:'file'}]});
 await s.t.reload();
 assert.deepEqual(rows(s.list).map(r=>[label(r),icon(r)]),[['src','folder-src.svg'],['kona','folder-link.svg'],['notes','folder-link.svg'],['README.md','readme.svg']]);
 s.row('src').onclick();await settle();
 assert.equal(icon(s.row('src')),'folder-src-open.svg');assert.equal(s.row('src').attrs['aria-expanded'],'true');
 assert.equal(s.row('a.mjs').style.paddingLeft,'22px');assert.ok(s.row('a.mjs').classes.has('active'));
 s.row('a.mjs').onclick();s.row('README.md').onclick();assert.deepEqual(s.opened,[['src/a.mjs',3],['README.md',5]]);
 s.row('kona').onclick();await settle();assert.ok(s.row('x.swift'));
 s.row('notes').onclick();await settle();assert.deepEqual(s.opened.at(-1),['notes',undefined]);assert.deepEqual(s.errors,[]);
 s.row('src').onclick();assert.equal(s.row('a.mjs'),undefined);
 s.row('src').onclick();await settle();assert.equal(s.reads.filter(p=>p==='src').length,1);
});
test('refresh keeps open folders that still exist; clear drops a late answer',async()=>{
 const tree={'':[{name:'src',type:'directory'},{name:'old',type:'directory'}],src:[{name:'a.mjs',type:'file'}],old:[]};
 const s=setup(tree);await s.t.reload();s.row('src').onclick();await settle();s.row('old').onclick();await settle();
 tree['']=[{name:'src',type:'directory'}];delete tree.old;
 assert.equal(await s.t.reload(),true);assert.ok(s.row('a.mjs'));assert.equal(s.row('old'),undefined);
 const late=s.t.reload();s.t.clear();assert.equal(await late,false);assert.deepEqual(rows(s.list),[]);
 const broken=setup({});assert.equal(await broken.t.reload(),false);assert.deepEqual(broken.errors,['폴더를 열 수 없습니다.']);
});
test('every icon the tree can name is vendored',()=>{
 const names=['a.ts','b.tsx','c.jsx','Package.json','Dockerfile','.gitignore','LICENSE','x.mov','y.pdf','z.lock','.env.local','w.unknown','q.plist','m.h','n.hpp'].map(n=>iconName(n,'file'));
 for(const f of ['src','docs','tests','node_modules','.github','build','assets','random'])for(const o of [false,true])names.push(iconName(f,'directory',o));
 names.push(iconName('x','other'),iconName('x','other',true));
 for(const n of names)assert.ok(existsSync(new URL(`vendor/file-icons/${n}.svg`,import.meta.url)),n);
 assert.equal(iconName('.env.local','file'),'tune');assert.equal(iconName('w.unknown','file'),'file');
});
