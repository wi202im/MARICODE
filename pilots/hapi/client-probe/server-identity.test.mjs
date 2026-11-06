import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {serverIdentity} from './server-identity.mjs';
test('persistent identity is stable, concurrent creation converges and corruption is not reset',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-identity-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'id');
 const ids=await Promise.all(Array.from({length:4},()=>serverIdentity(path)));assert.equal(new Set(ids).size,1);assert.equal(await serverIdentity(path),ids[0]);await writeFile(path,'broken');await assert.rejects(()=>serverIdentity(path));
});
test('identity endpoint follows the device-access setting and mismatched identity never reaches Hub',async t=>{
 const {createServer}=await import('./server.mjs'),{createEnvironment}=await import('./environment.mjs'),http=await import('node:http');
 const root=await mkdtemp(join(tmpdir(),'merry-id-route-')),path=join(root,'machine.json');let forwarded=0;
 const hub=http.createServer((q,r)=>{forwarded++;r.end('{}');});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,environmentPath:path,sessions:[],origins:['https://mini.test.ts.net']});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const s of [proxy,hub]){s.closeAllConnections();s.close();}return rm(root,{recursive:true,force:true});});const base=`http://127.0.0.1:${proxy.address().port}`,env=createEnvironment(path);
 // A remote browser reaches this Mac through the registered HTTPS address (Tailscale Serve sets Host).
 const remote=()=>new Promise((resolve,reject)=>http.get(base+'/api/server-identity',{headers:{host:'mini.test.ts.net'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
 assert.equal((await fetch(base+'/api/server-identity')).status,403);await env.save({revision:0,roles:{local:true,remote:false,server:false}});
 const id=(await(await fetch(base+'/api/server-identity')).json()).serverId;assert.equal(await serverIdentity(path+'.identity.json'),id);
 assert.equal(await remote(),403);
 await env.save({revision:1,roles:{local:true,remote:false,server:true}});
 assert.equal(await remote(),200);
 assert.equal((await fetch(base+'/api/server-identity?token=no')).status,405);
 const post=id=>fetch(base+'/api/auth',{method:'POST',headers:{origin:base,'content-type':'application/json','x-merry-server-id':id},body:'{}'});
 assert.equal((await post('wrong')).status,403);assert.equal(forwarded,0);assert.equal((await post(id)).status,200);assert.equal(forwarded,1);
});
