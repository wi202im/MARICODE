import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountCardControls} from './account-card-ui.mjs';
function fixture(overrides={}){const nodes=[],saved=new Map();let starts=0,state='signed-out',pending=false,fail=false,valid=true,returned=0;
 const document={createElement(tag){const n={tag,children:[],append(...v){this.children.push(...v);},setAttribute(){}};nodes.push(n);return n;}};
 const flow=createAccountCardControls({agent:'claude',document,valid:()=>valid,storage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},settings:()=>{},back:()=>returned++,api:async(path,opt)=>{if(opt){starts++;if(fail)throw Error('lost');pending=true;return {state,loginPending:true};}return {localLogin:true,providers:[{agent:'claude',state,loginPending:pending}]};},...overrides});
 return {flow,nodes,button:text=>nodes.find(n=>n.tag==='button'&&n.textContent===text),get starts(){return starts;},get returned(){return returned;},state:v=>state=v,pending:v=>pending=v,fail:()=>fail=true,invalidate:()=>valid=false,saved};}
test('account card starts official login only after status check and explicit click, then returns without sending or resuming',async()=>{const f=fixture();assert.equal(f.button('공식 로그인 시작').disabled,true);await f.flow.load();assert.equal(f.starts,0);await f.button('공식 로그인 시작').onclick();assert.equal(f.starts,1);await f.button('공식 로그인 시작').onclick();assert.equal(f.starts,1);f.state('connected');f.pending(false);await f.flow.load();assert.equal(f.button('공식 로그인 시작').hidden,true);f.button('대화로 돌아가기').onclick();assert.equal(f.returned,1);});
test('unknown login response never retries, including after a signed-out status without finished phase',async()=>{const f=fixture();await f.flow.load();f.fail();await f.button('공식 로그인 시작').onclick();await f.flow.load();await f.button('공식 로그인 시작').onclick();assert.equal(f.starts,1);assert.equal(f.saved.size,1);assert.ok(f.nodes.some(n=>n.textContent?.includes('미확인')));});
test('changed session and nonlocal or other authentication cannot start login',async()=>{const f=fixture();await f.flow.load();f.invalidate();await f.button('공식 로그인 시작').onclick();assert.equal(f.starts,0);for(const state of ['other-auth','unknown','connection-required']){const g=fixture();g.state(state);await g.flow.load();assert.equal(g.button('공식 로그인 시작').disabled,true);}});
test('late status from old session does not overwrite controls',async()=>{let finish;const f=fixture({api:()=>new Promise(r=>finish=r)});const p=f.flow.load();f.invalidate();finish({localLogin:true,providers:[{agent:'claude',state:'connected'}]});await p;assert.equal(f.button('공식 로그인 시작').disabled,true);});

test('remote status and missing provider cannot enable login and unknown marker survives a recreated card',async()=>{
 const remote=fixture({api:async()=>({localLogin:false,providers:[{agent:'claude',state:'signed-out'}]})});await remote.flow.load();assert.equal(remote.button('공식 로그인 시작').disabled,true);
 const first=fixture();await first.flow.load();first.fail();await first.button('공식 로그인 시작').onclick();let starts=0;
 const second=fixture({storage:{getItem:k=>first.saved.get(k)},api:async(path,opt)=>{if(opt)starts++;return {localLogin:true,providers:[{agent:'claude',state:'signed-out'}]};}});await second.flow.load();await second.button('공식 로그인 시작').onclick();assert.equal(starts,0);
});

test('Codex login keeps its own agent and permits retry only after a known finished failure',async()=>{
 let posts=0,phase=null;const f=fixture({agent:'codex',api:async(path,opt)=>{if(opt){assert.equal(path,'/api/accounts/codex/login');posts++;throw Error('lost');}return {localLogin:true,providers:[{agent:'codex',state:'signed-out',loginPhase:phase}]};}});
 await f.flow.load();await f.button('공식 로그인 시작').onclick();await f.flow.load();assert.equal(f.button('공식 로그인 시작').disabled,true);phase='finished';await f.flow.load();assert.equal(posts,1);assert.equal(f.button('공식 로그인 시작').disabled,false);
});
