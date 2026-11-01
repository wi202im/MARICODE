import test from 'node:test';import assert from 'node:assert/strict';
import {tailscaleCandidates,createDiscovery} from './discovery.mjs';
test('Tailscale candidates contain only online canonical DNS peers, no accounts or credentials',()=>{
 const result=tailscaleCandidates({BackendState:'Running',User:{secret:'private'},Peer:{a:{Online:true,DNSName:'mini.tail123.ts.net.',UserID:9},b:{Online:false,DNSName:'off.tail123.ts.net.'},c:{Online:true,DNSName:'evil.example.com.'},d:{Online:true,DNSName:'mini.tail123.ts.net.'},e:{Online:true,DNSName:'bad/path.tail123.ts.net'}}});
 assert.deepEqual(result,{state:'ready',candidates:[{name:'mini',host:'mini.tail123.ts.net'}]});
 assert.deepEqual(tailscaleCandidates({BackendState:'NeedsLogin'}),{state:'not-running',candidates:[]});assert.throws(()=>tailscaleCandidates({BackendState:'Running',Peer:[]}));
});
test('discovery only runs a fixed read-only command; concurrent and rapid queries share bounded result',async()=>{
 let calls=0,finish;const service=createDiscovery({binary:'/fixed/tailscale',execute:async(binary,args,options)=>{calls++;assert.equal(binary,'/fixed/tailscale');assert.deepEqual(args,['status','--json']);assert.equal(options.timeout,5000);return new Promise(r=>finish=r);}});
 const a=service.find(),b=service.find();await new Promise(r=>setImmediate(r));finish({stdout:'{"BackendState":"Running","Peer":null}'});assert.deepEqual(await a,{state:'ready',candidates:[]});await b;await service.find();assert.equal(calls,1);
});
test('failures return no raw CLI output and missing installation is distinct',async()=>{
 const a=createDiscovery({binary:'/fixed/tailscale',execute:async()=>{throw Object.assign(Error('private output'),{code:'ENOENT'});}});assert.deepEqual(await a.find(),{state:'not-installed',candidates:[]});
 const b=createDiscovery({binary:'/fixed/tailscale',execute:async()=>({stdout:'private broken json'})});assert.deepEqual(await b.find(),{state:'unavailable',candidates:[]});
});
for(const endpoint of ['/api/environment/discovery','/api/environment/discovery-lan'])test(endpoint+' is local nonce protected and requires remote role; denied requests never invoke CLI',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createServer}=await import('./server.mjs'),{createEnvironment}=await import('./environment.mjs');
 const dir=await mkdtemp(join(tmpdir(),'merry-discovery-')),file=join(dir,'env.json');let calls=0;const server=createServer({upstream:'http://127.0.0.1:1',sessions:[],environmentPath:file,origins:['https://mini.test'],clientOrigins:['http://127.0.0.1:61180'],discoveryService:{find:async()=>{calls++;return {state:'ready',candidates:[]};}},lanDiscoveryService:{find:async()=>{calls++;return {state:'ready',candidates:[]};}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();return rm(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`,env=createEnvironment(file),nonce=(await(await fetch(base+'/api/environment')).json()).nonce;
 const find=(headers={},method='GET')=>fetch(base+endpoint,{method,headers:{'x-setup-nonce':nonce,...headers}});
 assert.equal((await find()).status,403);await env.save({revision:0,roles:{local:true,server:false,remote:false}});assert.equal((await find()).status,403);await env.save({revision:1,roles:{local:true,server:true,remote:true}});
 for(const headers of [{'x-setup-nonce':'wrong'},{'x-forwarded-for':'100.1.2.3'},{origin:'http://127.0.0.1:61180'}])assert.equal((await find(headers)).status,403);
 const {get}=await import('node:http');const remote=await new Promise((resolve,reject)=>{get(base+endpoint,{headers:{host:'mini.test','x-setup-nonce':nonce}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(remote,403);
 assert.equal((await find({origin:base,'content-type':'application/json'},'POST')).status,405);assert.equal(calls,0);assert.equal((await find()).status,200);assert.equal(calls,1);
});
