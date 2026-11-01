import {test} from 'node:test';import assert from 'node:assert/strict';
import {createTrialServer} from './server.mjs';
test('local HTTP boundary, session ownership and fixture-only submission',async t=>{
 const s=createTrialServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());const base=`http://127.0.0.1:${s.address().port}`;
 const page=await fetch(base);const cookie=page.headers.get('set-cookie').split(';')[0];
 const state=await (await fetch(base+'/state',{headers:{cookie}})).json();
 const headers={cookie,origin:base,'content-type':'application/json','x-trial-csrf':state.csrf};
 const post=(path,data,extra={})=>fetch(base+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
 assert.equal((await post('/start',{engine:'codex'},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await post('/start',{engine:'codex'},{'x-trial-csrf':''})).status,403);
 assert.equal((await fetch(base+'/state?token=not-a-secret',{headers:{cookie}})).status,400);
 const r=await (await post('/start',{engine:'codex'})).json();
 assert.equal((await post('/submit',{id:r.id,password:'not-allowed',otp:'123456'})).status,409);
 assert.equal((await post('/submit',{id:r.id,password:'demo-only',otp:'123456'})).status,200);
 assert.equal((await post('/submit',{id:r.id,password:'demo-only',otp:'123456'})).status,409);
 const end=await(await fetch(base+'/state',{headers:{cookie}})).json();assert.equal(end.requests[0].state,'completed');assert.equal(end.requests[0].targetSignedIn,true);assert.ok(!JSON.stringify(end).includes('demo-only'));
 const page2=await fetch(base);const cookie2=page2.headers.get('set-cookie').split(';')[0];const state2=await(await fetch(base+'/state',{headers:{cookie:cookie2}})).json();
 assert.equal((await post('/cancel',{id:r.id},{cookie:cookie2,'x-trial-csrf':state2.csrf})).status,404);
});
