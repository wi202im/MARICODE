import http from 'node:http';
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createEnvironment,canUseMachine} from './environment.mjs';
test('first launch, this Mac always works locally, other-device access is the only choice, stale update rejected',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mari-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'machine.json');const e=createEnvironment(path);
 assert.equal((await e.read()).configured,false);
 const a=await e.save({revision:0,roles:{local:true,server:true,remote:false}});assert.deepEqual(a.roles,{local:true,server:true,remote:false});
 assert.deepEqual(await createEnvironment(path).read(),a);
 await assert.rejects(e.save({revision:0,roles:{local:true,server:false,remote:false}}));
 // The remote role is gone: it cannot be saved, and a remote-only machine is not local.
 await assert.rejects(e.save({revision:1,roles:{local:true,server:false,remote:true}}),/브라우저/);
 await assert.rejects(e.save({revision:1,roles:{local:false,server:false,remote:true}}),/브라우저/);
 const b=await e.save({revision:1,roles:{local:true,server:false,remote:false}});assert.equal(canUseMachine(b,true),true);assert.equal(canUseMachine(b,false),false);
 await writeFile(path,'broken');await assert.rejects(e.read());
});
test('an older remote-only machine starts over at first setup; older saved remote flags are dropped',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mari-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'machine.json');const e=createEnvironment(path);
 await writeFile(path,JSON.stringify({version:1,revision:4,roles:{local:false,server:false,remote:true}}));
 const old=await e.read();assert.equal(old.configured,false);assert.equal(old.revision,4);assert.equal(canUseMachine(old,true),false);
 assert.deepEqual((await e.save({revision:4,roles:{local:true,server:false,remote:false}})).roles,{local:true,server:false,remote:false});
 await writeFile(path,JSON.stringify({version:1,revision:7,roles:{local:true,server:true,remote:true}}));
 assert.deepEqual((await e.read()).roles,{local:true,server:true,remote:false});
});
test('machine access enforces role, and concurrent settings cannot overwrite',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mari-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));const e=createEnvironment(join(dir,'machine.json'));
 const results=await Promise.allSettled([e.save({revision:0,roles:{local:true,server:false,remote:false}}),e.save({revision:0,roles:{local:false,server:true,remote:false}})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const local={configured:true,roles:{local:true,server:false,remote:false}};
 assert.equal(canUseMachine(local,true),true);assert.equal(canUseMachine(local,false),false);assert.equal(canUseMachine({configured:false},true),false);
});

test('proxy requires setup, gates local/remote traffic and keeps settings local',async t=>{
 const {createServer}=await import('./server.mjs');const dir=await mkdtemp(join(tmpdir(),'mari-env-'));const file=join(dir,'machine.json');
 const s=createServer({upstream:'http://127.0.0.1:1',sessionId:'00000000-0000-0000-0000-000000000000',environmentPath:file,origins:['https://mini.test']});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();return rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${s.address().port}`;
 const remote=path=>new Promise((resolve,reject)=>{http.get(base+path,{headers:{host:'mini.test'}},res=>{res.resume();resolve({status:res.statusCode});}).on('error',reject);});
 assert.equal((await fetch(base+'/workspace',{redirect:'manual'})).headers.get('location'),'/setup');
 assert.equal((await remote('/config')).status,403);
 for(const asset of ['/theme.css','/settings.css']) {
  assert.equal((await fetch(base+asset)).status,200);
  assert.equal((await remote(asset)).status,200);
 }
 const config=await(await fetch(base+'/api/environment')).json();assert.equal(config.aiConfigurationRegistered,false);
 const save=(revision,roles,extra={})=>fetch(base+'/api/environment',{method:'POST',headers:{origin:base,'content-type':'application/json','x-setup-nonce':config.nonce,...extra},body:JSON.stringify({revision,roles})});
 assert.equal((await save(0,{local:true,server:false,remote:false},{'x-setup-nonce':'bad'})).status,403);
 assert.equal((await save(0,{local:true,server:false,remote:false})).status,200);
 assert.equal((await fetch(base+'/config')).status,200);
 assert.equal((await remote('/config')).status,403);
 assert.equal((await remote('/api/environment')).status,403);
 assert.equal((await fetch(base+'/api/environment',{headers:{'x-forwarded-for':'100.1.1.1'}})).status,403);
 assert.equal((await save(1,{local:true,server:true,remote:false})).status,200);
 assert.equal((await remote('/config')).status,200);
 assert.equal((await save(2,{local:true,server:false,remote:true})).status,409);
 assert.equal((await save(2,{local:true,server:false,remote:false})).status,200);
 assert.equal((await remote('/config')).status,403);
 assert.equal((await fetch(base+'/setup')).status,200);
 for(const asset of ['/theme.css','/settings.css'])assert.equal((await fetch(base+asset)).status,200);
 assert.equal((await remote('/setup/style.css')).status,403);
 assert.equal((await remote('/api/environment')).status,403);
});

test('remote workspace never offers execution-machine setup links',async t=>{
 const {createServer}=await import('./server.mjs');const dir=await mkdtemp(join(tmpdir(),'mari-remote-ui-')),file=join(dir,'machine.json');
 await createEnvironment(file).save({revision:0,roles:{local:true,server:true,remote:false}});
 const s=createServer({upstream:'http://127.0.0.1:1',sessions:[],environmentPath:file,origins:['https://mini.test']});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();return rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${s.address().port}`;
 const local=await(await fetch(base+'/workspace')).text();assert.match(local,/href="\/setup"/);assert.match(local,/data-machine-setup="true"/);
 for(const headers of [{host:'mini.test'},{'x-forwarded-for':'100.1.1.1'}]){
  const page=await new Promise((resolve,reject)=>http.get(base+'/workspace',{headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve(body));}).on('error',reject));
  assert.doesNotMatch(page,/href="\/setup"/);assert.doesNotMatch(page,/data-machine-setup="true"/);
 }
});

test('initial AI setup needs local role and nonce, cannot change an existing login',async t=>{
 const {createServer}=await import('./server.mjs');const dir=await mkdtemp(join(tmpdir(),'mari-ai-'));let starts=0;
 const s=createServer({upstream:'http://127.0.0.1:1',sessionId:'00000000-0000-0000-0000-000000000000',environmentPath:join(dir,'machine.json'),accountsService:{status:async()=>({state:'connected',loginPending:false}),start:async()=>{starts++;return {state:'connected'};}}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();return rm(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${s.address().port}`;
 const state=await(await fetch(base+'/api/environment')).json();assert.equal(state.aiConfigurationRegistered,true);const headers={origin:base,'content-type':'application/json','x-setup-nonce':state.nonce};
 assert.equal((await fetch(base+'/api/environment/accounts',{headers})).status,403);
 await fetch(base+'/api/environment',{method:'POST',headers,body:JSON.stringify({revision:0,roles:{local:true,server:false,remote:false}})});
 assert.equal((await fetch(base+'/api/environment/accounts')).status,403);
 const result=await(await fetch(base+'/api/environment/accounts',{headers})).json();assert.equal(result.providers.length,2);assert.equal(result.providers[0].state,'connected');
 assert.equal((await fetch(base+'/api/environment/accounts/codex/login',{method:'POST',headers,body:'{}'})).status,409);assert.equal(starts,0);
 assert.equal((await fetch(base+'/api/environment/accounts',{headers:{...headers,'x-forwarded-for':'100.1.1.1'}})).status,403);
});

test('other origins are refused without any cross-origin allowance',async t=>{
 const {createServer}=await import('./server.mjs');const dir=await mkdtemp(join(tmpdir(),'mari-cors-')),path=join(dir,'machine.json');await createEnvironment(path).save({revision:0,roles:{local:true,server:true,remote:false}});
 const s=createServer({upstream:'http://127.0.0.1:1',sessionId:'00000000-0000-0000-0000-000000000000',environmentPath:path});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();return rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${s.address().port}`,origin='http://127.0.0.1:61171';
 const preflight=await fetch(base+'/api/auth',{method:'OPTIONS',headers:{origin,'Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,403);assert.equal(preflight.headers.get('access-control-allow-origin'),null);
 for(const path of ['/config','/api/server-identity','/connections','/api/environment/discovery'])assert.equal((await fetch(base+path,{headers:{origin}})).status,403,path);
 assert.notEqual((await fetch(base+'/connections')).status,200);
});
test('file reads require a configured project and reject external symlinks',async t=>{
 const {createServer}=await import('./server.mjs'),{mkdir,symlink}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'mari-remote-files-')),root=join(dir,'project'),path=join(dir,'env.json');await mkdir(root);await writeFile(join(root,'hello.txt'),'hello');await writeFile(join(dir,'outside.txt'),'outside');await symlink('../outside.txt',join(root,'external'));await symlink('hello.txt',join(root,'internal'));await createEnvironment(path).save({revision:0,roles:{local:true,server:true,remote:false}});
 const id='00000000-0000-0000-0000-000000000000',reads=[];const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url===`/api/sessions/${id}`)res.end(JSON.stringify({session:{id,metadata:{machineId:'fixture',path:root}}}));else{reads.push(req.url);res.end(JSON.stringify({success:true,content:'aGVsbG8='}));}});await new Promise(r=>hub.listen(0,'127.0.0.1',r));let origin;const server=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,sessionId:id,environmentPath:path,handoffTarget:{directory:join(dir,'handoffs'),machineId:'fixture',project:root}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of [server,hub]){s.closeAllConnections();s.close();}await rm(dir,{recursive:true,force:true});});origin=`http://127.0.0.1:${server.address().port}`;const base=`http://127.0.0.1:${server.address().port}/api/sessions/${id}/file?path=`;
 const headers={origin,authorization:'Bearer synthetic'};assert.equal((await fetch(base+'internal',{headers})).status,200);assert.ok(reads[0].endsWith('path=hello.txt'));assert.equal((await fetch(base+'external',{headers})).status,403);assert.equal((await fetch(base+'..%2Foutside.txt',{headers})).status,403);assert.equal(reads.length,1);
});
test('permission decisions preserve auth, exact request and at-most-once forwarding',async t=>{
 const {createServer}=await import('./server.mjs');const dir=await mkdtemp(join(tmpdir(),'mari-permissions-')),path=join(dir,'env.json');await createEnvironment(path).save({revision:0,roles:{local:true,server:true,remote:false}});
 const id='00000000-0000-0000-0000-000000000001',expected={tool:'Bash',arguments:{command:'echo synthetic'}},forwarded=[];
 const hub=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}if(req.method==='GET'){res.end(JSON.stringify({session:{id,active:true,agentState:{requests:{one:expected,two:expected,three:expected}}}}));return;}let raw='';for await(const c of req)raw+=c;forwarded.push(JSON.parse(raw));if(req.url.includes('/three/'))res.destroy();else res.end('{"ok":true}');});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,sessionId:id,environmentPath:path});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;t.after(async()=>{for(const s of [server,hub]){s.closeAllConnections();s.close();}await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api/sessions/${id}/permissions/`;
 const post=(tail,body={expected},extra={})=>fetch(base+tail,{method:'POST',headers:{origin,'Content-Type':'application/json',authorization:'Bearer synthetic',...extra},body:JSON.stringify(body)});
 assert.equal((await post('one/approve',undefined,{authorization:''})).status,401);assert.equal((await post('one/approve',undefined,{authorization:'Bearer wrong'})).status,401);
 assert.equal((await post('one/approve',undefined,{origin:'https://evil.example'})).status,403);assert.equal((await post('one/approve?token=x')).status,403);
 assert.equal((await post('one/approve',{expected:{tool:'Bash',arguments:{command:'changed'}}})).status,409);assert.equal((await post('one/approve',{expected,mode:'bypassPermissions'})).status,400);assert.equal(forwarded.length,0);
 const attempts=await Promise.all([post('one/approve'),post('one/approve')]);assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);assert.equal((await post('two/deny')).status,200);assert.deepEqual(forwarded,[{decision:'approved'},{decision:'denied'}]);
 assert.equal((await post('three/approve')).status,502);assert.equal((await post('three/approve')).status,409);assert.equal(forwarded.length,3);
});

test('CLI registration requires local role, setup nonce and same origin without starting login',async t=>{
 const {createServer}=await import('./server.mjs');const dir=await mkdtemp(join(tmpdir(),'mari-registration-'));let writes=0,logins=0;
 const s=createServer({upstream:'http://127.0.0.1:1',sessionId:'00000000-0000-0000-0000-000000000000',environmentPath:join(dir,'env.json'),registrationService:{list:async()=>({providers:[]}),register:async()=>{writes++;return {registered:true};}},accountsService:{start:async()=>{logins++;}}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();return rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${s.address().port}`,state=await(await fetch(base+'/api/environment')).json(),url=base+'/api/environment/accounts/registration',headers={origin:base,'Content-Type':'application/json','X-Setup-Nonce':state.nonce};
 assert.equal((await fetch(url,{headers})).status,403);
 await fetch(base+'/api/environment',{method:'POST',headers,body:JSON.stringify({revision:0,roles:{local:true,server:false,remote:false}})});
 for(const extra of [{'X-Setup-Nonce':''},{origin:'https://evil.example'},{'x-forwarded-for':'10.0.0.2'}])assert.equal((await fetch(url,{method:'POST',headers:{...headers,...extra},body:'{}'})).status,403);
 assert.equal(writes,0);assert.equal((await fetch(url,{headers})).status,200);
 assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,200);
 assert.equal(writes,1);assert.equal(logins,0);
});
test('Runner setup actions require local role, nonce and same origin and accept no path input',async t=>{
 const {createServer}=await import('./server.mjs');const dir=await mkdtemp(join(tmpdir(),'mari-runner-route-'));let starts=0;
 const s=createServer({upstream:'http://127.0.0.1:1',sessionId:'00000000-0000-0000-0000-000000000000',environmentPath:join(dir,'env.json'),runnerService:{status:async()=>({phase:'prepared'}),start:async()=>{starts++;}}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();return rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${s.address().port}`,state=await(await fetch(base+'/api/environment')).json(),url=base+'/api/environment/runner',headers={origin:base,'Content-Type':'application/json','X-Setup-Nonce':state.nonce};
 const post=(body={action:'start'},extra={})=>fetch(url,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 assert.equal((await post()).status,403);await fetch(base+'/api/environment',{method:'POST',headers,body:JSON.stringify({revision:0,roles:{local:true,server:false,remote:false}})});
 for(const extra of [{'X-Setup-Nonce':''},{origin:'https://evil.example'},{'x-forwarded-for':'10.0.0.1'}])assert.equal((await post(undefined,extra)).status,403);
 assert.equal((await post({action:'start',binary:'/bin/sh'})).status,400);assert.equal(starts,0);assert.equal((await post()).status,200);assert.equal(starts,1);
});
test('Runner config must use the same account setup and Hub as the setup screen',async()=>{
 const {createServer}=await import('./server.mjs');
 const base={upstream:'http://127.0.0.1:61164',accountConfig:'/machine/accounts.json',runnerService:{},runnerConfig:{accountConfig:'/other/accounts.json',hubUrl:'http://127.0.0.1:61164'}};
 assert.throws(()=>createServer(base));
 assert.throws(()=>createServer({...base,runnerConfig:{accountConfig:base.accountConfig,hubUrl:'http://127.0.0.1:61185'}}));
});
test('runner workspace replaces fixed sessions and never exposes its list without user authentication',async t=>{
 const {createServer}=await import('./server.mjs');const own='00000000-0000-0000-0000-000000000002';let reads=0;
 const s=createServer({upstream:'http://127.0.0.1:1',sessionId:'00000000-0000-0000-0000-000000000001',runnerService:{workspace:async auth=>{reads++;assert.equal(auth,'Bearer synthetic');return [{id:own,label:'Codex 작업'}];}}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});const base=`http://127.0.0.1:${s.address().port}`;
 assert.equal((await fetch(base+'/config')).status,401);assert.equal(reads,0);
 const config=await(await fetch(base+'/config',{headers:{authorization:'Bearer synthetic'}})).json();
 assert.equal(config.sessions.length,1);assert.equal(config.sessionId,own);assert.equal(config.fileRead,false);
});
test('runner workspace preserves expired authentication status',async t=>{
 const {createServer}=await import('./server.mjs');
 const s=createServer({upstream:'http://127.0.0.1:1',sessionId:'00000000-0000-0000-0000-000000000001',runnerService:{workspace:async()=>{throw Object.assign(Error('Denied'),{status:401});}}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});
 assert.equal((await fetch(`http://127.0.0.1:${s.address().port}/config`,{headers:{authorization:'Bearer expired'}})).status,401);
});
test('empty runner workspace can authenticate but cannot read unsupported files',async t=>{
 const {createServer,allowedRoute}=await import('./server.mjs');assert.equal(allowedRoute('POST',new URL('http://local/api/auth'),[]),true);
 const id='00000000-0000-0000-0000-000000000001';let forwards=0;const hub=http.createServer((req,res)=>{forwards++;res.setHeader('Content-Type','application/json');res.end('{"token":"synthetic"}');});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const s=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,sessionId:id,runnerService:{workspace:async()=>[{id}]}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{for(const server of [s,hub]){server.closeAllConnections();server.close();}});
 const base=`http://127.0.0.1:${s.address().port}`;
 assert.equal((await fetch(base+'/api/auth',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{"accessToken":"synthetic"}'})).status,200);
 for(const path of ['file','directory'])assert.equal((await fetch(base+'/api/sessions/'+id+'/'+path,{headers:{authorization:'Bearer synthetic'}})).status,403);
 assert.equal(forwards,1);
});
test('Runner file reads keep the project realpath boundary',async t=>{
 const {createServer}=await import('./server.mjs'),{symlink}=await import('node:fs/promises');const root=await mkdtemp(join(tmpdir(),'runner-cors-file-')),env=join(root,'env.json'),id='00000000-0000-0000-0000-000000000001';
 await writeFile(join(root,'inside'),'ok');await symlink('/etc/hosts',join(root,'outside'));await createEnvironment(env).save({revision:0,roles:{local:true,server:true,remote:false}});
 const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.includes('/file')?{content:'b2s='}:{session:{id,metadata:{machineId:'own',path:root}}}));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const s=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,sessionId:id,environmentPath:env,runnerService:{workspace:async()=>[{id,project:root}],target:async()=>({machineId:'own',project:root})}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{for(const a of [s,hub]){a.closeAllConnections();a.close();}return rm(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${s.address().port}/api/sessions/${id}/file?path=`,headers={origin:`http://127.0.0.1:${s.address().port}`,authorization:'Bearer synthetic'};
 assert.equal((await fetch(base+'inside',{headers})).status,200);assert.equal((await fetch(base+'outside',{headers})).status,403);
});
