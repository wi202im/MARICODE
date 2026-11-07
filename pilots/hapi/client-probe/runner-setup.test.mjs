import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createRunnerSetup} from './runner-setup.mjs';
test('lost resume acknowledgement recovers only the exact active native session without replay',async t=>{
 const {createServer}=await import('node:http'),{prepareRunner}=await import('./machine-setup.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),binary:'/bin/echo',tokenFile:join(root,'token')};
 await writeFile(join(root,'env'),'{"PATH":"/usr/bin:/bin"}');await writeFile(c.accountConfig,JSON.stringify({cwd:root,environment:join(root,'env'),binaries:{}}));await writeFile(c.tokenFile,'synthetic');
 const original={id:'10000000-0000-4000-8000-000000000001',active:false,metadata:{machineId:'own',path:root,flavor:'codex',codexSessionId:'native-original'}};
 let result=structuredClone(original),reads=0,starts=0,writes=0,running=true,online=true;
 const hub=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/auth')return res.end('{"token":"synthetic"}');if(req.headers.authorization!=='Bearer synthetic')return res.writeHead(401).end('{}');if(req.url==='/api/sessions')return res.end('{"sessions":[]}');reads++;res.end(JSON.stringify({session:result}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});c.hubUrl=`http://127.0.0.1:${hub.address().port}`;
 const api=createRunnerSetup(c,{prepare:prepareRunner,connection:async()=>online,launch:async({prepared})=>{starts++;await mkdir(join(prepared,'runner-home'));await writeFile(join(prepared,'runner-home/settings.json'),'{"machineId":"own"}');return {get running(){return running;}};}});
 await api.prepare();await api.start();
 await assert.rejects(api.runSessionMutation(async()=>{writes++;throw Error('response lost');},{resume:original}));
 await access(join(c.directory,'session-operation.json'));
 assert.equal((await createRunnerSetup(c,{connection:async()=>true}).status()).phase,'unknown');
 await assert.rejects(api.reconcileResume(original.id,'Bearer wrong'));assert.equal(reads,0);
 assert.equal(await api.reconcileResume(original.id,'Bearer synthetic'),false);assert.equal((await api.status()).phase,'unknown');
 await assert.rejects(api.runSessionMutation(()=>{writes++;}));await assert.rejects(api.stop());await assert.rejects(api.reprepare());
 for(const patch of [{id:'other'},{metadata:{...original.metadata,machineId:'other'}},{metadata:{...original.metadata,path:'/other'}},{metadata:{...original.metadata,flavor:'claude'}},{metadata:{...original.metadata,codexSessionId:'different'}}]){
  result={...structuredClone(original),active:true,...patch};assert.equal(await api.reconcileResume(original.id,'Bearer synthetic'),false);
 }
 result={...structuredClone(original),active:true};online=false;assert.equal(await api.reconcileResume(original.id,'Bearer synthetic'),false);online=true;
 running=false;assert.equal(await api.reconcileResume(original.id,'Bearer synthetic'),false);running=true;
 assert.equal(await api.reconcileResume(original.id,'Bearer synthetic'),true);assert.equal((await api.status()).phase,'running');assert.equal(starts,1);assert.equal(writes,1);await assert.rejects(access(join(c.directory,'session-operation.json')));
 const claude={...original,metadata:{...original.metadata,flavor:'claude',codexSessionId:undefined,claudeSessionId:'claude-original'}};
 await assert.rejects(api.runSessionMutation(async()=>{writes++;throw Error('response lost');},{resume:claude}));
 result={...claude,active:true,metadata:{...claude.metadata,claudeSessionId:'other'}};assert.equal(await api.reconcileResume(original.id,'Bearer synthetic'),false);
 result={...claude,active:true};assert.equal(await api.reconcileResume(original.id,'Bearer synthetic'),true);assert.equal(writes,2);assert.equal(starts,1);
 // Non-resume uncertainty is never cleared by an online session or this readback.
 await assert.rejects(api.runSessionMutation(async()=>{throw Error('archive unknown');}));
 assert.equal(await api.reconcileResume(original.id,'Bearer synthetic'),true);assert.equal((await api.status()).phase,'unknown');
 await access(join(c.directory,'session-operation.json'));await writeFile(join(c.directory,'runner-stopped.json'),'{}');
 assert.equal((await createRunnerSetup(c,{connection:async()=>true}).status()).phase,'unknown');
});
test('prepare/start are explicit, duplicate start blocked and restart cannot re-adopt unknown child',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-runner-ui-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=join(root,'snapshot'),tokenFile=join(root,'token');await writeFile(tokenFile,'synthetic');
 let starts=0;const c={directory,accountConfig:join(root,'fixture'),binary:'/bin/echo',hubUrl:'http://127.0.0.1:1',tokenFile};
 await writeFile(join(root,'env.json'),'{}');await writeFile(c.accountConfig,JSON.stringify({environment:join(root,'env.json'),binaries:{}}));
 const {accountRevision}=await import('./machine-setup.mjs');
 const deps={prepare:async()=>{await mkdir(directory);await writeFile(join(directory,'prepared.json'),JSON.stringify({cwd:root+'/local-setup/working-directory',sourceRevision:await accountRevision(c.accountConfig)}));},launch:async()=>{starts++;await mkdir(join(directory,'runner-home'));return {running:true};},connection:async()=>false};
 const s=createRunnerSetup(c,deps);assert.equal((await s.status()).phase,'unprepared');assert.equal(starts,0);
 await s.prepare();assert.equal((await s.status()).phase,'prepared');
 const results=await Promise.allSettled([s.start(),s.start()]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(starts,1);
 assert.equal((await s.status()).phase,'running');assert.equal((await s.status()).configuration,'matched');
 assert.equal((await createRunnerSetup(c,deps).status()).phase,'unknown');
});
test('Hub status requires this runner identity; invalid remote configuration rejected before auth',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-runner-ui-'));t.after(()=>rm(root,{recursive:true,force:true}));
 assert.throws(()=>createRunnerSetup({hubUrl:'https://example.com'}));
});
test('Hub connection matches own machine id, not merely any online machine',async t=>{
 const {runnerConnected}=await import('./runner-setup.mjs'),{createServer}=await import('node:http');
 const root=await mkdtemp(join(tmpdir(),'merry-runner-id-'));await mkdir(join(root,'runner-home'));await writeFile(join(root,'runner-home/settings.json'),JSON.stringify({machineId:'own'}));await writeFile(join(root,'token'),'synthetic');
 let id='other',ready=false;const s=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url.endsWith('/agent-availability')){res.writeHead(ready?200:500).end(JSON.stringify(ready?{agents:[{agent:'codex',available:true}]}:{error:'RPC handler not registered'}));return;}res.end(JSON.stringify(req.url==='/api/auth'?{token:'synthetic'}:{machines:[{id}]}));});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();return rm(root,{recursive:true,force:true});});
 const config={directory:root,tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${s.address().port}`};
 assert.equal(await runnerConnected(config),false);id='own';assert.equal(await runnerConnected(config),false);ready=true;assert.equal(await runnerConnected(config),true);
});
test('changed account configuration blocks start and scopes workspace to exact machine/project',async t=>{
 const {createServer}=await import('node:http'),{prepareRunner}=await import('./machine-setup.mjs');
 const root=await mkdtemp(join(tmpdir(),'merry-runner-scope-')),directory=join(root,'snapshot'),accountConfig=join(root,'accounts.json');
 await writeFile(join(root,'env.json'),JSON.stringify({PATH:'/usr/bin:/bin'}));const c={cwd:root,environment:join(root,'env.json'),binaries:{}};await writeFile(accountConfig,JSON.stringify(c));
 await prepareRunner(accountConfig,directory);await writeFile(accountConfig,JSON.stringify({...c,cwd:tmpdir()}));
 const own='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';let starts=0;
 const hub=createServer((req,res)=>{if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sessions:[{id:own,metadata:{machineId:'own',path:root,flavor:'codex',summary:{text:'목록의 실제 대화 제목'}}},{id:other,metadata:{machineId:'other',path:root}},{id:other,metadata:{machineId:'own',path:'/other'}}]}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const s=createRunnerSetup({directory,accountConfig,binary:'/bin/echo',hubUrl:`http://127.0.0.1:${hub.address().port}`,tokenFile:join(root,'token')},{launch:async()=>{starts++;}});
 assert.equal((await s.status()).configuration,'changed');await assert.rejects(()=>s.start());assert.equal(starts,0);
 await mkdir(join(directory,'runner-home'));await writeFile(join(directory,'runner-home/settings.json'),JSON.stringify({machineId:'own'}));
 assert.deepEqual((await s.workspace('Bearer synthetic')).map(x=>x.id),[own]);
 assert.equal((await s.workspace('Bearer synthetic'))[0].label,'목록의 실제 대화 제목');
 await assert.rejects(()=>s.workspace('Bearer wrong'),e=>e.status===401);await assert.rejects(()=>s.workspace(''));
});
test('owned stop and new preparation preserve machine identity without overwriting old generation',async t=>{
 const {readFile,stat}=await import('node:fs/promises'),{prepareRunner}=await import('./machine-setup.mjs');
 const root=await mkdtemp(join(tmpdir(),'merry-lifecycle-')),directory=join(root,'snapshot'),accountConfig=join(root,'accounts.json');
 t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'env.json'),'{"PATH":"/usr/bin:/bin"}');await writeFile(accountConfig,JSON.stringify({cwd:root,environment:join(root,'env.json'),binaries:{}}));await writeFile(join(root,'token'),'synthetic');
 const id='00000000-0000-0000-0000-000000000005';let running=false,active=true;
 const launch=async({prepared})=>{await mkdir(join(prepared,'runner-home'));await writeFile(join(prepared,'runner-home/settings.json'),JSON.stringify({machineId:id}));running=true;return {get running(){return running;},stop:async()=>{running=false;}};};
 const config={directory,accountConfig,binary:'/bin/echo',hubUrl:'http://127.0.0.1:1',tokenFile:join(root,'token')};
 const s=createRunnerSetup(config,{prepare:prepareRunner,launch,connection:async()=>true,hasActive:async()=>active});
 await s.prepare();await s.start();await assert.rejects(()=>s.stop());assert.equal((await s.status()).phase,'running');
 active=false;let release,entered;const ready=new Promise(r=>{entered=r;});const mutation=s.runSessionMutation(()=>new Promise(r=>{release=r;entered();}));await ready;
 await assert.rejects(()=>s.stop());assert.equal(running,true);release({});await mutation;await mkdir(join(directory,'tasks'));const pending=join(directory,'tasks',id+'.json');await writeFile(pending,JSON.stringify({state:'verifying'}));await assert.rejects(()=>s.stop());assert.equal(running,true);await rm(pending);await s.stop();assert.equal((await s.status()).phase,'exited');await s.reprepare();await s.reprepare();
 assert.equal((await s.status()).phase,'prepared');assert.ok(await stat(join(directory,'runner-home')));
 const current=JSON.parse(await readFile(directory+'.current.json','utf8'));
 assert.notEqual(current.directory,directory);assert.equal(JSON.parse(await readFile(join(current.directory,'prepared.json'),'utf8')).machineId,id);
 assert.equal((await createRunnerSetup(config).status()).phase,'prepared');
});
test('restarted web owner can observe connected runner without acquiring process controls',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-observe-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'snapshot');await mkdir(join(directory,'runner-home'),{recursive:true});
 const c={directory,accountConfig:join(root,'accounts'),binary:'/bin/echo',hubUrl:'http://127.0.0.1:1',tokenFile:join(root,'token')};
 let connected=true,checks=0,starts=0;
 const s=createRunnerSetup(c,{connection:async()=>{checks++;if(connected===null)throw Error();return connected;},launch:async()=>{starts++;}});
 const online=await s.status();assert.equal(online.phase,'unknown');assert.equal(online.hub,'connected');assert.equal(online.observed,true);assert.equal(online.workspaceAvailable,true);
 await assert.rejects(()=>s.start());await assert.rejects(()=>s.stop());await assert.rejects(()=>s.reprepare());await assert.rejects(()=>s.runSessionMutation(()=>assert.fail('must not resume')));
 assert.equal(starts,0);
 connected=false;assert.equal((await s.status()).workspaceAvailable,false);
 connected=null;const unavailable=await s.status();assert.equal(unavailable.hub,'unknown');assert.equal(unavailable.workspaceAvailable,false);assert.equal(checks,3);
});

test('empty project workspace authenticates before reads and session preparation starts once',async t=>{
 const http=await import('node:http');const {accountRevision}=await import('./machine-setup.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-empty-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),projectsPath:join(root,'projects'),binary:'/bin/echo',tokenFile:join(root,'token')};
 await writeFile(join(root,'env'),'{}');await writeFile(c.accountConfig,JSON.stringify({cwd:root+'/local-setup/working-directory',environment:join(root,'env'),binaries:{}}));await writeFile(c.tokenFile,'synthetic');
 const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.writeHead(req.headers.authorization==='Bearer synthetic'?200:401).end('{"sessions":[]}');});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});c.hubUrl=`http://127.0.0.1:${hub.address().port}`;
 let starts=0;const api=createRunnerSetup(c,{prepare:async(_path,dir)=>{await mkdir(dir);await writeFile(join(dir,'prepared.json'),JSON.stringify({cwd:root+'/local-setup/working-directory',sourceRevision:await accountRevision(c.accountConfig)}));},launch:async()=>{starts++;return {running:true};}});
 await assert.rejects(api.projects('Bearer wrong'));await assert.rejects(api.workspace('Bearer wrong'));await assert.rejects(api.ready('Bearer wrong'));assert.equal(starts,0);
 assert.deepEqual(await api.projects('Bearer synthetic'),[]);assert.deepEqual(await api.workspace('Bearer synthetic'),[]);
 await api.ready('Bearer synthetic');await api.ready('Bearer synthetic');assert.equal(starts,1);
 const {projectRegistry}=await import('./project-registry.mjs');const added=await projectRegistry(c.projectsPath).add(root);
 await assert.rejects(api.ready('Bearer synthetic',added.id));assert.equal(starts,1);
});

test('new roots refresh only an idle owned Runner, preserving identity and rejecting concurrent work',async t=>{
 const {readFile}=await import('node:fs/promises'),{createServer}=await import('node:http'),{prepareRunner}=await import('./machine-setup.mjs'),{projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-root-refresh-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),projectsPath:join(root,'projects'),binary:'/bin/echo',tokenFile:join(root,'token')};
 await writeFile(join(root,'env'),'{"PATH":"/usr/bin:/bin"}');await writeFile(c.accountConfig,JSON.stringify({cwd:root,environment:join(root,'env'),binaries:{codex:'/bin/echo'}}));await writeFile(c.tokenFile,'synthetic');
 const hub=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.writeHead(req.headers.authorization==='Bearer synthetic'?200:401).end('{"sessions":[]}');});await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});c.hubUrl=`http://127.0.0.1:${hub.address().port}`;
 const id='00000000-0000-0000-0000-000000000005';let starts=0,stops=0,active=false,stopFails=false,hold,entered,gate;
 const plans=[];const api=createRunnerSetup(c,{prepare:prepareRunner,connection:async()=>true,hasActive:async()=>active,launch:async({prepared})=>{
  const plan=JSON.parse(await readFile(join(prepared,'prepared.json'),'utf8'));plans.push(plan);starts++;await mkdir(join(prepared,'runner-home'));await writeFile(join(prepared,'runner-home/settings.json'),JSON.stringify({machineId:plan.machineId??id}));let running=true;
  return {get running(){return running;},stop:async()=>{stops++;if(gate){entered();await gate;}if(stopFails)throw Error();running=false;}};
 }});
 await api.ready('Bearer synthetic',undefined,'codex');assert.equal(starts,1);
 const folder=join(root,'added');await mkdir(folder);const project=await projectRegistry(c.projectsPath).add(folder);
 await assert.rejects(api.ready('Bearer wrong',project.id,'codex'));await assert.rejects(api.ready('Bearer synthetic','unknown','codex'));assert.equal(stops,0);
 active=true;await assert.rejects(api.ready('Bearer synthetic',project.id,'codex'),e=>e.code==='RUNNER_ACTIVE');assert.equal(stops,0);assert.equal((await api.status()).phase,'running');
 active=false;await mkdir(join(c.directory,'tasks'));const pending=join(c.directory,'tasks',id+'.json');await writeFile(pending,'{"state":"verifying"}');await assert.rejects(api.ready('Bearer synthetic',project.id,'codex'),e=>e.code==='RUNNER_UNCONFIRMED');assert.equal(stops,0);await rm(pending);
 gate=new Promise(r=>{hold=r;});const waiting=new Promise(r=>{entered=r;});const refresh=api.ready('Bearer synthetic',project.id,'codex');await waiting;
 await assert.rejects(api.ready('Bearer synthetic',project.id,'codex'));await assert.rejects(api.runSessionMutation(()=>assert.fail('must not mutate while refreshing')));hold();await refresh;gate=null;
 assert.equal(stops,1);assert.equal(starts,2);assert.equal(plans[1].machineId,id);assert.ok(plans[1].workspaceRoots.includes(project.path));assert.equal((await api.status()).phase,'running');await api.ready('Bearer synthetic',project.id,'codex');assert.equal(starts,2);
 const current=JSON.parse(await readFile(c.directory+'.current.json','utf8')).directory;assert.notEqual(current,c.directory);assert.equal(JSON.parse(await readFile(join(c.directory,'prepared.json'),'utf8')).workspaceRoots.includes(project.path),false);
 // Adding a second AI also refreshes the snapshot only before a new task.
 const config=JSON.parse(await readFile(c.accountConfig,'utf8'));await writeFile(c.accountConfig,JSON.stringify({...config,binaries:{...config.binaries,claude:'/bin/echo'}}));await api.ready('Bearer synthetic',project.id,'claude');assert.equal(starts,3);assert.ok(plans[2].agents.includes('claude'));
 const third=join(root,'third');await mkdir(third);const thirdProject=await projectRegistry(c.projectsPath).add(third);stopFails=true;await assert.rejects(api.ready('Bearer synthetic',thirdProject.id,'codex'));assert.equal((await api.status()).phase,'unknown');await assert.rejects(api.ready('Bearer synthetic',thirdProject.id,'codex'));assert.equal(starts,3);assert.equal(stops,3);
});

test('one workspace request prepares a linked checkout and spawns exactly one session in it',async t=>{
 const {createServer}=await import('node:http'),{execFileSync}=await import('node:child_process'),{projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-workflow-'));t.after(()=>rm(root,{recursive:true,force:true}));const repo=join(root,'repo');await mkdir(repo);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});git('init','-b','main');git('-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','fixture');
 const projectsPath=join(root,'projects.json'),registry=projectRegistry(projectsPath),project=await registry.add(repo);
 const accountConfig=join(root,'accounts.json');await writeFile(join(root,'env.json'),JSON.stringify({PATH:'/usr/bin:/bin'}));await writeFile(accountConfig,JSON.stringify({cwd:repo,environment:join(root,'env.json'),binaries:{codex:'/bin/echo'}}));await writeFile(join(root,'token'),'synthetic');
 let spawns=0,spawned,connectionChecks=0;const id='90000000-0000-0000-0000-000000000001';
 const hub=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic')return res.writeHead(401).end('{}');
 if(req.url==='/api/sessions')return res.end('{"sessions":[]}');if(req.url==='/api/machines')return res.end('{"machines":[{"id":"own"}]}');if(req.url.endsWith('/agent-availability'))return res.end('{"agents":[{"agent":"codex","available":true}]}');
 if(req.url.endsWith('/spawn')){let raw='';for await(const p of req)raw+=p;spawned=JSON.parse(raw);spawns++;return res.end(JSON.stringify({type:'success',sessionId:id}));}
 res.end(JSON.stringify({session:{id,metadata:{machineId:'own',path:spawned.directory,flavor:'codex'}}}));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});
 const api=createRunnerSetup({directory:join(root,'runner'),accountConfig,binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:'http://127.0.0.1:'+hub.address().port,projectsPath},{connection:async()=>{if(++connectionChecks===1){assert.equal(spawns,0);throw Object.assign(Error('identity not written yet'),{code:'ENOENT'});}return true;},hasActive:async()=>false,launch:async({prepared})=>{await mkdir(join(prepared,'runner-home'));await writeFile(join(prepared,'runner-home/settings.json'),'{"machineId":"own"}');return {running:true,stop:async()=>{}};}});
 const input={requestId:'80000000-0000-0000-0000-000000000001',agent:'codex',project:project.id,workspace:{mode:'new',branch:'main',name:'feature/test'}};
 await assert.rejects(api.task(input,'Bearer wrong'));assert.equal(spawns,0);
 const result=await api.task(input,'Bearer synthetic');assert.equal(result.state,'created');assert.ok(connectionChecks>=2);assert.notEqual(spawned.directory,repo);assert.equal(git('branch','--show-current').trim(),'main');
 assert.equal((await api.task(input,'Bearer synthetic')).session.id,id);assert.equal(spawns,1);assert.equal((await api.task(input,'Bearer synthetic',true)).state,'created');
 assert.equal((await api.projects('Bearer synthetic')).filter(p=>p.parentKey===project.id).length,1);
});

test('navigation management authenticates, scopes sessions and blocks removal of active or uncertain work',async t=>{
 const {createServer}=await import('node:http'),{projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-manage-'));const source=join(root,'source');await mkdir(source);const directory=join(root,'runner');await mkdir(join(directory,'runner-home'),{recursive:true});
 const accountConfig=join(root,'account');await writeFile(accountConfig,JSON.stringify({cwd:source}));await writeFile(join(directory,'prepared.json'),JSON.stringify({cwd:source}));await writeFile(join(directory,'runner-home/settings.json'),JSON.stringify({machineId:'own'}));
 const projectsPath=join(root,'projects'),registry=projectRegistry(projectsPath),project=await registry.add(source);await writeFile(accountConfig,JSON.stringify({cwd:project.path}));const sid='11111111-1111-4111-8111-111111111111';let active=true;
 const hub=createServer((req,res)=>{if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sessions:[{id:sid,active,metadata:{machineId:'own',path:project.path,flavor:'codex'}}]}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const service=createRunnerSetup({directory,accountConfig,projectsPath,binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`});
 const remove={kind:'project',id:project.id,action:'remove'};
 await assert.rejects(service.manage('Bearer wrong',remove),e=>e.status===401);
 await assert.rejects(service.manage('Bearer synthetic',remove));
 await assert.rejects(service.manage('Bearer synthetic',{kind:'session',id:'22222222-2222-4222-8222-222222222222',action:'rename',name:'wrong'}));
 await service.manage('Bearer synthetic',{kind:'session',id:sid,action:'rename',name:'별도 표시 이름'});
 assert.equal((await service.workspace('Bearer synthetic'))[0].displayName,'별도 표시 이름');
 active=false;await mkdir(join(directory,'tasks'));const pending=join(directory,'tasks',sid+'.json');await writeFile(pending,JSON.stringify({state:'pending'}));await assert.rejects(service.manage('Bearer synthetic',remove));await rm(pending);
 await service.manage('Bearer synthetic',remove);assert.equal((await service.projects('Bearer synthetic')).length,0);assert.equal((await service.workspace('Bearer synthetic')).length,0);
 await service.manage('Bearer synthetic',{...remove,action:'restore'});assert.equal((await service.workspace('Bearer synthetic'))[0].id,sid);
 await service.manage('Bearer synthetic',{kind:'session',id:sid,action:'remove'});assert.equal((await service.workspace('Bearer synthetic'))[0].hidden,true);
});

test('missing unrelated project does not hide healthy projects or sessions',async t=>{
 const {createServer}=await import('node:http'),{projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-missing-'));const directory=join(root,'runner'),source=join(root,'healthy'),missing=join(root,'missing');
 await mkdir(source);await mkdir(missing);await mkdir(join(directory,'runner-home'),{recursive:true});
 const projectsPath=join(root,'projects'),registry=projectRegistry(projectsPath),healthy=await registry.add(source),gone=await registry.add(missing);
 await rm(missing,{recursive:true});const accountConfig=join(root,'account');await writeFile(accountConfig,JSON.stringify({cwd:healthy.path}));await writeFile(join(directory,'prepared.json'),JSON.stringify({cwd:healthy.path}));await writeFile(join(directory,'runner-home/settings.json'),'{"machineId":"own"}');
 const hub=createServer((req,res)=>res.end(JSON.stringify({sessions:[{id:'11111111-1111-4111-8111-111111111111',metadata:{machineId:'own',path:healthy.path,flavor:'codex'}}]})));await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const service=createRunnerSetup({directory,projectsPath,accountConfig,binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`});
 const rows=await service.projects('Bearer synthetic');assert.equal(rows.length,2);assert.equal(rows.find(p=>p.key===gone.id).available,false);assert.equal(rows.find(p=>p.key===healthy.id).available,true);assert.equal((await service.workspace('Bearer synthetic'))[0].id,'11111111-1111-4111-8111-111111111111');
 await assert.rejects(service.workspaceChoices('Bearer synthetic',gone.id));
});

test('legacy default folders expose ordinary management without writing on read',async t=>{
 const {createServer}=await import('node:http'),{readFile,realpath}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'maricode-legacy-manage-'));const source=join(root,'source');await mkdir(source);const path=await realpath(source),accountConfig=join(root,'account'),projectsPath=join(root,'projects');
 await writeFile(accountConfig,JSON.stringify({cwd:path}));let active=true;
 const hub=createServer((req,res)=>{if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end();return;}res.end(JSON.stringify({sessions:[{active,metadata:{path}}]}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const service=createRunnerSetup({directory:join(root,'runner'),accountConfig,projectsPath,binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`});
 const p=(await service.projects('Bearer synthetic'))[0];assert.ok(p.projectId);assert.equal(p.key,'');
 assert.equal((await service.projects('Bearer synthetic'))[0].projectId,p.projectId);
 await assert.rejects(readFile(projectsPath),e=>e.code==='ENOENT');
 const remove={kind:'project',id:p.projectId,action:'remove'};
 await assert.rejects(service.manage('Bearer wrong',remove));await assert.rejects(service.manage('Bearer synthetic',remove));
 await assert.rejects(readFile(projectsPath),e=>e.code==='ENOENT');active=false;
 await assert.rejects(service.manage('Bearer synthetic',{...remove,id:'00000000-0000-0000-0000-000000000000'}));
 await service.manage('Bearer synthetic',remove);await service.manage('Bearer synthetic',remove);
 assert.deepEqual(await service.projects('Bearer synthetic'),[]);
 assert.equal((await service.navigation('Bearer synthetic')).removed[0].id,p.projectId);
 await service.manage('Bearer synthetic',{...remove,action:'restore'});
 await service.manage('Bearer synthetic',{...remove,action:'rename',name:'내 프로젝트'});
 const restored=(await service.projects('Bearer synthetic'))[0];assert.equal(restored.projectId,p.projectId);assert.equal(restored.label,'내 프로젝트');assert.equal(restored.path,path);
});

test('general chat provisions one dedicated workspace only after authentication and never starts AI',async t=>{
 const {createServer}=await import('node:http');const {readFile,symlink}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'maricode-general-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const hub=createServer((req,res)=>{if(req.headers.authorization!=='Bearer synthetic')return res.writeHead(401).end();res.end('{"sessions":[]}');});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),projectsPath:join(root,'projects.json'),binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`};
 await writeFile(c.accountConfig,JSON.stringify({cwd:join(root,'local-setup/working-directory')}));
 const api=createRunnerSetup(c,{launch:()=>{throw Error('must not start');}});
 await assert.rejects(api.generalChat('Bearer wrong'));await assert.rejects(access(c.projectsPath));
 const first=await api.generalChat('Bearer synthetic'),second=await api.generalChat('Bearer synthetic');
 assert.equal(first.project,second.project);const projects=await api.projects('Bearer synthetic');
 assert.equal(projects.length,1);assert.equal(projects[0].general,true);assert.equal(projects[0].label,'일반 대화');assert.notEqual(projects[0].path,root);
 await rm(projects[0].path,{recursive:true});await symlink(root,projects[0].path);
 await assert.rejects(api.generalChat('Bearer synthetic'));
 await rm(projects[0].path);await rm(join(root,'runner.general'),{recursive:true});
 const outside=join(root,'outside');await mkdir(outside);await symlink(outside,join(root,'runner.general'));
 await assert.rejects(api.generalChat('Bearer synthetic'));await assert.rejects(access(join(outside,'general-chat')));
});

test('general chat can start beside an active project without changing its folder or refreshing the Runner',async t=>{
 const {createServer}=await import('node:http'),{projectRegistry}=await import('./project-registry.mjs'),{readFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'maricode-general-session-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projectsPath=join(root,'projects.json');await projectRegistry(projectsPath).add(root);
 await writeFile(join(root,'env'),'{"PATH":"/usr/bin:/bin"}');await writeFile(join(root,'accounts'),JSON.stringify({cwd:root,environment:join(root,'env'),binaries:{claude:'/bin/echo'}}));await writeFile(join(root,'token'),'synthetic');
 let starts=0,stops=0,spawns=0,spawned;const sid='20000000-0000-4000-8000-000000000001';
 const hub=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic')return res.writeHead(401).end('{}');
 if(req.url==='/api/sessions')return res.end('{"sessions":[]}');if(req.url==='/api/machines')return res.end('{"machines":[{"id":"own"}]}');if(req.url.endsWith('/agent-availability'))return res.end('{"agents":[{"agent":"claude","available":true}]}');
 if(req.url.endsWith('/spawn')){let body='';for await(const c of req)body+=c;spawned=JSON.parse(body);spawns++;return res.end(JSON.stringify({type:'success',sessionId:sid}));}
 res.end(JSON.stringify({session:{id:sid,metadata:{machineId:'own',path:spawned.directory,flavor:'claude'}}}));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),projectsPath,binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`};
 const api=createRunnerSetup(c,{connection:async()=>true,hasActive:async()=>true,launch:async({prepared})=>{starts++;await mkdir(join(prepared,'runner-home'));await writeFile(join(prepared,'runner-home/settings.json'),'{"machineId":"own"}');return {running:true,stop:async()=>{stops++;}};}});
 await api.prepare();await api.start();const general=await api.generalChat('Bearer synthetic');
 const req={requestId:'30000000-0000-4000-8000-000000000001',agent:'claude',project:general.project,workspace:{mode:'current'}};
 assert.equal((await api.task(req,'Bearer synthetic')).state,'created');assert.equal((await api.task(req,'Bearer synthetic',true)).state,'created');assert.equal(spawns,1);assert.equal(starts,1);assert.equal(stops,0);
 assert.notEqual(spawned.directory,root);assert.equal(spawned.yolo,false);assert.ok((JSON.parse(await readFile(join(c.directory,'prepared.json')))).workspaceRoots.includes(spawned.directory));
});
test('a resume that never started is released after a settle window without replay',async t=>{
 const {createServer}=await import('node:http'),{prepareRunner}=await import('./machine-setup.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-resume-fail-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),binary:'/bin/echo',tokenFile:join(root,'token')};
 await writeFile(join(root,'env'),'{"PATH":"/usr/bin:/bin"}');await writeFile(c.accountConfig,JSON.stringify({cwd:root,environment:join(root,'env'),binaries:{}}));await writeFile(c.tokenFile,'synthetic');
 const session={id:'10000000-0000-4000-8000-000000000002',active:false,metadata:{machineId:'own',path:root,flavor:'codex',codexSessionId:'native'}};
 let clock=1000,running=true,online=true,writes=0,result=structuredClone(session);
 const hub=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/auth')return res.end('{"token":"synthetic"}');if(req.url==='/api/sessions')return res.end('{"sessions":[]}');res.end(JSON.stringify({session:result}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});c.hubUrl=`http://127.0.0.1:${hub.address().port}`;
 const api=createRunnerSetup(c,{prepare:prepareRunner,now:()=>clock,connection:async()=>online,launch:async({prepared})=>{await mkdir(join(prepared,'runner-home'));await writeFile(join(prepared,'runner-home/settings.json'),'{"machineId":"own"}');return {get running(){return running;}};}});
 await api.prepare();await api.start();
 const fail=()=>api.runSessionMutation(async()=>{writes++;throw Error('engine failed');},{resume:session});
 await assert.rejects(fail());
 clock+=14000;assert.equal(await api.reconcileResume(session.id,'Bearer synthetic'),false);
 clock+=2000;online=false;assert.equal(await api.reconcileResume(session.id,'Bearer synthetic'),false);online=true;
 result={...session,active:true,metadata:{...session.metadata,codexSessionId:'someone-else'}};assert.equal(await api.reconcileResume(session.id,'Bearer synthetic'),false);
 result=structuredClone(session);assert.equal(await api.reconcileResume(session.id,'Bearer synthetic'),true);
 assert.equal((await api.status()).phase,'running');await assert.rejects(access(join(c.directory,'session-operation.json')));assert.equal(writes,1);
 // If the owned Runner itself exited, the generation is released as exited rather than running.
 await assert.rejects(fail());running=false;clock+=16000;
 assert.equal(await api.reconcileResume(session.id,'Bearer synthetic'),true);assert.equal((await api.status()).phase,'exited');assert.equal(writes,2);
});

test('the session terminal opens only an authenticated session of this Mac in its registered folder and original account',async t=>{
 const {createServer}=await import('node:http'),{randomUUID}=await import('node:crypto');
 const root=await mkdtemp(join(tmpdir(),'maricode-term-scope-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),binary:'/bin/echo',tokenFile:join(root,'token')};
 const cwd=join(root,'project'),home=join(root,'claude');await mkdir(cwd);await mkdir(join(home,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-')),{recursive:true});
 const native='fixture-native-id';await writeFile(join(home,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'),native+'.jsonl'),'');
 await writeFile(join(root,'env'),JSON.stringify({PATH:'/usr/bin:/bin',CLAUDE_CONFIG_DIR:home}));await writeFile(c.accountConfig,JSON.stringify({cwd,environment:join(root,'env'),binaries:{claude:'/bin/echo'}}));
 const generation=c.directory+'.generation-'+randomUUID();await writeFile(c.directory+'.current.json',JSON.stringify({directory:generation}));
 await mkdir(join(generation,'runner-home'),{recursive:true});await writeFile(join(generation,'runner-home/settings.json'),'{"machineId":"own"}');await writeFile(join(generation,'prepared.json'),JSON.stringify({cwd,agents:['claude']}));
 let s={id:randomUUID(),metadata:{machineId:'own',path:cwd,flavor:'claude',claudeSessionId:native}},opened=[];
 const hub=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer fixture')return res.writeHead(401).end('{}');res.end(JSON.stringify(req.url==='/api/machines'?{machines:[{id:'own'}]}:{sessions:[s]}));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));c.hubUrl=`http://127.0.0.1:${hub.address().port}`;t.after(()=>{hub.closeAllConnections();hub.close();});
 const sessionTerminal={start:async input=>{opened.push(input);return {phase:'opening'};},status:async()=>({phase:'idle'})};
 const api=createRunnerSetup(c,{sessionTerminal});
 await assert.rejects(api.openSessionTerminal('Bearer wrong',{id:s.id}));
 await assert.rejects(api.openSessionTerminal('Bearer fixture',{id:s.id,cwd:'/elsewhere'}),e=>e.rejected===true);
 assert.equal((await api.openSessionTerminal('Bearer fixture',{id:s.id})).phase,'opening');
 assert.deepEqual(opened,[{sessionId:s.id,agent:'claude',cwd}]);
 for(const patch of [{machineId:'other'},{path:root},{claudeSessionId:'missing-native-id'}]){const old=s.metadata;s.metadata={...old,...patch};await assert.rejects(api.openSessionTerminal('Bearer fixture',{id:s.id}));s.metadata=old;}
 assert.equal(opened.length,1);
});

test('CLI connection requires authentication and consent and rejects arbitrary environment',async t=>{
 const {createServer}=await import('node:http'),{readFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'cli-link-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original=join(root,'isolated'),source=join(root,'cli');await mkdir(original);await mkdir(source);
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),binary:'/bin/echo',tokenFile:join(root,'token')};await writeFile(join(root,'env'),JSON.stringify({CLAUDE_CONFIG_DIR:original,PATH:'/bin'}));await writeFile(c.accountConfig,JSON.stringify({environment:join(root,'env'),directory:join(root,'login'),binaries:{claude:'/bin/echo'}}));
 const hub=createServer((req,res)=>{if(req.headers.authorization!=='Bearer fixture')return res.writeHead(401).end('{}');res.setHeader('content-type','application/json');res.end('{"sessions":[]}');});await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});c.hubUrl=`http://127.0.0.1:${hub.address().port}`;
 const api=createRunnerSetup(c);
 await assert.rejects(api.accountProfile('Bearer wrong',{action:'discover',agent:'claude',source}));
 const found=await api.accountProfile('Bearer fixture',{action:'discover',agent:'claude',source});assert.equal(found.source,source);assert.equal(found.exists,true);assert.equal(found.binary,'/bin/echo');assert.equal(found.current,await (await import('node:fs/promises')).realpath(original));
 await assert.rejects(api.accountProfile('Bearer fixture',{action:'connect',agent:'claude',source}));
 await assert.rejects(api.accountProfile('Bearer fixture',{action:'connect',agent:'claude',source,confirm:true,env:{HOME:'/other'}}));
 const linked=await api.accountProfile('Bearer fixture',{action:'connect',agent:'claude',source,confirm:true});assert.equal(linked.claude.active,'default');
 assert.equal(JSON.parse(await readFile(join(root,'env'),'utf8')).CLAUDE_CONFIG_DIR,await (await import('node:fs/promises')).realpath(source));
 assert.equal((await api.accountProfile('Bearer fixture',{action:'discover',agent:'claude',source:join(root,'missing')})).exists,false);
});

test('Claude import distinguishes CLI setup failure from an admitted import and check never launches a runner',async t=>{
 const {createServer}=await import('node:http'),{randomUUID}=await import('node:crypto'),{accountProfiles}=await import('./account-profiles.mjs'),{projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-import-ready-')),source=join(root,'cli');await mkdir(source);
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),projectsPath:join(root,'projects'),binary:'/bin/echo',tokenFile:join(root,'token')};
 await writeFile(join(root,'env'),JSON.stringify({HOME:root,PATH:'/usr/bin:/bin',CLAUDE_CONFIG_DIR:source}));await writeFile(c.accountConfig,JSON.stringify({cwd:root,environment:join(root,'env'),cliConnectionRequired:true,binaries:{claude:'/bin/echo'}}));
 const hub=createServer((req,res)=>res.end('{"sessions":[]}'));await new Promise(r=>hub.listen(0,'127.0.0.1',r));c.hubUrl=`http://127.0.0.1:${hub.address().port}`;
 t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const p=await projectRegistry(c.projectsPath).add(root),input={project:p.id,source,id:randomUUID(),fingerprint:'0'.repeat(64)};let starts=0;
 const service=createRunnerSetup(c,{prepare:async()=>{starts++;throw Error('private path detail');}});
 const rows=await service.claudeImport('Bearer fixture',{project:p.id,source},'list');assert.equal(rows.status,'store-missing');
 await assert.rejects(service.claudeImport('Bearer fixture',input,'import'),e=>e.rejected===true&&e.reason==='IMPORT_CLI_CONNECTION'&&e.userMessage.includes('CLI'));
 assert.equal(starts,0);assert.equal((await service.claudeImport('Bearer fixture',input,'check')).state,'none');assert.equal(starts,0);
 await accountProfiles(c.accountConfig).connect('claude',source,true);
 await assert.rejects(service.claudeImport('Bearer fixture',input,'import'),e=>e.rejected===true&&e.reason==='IMPORT_RUNNER_PREPARE'&&!e.userMessage.includes('private path detail'));
 assert.equal(starts,1);assert.equal((await service.claudeImport('Bearer fixture',input,'check')).state,'none');assert.equal(starts,1);
});

test('Claude registration response loss recovers through Hub before CLI or Runner preparation',async t=>{
 const {createServer}=await import('node:http'),{randomUUID}=await import('node:crypto'),{accountProfiles}=await import('./account-profiles.mjs'),{projectRegistry}=await import('./project-registry.mjs'),{readFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'maricode-import-recover-')),source=join(root,'cli');await mkdir(source);
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),projectsPath:join(root,'projects'),binary:'/bin/echo',tokenFile:join(root,'token')};
 await writeFile(join(root,'env'),JSON.stringify({HOME:root,PATH:'/usr/bin:/bin'}));await writeFile(c.accountConfig,JSON.stringify({cwd:root,environment:join(root,'env'),cliConnectionRequired:true,binaries:{claude:'/bin/echo'}}));await writeFile(c.tokenFile,'fixture');
 await accountProfiles(c.accountConfig).connect('claude',source,true);const p=await projectRegistry(c.projectsPath).add(root),nativeId=randomUUID(),machineId=randomUUID();
 const base=join(source,'projects',p.path.replace(/[^a-zA-Z0-9]/g,'-'));await mkdir(base,{recursive:true});const raw=JSON.stringify({type:'user',uuid:randomUUID(),sessionId:nativeId,cwd:p.path,message:{content:'synthetic previous history'}})+'\n',file=join(base,nativeId+'.jsonl');await writeFile(file,raw);
 let stored,posts=0,starts=0;
 const hub=createServer(async(req,res)=>{
  if(req.url==='/cli/sessions'){let raw='';for await(const chunk of req)raw+=chunk;stored=JSON.parse(raw);posts++;req.socket.destroy();return;}
  if(req.url==='/api/machines')return res.end(JSON.stringify({machines:[{id:machineId}]}));
  if(req.url==='/api/sessions')return res.end(JSON.stringify({sessions:stored?[stored]:[]}));
  if(stored&&req.url==='/api/sessions/'+stored.id)return res.end(JSON.stringify({session:stored}));
  res.writeHead(404).end('{}');
 });await new Promise(r=>hub.listen(0,'127.0.0.1',r));c.hubUrl=`http://127.0.0.1:${hub.address().port}`;
 t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const service=createRunnerSetup(c,{connection:async()=>true,launch:async({prepared})=>{starts++;await mkdir(join(prepared,'runner-home'));await writeFile(join(prepared,'runner-home/settings.json'),JSON.stringify({machineId}));return {running:true};}});
 const row=(await service.claudeImport('Bearer fixture',{project:p.id,source},'list')).sessions[0],input={project:p.id,source,id:nativeId,fingerprint:row.fingerprint};
 await assert.rejects(service.claudeImport('Bearer fixture',input,'import'),e=>e.rejected!==true);assert.equal(posts,1);assert.equal(starts,1);
 // CLI connection is no longer confirmed, but an existing registration can
 // still be verified. Do not invoke prepare, launch or registration again.
 await rm(join(root,'cli-connections.json'));
 const restarted=createRunnerSetup(c,{prepare:async()=>{throw Error('must not prepare');},launch:async()=>{throw Error('must not launch');}});
 for(const action of ['check','import']){const r=await restarted.claudeImport('Bearer fixture',input,action);assert.equal(r.state,'registered');assert.equal(r.id,stored.id);}
 assert.equal(posts,1);assert.equal(starts,1);assert.equal(await readFile(file,'utf8'),raw);assert.equal((await restarted.claudeImportHistory('Bearer fixture',stored.id)).total,1);
});
test('permanent delete removes only hidden, ended sessions from the Hub and forgets their view',async t=>{
 const {createServer}=await import('node:http'),{projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-delete-'));const source=join(root,'source');await mkdir(source);const directory=join(root,'runner');await mkdir(join(directory,'runner-home'),{recursive:true});
 const accountConfig=join(root,'account');await writeFile(join(directory,'runner-home/settings.json'),JSON.stringify({machineId:'own'}));await writeFile(join(directory,'prepared.json'),JSON.stringify({cwd:source}));
 const projectsPath=join(root,'projects'),project=await projectRegistry(projectsPath).add(source);await writeFile(accountConfig,JSON.stringify({cwd:project.path}));
 const sid='11111111-1111-4111-8111-111111111111';let active=true,sessions=[sid];const deleted=[];
 const hub=createServer((req,res)=>{if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end();return;}
  if(req.method==='DELETE'){deleted.push(req.url);sessions=[];res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sessions:sessions.map(id=>({id,active,metadata:{machineId:'own',path:project.path,flavor:'claude'}}))}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const service=createRunnerSetup({directory,accountConfig,projectsPath,binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`});
 const del={kind:'session',id:sid,action:'delete'};
 await assert.rejects(service.manage('Bearer synthetic',del));assert.equal(deleted.length,0);
 active=false;await assert.rejects(service.manage('Bearer synthetic',del),/제거한/);assert.equal(deleted.length,0);
 await service.manage('Bearer synthetic',{kind:'session',id:sid,action:'remove'});
 await service.manage('Bearer synthetic',del);assert.deepEqual(deleted,['/api/sessions/'+sid]);
 assert.equal((await service.workspace('Bearer synthetic')).length,0);assert.equal((await projectRegistry(projectsPath).navigation()).sessions[sid],undefined);
});
test('removed projects list their sessions so they can be deleted without restoring the project first',async t=>{
 const {createServer}=await import('node:http'),{projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-removed-'));const source=join(root,'source');await mkdir(source);const directory=join(root,'runner');await mkdir(join(directory,'runner-home'),{recursive:true});
 const accountConfig=join(root,'account');await writeFile(join(directory,'runner-home/settings.json'),JSON.stringify({machineId:'own'}));await writeFile(join(directory,'prepared.json'),JSON.stringify({cwd:source}));
 const projectsPath=join(root,'projects'),project=await projectRegistry(projectsPath).add(source);await writeFile(accountConfig,JSON.stringify({cwd:project.path}));
 const sid='11111111-1111-4111-8111-111111111111';let sessions=[sid];const deleted=[];
 const hub=createServer((req,res)=>{if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end();return;}
  if(req.method==='DELETE'){deleted.push(req.url);sessions=[];res.writeHead(200,{'Content-Type':'application/json'}).end('{}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sessions:sessions.map(id=>({id,active:false,metadata:{machineId:'own',path:project.path,flavor:'claude',summary:{text:'예전 대화'}}}))}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const service=createRunnerSetup({directory,accountConfig,projectsPath,binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`});
 await service.manage('Bearer synthetic',{kind:'project',id:project.id,action:'remove'});
 const nav=await service.navigation('Bearer synthetic');const row=nav.removed.find(r=>r.kind==='session'&&r.id===sid);
 assert.ok(row);assert.equal(row.parent,project.name);
 await service.manage('Bearer synthetic',{kind:'session',id:sid,action:'delete'});assert.deepEqual(deleted,['/api/sessions/'+sid]);
 assert.equal((await service.navigation('Bearer synthetic')).removed.some(r=>r.kind==='session'),false);
});

test('branch pin is kept per registered session and checks the repositories directly under its folder',async t=>{
 const {createServer}=await import('node:http'),{projectRegistry}=await import('./project-registry.mjs'),{execFileSync}=await import('node:child_process');
 const root=await mkdtemp(join(tmpdir(),'maricode-pin-'));const source=join(root,'source'),api=join(source,'api');await mkdir(api,{recursive:true});const directory=join(root,'runner');await mkdir(join(directory,'runner-home'),{recursive:true});
 const g=(...a)=>execFileSync('git',a,{cwd:api,stdio:'pipe',env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@t',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@t'}});
 g('init','-q','-b','feature/x');await writeFile(join(api,'a'),'a');g('add','a');g('commit','-qm','a');g('branch','main');
 const projectsPath=join(root,'projects'),project=await projectRegistry(projectsPath).add(source),accountConfig=join(root,'account');
 await writeFile(accountConfig,JSON.stringify({cwd:project.path}));await writeFile(join(directory,'prepared.json'),JSON.stringify({cwd:project.path}));await writeFile(join(directory,'runner-home/settings.json'),JSON.stringify({machineId:'own'}));
 const sid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 const hub=createServer((req,res)=>{if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sessions:[{id:sid,metadata:{machineId:'own',path:project.path,flavor:'claude'}},{id:other,metadata:{machineId:'else',path:project.path,flavor:'claude'}}]}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const service=createRunnerSetup({directory,accountConfig,projectsPath,binary:'/bin/echo',tokenFile:join(root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`});
 await assert.rejects(service.branchPin('Bearer wrong',{id:sid,action:'enable'}),e=>e.status===401);
 await assert.rejects(service.branchPin('Bearer synthetic',{id:other,action:'enable'}));
 await assert.rejects(service.branchPin('Bearer synthetic',{id:sid,action:'add',repo:'api',branch:'main'}));
 let r=await service.branchPin('Bearer synthetic',{id:sid,action:'enable'});assert.deepEqual(r.pin,{repos:{api:['feature/x']}});assert.deepEqual(r.mismatches,[]);
 assert.deepEqual((await service.workspace('Bearer synthetic'))[0].branchPin,{repos:{api:['feature/x']}});
 g('checkout','-q','main');r=await service.branches('Bearer synthetic',sid);assert.deepEqual(r.mismatches,[{repo:'api',current:'main',allowed:['feature/x']}]);
 await assert.rejects(service.branchPin('Bearer synthetic',{id:sid,action:'add',repo:'api',branch:'nope'}));
 r=await service.branchPin('Bearer synthetic',{id:sid,action:'add',repo:'api',branch:'main'});assert.deepEqual(r.mismatches,[]);
 r=await service.branchPin('Bearer synthetic',{id:sid,action:'remove',repo:'api',branch:'feature/x'});assert.deepEqual(r.pin,{repos:{api:['main']}});
 r=await service.branchPin('Bearer synthetic',{id:sid,action:'disable'});assert.equal(r.pin,null);assert.equal((await service.workspace('Bearer synthetic'))[0].branchPin,undefined);
});
test('runner readiness failures keep the specific reason so the user sees why a new folder was not applied',async()=>{
 const {runnerSetupReason}=await import('./runner-setup.mjs');
 assert.equal(runnerSetupReason(Object.assign(Error('x'),{code:'RUNNER_ACTIVE'})),'RUNNER_ACTIVE');
 assert.equal(runnerSetupReason(Object.assign(Error('x'),{code:'RUNNER_UNCONFIRMED'})),'RUNNER_UNCONFIRMED');
 assert.equal(runnerSetupReason(Error('connection')),'RUNNER_SETUP');
});

test('registered workspace restarts after saved default disappears and preserves machine identity',async t=>{
 const {readFile}=await import('node:fs/promises'),{createServer}=await import('node:http'),{projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-missing-default-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const c={directory:join(root,'runner'),accountConfig:join(root,'accounts'),projectsPath:join(root,'projects'),binary:'/bin/echo',tokenFile:join(root,'token')};
 const old=join(root,'old');await mkdir(old);await writeFile(join(root,'env'),'{"PATH":"/usr/bin:/bin"}');await writeFile(c.accountConfig,JSON.stringify({cwd:old,environment:join(root,'env'),binaries:{codex:'/bin/echo'}}));await writeFile(c.tokenFile,'synthetic');
 const project=await projectRegistry(c.projectsPath).add(root);
 const hub=createServer((req,res)=>res.writeHead(req.headers.authorization==='Bearer synthetic'?200:401,{'Content-Type':'application/json'}).end('{"sessions":[]}'));
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});c.hubUrl=`http://127.0.0.1:${hub.address().port}`;
 let starts=0;const plans=[];
 const deps={connection:async()=>true,hasActive:async()=>false,launch:async({prepared})=>{const plan=JSON.parse(await readFile(join(prepared,'prepared.json'),'utf8'));plans.push(plan);starts++;await mkdir(join(prepared,'runner-home'));await writeFile(join(prepared,'runner-home/settings.json'),JSON.stringify({machineId:plan.machineId??'stable-machine'}));let running=true;return {get running(){return running;},stop:async()=>{running=false;}};}};
 const first=createRunnerSetup(c,deps);await first.prepare();await first.start();await first.stop();await rm(old,{recursive:true});
 const before=await readFile(c.accountConfig,'utf8'),restarted=createRunnerSetup(c,deps);
 await assert.rejects(restarted.ready('Bearer synthetic','unknown','codex'));assert.equal(starts,1);
 await restarted.ready('Bearer synthetic',project.id,'codex');assert.equal(starts,2);assert.equal(plans[1].cwd,project.path);assert.equal(plans[1].machineId,'stable-machine');
 await restarted.ready('Bearer synthetic',project.id,'codex');assert.equal(starts,2);assert.equal(await readFile(c.accountConfig,'utf8'),before);
 await restarted.stop();
 const fresh=createRunnerSetup({...c,directory:join(root,'fresh')},deps);await fresh.ready('Bearer synthetic',project.id,'codex');assert.equal(plans[2].cwd,project.path);await fresh.stop();
});
