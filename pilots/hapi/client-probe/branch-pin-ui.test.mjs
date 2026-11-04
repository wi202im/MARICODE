import test from 'node:test';import assert from 'node:assert/strict';
import {createBranchPin} from './branch-pin-ui.mjs';

function fakeDocument(){const nodes=[];return {nodes,createElement(tag){const n={tag,children:[],hidden:false,attrs:{},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(k,v){this.attrs[k]=v;},get lastChild(){return this.children.at(-1);}};nodes.push(n);return n;}};}
const find=(doc,text)=>doc.nodes.findLast(n=>n.tag==='button'&&n.textContent===text);
const sid='11111111-1111-4111-8111-111111111111';

test('a pinned session off its branches asks before sending; adding the branch sends',async()=>{
 const doc=fakeDocument(),posts=[];let repos=[{repo:'api',current:'main',branches:['main','feature/x']}],pin={repos:{api:['feature/x']}};
 const api=async(path,o)=>{if(o?.method==='POST'){posts.push(o.body);pin={repos:{api:[...pin.repos.api,o.body.branch]}};}const mismatches=repos.filter(r=>!pin.repos[r.repo].includes(r.current)).map(r=>({repo:r.repo,current:r.current,allowed:pin.repos[r.repo]}));return {pin,repos,mismatches};};
 const section=doc.createElement('section'),banner=doc.createElement('div'),ui=createBranchPin({api,section,banner,document:doc});
 const pending=ui.beforeSend(sid);await new Promise(r=>setTimeout(r));
 assert.equal(banner.hidden,false);assert.ok(doc.nodes.some(n=>n.textContent==='api 저장소가 main에 있습니다 (고정: feature/x)'));
 find(doc,'목록에 추가하고 보내기').onclick();assert.equal(await pending,'send');assert.deepEqual(posts,[{id:sid,action:'add',repo:'api',branch:'main'}]);
 assert.equal(await ui.beforeSend(sid),'send');
});
test('cancel keeps the message; an unpinned session sends without asking',async()=>{
 const doc=fakeDocument(),section=doc.createElement('section'),banner=doc.createElement('div');
 const ui=createBranchPin({api:async()=>({pin:{repos:{api:['x']}},repos:[{repo:'api',current:'y',branches:['x','y']}],mismatches:[{repo:'api',current:'y',allowed:['x']}]}),section,banner,document:doc});
 const pending=ui.beforeSend(sid);await new Promise(r=>setTimeout(r));find(doc,'취소').onclick();assert.equal(await pending,'cancel');
 const free=createBranchPin({api:async()=>({pin:null,repos:[],mismatches:[]}),section,banner,document:doc});assert.equal(await free.beforeSend(sid),'send');
});
test('after a turn, a branch the turn created shows its base and is added only on request',async()=>{
 const doc=fakeDocument(),posts=[];let repos=[{repo:'api',current:'feature/x',branches:['feature/x','main']}];
 const pin={repos:{api:['feature/x']}};
 const api=async(path,o)=>{if(o?.method==='POST')posts.push(o.body);const mismatches=repos.filter(r=>!pin.repos[r.repo].includes(r.current)).map(r=>({repo:r.repo,current:r.current,allowed:pin.repos[r.repo]}));return {pin,repos,mismatches};};
 const section=doc.createElement('section'),banner=doc.createElement('div'),ui=createBranchPin({api,section,banner,document:doc});
 assert.equal(await ui.beforeSend(sid),'send');
 repos=[{repo:'api',current:'feature/x-1',branches:['feature/x','feature/x-1','main']}];
 await ui.afterTurn(sid);
 assert.ok(doc.nodes.some(n=>n.textContent==='새 브랜치가 생겼습니다'));assert.ok(doc.nodes.some(n=>n.textContent==='api 저장소 · 새 브랜치 feature/x-1 — feature/x에서 분기'));
 assert.deepEqual(posts,[]);find(doc,'추가 안 함').onclick();assert.equal(banner.hidden,true);assert.deepEqual(posts,[]);
 await ui.afterTurn(sid);assert.equal(banner.hidden,true);
});
