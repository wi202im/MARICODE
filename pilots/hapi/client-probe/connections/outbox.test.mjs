import {test} from 'node:test';import assert from 'node:assert/strict';import {createOutbox} from './outbox.mjs';
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('lost response stays locked across reconnect and reload, isolated by server and session',async()=>{
 const storage=memory();let calls=0;const post=async()=>{calls++;throw Error('lost');};const a=createOutbox('https://a.local','same',storage,post);
 await assert.rejects(a.send('hello'));assert.equal(calls,1);const restored=createOutbox('https://a.local','same',storage,post);await assert.rejects(restored.send('hello'));assert.equal(calls,1);
 assert.equal(createOutbox('https://b.local','same',storage,post).pending,null);assert.equal(createOutbox('https://a.local','other',storage,post).pending,null);
 restored.reconcile([{localId:restored.pending.id,content:{role:'user',content:'hello'}}]);assert.equal(restored.pending,null);
});
test('double send calls transport once and broken storage prevents transport',async()=>{
 const storage=memory();let calls=0,finish,started;const ready=new Promise(r=>started=r);const a=createOutbox('https://a.local','s',storage,()=>{calls++;started();return new Promise(r=>finish=r);});const p=a.send('hello');await assert.rejects(a.send('hello'));await ready;assert.equal(calls,1);finish({ok:true});await p;assert.ok(a.pending);
 const broken=createOutbox('https://a.local','s',{getItem(){return null},setItem(){throw Error('storage')}},async()=>{calls++;});await assert.rejects(broken.send('hello'));assert.equal(calls,1);
});
test('explicit retry checks receipt and reuses ID only when absent',async()=>{
 const storage=memory();let first;const original=createOutbox('https://a.local','s',storage,async body=>{first=body;throw Error('lost');});await assert.rejects(original.send('hello'));
 const calls=[];const restored=createOutbox('https://a.local','s',storage,async(body,kind)=>{calls.push({kind,body});return kind==='state'?{queuedLocalIds:[],indeterminateLocalIds:[],invokedLocalMessages:[]}:{ok:true};});await restored.retry('hello');assert.deepEqual(calls.map(c=>c.kind),['state','send']);assert.equal(calls[1].body.localId,first.localId);
});
test('accepted, uncertain, bad response and changed text never replay',async()=>{
 for(const mode of ['queued','uncertain','bad','changed']){
  const storage=memory();const original=createOutbox('https://a.local','s',storage,async()=>{throw Error('lost');});await assert.rejects(original.send('hello'));const id=original.pending.id,calls=[];
  const restored=createOutbox('https://a.local','s',storage,async(body,kind)=>{calls.push(kind);return mode==='bad'?{}:{queuedLocalIds:mode==='queued'?[id]:[],indeterminateLocalIds:mode==='uncertain'?[id]:[],invokedLocalMessages:[]};});
  if(mode==='queued'){await restored.retry('hello');assert.equal(restored.pending,null);}else await assert.rejects(restored.retry(mode==='changed'?'different':'hello'));
  assert.deepEqual(calls,mode==='changed'?[]:['state']);
 }
});
