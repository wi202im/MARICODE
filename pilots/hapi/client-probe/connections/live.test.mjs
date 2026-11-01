import {test} from 'node:test';import assert from 'node:assert/strict';import {createSessionStream} from './live.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('SSE reads only the selected session and reconnects with reads, never sends',async()=>{
 let stream,reads=0;const calls=[],timers=[],states=[];
 const live=createSessionStream({origin:'https://a.local',id:'one',token:'synthetic',read:async()=>{reads++;return true;},onState:s=>states.push(s),schedule:fn=>{timers.push(fn);return fn;},cancel:()=>{},fetcher:async(url,opts)=>{calls.push({url,opts});return {ok:true,body:new ReadableStream({start(c){stream=c;}})};}});
 live.start();await tick();assert.equal(reads,1);stream.enqueue(new TextEncoder().encode('data: {"type":"message-received","sessionId":"other"}\n\n'));await tick();assert.equal(reads,1);stream.enqueue(new TextEncoder().encode('data: {"type":"message-received","sessionId":"one"}\n\n'));await tick();assert.equal(reads,2);stream.close();await tick();assert.equal(states.at(-1),'reconnecting');timers.at(-1)();await tick();assert.equal(reads,3);assert.equal(calls.length,2);for(const c of calls){assert.ok(c.url.endsWith('/api/events?sessionId=one'));assert.equal(c.opts.method,'GET');assert.equal(c.opts.credentials,'omit');assert.equal(c.opts.redirect,'error');}live.stop();
});
test('401 stops retries and stopping ignores a late stream response',async()=>{
 let failure,scheduled=0;const live=createSessionStream({origin:'https://a.local',id:'one',token:'synthetic',read:async()=>true,onFailure:s=>failure=s,schedule:()=>{scheduled++;},fetcher:async()=>({ok:false,status:401})});live.start();await tick();assert.equal(failure,401);assert.equal(scheduled,0);
 let finish,reads=0;const late=createSessionStream({origin:'https://a.local',id:'one',token:'synthetic',read:async()=>{reads++;},fetcher:()=>new Promise(r=>finish=r)});late.start();late.stop();finish({ok:true,body:new ReadableStream({start(c){c.close();}})});await tick();assert.equal(reads,0);
});
test('one server auth failure does not stop another server with the same session ID',async()=>{
 let controller,reads=0;const states=[];
 const a=createSessionStream({origin:'https://a.local',id:'same',token:'a',read:async()=>true,fetcher:async()=>({ok:false,status:403})});
 const b=createSessionStream({origin:'https://b.local',id:'same',token:'b',onState:s=>states.push(s),read:async()=>{reads++;return true;},fetcher:async()=>({ok:true,body:new ReadableStream({start(c){controller=c;}})})});a.start();b.start();await tick();controller.enqueue(new TextEncoder().encode('data: {"type":"message-received","sessionId":"same"}\n\n'));await tick();assert.equal(reads,2);assert.equal(states.at(-1),'live');b.stop();
});
