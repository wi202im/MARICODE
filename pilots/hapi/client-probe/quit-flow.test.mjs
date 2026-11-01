import test from 'node:test';import assert from 'node:assert/strict';
import {createQuitFlow} from './quit-flow.mjs';
const session=id=>({id,active:true,thinking:false,metadataVersion:1,agentStateVersion:2,agentState:{controlledByUser:false},metadata:{name:'sample',flavor:'codex'}});
test('quit archives only the approved idle snapshot and completes only after inactive readback',async()=>{
 const states={a:session('a'),b:session('b')};let posts=[],done=0;
 const flow=createQuitFlow({list:async()=>Object.keys(states),read:async id=>states[id],archive:async(id,body)=>{posts.push([id,body]);states[id]={...states[id],active:false};},finish:()=>done++});
 const plan=await flow.review();assert.equal(plan.sessions.length,2);await flow.confirm(plan);
 assert.deepEqual(posts.map(p=>p[0]),['a','b']);assert.equal(done,1);await assert.rejects(flow.confirm(plan));assert.equal(posts.length,2);
});
test('changed or new sessions and pending approvals prevent any close request',async()=>{
 let states={a:session('a')},posts=0,done=0;
 const flow=createQuitFlow({list:async()=>Object.keys(states),read:async id=>states[id],archive:async()=>posts++,finish:()=>done++});
 let plan=await flow.review();states.b=session('b');await assert.rejects(flow.confirm(plan));assert.equal(posts,0);
 delete states.b;plan=await flow.review();states.a={...states.a,agentStateVersion:3};await assert.rejects(flow.confirm(plan));assert.equal(posts,0);
 states.a={...session('a'),agentState:{requests:{permission:{}}}};await assert.rejects(flow.review());assert.equal(done,0);
});
test('lost archive response is not replayed, including a new review',async()=>{
 const state=session('a');let posts=0,done=0;
 const flow=createQuitFlow({list:async()=>['a'],read:async()=>state,archive:async()=>{posts++;throw Error('lost');},finish:()=>done++});
 const plan=await flow.review();await assert.rejects(flow.confirm(plan));await assert.rejects(flow.confirm(plan));await assert.rejects(flow.review());assert.equal(posts,1);assert.equal(done,0);
});
