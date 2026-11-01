import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from './server.mjs';
test('install metadata and icons are served without caching or upstream authentication',async t=>{
 const server=createServer({upstream:'http://127.0.0.1:1',sessions:[]});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/manifest.webmanifest');assert.equal(r.status,200);
 assert.match(r.headers.get('content-type'),/application\/manifest\+json/);
 const m=await r.json();assert.equal(m.start_url,'/workspace');assert.equal(m.id,'/workspace');assert.equal(m.display,'standalone');
 for(const icon of m.icons){const r=await fetch(base+icon.src);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');const b=Buffer.from(await r.arrayBuffer());assert.equal(b.readUInt32BE(16),Number(icon.sizes.split('x')[0]));}
 for(const path of ['/workspace','/install','/app.mjs','/manifest.webmanifest']){const r=await fetch(base+path);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');}
 assert.match(await(await fetch(base+'/workspace')).text(),/rel="manifest"/);
});

test('incompatible workspace protocol is rejected before upstream writes',async t=>{
 const http=await import('node:http');let writes=0;
 const hub=http.createServer((req,res)=>{writes++;res.end('{}');});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,sessions:[]});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();hub.closeAllConnections();hub.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(base+'/api/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Merry-Protocol':'999'},body:'{}'});
 assert.equal(r.status,426);assert.equal(writes,0);assert.equal((await r.json()).rejected,true);
 const ok=await fetch(base+'/api/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Merry-Protocol':'1'},body:'{}'});assert.equal(ok.status,200);assert.equal(writes,1);
});
