import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {remoteOrigin,saveRemoteOrigin,readRemoteOrigin} from './remote-config.mjs';
test('remote endpoint accepts only explicit Tailscale HTTPS origins without credentials or paths',()=>{
 assert.equal(remoteOrigin('https://mini.tail123.ts.net:8445/'),'https://mini.tail123.ts.net:8445');
 for(const value of ['http://mini.tail123.ts.net','https://evil.example','https://mini.tail123.ts.net/path','https://x:secret@mini.tail123.ts.net','https://mini.tail123.ts.net/?token=x','https://mini.tail123.ts.net/#x'])assert.throws(()=>remoteOrigin(value));
});
test('endpoint changes require stopped runtime and matching prior value, and can be disabled',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'merry-remote-'));try{
 assert.equal(await readRemoteOrigin(directory),null);
 const origin='https://mini.tail123.ts.net:8445';
 await saveRemoteOrigin({directory,origin,expected:null});assert.equal(await readRemoteOrigin(directory),origin);
 await assert.rejects(saveRemoteOrigin({directory,origin:null,expected:null}));
 await mkdir(join(directory,'web.lock'));await assert.rejects(saveRemoteOrigin({directory,origin:null,expected:origin}));await rm(join(directory,'web.lock'),{recursive:true});
 await saveRemoteOrigin({directory,origin:null,expected:origin});assert.equal(await readRemoteOrigin(directory),null);
 assert.equal(JSON.parse(await readFile(join(directory,'remote.json'),'utf8')).origin,null);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('desktop forwards only the saved origin and keeps remote machine APIs disabled in local mode',async()=>{
 const {startDesktopWeb}=await import('./runtime.mjs');const {createEnvironment}=await import('../../pilots/hapi/client-probe/environment.mjs');
 const directory=await mkdtemp(join(tmpdir(),'merry-origin-'));let runtime;
 try{
 const origin='https://mini.tail123.ts.net:8445';await saveRemoteOrigin({directory,origin,expected:null});
 await createEnvironment(join(directory,'environment.json')).save({revision:0,roles:{local:true,server:false,remote:false}});
 runtime=await startDesktopWeb({directory,port:0});
 const request=(path,headers)=>new Promise((resolve,reject)=>{http.get(runtime.url+path,{headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});
 assert.equal(await request('/workspace',{host:new URL(origin).host}),403);
 assert.equal(await request('/workspace',{host:'other.tail123.ts.net:8445'}),403);
 assert.equal(await request('/api/sessions',{host:new URL(origin).host,origin}),403);
 assert.equal(await request('/api/environment',{host:new URL(origin).host,origin}),403);
 await createEnvironment(join(directory,'environment.json')).save({revision:1,roles:{local:true,server:true,remote:false}});
 assert.equal(await request('/workspace',{host:new URL(origin).host}),200);
 assert.equal(await request('/workspace',{host:'other.tail123.ts.net:8445'}),403);
 assert.equal(await request('/api/environment',{host:new URL(origin).host,origin}),403);
 }finally{await runtime?.close();await rm(directory,{recursive:true,force:true});}
});

test('startup discovers this Mac only when access is enabled and no address decision exists',async t=>{
 const {startDesktopWeb}=await import('./runtime.mjs');const {createEnvironment}=await import('../../pilots/hapi/client-probe/environment.mjs');
 const {writeFile,stat}=await import('node:fs/promises');
 for(const [name,server,saved,status,expected,calls] of [
  ['new server',true,undefined,{BackendState:'Running',Self:{DNSName:'mini.tail123.ts.net.'}},'https://mini.tail123.ts.net',1],
  ['local only',false,undefined,{BackendState:'Running',Self:{DNSName:'mini.tail123.ts.net.'}},null,0],
  ['custom port',true,'https://mini.tail123.ts.net:8445',{},'https://mini.tail123.ts.net:8445',0],
  ['explicit unregister',true,null,{},null,0],
  ['stopped Tailscale',true,undefined,{BackendState:'Stopped',Self:{DNSName:'mini.tail123.ts.net.'}},null,1],
  ['invalid name',true,undefined,{BackendState:'Running',Self:{DNSName:'evil.example.'}},null,1],
  ['unavailable tool',true,undefined,null,null,1]
 ])await t.test(name,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'maricode-auto-origin-'));let runtime,count=0;
  try{
   await createEnvironment(join(directory,'environment.json')).save({revision:0,roles:{local:true,server,remote:false}});
   if(saved!==undefined)await writeFile(join(directory,'remote.json'),JSON.stringify({version:1,origin:saved}));
   runtime=await startDesktopWeb({directory,port:0,tailscaleStatus:async()=>{count++;await stat(join(directory,'web.lock'));if(status===null)throw Error('offline');return status;}});
   assert.equal(count,calls);assert.equal(await readRemoteOrigin(directory),expected);assert.equal(runtime.remotePhase,'stopped');
   if(saved===undefined&&expected===null)await assert.rejects(stat(join(directory,'remote.json')),e=>e.code==='ENOENT');
   if(name==='new server'){
    assert.equal((await stat(join(directory,'remote.json'))).mode&0o777,0o600);
    const response=await new Promise((resolve,reject)=>http.get(runtime.url+'/workspace',{headers:{host:'mini.tail123.ts.net'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));}).on('error',reject));
    assert.equal(response,200);await runtime.close();runtime=null;
    runtime=await startDesktopWeb({directory,port:0,tailscaleStatus:async()=>{throw Error('must not rediscover');}});assert.equal(await readRemoteOrigin(directory),expected);
   }
  }finally{await runtime?.close();await rm(directory,{recursive:true,force:true});}
 });
});

test('pairing preparation discovers and starts once after enabling access, preserving unknown forwarding',async t=>{
 const {startDesktopWeb}=await import('./runtime.mjs');const {createEnvironment}=await import('../../pilots/hapi/client-probe/environment.mjs');const {writeFile}=await import('node:fs/promises');
 const directory=await mkdtemp(join(tmpdir(),'maricode-pair-ready-'));let runtime,starts=0,phase='stopped',release;
 const gate=new Promise(r=>release=r),environment=createEnvironment(join(directory,'environment.json'));
 try{
  await environment.save({revision:0,roles:{local:true,server:false,remote:false}});
  await writeFile(join(directory,'backend.json'),JSON.stringify({version:1,binary:'/bin/echo'}));
  runtime=await startDesktopWeb({directory,port:0,tailscaleStatus:async()=>{await gate;return {BackendState:'Running',Self:{DNSName:'mini.tail123.ts.net.'}};}},{
   backend:async()=>({upstream:'http://127.0.0.1:1',authenticate:async()=>'fixture',close:async()=>{}}),
   forward:()=>({get phase(){return phase;},start:async()=>{starts++;phase='running';},stop:async()=>{phase='stopped';}})
  });
  await assert.rejects(runtime.prepareRemote());assert.equal(starts,0);
  await environment.save({revision:1,roles:{local:true,server:true,remote:false}});
  const preparing=runtime.prepareRemote();await assert.rejects(runtime.prepareRemote());release();await preparing;
  assert.equal(starts,1);assert.equal(runtime.remotePhase,'running');await runtime.prepareRemote();assert.equal(starts,1);
  assert.equal(await readRemoteOrigin(directory),'https://mini.tail123.ts.net');
  phase='unknown';await assert.rejects(runtime.prepareRemote());assert.equal(starts,1);
  await environment.save({revision:2,roles:{local:true,server:false,remote:false}});
  phase='running';await assert.rejects(runtime.prepareRemote());assert.equal(starts,1);
 }finally{release();await runtime?.close();await rm(directory,{recursive:true,force:true});}
});
