import test from 'node:test';
import assert from 'node:assert/strict';
import {turnAlerts} from './turn-alerts.mjs';
const s=(thinking,requests={},active=true)=>({thinking,active,agentState:{requests}});
test('alerts fire for finished turns, new approvals and stopped runs outside the viewed conversation',()=>{
 const prev=new Map([['a',s(true)],['b',s(false)],['c',s(true)],['d',s(true)],['e',s(false)]]);
 const next=new Map([['a',s(false)],['b',s(false,{r1:{}})],['c',s(true)],['d',s(false,{},false)],['e',s(false)],['new',s(false)]]);
 assert.deepEqual(turnAlerts(prev,next,{selectedId:null,visible:true}),[{id:'a',kind:'done'},{id:'b',kind:'approval'},{id:'d',kind:'stopped'}]);
 assert.deepEqual(turnAlerts(prev,next,{selectedId:'a',visible:true}).map(x=>x.id),['b','d']);
 assert.deepEqual(turnAlerts(prev,next,{selectedId:'a',visible:false}).map(x=>x.id),['a','b','d']);
});

test('completion waits for the last background task and does not confuse session shutdown with completion',()=>{
 const foreground=s(true),background={...s(false),backgroundTaskCount:2};
 const check=(before,after)=>turnAlerts(new Map([['a',before]]),new Map([['a',after]]),{selectedId:'other',visible:true}).map(a=>a.kind);
 assert.deepEqual(check(foreground,background),[]);
 assert.deepEqual(check(background,{...background,backgroundTaskCount:1}),[]);
 assert.deepEqual(check(background,{...background,backgroundTaskCount:0}),['done']);
 assert.deepEqual(check(background,s(false,{},false)),['stopped']);
});
