import {test} from 'node:test';import assert from 'node:assert/strict';
import {createReadRecovery,connectionFailure,desktopRelogin} from './reconnect.mjs';
test('restoration retries only its read callback, never duplicates concurrent retries',async()=>{
 let calls=0,finish,scheduled,states=[];const r=createReadRecovery({read:async()=>{calls++;if(calls===1)throw Error('offline');await new Promise(resolve=>finish=resolve);},schedule:fn=>{scheduled=fn;return 1;},cancel:()=>{},onState:s=>states.push(s)});
 await r.start();assert.equal(calls,1);assert.equal(states.at(-1),'unavailable');const second=r.start();await r.start();assert.equal(calls,2);finish();await second;assert.equal(states.at(-1),'ready');await scheduled();assert.equal(calls,2);
});
test('401/403/426 stop retries and invalidated old responses cannot report ready',async()=>{
 for(const status of [401,403,426]){let queued=0,states=[];const r=createReadRecovery({read:async()=>{throw Object.assign(Error(),{status});},schedule:()=>{queued++;},cancel:()=>{},onState:s=>states.push(s)});await r.start();assert.equal(queued,0);assert.equal(states.at(-1),status===426?'outdated':status===401?'expired':'denied');}
 let done,states=[];const r=createReadRecovery({read:()=>new Promise(resolve=>done=resolve),onState:s=>states.push(s)});const pending=r.start();r.stop();done();await pending;assert.ok(!states.includes('ready'));
 assert.equal(connectionFailure({status:404}),'denied');assert.equal(connectionFailure({status:503}),'unavailable');
});
test('an expired Mac app login reconnects at most once a minute',()=>{
 const m=new Map(),s={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};
 assert.equal(desktopRelogin(s,100000),true);assert.equal(desktopRelogin(s,130000),false);assert.equal(desktopRelogin(s,161000),true);
 assert.equal(desktopRelogin({getItem(){throw Error('blocked');}},0),false);
});
