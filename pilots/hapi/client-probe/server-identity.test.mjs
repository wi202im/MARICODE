import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {serverIdentity} from './server-identity.mjs';
import {identityTransport} from './connections/identity.mjs';
test('persistent identity is stable, concurrent creation converges and corruption is not reset',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-identity-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'id');
 const ids=await Promise.all(Array.from({length:4},()=>serverIdentity(path)));assert.equal(new Set(ids).size,1);assert.equal(await serverIdentity(path),ids[0]);await writeFile(path,'broken');await assert.rejects(()=>serverIdentity(path));
});
test('identity transport pins only successful login, blocks changed server before credentials and redirects',async()=>{
 const origin='https://mini.test.ts.net',a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';let id=a,ok=false,posts=0;const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const fetcher=async(url,o)=>{assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');if(url.endsWith('/api/server-identity')){assert.equal(o.headers,undefined);return {ok:true,json:async()=>({serverId:id})};}posts++;assert.equal(o.headers['X-Merry-Server-Id'],id);return {ok,status:ok?200:401};};
 const transport=identityTransport(origin,{storage,fetcher});await transport(origin+'/api/auth',{method:'POST',body:'synthetic'});assert.equal(map.size,0);ok=true;await transport(origin+'/api/auth',{method:'POST',body:'synthetic'});assert.equal(map.size,1);
 id=b;await assert.rejects(()=>transport(origin+'/api/auth',{method:'POST',body:'secret'}));assert.equal(posts,2);await assert.rejects(()=>transport('https://other.test.ts.net/config',{}));assert.equal(posts,2);
});
test('identity transport rejects storage failures and abort before sending credentials',async()=>{
 const origin='https://mini.test.ts.net';let posts=0,blocked=0;const controller=new AbortController();
 const fetcher=async url=>{if(url.endsWith('/api/server-identity')){controller.abort();return {ok:true,json:async()=>({serverId:'00000000-0000-0000-0000-000000000001'})};}posts++;};
 const transport=identityTransport(origin,{storage:{getItem:()=>null,setItem:()=>{}},fetcher,onBlocked:()=>blocked++});await assert.rejects(()=>transport(origin+'/api/auth',{signal:controller.signal}));assert.equal(posts,0);assert.equal(blocked,0);
});
test('identity endpoint obeys roles/origins and mismatched identity never reaches Hub',async t=>{
 const {createServer}=await import('./server.mjs'),{createEnvironment}=await import('./environment.mjs'),http=await import('node:http');
 const root=await mkdtemp(join(tmpdir(),'merry-id-route-')),path=join(root,'machine.json');let forwarded=0;
 const hub=http.createServer((q,r)=>{forwarded++;r.end('{}');});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,environmentPath:path,sessions:[],clientOrigins:['http://127.0.0.1:61180']});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const s of [proxy,hub]){s.closeAllConnections();s.close();}return rm(root,{recursive:true,force:true});});const base=`http://127.0.0.1:${proxy.address().port}`,env=createEnvironment(path);
 assert.equal((await fetch(base+'/api/server-identity')).status,403);await env.save({revision:0,roles:{local:true,remote:false,server:false}});
 const id=(await(await fetch(base+'/api/server-identity')).json()).serverId;assert.equal(await serverIdentity(path+'.identity.json'),id);
 assert.equal((await fetch(base+'/api/server-identity',{headers:{origin:'http://127.0.0.1:61180'}})).status,403);
 await env.save({revision:1,roles:{local:true,remote:false,server:true}});
 const r=await fetch(base+'/api/server-identity',{headers:{origin:'http://127.0.0.1:61180'}});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'http://127.0.0.1:61180');
 assert.equal((await fetch(base+'/api/server-identity?token=no')).status,405);
 const post=id=>fetch(base+'/api/auth',{method:'POST',headers:{origin:base,'content-type':'application/json','x-merry-server-id':id},body:'{}'});
 assert.equal((await post('wrong')).status,403);assert.equal(forwarded,0);assert.equal((await post(id)).status,200);assert.equal(forwarded,1);
});

test('abort after auth response cannot disconnect a newer connection or pin identity',async()=>{
 const origin='https://mini.test.ts.net',c=new AbortController();let blocked=0,saved=0;
 const transport=identityTransport(origin,{storage:{getItem:()=>null,setItem:()=>saved++},onBlocked:()=>blocked++,fetcher:async url=>{if(url.endsWith('/api/server-identity'))return {ok:true,json:async()=>({serverId:'00000000-0000-0000-0000-000000000001'})};c.abort();return {ok:true};}});
 await assert.rejects(()=>transport(origin+'/api/auth',{signal:c.signal}));assert.equal(blocked,0);assert.equal(saved,0);
});
test('explicit identity review changes only the displayed pair and sends no credentials',async()=>{
 const {reviewServerIdentity,acceptServerIdentity}=await import('./connections/identity.mjs');
 const origin='https://mini.test.ts.net',a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002',c='00000000-0000-0000-0000-000000000003';
 let pinned=a,id=b,writes=0;const storage={getItem:()=>pinned,setItem:(_,v)=>{writes++;pinned=v;}};
 const fetcher=async(url,o)=>{assert.equal(url,origin+'/api/server-identity');assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');assert.equal(o.headers,undefined);return {ok:true,json:async()=>({serverId:id})};};
 const review=await reviewServerIdentity(origin,{storage,fetcher});assert.deepEqual(review,{origin,previous:a,current:b});assert.equal(writes,0);
 id=c;await assert.rejects(()=>acceptServerIdentity(review,{storage,fetcher}));assert.equal(writes,0);
 id=b;pinned=c;await assert.rejects(()=>acceptServerIdentity(review,{storage,fetcher}));assert.equal(writes,0);
 pinned=a;await acceptServerIdentity(review,{storage,fetcher});assert.equal(pinned,b);assert.equal(writes,1);
 await assert.rejects(()=>acceptServerIdentity(review,{storage,fetcher}));assert.equal(writes,1);
});
