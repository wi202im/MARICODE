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
 const service={workspace:async()=>[{id,project:'/trial'}],projects:async()=>[{key:'project-key',path:'/trial'}],ready:async(...args)=>{starts++;prepared=args;},status:async scope=>{assert.deepEqual(scope,{session:id});return {workspaceAvailable:starts>0};},runSessionMutation:async(fn)=>{assert.equal(starts,1);return fn();}};
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:service});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});const origin=`http://127.0.0.1:${proxy.address().port}`;
 const r=await fetch(origin+`/api/sessions/${id}/resume`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200);assert.deepEqual(prepared,['Bearer synthetic','project-key','codex',{session:id}]);assert.equal(forwarded,1);
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
 await createEnvironment(environmentPath).save({revision:0,roles:{local:true,server:false,remote:false}});
 const server=createServer({upstream:'http://127.0.0.1:1',sessionId:id,environmentPath});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();return rm(dir,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/workspace','/setup','/install','/']){
  const response=await fetch(origin+path);assert.equal(response.status,200,path);
  const html=await response.text();assert.ok(html.includes(`Maricode ${PRODUCT_VERSION}`),path);
  assert.ok(!html.includes('{{PRODUCT_VERSION}}'),path);assert.ok(!html.includes('MARICODE 1.0.0'),path);
 }
 const manifest=await(await fetch(origin+'/manifest.webmanifest')).json();assert.equal(manifest.short_name,'Maricode');
 const install=await(await fetch(origin+'/install')).text();assert.ok(install.includes('/install.mjs'));
 for(const [,src] of install.matchAll(/src="([^"]+)"/g))assert.equal((await fetch(origin+src)).status,200,src);
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

test('pairing codes are issued only to the signed-in local app and redeem once for a Hub login',async t=>{
 const {createPairing}=await import('./pairing.mjs');
 const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.writeHead(req.headers.authorization==='Bearer fixture'?200:401).end('{"sessions":[]}');});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const pairing=createPairing({authenticate:async()=>'issued-jwt'});
 const server=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,pairing});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();hub.closeAllConnections();hub.close();});
 const url=`http://127.0.0.1:${server.address().port}`,post=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{origin:url,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post('/api/pairing-code',{action:'issue'})).status,401);
 assert.equal((await post('/api/pairing-code',{action:'issue'},{authorization:'Bearer fixture','x-forwarded-for':'10.0.0.9'})).status,403);
 const issued=await post('/api/pairing-code',{action:'issue'},{authorization:'Bearer fixture'});assert.equal(issued.status,200);const {code}=await issued.json();
 assert.equal((await post('/api/pair',{code:'AAAA-AAAA'})).status,401);
 const ok=await post('/api/pair',{code});assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{token:'issued-jwt'});
 assert.equal((await post('/api/pair',{code})).status,401);
 assert.equal((await post('/api/pair',{code},{origin:'https://untrusted.example'})).status,403);
});

test('a paired device that stays signed in refreshes remotely; only the local app lists and revokes devices',async t=>{
 const {createPairing}=await import('./pairing.mjs');const {createDeviceLogins}=await import('./device-logins.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'device-server-'));
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');let n=0;const jwt=()=>`${b64({alg:'HS256'})}.${b64({exp:Math.floor(Date.now()/1000)+3600,n:++n})}.s`;
 const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.writeHead(req.headers.authorization==='Bearer fixture'?200:401).end('{"sessions":[]}');});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const pairing=createPairing({authenticate:async()=>jwt()}),deviceLogins=createDeviceLogins({path:join(dir,'devices.json'),authenticate:async()=>jwt()});
 const server=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,pairing,deviceLogins});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();hub.closeAllConnections();hub.close();return rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${server.address().port}`,remote={'x-forwarded-for':'100.64.0.9'};
 const post=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{origin:url,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const issue=async()=>(await (await post('/api/pairing-code',{action:'issue'},{authorization:'Bearer fixture'})).json()).code;
 // A bad device name is refused before the one-time code is spent.
 let code=await issue();assert.equal((await post('/api/pair',{code,device:'x'.repeat(61)},remote)).status,400);
 const paired=await (await post('/api/pair',{code,device:'iPhone · Safari'},remote)).json();
 assert.ok(paired.token&&paired.device.id&&paired.device.secret);
 const refreshed=await post('/api/device-refresh',paired.device,remote);assert.equal(refreshed.status,200);
 const next=await refreshed.json();assert.notEqual(next.device.secret,paired.device.secret);
 assert.equal((await post('/api/device-refresh',{id:paired.device.id,secret:'nope'},remote)).status,401);
 assert.equal((await fetch(url+'/api/devices',{headers:{authorization:'Bearer fixture',...remote}})).status,403);
 const listed=await (await fetch(url+'/api/devices',{headers:{authorization:'Bearer fixture'}})).json();
 assert.deepEqual(listed.devices.map(d=>d.name),['iPhone · Safari']);
 assert.equal((await post('/api/devices',{action:'revoke',id:paired.device.id},{authorization:'Bearer fixture'})).status,200);
 assert.equal((await post('/api/device-refresh',next.device,remote)).status,401);
 // Its last token is refused at this server even though HAPI would still accept it.
 assert.equal((await fetch(url+'/api/sessions',{headers:{authorization:'Bearer '+next.token}})).status,401);
 // Logging out forgets a device; a plain code login does not register one.
 code=await issue();const other=await (await post('/api/pair',{code,device:'Android · Chrome'},remote)).json();
 assert.equal((await post('/api/device-refresh',{...other.device,action:'forget'},remote)).status,200);
 code=await issue();assert.deepEqual(Object.keys(await (await post('/api/pair',{code},remote)).json()),['token']);
 assert.deepEqual((await (await fetch(url+'/api/devices',{headers:{authorization:'Bearer fixture'}})).json()).devices,[]);
});

test('the session terminal opens only from authenticated same-origin local requests with a bounded body',async t=>{
 let starts=0,body=null;const authCheck=auth=>{if(auth!=='Bearer fixture')throw Object.assign(Error('auth'),{status:401});};
 const runnerService={sessionTerminalStatus:async auth=>{authCheck(auth);return {phase:'idle'};},openSessionTerminal:async(auth,input)=>{authCheck(auth);starts++;body=input;return {phase:'opening',agent:'claude'};}};
 const server=createServer({upstream:'http://127.0.0.1:1',runnerService});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}`,post=(headers={},payload={id})=>fetch(url+'/api/session-terminal',{method:'POST',headers:{origin:url,'content-type':'application/json',authorization:'Bearer fixture',...headers},body:JSON.stringify(payload)});
 assert.equal((await fetch(url+'/api/session-terminal')).status,401);
 assert.equal((await fetch(url+'/api/session-terminal',{headers:{authorization:'Bearer fixture'}})).status,200);
 for(const headers of [{'x-forwarded-for':'10.0.0.1'},{forwarded:'for=10.0.0.1'},{origin:'https://untrusted.example'},{authorization:'Bearer wrong'}])assert.notEqual((await post(headers)).status,200);
 assert.equal(starts,0);assert.equal((await post()).status,200);assert.equal(starts,1);assert.deepEqual(body,{id});
 assert.equal((await post({},{id,pad:'x'.repeat(2000)})).status,413);
 assert.equal((await fetch(url+'/api/session-terminal?id=x',{headers:{authorization:'Bearer fixture'}})).status,403);
 assert.equal((await fetch(url+`/api/sessions/${id}/command-cards`,{headers:{authorization:'Bearer fixture'}})).status,403);
});

test('ended Claude exposes every access choice and real catalog labels, refusing apply until resumed',async t=>{
 let updates=0;const state={active:false,thinking:false,metadata:{flavor:'claude',machineId:'fixture'},agentState:{controlledByUser:false,requests:{}},model:'opus',effort:'high',permissionMode:'default'};
 const upstream=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic')return res.writeHead(401).end('{}');
  if(req.url==='/api/machines/fixture/claude-models')return res.end(JSON.stringify({success:true,availableModels:[{value:'opus',displayName:'Opus fixture version',effortLevels:['high']}]}));
  if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;assert.equal(req.url,`/api/sessions/${id}/permission-mode`);state.permissionMode=JSON.parse(raw).mode;updates++;return res.end('{"ok":true}');}
  res.end(JSON.stringify({session:state}));});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,path=origin+`/api/sessions/${id}/settings`,headers={authorization:'Bearer synthetic'};
 const view=await (await fetch(path,{headers})).json();assert.equal(view.permissionModes.length,5);assert.equal(view.editable,false);assert.equal(view.models.find(o=>o.value==='opus').label,'Opus fixture version');
 const body={field:'permissionMode',value:'bypassPermissions',expected:{...view.current,flavor:'claude'}},post=()=>fetch(path,{method:'POST',headers:{...headers,origin,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post()).status,409);assert.equal(updates,0);state.active=true;
 const applied=await post();assert.equal(applied.status,200);assert.equal((await applied.json()).current.permissionMode,'bypassPermissions');assert.equal(updates,1);
});

test('import preflight failure exposes a safe stage while uncertain registration keeps its lock',async t=>{
 let uncertain=false;const service={workspace:async()=>[],claudeImport:async()=>{throw uncertain?Error('/private/path secret'):Object.assign(Error('internal'),{rejected:true,reason:'IMPORT_RUNNER_PREPARE',userMessage:'가져오기를 시작하지 않았습니다. 실행 환경을 확인하세요.'});}};
 const server=createServer({upstream:'http://127.0.0.1:1',runnerService:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,request=()=>fetch(origin+'/api/claude-import',{method:'POST',headers:{origin,authorization:'Bearer fixture','content-type':'application/json'},body:'{}'});
 let r=await request(),body=await r.json();assert.equal(r.status,409);assert.equal(body.rejected,true);assert.equal(body.reason,'IMPORT_RUNNER_PREPARE');assert.match(body.error,/시작하지 않았/);
 uncertain=true;r=await request();body=await r.json();assert.equal(body.rejected,false);assert.ok(!body.error.includes('private'));assert.ok(!body.error.includes('secret'));
});
test('local account diagnosis authenticates independently of a broken runner and excludes private configuration',async t=>{
 let reads=0;const service={projects:async auth=>{if(auth!=='Bearer fixture')throw Object.assign(Error('auth'),{status:401});return [];},workspace:async()=>{throw Error('broken runner');},status:async()=>({phase:'unknown',hub:'disconnected',agents:['claude'],binaries:{claude:'/private/binary'},hubUrl:'private'})};
 const server=createServer({upstream:'http://127.0.0.1:1',runnerService:service,accountsService:{status:async()=>{reads++;return {state:'connected'};}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,get=headers=>fetch(origin+'/api/accounts',{headers});
 assert.notEqual((await get({authorization:'Bearer wrong'})).status,200);assert.equal(reads,0);
 const r=await get({authorization:'Bearer fixture'});assert.equal(r.status,200);const body=await r.json();assert.deepEqual(body.runner,{phase:'unknown',hub:'disconnected',agents:['claude']});assert.ok(!JSON.stringify(body).includes('private'));assert.equal(body.providers[0].state,'connected');
 const remote=await(await get({authorization:'Bearer fixture','x-forwarded-for':'100.64.0.1'})).json();assert.equal(remote.runner,undefined);
});
test('an authorised file read mints a media link that streams the checked file with ranges and nothing else',async t=>{
 const {mkdtemp,writeFile,rm,realpath}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const project=await realpath(await mkdtemp(join(tmpdir(),'media-api-')));await writeFile(join(project,'clip.mp4'),'0123456789');await writeFile(join(project,'notes.txt'),'x');
 const upstream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}res.end(JSON.stringify({session:{active:true,metadata:{machineId:'machine',path:project,flavor:'claude'}}}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id,handoffTarget:{directory:join(project,'.records'),machineId:'machine',project}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();await rm(project,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`,link=(path,auth='synthetic')=>fetch(origin+`/api/sessions/${id}/file-link?path=${encodeURIComponent(path)}`,{headers:{Authorization:`Bearer ${auth}`}});
 assert.equal((await link('clip.mp4','')).status,401);
 assert.equal((await link('../etc/passwd')).status,403);
 assert.equal((await link('notes.txt')).status,415);
 const {url}=await (await link('clip.mp4')).json();assert.match(url,/^\/file-raw\/[0-9a-f]{64}$/);
 const part=await fetch(origin+url,{headers:{Range:'bytes=3-5'}});assert.equal(part.status,206);assert.equal(await part.text(),'345');
 assert.equal((await fetch(origin+url,{headers:{Origin:'https://elsewhere.test'}})).status,403);
 assert.equal((await fetch(origin+'/vendor/hljs-languages/swift.mjs')).headers.get('content-type'),'text/javascript');
 assert.notEqual((await fetch(origin+'/vendor/hljs-languages/..%2Fhighlight.mjs')).status,200);
});
test('with the Runner stopped, this Mac reads its own session folder from disk; other machines stay blocked',async t=>{
 const {mkdtemp,writeFile,mkdir,rm,realpath}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const project=await realpath(await mkdtemp(join(tmpdir(),'local-read-')));await mkdir(join(project,'src'));await writeFile(join(project,'src/a.txt'),'hi');
 let machine='mac';const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({session:{active:false,metadata:{machineId:machine,path:project,flavor:'claude'}}}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:{workspace:async()=>[{id,project}],status:async()=>({workspaceAvailable:false}),localMachine:async()=>'mac',target:async()=>{throw Error('must not be used');}}});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}await rm(project,{recursive:true,force:true});});
 const get=p=>fetch(`http://127.0.0.1:${proxy.address().port}/api/sessions/${id}/${p}`,{headers:{Authorization:'Bearer synthetic'}});
 assert.deepEqual((await (await get('directory?path=')).json()).entries.map(e=>[e.name,e.type]),[['src','directory']]);
 const f=await (await get('file?path=src%2Fa.txt')).json();assert.equal(Buffer.from(f.content,'base64').toString(),'hi');assert.equal(f.size,2);
 assert.equal((await get('file?path=..%2F..%2Fetc%2Fhosts')).status,403);
 machine='other';assert.equal((await get('directory?path=')).status,403);
});
test('every module the workspace page imports is served',async t=>{
 const {readFile}=await import('node:fs/promises');
 const server=createServer({upstream:'http://127.0.0.1:9',sessionId:id});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,seen=new Set(),todo=['/app.mjs'];
 while(todo.length){
  const path=todo.pop();if(seen.has(path))continue;seen.add(path);
  const r=await fetch(origin+path);assert.equal(r.status,200,path);await r.arrayBuffer();
  const source=await readFile(new URL('.'+path,import.meta.url),'utf8');
  for(const m of source.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"$]+)['"]/g))todo.push(new URL(m[1],'http://x'+path).pathname);
 }
 assert.ok(seen.size>30);
});
test('stop and queued-message routes are limited to the selected session and exact shapes',()=>{
 const b=`/api/sessions/${id}`;
 assert.equal(allowedRoute('POST',url(b+'/abort'),id),true);
 assert.equal(allowedRoute('DELETE',url(b+'/messages/msg_123-a'),id),true);
 assert.equal(allowedRoute('POST',url(b+'/messages/msg_123-a/steer'),id),true);
 assert.equal(allowedRoute('POST',url(b+'/messages/queued-state'),id),true);
 for(const [m,p] of [['DELETE',b+'/messages/queued-state'],['GET',b+'/messages/x/steer'],['POST',b+'/messages/x'],['DELETE',b+'/messages/x/steer'],['DELETE',b+'/messages/x?y=1'],['DELETE','/api/sessions/other/messages/x'],['DELETE',b+'/messages/a/b']])assert.equal(allowedRoute(m,url(p),id),false,`${m} ${p}`);
});
test('file search for @-mentions accepts only a short query and limit',()=>{
 const b=`/api/sessions/${id}/files`;
 assert.equal(allowedRoute('GET',url(b+'?query=src%2Fapp&limit=20'),id),true);
 for(const p of [b+'?path=/etc',b+'?query='+'x'.repeat(201),b+'?limit=9999',b+'?limit=-1'])assert.equal(allowedRoute('GET',url(p),id),false,p);
 assert.equal(allowedRoute('POST',url(b),id),false);
});

test('concurrent resume is rejected while preparation is pending, forwarding only once',async t=>{
 let entered,release;const seen=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let starts=0,forwarded=0;
 const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST'){forwarded++;return res.end(JSON.stringify({sessionId:id}));}res.end(JSON.stringify({session:{id,active:false,metadata:{machineId:'own',path:'/trial',flavor:'codex'}}}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));
 const service={workspace:async()=>[{id,project:'/trial'}],projects:async()=>[{key:'project',path:'/trial'}],ready:async()=>{starts++;entered();await gate;},status:async()=>({workspaceAvailable:true}),runSessionMutation:async fn=>fn()};
 const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:service});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{release();for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});
 const origin=`http://127.0.0.1:${proxy.address().port}`,post=()=>fetch(origin+`/api/sessions/${id}/resume`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{}'});
 const first=post();await seen;const second=await post();assert.equal(second.status,409);assert.equal((await second.json()).rejected,true);assert.equal(starts,1);assert.equal(forwarded,0);release();assert.equal((await first).status,200);assert.equal(forwarded,1);
});

test('resume preflight and original account failures never forward a resume',async t=>{
 for(const scenario of ['active','missing-project','different-folder','unconfirmed-cli','missing-native'])await t.test(scenario,async t=>{
  let starts=0,forwarded=0;
  const metadata={machineId:'own',path:scenario==='different-folder'?'/other':'/trial',flavor:'codex'};
  const hub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST'){forwarded++;return res.end(JSON.stringify({sessionId:id}));}res.end(JSON.stringify({session:{id,active:scenario==='active',metadata}}));});await new Promise(r=>hub.listen(0,'127.0.0.1',r));
  const service={workspace:async()=>[{id,project:'/trial'}],projects:async()=>scenario==='missing-project'?[]:[{key:'project',path:'/trial'}],ready:async()=>{starts++;if(scenario==='unconfirmed-cli')throw Error('CLI connection not confirmed');},status:async()=>({workspaceAvailable:true}),runSessionMutation:async()=>{throw Object.assign(Error('원본 기록을 다시 연결하세요.'),{rejected:true,status:409,reason:'ACCOUNT_MISMATCH'});}};
  const proxy=createServer({upstream:`http://127.0.0.1:${hub.address().port}`,runnerService:service});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of [hub,proxy]){s.closeAllConnections();s.close();}});
  const origin=`http://127.0.0.1:${proxy.address().port}`,r=await fetch(origin+`/api/sessions/${id}/resume`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{}'}),result=await r.json();
  assert.equal(r.status,409);assert.equal(result.rejected,true);assert.equal(forwarded,0);
  assert.equal(starts,['unconfirmed-cli','missing-native'].includes(scenario)?1:0);
  assert.equal(result.reason,scenario==='missing-native'?'ACCOUNT_MISMATCH':'RUNNER_SETUP');if(scenario==='missing-native')assert.equal(result.error,'원본 기록을 다시 연결하세요.');
 });
});
test('branch remote check and pull reach the session Runner with only the session and repository names',async t=>{
 const calls=[],sid='11111111-1111-4111-8111-111111111111';
 const runnerService={workspace:async()=>[{id:sid}],branches:async()=>({}),branchRemote:async(auth,id)=>{calls.push(['remote',auth,id]);return [{repo:'api',behind:1}];},branchPull:async(auth,input)=>{calls.push(['pull',auth,input]);return [{repo:'api',ok:true}];}};
 const server=createServer({upstream:'http://127.0.0.1:1',sessionId:sid,runnerService});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}`,auth={authorization:'Bearer synthetic'};
 assert.equal((await fetch(url+'/api/branch-remote?session=nope',{headers:auth})).status,400);
 assert.equal((await fetch(url+`/api/branch-remote?session=${sid}&path=/etc`,{headers:auth})).status,400);
 assert.deepEqual(await (await fetch(url+`/api/branch-remote?session=${sid}`,{headers:auth})).json(),[{repo:'api',behind:1}]);
 const pull=await fetch(url+'/api/branch-pull',{method:'POST',headers:{...auth,origin:url,'content-type':'application/json'},body:JSON.stringify({id:sid,repos:['api']})});
 assert.deepEqual(await pull.json(),[{repo:'api',ok:true}]);
 assert.equal((await fetch(url+'/api/branch-pull',{method:'POST',headers:{...auth,origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);
 assert.deepEqual(calls,[['remote','Bearer synthetic',sid],['pull','Bearer synthetic',{id:sid,repos:['api']}]]);
});
