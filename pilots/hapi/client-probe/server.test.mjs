import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer,allowedRoute } from './server.mjs';
const id='00000000-0000-0000-0000-000000000000';
const url=path=>new URL(path,'http://local');
test('proxy is limited to one test session and relative file reads',()=>{
  assert.equal(allowedRoute('GET',url(`/api/sessions/${id}/directory?path=notes-link`),id),true);
  for(const p of ['/api/sessions/another/messages','/api/machines',`/api/sessions/${id}/file?path=../auth`,`/api/events?sessionId=${id}&token=secret`,`/api/events?sessionId=${id}&all=true`])assert.equal(allowedRoute('GET',url(p),id),false);
  assert.equal(allowedRoute('POST',url(`/api/sessions/${id}/permissions/x/approve`),id),true);
  assert.equal(allowedRoute('POST',url(`/api/sessions/${id}/permissions/x/approve/extra`),id),false);
});
test('no implicit Hub credentials; cross-origin mutation never reaches upstream',async t=>{
  let count=0;
  const upstream=http.createServer((req,res)=>{count++;res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
  const origin=`http://127.0.0.1:${server.address().port}`,path=`/api/sessions/${id}/messages`;
  assert.equal((await fetch(origin+path)).status,401);
  assert.equal((await fetch(origin+path,{method:'POST',headers:{Origin:'https://wrong.example','Content-Type':'application/json',Authorization:'Bearer synthetic'},body:'{}'})).status,403);
  assert.equal(count,0);
  assert.equal((await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:'{}'})).status,200);
  assert.equal(count,1);
});
test('two explicitly allowed trial sessions never permit a third session',()=>{
  const second='11111111-1111-1111-1111-111111111111';
  assert.equal(allowedRoute('GET',url(`/api/sessions/${second}/messages`),[id,second]),true);
  assert.equal(allowedRoute('POST',url(`/api/sessions/${id}/resume`),[id,second]),true);
  assert.equal(allowedRoute('GET',url('/api/sessions/22222222-2222-2222-2222-222222222222/messages'),[id,second]),false);
});

test('permission proxy rejects changed requests, broader grants and repeat decisions',async t=>{
 let approvals=0;const bodies=[];const current={tool:'Bash',arguments:{command:'echo trial'}};
 const upstream=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='GET')res.end(JSON.stringify({session:{active:true,agentState:{requests:{request1:current,request2:current,'codex:thread:number:0':current}}}}));else{let body='';for await(const chunk of req)body+=chunk;bodies.push(JSON.parse(body));approvals++;res.end('{"ok":true}');}});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,path=`/api/sessions/${id}/permissions/request1/approve`;
 const post=body=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify(body)});
 assert.equal((await post({expected:{tool:'Bash',arguments:{command:'different'}}})).status,409);
 assert.equal((await post({expected:current,mode:'bypassPermissions'})).status,400);assert.equal(approvals,0);
 assert.equal((await post({expected:current})).status,200);
 assert.equal((await post({expected:current})).status,409);assert.equal(approvals,1);
 const denied=await fetch(origin+`/api/sessions/${id}/permissions/request2/deny`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify({expected:current})});
 assert.equal(denied.status,200);assert.deepEqual(bodies,[{decision:'approved'},{decision:'denied'}]);
 const codex=await fetch(origin+`/api/sessions/${id}/permissions/${encodeURIComponent('codex:thread:number:0')}/deny`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify({expected:current})});
 assert.equal(codex.status,200);assert.equal(bodies.length,3);
 assert.equal(allowedRoute('POST',url(`/api/sessions/${id}/permissions/x%2Fy/deny`),id),false);
});

test('new handoff requires source authorization and cannot change target or create twice',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'handoff-api-'));let spawns=0;
 const child='22222222-2222-2222-2222-222222222222';
 const upstream=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}
  if(req.method==='POST'){spawns++;res.end(JSON.stringify({type:'success',sessionId:child}));return;}
  res.end(JSON.stringify({session:{active:true,metadata:{machineId:'machine',path:'/trial',flavor:req.url.includes(child)?'claude':'codex'}}}));
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id,handoffTarget:{directory,machineId:'machine',project:'/trial'}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();await rm(directory,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const post=(body='{}',auth='synthetic')=>fetch(origin+`/api/sessions/${id}/handoff`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${auth}`},body});
 assert.equal((await post('{}','invalid')).status,401);
 assert.equal((await post('{"yolo":true}')).status,400);assert.equal(spawns,0);
 assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal(spawns,1);
 assert.equal((await fetch(origin+`/api/sessions/${child}`,{headers:{Authorization:'Bearer synthetic'}})).status,200);
});

test('independent task authenticates fixed project anchor and rejects target overrides and duplicate spawn',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'tasks-api-'));let spawns=0;const child='55555555-5555-5555-5555-555555555555';
 const upstream=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}
  if(req.method==='POST'){let raw='';for await(const part of req)raw+=part;assert.deepEqual(JSON.parse(raw),{directory:'/personal',agent:'codex',startingMode:'remote',sessionType:'simple',yolo:false});spawns++;res.end(JSON.stringify({type:'success',sessionId:child}));return;}
  res.end(JSON.stringify({session:{active:true,metadata:{machineId:'machine',path:req.url.includes(child)?'/personal':'/trial',flavor:'codex'}}}));
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id,handoffTarget:{directory,machineId:'machine',project:'/trial'},taskTarget:{directory:join(directory,'personal'),machineId:'machine',project:'/personal'}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();await rm(directory,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`,body={requestId:'66666666-6666-6666-6666-666666666666',agent:'codex'};
 const post=(b,auth='synthetic')=>fetch(origin+'/api/tasks',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${auth}`},body:JSON.stringify(b)});
 assert.equal((await post(body,'invalid')).status,401);
 assert.equal((await post({...body,directory:'/other'})).status,400);assert.equal(spawns,0);
 const first=await post(body);assert.equal(first.status,200);assert.equal((await first.json()).session.parentId,undefined);
 assert.equal((await post(body)).status,200);assert.equal(spawns,1);
 const handoffState=await fetch(origin+`/api/sessions/${child}/handoff`,{headers:{Authorization:'Bearer synthetic'}});assert.equal(handoffState.status,200);assert.equal((await handoffState.json()).state,'none');
 assert.equal((await post({...body,agent:'claude'})).status,409);
 assert.equal((await fetch(origin+`/api/sessions/${child}`,{headers:{Authorization:'Bearer synthetic'}})).status,200);
});

test('project selection is authenticated and selected directory survives task creation and handoff',async t=>{
 const {mkdtemp,mkdir,realpath,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{randomUUID}=await import('node:crypto');
 const temp=await realpath(await mkdtemp(join(tmpdir(),'project-api-'))),root=join(temp,'personal'),sub=join(root,'app');await mkdir(sub,{recursive:true});
 const created=new Map();let spawns=0;
 const upstream=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}
  if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);assert.equal(body.directory,sub);assert.equal(body.yolo,false);const child=randomUUID();created.set(child,{active:true,metadata:{machineId:'machine',path:body.directory,flavor:body.agent}});spawns++;res.end(JSON.stringify({type:'success',sessionId:child}));return;}
  const sid=req.url.split('/').at(-1);res.end(JSON.stringify({session:created.get(sid)??{active:true,metadata:{machineId:'machine',path:'/trial',flavor:'codex'}}}));
 });await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id,handoffTarget:{directory:join(temp,'trial-records'),machineId:'machine',project:'/trial'},taskTarget:{directory:join(temp,'records'),machineId:'machine',project:root}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();await rm(temp,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer synthetic',Origin:origin,'Content-Type':'application/json'};
 assert.equal((await fetch(origin+'/api/projects')).status,401);
 assert.equal((await fetch(origin+'/api/projects',{headers:{Authorization:'Bearer bad'}})).status,401);
 assert.deepEqual((await (await fetch(origin+'/api/projects',{headers})).json()).projects.map(p=>p.key),['','app']);
 const request={requestId:randomUUID(),agent:'codex',project:'app'};
 const post=(path,body)=>fetch(origin+path,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await post('/api/tasks',{...request,project:'../outside'})).status,403);assert.equal(spawns,0);
 const response=await post('/api/tasks',request);assert.equal(response.status,200);const child=(await response.json()).session.id;
 assert.equal((await post('/api/tasks',{...request,project:''})).status,409);assert.equal(spawns,1);
 const handoff=await post(`/api/sessions/${child}/handoff`,{});assert.equal(handoff.status,200);const result=(await handoff.json()).session;
 assert.equal(result.project,sub);assert.equal(result.agent,'claude');assert.equal(spawns,2);
});

test('settings authorize session, validate stale choices and reject unscoped permission and duplicate changes',async t=>{
 let changes=0,failReadback=false;const state={active:true,metadata:{flavor:'codex'},agentState:{controlledByUser:false,requests:{}},model:'m1',modelReasoningEffort:'high'};
 const upstream=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}
  if(req.method==='POST'){let body='';for await(const c of req)body+=c;changes++;assert.deepEqual(JSON.parse(body),{modelReasoningEffort:'low'});state.modelReasoningEffort='low';res.end('{"ok":true}');return;}
  if(failReadback&&changes===2&&!req.url.endsWith('/codex-models')){failReadback=false;res.writeHead(503).end('{}');return;}
  res.end(JSON.stringify(req.url.endsWith('/codex-models')?{success:true,models:[{id:'m1',supportedReasoningEfforts:['low','high']}]}:{session:state}));
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,path=origin+`/api/sessions/${id}/settings`,input={field:'effort',value:'low',expected:{model:'m1',effort:'high'}};
 const post=body=>fetch(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify(body)});
 assert.equal((await fetch(path)).status,401);
 assert.equal((await post({...input,yolo:true})).status,409);assert.equal(changes,0);
 const r=await post(input);assert.equal(r.status,200);assert.equal((await r.json()).current.effort,'low');
 assert.equal((await post(input)).status,409);assert.equal(changes,1);
 state.modelReasoningEffort='high';failReadback=true;const lost=await post(input);assert.equal(lost.status,503);assert.equal((await lost.json()).rejected,false);
 const recovered=await fetch(path,{headers:{Authorization:'Bearer synthetic'}});assert.equal((await recovered.json()).current.effort,'low');assert.equal(changes,2);
 assert.equal(allowedRoute('POST',url(`/api/sessions/${id}/model`),id),false);
});

test('account routes require Hub authorization, deny remote login and reject arbitrary payloads',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const directory=await mkdtemp(join(tmpdir(),'account-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let starts=0,reads=0;const upstream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}res.end(JSON.stringify({session:{metadata:{machineId:'machine',path:'/trial',host:'test-machine'}}}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id,origins:['https://remote.test'],handoffTarget:{directory,machineId:'machine',project:'/trial'},accountsService:{status:async()=>{reads++;return {state:'connected'};},start:async()=>{starts++;return {state:'signed-out',loginPending:true};}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(origin+'/api/accounts')).status,401);assert.equal(reads,0);
 assert.equal((await fetch(origin+'/api/accounts',{headers:{Authorization:'Bearer bad'}})).status,401);
 const post=(body,headers={})=>fetch(origin+'/api/accounts/codex/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic',...headers},body});
 assert.equal((await post('{"command":"anything"}')).status,400);
 assert.equal((await post('{}',{Host:'remote.test',Origin:'https://remote.test'})).status,403);assert.equal(starts,0);
 assert.equal((await post('{}',{'X-Forwarded-For':'100.64.0.1'})).status,403);assert.equal(starts,0);
 assert.equal((await post('{}')).status,200);assert.equal(starts,1);
 const r=await fetch(origin+'/api/accounts',{headers:{Authorization:'Bearer synthetic'}});assert.equal((await r.json()).providers.length,2);
});

test('archive authenticates, checks displayed state, and does not replay an uncertain request',async t=>{
 let count=0,state={active:true,thinking:false,metadataVersion:2,agentStateVersion:3,agentState:{controlledByUser:false,requests:{}}};
 const upstream=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}
  if(req.method==='GET'){res.end(JSON.stringify({session:state}));return;}
  count++;res.destroy();
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const body={requestId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',expected:{metadataVersion:2,agentStateVersion:3}};
 const post=(input=body,auth='synthetic')=>fetch(origin+`/api/sessions/${id}/archive`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await post(body,'wrong')).status,401);
 state.thinking=true;assert.equal((await post()).status,409);state.thinking=false;
 state.agentState.requests={x:{}};assert.equal((await post()).status,409);state.agentState.requests={};
 assert.equal((await post({...body,expected:{metadataVersion:1,agentStateVersion:3}})).status,409);assert.equal(count,0);
 assert.equal((await post()).status,502);assert.equal(count,1);
 assert.equal((await post()).status,409);assert.equal(count,1);
});

test('archive and other session mutations exclude each other in both directions',async t=>{
 let release,entered,posts=0;
 const upstream=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'){res.end(JSON.stringify({session:{active:true,thinking:false,metadataVersion:2,agentStateVersion:3,agentState:{controlledByUser:false,requests:{}}}}));return;}
  posts++;entered();await new Promise(r=>release=r);res.end('{"ok":true}');
 });await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const archive={requestId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',expected:{metadataVersion:2,agentStateVersion:3}};
 const post=route=>fetch(origin+`/api/sessions/${id}/${route}`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(route==='archive'?archive:{})});
 for(const [first,second] of [['messages','archive'],['archive','messages']]){
  const ready=new Promise(r=>entered=r),request=post(first);await ready;
  assert.equal((await post(second)).status,409);release();assert.equal((await request).status,200);
 }
 assert.equal(posts,2);
});

test('desktop credential handoff accepts only a local file navigation with an explicit one-use grant',async t=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'desktop-web-')),environmentPath=join(directory,'environment.json');
 const {createEnvironment}=await import('./environment.mjs');await createEnvironment(environmentPath).save({revision:0,roles:{local:true,server:false,remote:false}});
 let calls=0;const code='a'.repeat(64);
 const server=createServer({upstream:'http://127.0.0.1:1',sessions:[],environmentPath,desktopAccess:{exchange:async value=>{if(value!==code||calls++)throw Error();return 'synthetic-issued';}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();server.close();await rm(directory,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`;
 // Native HTTP client preserves Fetch Metadata; fetch itself overwrites sec-fetch-mode.
 const post=(extra={},body='code='+code)=>new Promise((resolve,reject)=>{const r=http.request(origin+'/desktop-connect',{method:'POST',headers:{origin:'null','content-type':'application/x-www-form-urlencoded','sec-fetch-mode':'navigate','sec-fetch-dest':'document',...extra}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,data}));});r.on('error',reject);r.end(body);});
 assert.equal((await post({origin:'https://evil.example'})).status,403);
 assert.equal((await post({'x-forwarded-host':'remote.example'})).status,403);
 assert.equal((await post({'sec-fetch-mode':'cors'})).status,403);assert.equal(calls,0);
 assert.equal((await post({},'code=invalid')).status,400);
 const allowed=await post();assert.equal(allowed.status,200);assert.match(allowed.data,/id="desktop-credential">"synthetic-issued"/);
 assert.equal((await post()).status,403);
});

test('session preparation validates input before lifecycle changes and reports active work without spawning',async t=>{
 let readyCalls=0,spawns=0,blocked=true,received;
 const runnerService={workspace:async()=>[],projects:async auth=>{if(auth!=='Bearer synthetic')throw Object.assign(Error(),{status:401});return [];},status:async()=>({workspaceAvailable:true}),ready:async(...args)=>{readyCalls++;received=args;if(blocked)throw Object.assign(Error(),{code:'RUNNER_ACTIVE'});},task:async()=>{spawns++;return {state:'created'};}};
 const server=createServer({upstream:'http://127.0.0.1:1',runnerService});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const base=`http://127.0.0.1:${server.address().port}`;
 const request={requestId:'00000000-0000-0000-0000-000000000010',agent:'claude',project:'project-id'};
 const post=body=>fetch(base+'/api/tasks',{method:'POST',headers:{origin:base,authorization:'Bearer synthetic','content-type':'application/json'},body:JSON.stringify(body)});
 for(const body of [{...request,requestId:'invalid'},{...request,extra:true},{...request,project:3},null]){const r=await post(body);assert.equal(r.status,400);assert.equal((await r.json()).rejected,true);}assert.equal(readyCalls,0);
 const r=await post(request);assert.equal(r.status,409);const body=await r.json();assert.equal(body.reason,'RUNNER_ACTIVE');assert.equal(body.rejected,true);assert.equal(spawns,0);
 blocked=false;assert.equal((await post(request)).status,200);assert.deepEqual(received,['Bearer synthetic','project-id','claude']);assert.equal(spawns,1);
});

test('Git summary only reads an allowed session and strips raw paths and errors',async t=>{
 for(const [method,path] of [['POST',`/api/sessions/${id}/git-status`],['GET',`/api/sessions/${id}/git-status?cwd=/other`],['GET','/api/sessions/other/git-status']])assert.equal(allowedRoute(method,url(path),id),false);
 let calls=0;
 const upstream=http.createServer((req,res)=>{calls++;res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}res.end(JSON.stringify({success:true,stdout:'# branch.oid '+ 'c'.repeat(40)+'\n# branch.head feature/test\n? private-file.txt\n',stderr:'private path'}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,path=`/api/sessions/${id}/git-status`;
 assert.equal((await fetch(origin+path)).status,401);assert.equal(calls,0);
 assert.equal((await fetch(origin+path,{headers:{Authorization:'Bearer invalid'}})).status,401);
 const response=await fetch(origin+path,{headers:{Authorization:'Bearer synthetic'}}),data=await response.json();
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(data.changed,1);assert.equal(data.branch,'feature/test');assert.equal(JSON.stringify(data).includes('private'),false);
});

test('navigation endpoint retains same-origin, authentication and body limits',async t=>{
 let writes=0;const authorize=auth=>{if(auth!=='Bearer synthetic')throw Object.assign(Error('Authentication required'),{status:401});};
 const runnerService={workspace:async()=>[],navigation:async auth=>{authorize(auth);return {removed:[],sessions:{}};},manage:async(auth,input)=>{authorize(auth);writes++;return {ok:true};}};
 const server=createServer({upstream:'http://127.0.0.1:1',runnerService});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,body=JSON.stringify({kind:'project',id,action:'remove'});
 const post=(auth='Bearer synthetic',requestOrigin=origin,data=body)=>fetch(origin+'/api/navigation',{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',Authorization:auth},body:data});
 assert.equal((await fetch(origin+'/api/navigation')).status,401);
 assert.equal((await post('Bearer wrong')).status,401);assert.equal((await post('Bearer synthetic','https://wrong.example')).status,403);
 assert.equal((await post('Bearer synthetic',origin,'x'.repeat(2100))).status,413);assert.equal(writes,0);
 assert.equal((await post()).status,200);assert.equal(writes,1);
});

test('scoped approvals bind provider and derive session policy without replay',async t=>{
 const current={tool:'Bash',arguments:{command:'printf trial'}};let count=0,payload;
 const hub=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='GET')return res.end(JSON.stringify({session:{active:true,metadata:{flavor:'claude'},agentState:{requests:{r:current}}}}));let raw='';for await(const c of req)raw+=c;payload=JSON.parse(raw);count++;res.end('{"ok":true}');});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,sessionId:id});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});
 const origin=`http://127.0.0.1:${proxy.address().port}`;
 const post=body=>fetch(origin+`/api/sessions/${id}/permissions/r/approve`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const body of [{expected:current,scope:'session'},{expected:current,scope:'session',engine:'codex'},{expected:current,scope:'always',engine:'claude'},{expected:current,scope:'session',engine:'claude',allowTools:['*']}]){const r=await post(body);assert.ok(r.status>=400);assert.equal((await r.json()).rejected,true);}assert.equal(count,0);
 const body={expected:current,scope:'session',engine:'claude'};assert.equal((await post(body)).status,200);assert.deepEqual(payload,{decision:'approved',allowTools:['Bash(printf trial)']});assert.equal((await (await post(body)).json()).rejected,false);assert.equal(count,1);
});
test('offline file reads expose a recoverable runner error without forwarding file access',async t=>{
 let reads=0;const hub=http.createServer((req,res)=>{reads++;res.end('{}');});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:{workspace:async()=>[{id,project:'/trial'}],target:async()=>{throw Object.assign(Error('offline'),{status:409});}}});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});
 const r=await fetch(`http://127.0.0.1:${proxy.address().port}/api/sessions/${id}/directory?path=`,{headers:{Authorization:'Bearer synthetic'}});assert.equal(r.status,409);assert.equal((await r.json()).reason,'RUNNER_OFFLINE');assert.equal(reads,0);
});

test('explicit resume prepares only the session project and engine before forwarding',async t=>{
 let starts=0,forwarded=0,prepared;const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST'){forwarded++;return res.end(JSON.stringify({sessionId:id}));}res.end(JSON.stringify({session:{active:false,metadata:{machineId:'own',path:'/trial',flavor:'codex'}}}));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const service={workspace:async()=>[{id,project:'/trial'}],projects:async()=>[{key:'project-key',path:'/trial'}],ready:async(...args)=>{starts++;prepared=args;},status:async()=>({workspaceAvailable:starts>0}),runSessionMutation:async(fn)=>{assert.equal(starts,1);return fn();}};
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:service});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});const origin=`http://127.0.0.1:${proxy.address().port}`;
 const r=await fetch(origin+`/api/sessions/${id}/resume`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200);assert.deepEqual(prepared,['Bearer synthetic','project-key','codex']);assert.equal(forwarded,1);
});

test('closing the browser does not cancel or replay an accepted resume',async t=>{
 let accepted,release;const seen=new Promise(r=>{accepted=r;}),gate=new Promise(r=>{release=r;});let forwarded=0,failed=0,finished=false,expectation;
 const before={id,active:false,metadata:{machineId:'own',path:'/trial',flavor:'codex',codexSessionId:'native'}};
 const hub=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST'){forwarded++;accepted();await gate;res.end(JSON.stringify({sessionId:id}));return;}res.end(JSON.stringify({session:before}));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const service={workspace:async()=>[{id,project:'/trial'}],projects:async()=>[{key:'project',path:'/trial'}],ready:async()=>{},status:async()=>({workspaceAvailable:true}),runSessionMutation:async(fn,options)=>{expectation=options;try{const r=await fn();finished=true;return r;}catch(e){failed++;throw e;}}};
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:service});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{release();for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});
 const origin=`http://127.0.0.1:${proxy.address().port}`,controller=new AbortController();
 const sending=fetch(origin+`/api/sessions/${id}/resume`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{}',signal:controller.signal}).catch(()=>null);
 await seen;controller.abort();await sending;await new Promise(r=>setTimeout(r,30));release();
 for(let i=0;i<50&&!finished&&!failed;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(failed,0);assert.equal(finished,true);assert.equal(forwarded,1);assert.deepEqual(expectation?.resume,before);
});

test('session readback keeps unresolved resume blocked until reconciliation succeeds',async t=>{
 let resolved=false,checks=0;const hub=http.createServer((req,res)=>res.end(JSON.stringify({session:{id,active:true}})));await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const service={workspace:async()=>[{id,project:'/trial'}],reconcileResume:async(sid,auth)=>{assert.equal(sid,id);assert.equal(auth,'Bearer synthetic');checks++;return resolved;}};
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:service});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});
 const url=`http://127.0.0.1:${proxy.address().port}/api/sessions/${id}`;
 assert.equal((await (await fetch(url,{headers:{Authorization:'Bearer synthetic'}})).json()).session.resumeUnconfirmed,true);
 const post=await fetch(url+'/resume',{method:'POST',headers:{Origin:new URL(url).origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{}'});assert.equal(post.status,409);assert.equal((await post.json()).reason,'RESUME_UNCONFIRMED');resolved=true;
 const recovered=(await (await fetch(url,{headers:{Authorization:'Bearer synthetic'}})).json()).session;assert.equal(recovered.active,true);assert.notEqual(recovered.resumeUnconfirmed,true);assert.equal(checks,3);
});
test('truncated resume acknowledgement is uncertain before releasing the runner lock',async t=>{
 let failed=0,forwarded=0;
 const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST'){forwarded++;res.writeHead(200,{'Content-Length':'100'});res.write('{');setTimeout(()=>res.destroy(),10);return;}res.end(JSON.stringify({session:{id,active:false,metadata:{machineId:'own',path:'/trial',flavor:'codex',codexSessionId:'native'}}}));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const service={workspace:async()=>[{id,project:'/trial'}],projects:async()=>[{key:'project',path:'/trial'}],ready:async()=>{},status:async()=>({workspaceAvailable:true}),runSessionMutation:async fn=>{try{return await fn();}catch(e){failed++;throw e;}}};
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:service});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});
 const origin=`http://127.0.0.1:${proxy.address().port}`;
 const r=await fetch(origin+`/api/sessions/${id}/resume`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{}'});
 assert.equal(r.status,502);assert.equal(failed,1);assert.equal(forwarded,1);
});
test('attachment upload is session-authorized, bounded and forwarded once per request',async t=>{
 let uploads=0;
 const upstream=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic')return res.writeHead(401).end('{}');if(req.method==='GET')return res.end(JSON.stringify({session:{id,active:true}}));uploads++;for await(const chunk of req){}res.end('{"success":true,"path":"/owned/upload"}');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});const origin=`http://127.0.0.1:${server.address().port}`;
 const payload={requestId:'10000000-0000-4000-8000-000000000001',filename:'a.txt',mimeType:'text/plain',content:'aGk='};
 const post=(body,auth='synthetic')=>fetch(origin+`/api/sessions/${id}/upload`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post(payload,'wrong')).status,401);assert.equal(uploads,0);
 assert.equal((await post({...payload,path:'/private'})).status,400);assert.equal(uploads,0);
 assert.equal((await post(payload)).status,200);assert.equal((await post(payload)).status,200);assert.equal(uploads,1);
 assert.equal((await post({...payload,content:'Ynk='})).status,409);assert.equal((await post(payload,'wrong')).status,401);assert.equal(uploads,1);
});

test('question answers bind the authenticated current request and cannot grant broader permission',async t=>{
 let current={tool:'AskUserQuestion',arguments:{questions:[{question:'Which test?',options:[{label:'Focused'},{label:'Full'}]}]}},forwarded=[];
 const hub=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic')return res.writeHead(401).end('{}');if(req.method==='GET')return res.end(JSON.stringify({session:{active:true,metadata:{flavor:'claude'},agentState:{requests:{q:current}}}}));let raw='';for await(const c of req)raw+=c;forwarded.push(JSON.parse(raw));res.end('{}');});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,sessionId:id});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});
 const origin=`http://127.0.0.1:${proxy.address().port}`,post=(body,auth='synthetic')=>fetch(origin+`/api/sessions/${id}/permissions/q/approve`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const valid={expected:structuredClone(current),engine:'claude',answers:{'0':['Focused']}};
 assert.equal((await post(valid,'wrong')).status,401);
 for(const change of [{engine:'codex'},{scope:'session'},{answers:{'1':['Full']}},{answers:{'0':['Focused','Full']}}])assert.ok((await post({...valid,...change})).status>=400);
 current={...current,arguments:{questions:[{question:'Secret?',isSecret:true}]}};assert.equal((await post({...valid,expected:current})).status,400);
 assert.equal((await post(valid)).status,409);assert.equal(forwarded.length,0);
 current=valid.expected;assert.equal((await post(valid)).status,200);assert.deepEqual(forwarded,[{decision:'approved',answers:{'0':['Focused']}}]);
 assert.equal((await post(valid)).status,409);assert.equal(forwarded.length,1);
});

test('local Claude imports require same-origin authenticated service and are unavailable through remote forwarding',async t=>{
 let calls=0;const service={workspace:async auth=>{if(auth!=='Bearer fixture')throw Object.assign(Error('auth'),{status:401});return [];},target:async()=>({project:'/fixture'}),claudeImport:async(auth,input,action)=>{if(auth!=='Bearer fixture')throw Object.assign(Error('auth'),{status:401});calls++;return {sessions:[],action};}};
 const server=createServer({upstream:'http://127.0.0.1:1',runnerService:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}`;const request=(headers={})=>fetch(url+'/api/claude-import/list',{method:'POST',headers:{origin:url,'content-type':'application/json',...headers},body:JSON.stringify({project:'fixture'})});
 assert.equal((await request()).status,401);assert.equal((await request({authorization:'Bearer fixture','x-forwarded-for':'127.0.0.1'})).status,403);assert.equal((await request({authorization:'Bearer fixture',origin:'https://untrusted.example'})).status,403);assert.equal(calls,0);
 assert.equal((await request({authorization:'Bearer fixture'})).status,200);assert.equal(calls,1);
 const config=await(await fetch(url+'/config',{headers:{authorization:'Bearer fixture'}})).json();assert.equal(config.claudeImport,true);
});

test('general conversation preparation rejects cross-origin, unauthenticated and arbitrary folder requests',async t=>{
 let calls=0;const service={generalChat:async auth=>{if(auth!=='Bearer fixture')throw Object.assign(Error('auth'),{status:401});calls++;return {project:'owned'};}};
 const server=createServer({upstream:'http://127.0.0.1:1',runnerService:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}`;
 const send=(body='{}',headers={})=>fetch(url+'/api/conversations/prepare',{method:'POST',headers:{origin:url,'content-type':'application/json',...headers},body});
 assert.equal((await send()).status,401);assert.equal((await send('{}',{authorization:'Bearer fixture',origin:'https://wrong.example'})).status,403);
 assert.equal((await send('{"path":"/another-project"}',{authorization:'Bearer fixture'})).status,400);assert.equal(calls,0);
 assert.equal((await send('{}',{authorization:'Bearer fixture'})).status,200);assert.equal(calls,1);
});

test('access setting stays scoped, rejects stale providers and does not resend after lost readback',async t=>{
 let writes=0,drop=false;const state={active:true,metadata:{flavor:'claude'},permissionMode:'default',agentState:{controlledByUser:false,requests:{}}};
 const upstream=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}
  if(req.method==='POST'){assert.equal(req.url,`/api/sessions/${id}/permission-mode`);let raw='';for await(const c of req)raw+=c;assert.deepEqual(JSON.parse(raw),{mode:'bypassPermissions'});writes++;state.permissionMode='bypassPermissions';res.end('{"ok":true}');return;}
  if(drop&&writes){drop=false;res.writeHead(503).end('{}');return;}
  res.end(JSON.stringify({session:state}));
 });await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,path=origin+`/api/sessions/${id}/settings`,headers={Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'};
 const input={field:'permissionMode',value:'bypassPermissions',expected:{model:null,effort:null,permissionMode:'default',flavor:'claude'}};
 const post=body=>fetch(path,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await fetch(path)).status,401);
 assert.equal((await post({...input,expected:{...input.expected,flavor:'codex'}})).status,409);
 state.agentState.requests={pending:{}};assert.equal((await post(input)).status,409);assert.equal(writes,0);state.agentState.requests={};
 drop=true;const lost=await post(input);assert.equal(lost.status,503);assert.equal((await lost.json()).rejected,false);assert.equal(writes,1);
 assert.equal((await (await fetch(path,{headers})).json()).current.permissionMode,'bypassPermissions');assert.equal(writes,1);
 assert.equal((await post(input)).status,409);assert.equal(writes,1);
 assert.equal(allowedRoute('POST',url(`/api/sessions/${id}/permission-mode`),id),false);
});


test('HTML titles and visible branding use the running product version',async t=>{
 const {PRODUCT_VERSION}=await import('../../../apps/mac-launcher/version.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createEnvironment}=await import('./environment.mjs');
 const dir=await mkdtemp(join(tmpdir(),'maricode-brand-')),environmentPath=join(dir,'environment.json');
 await createEnvironment(environmentPath).save({revision:0,roles:{local:true,server:false,remote:true}});
 const server=createServer({upstream:'http://127.0.0.1:1',sessionId:id,environmentPath});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();return rm(dir,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/workspace','/setup','/connections','/install','/']){
  const response=await fetch(origin+path);assert.equal(response.status,200,path);
  const html=await response.text();assert.ok(html.includes(`Maricode ${PRODUCT_VERSION}`),path);
  assert.ok(!html.includes('{{PRODUCT_VERSION}}'),path);assert.ok(!html.includes('MARICODE 1.0.0'),path);
 }
 const manifest=await(await fetch(origin+'/manifest.webmanifest')).json();assert.equal(manifest.short_name,'Maricode');
});
test('read-only diff routes accept only project-relative paths',()=>{
 const ok=u=>allowedRoute('GET',new URL('http://x'+u),'s1');
 assert.equal(ok('/api/sessions/s1/git-diff-numstat'),true);assert.equal(ok('/api/sessions/s1/git-diff-numstat?staged=true'),true);
 assert.equal(ok('/api/sessions/s1/git-diff-file?path=src/a.js'),true);assert.equal(ok('/api/sessions/s1/git-diff-file?path=src/a.js&staged=true'),true);
 assert.equal(ok('/api/sessions/s1/git-diff-file?path=../secret'),false);assert.equal(ok('/api/sessions/s1/git-diff-file?path=/etc/passwd'),false);
 assert.equal(ok('/api/sessions/s1/git-diff-file?path=a&extra=1'),false);assert.equal(allowedRoute('POST',new URL('http://x/api/sessions/s1/git-diff-numstat'),'s1'),false);
});

test('account switching is local-only, authenticated and passes rejection messages through',async t=>{
 const calls=[];const service={accountProfiles:async auth=>{if(auth!=='Bearer fixture')throw Object.assign(Error('auth'),{status:401});return {codex:{active:'default',accounts:[]}};},
  accountProfile:async(auth,input)=>{if(auth!=='Bearer fixture')throw Object.assign(Error('auth'),{status:401});calls.push(input);if(input.id==='busy')throw Object.assign(Error('실행 중'),{rejected:true});return {ok:true};}};
 const server=createServer({upstream:'http://127.0.0.1:1',runnerService:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}`,post=(body,headers={})=>fetch(url+'/api/account-profiles',{method:'POST',headers:{origin:url,'content-type':'application/json',authorization:'Bearer fixture',...headers},body:JSON.stringify(body)});
 assert.equal((await fetch(url+'/api/account-profiles')).status,401);
 assert.equal((await fetch(url+'/api/account-profiles',{headers:{authorization:'Bearer fixture'}})).status,200);
 assert.equal((await post({action:'switch',agent:'codex',id:'x'},{'x-forwarded-for':'10.0.0.2'})).status,403);
 assert.equal((await post({action:'switch',agent:'codex',id:'x'},{origin:'https://untrusted.example'})).status,403);assert.equal(calls.length,0);
 assert.equal((await post({action:'switch',agent:'codex',id:'x'})).status,200);
 const busy=await post({action:'switch',agent:'codex',id:'busy'});assert.equal(busy.status,409);assert.deepEqual(await busy.json(),{rejected:true,error:'실행 중'});
});
test('forking is a POST-only session route without query parameters',()=>{
 assert.equal(allowedRoute('POST',new URL('http://x/api/sessions/s1/fork'),'s1'),true);
 assert.equal(allowedRoute('GET',new URL('http://x/api/sessions/s1/fork'),'s1'),false);
 assert.equal(allowedRoute('POST',new URL('http://x/api/sessions/other/fork'),'s1'),false);
});
