import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import http from 'node:http';
import {createRunnerWorkspace} from './runner-workspace.mjs';
test('authenticated runner tasks use fixed target, deduplicate and reject changed agent/path',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-runner-task-'));await mkdir(join(root,'runner-home'));
 await writeFile(join(root,'prepared.json'),JSON.stringify({cwd:root,agents:['codex']}));await writeFile(join(root,'runner-home/settings.json'),'{"machineId":"own"}');
 let spawns=0,ready=false;const id='00000000-0000-0000-0000-000000000001';
 const hub=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}
 if(req.url==='/api/machines')return res.end('{"machines":[{"id":"own"}]}');
 if(req.url.endsWith('/agent-availability'))return res.writeHead(ready?200:500).end(JSON.stringify({agents:[{agent:'codex',available:true}]}));
 if(req.url.endsWith('/spawn')){let body='';for await(const b of req)body+=b;assert.equal(JSON.parse(body).directory,root);spawns++;return res.end(JSON.stringify({type:'success',sessionId:id}));}
 res.end(JSON.stringify({session:{id,metadata:{machineId:'own',path:root,flavor:'codex'}}}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const api=createRunnerWorkspace({directory:root,hubUrl:`http://127.0.0.1:${hub.address().port}`}),request={requestId:'00000000-0000-0000-0000-000000000002',agent:'codex',project:''};
 await assert.rejects(()=>api.task(request,'Bearer wrong'));assert.equal(spawns,0);
 await assert.rejects(()=>api.task({...request,project:'/outside'},'Bearer synthetic'));
 await assert.rejects(()=>api.task(request,'Bearer synthetic'));assert.equal(spawns,0);await assert.rejects(access(join(root,'tasks',request.requestId+'.json')));ready=true;
 const r=await api.task(request,'Bearer synthetic');assert.equal(r.state,'created');
 assert.equal((await api.task(request,'Bearer synthetic')).session.id,id);assert.equal(spawns,1);
 await assert.rejects(()=>api.task({...request,agent:'claude'},'Bearer synthetic'));assert.equal(spawns,1);
 const next=join(root,'next');await mkdir(next);await mkdir(join(next,'runner-home'));
 await writeFile(join(next,'prepared.json'),JSON.stringify({cwd:root,agents:['codex']}));await writeFile(join(next,'runner-home/settings.json'),'{"machineId":"own"}');
 const againApi=createRunnerWorkspace({directory:next,taskDirectory:join(root,'tasks'),hubUrl:`http://127.0.0.1:${hub.address().port}`});
 assert.equal((await againApi.task(request,'Bearer synthetic')).session.id,id);assert.equal(spawns,1);
});

test('registered project IDs select independent folders and request IDs cannot move to another project',async t=>{
 const {projectRegistry}=await import('./project-registry.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-multi-project-'));await mkdir(join(root,'runner-home'));
 const a=join(root,'a'),b=join(root,'b');await mkdir(a);await mkdir(b);
 const file=join(root,'projects.json'),registry=projectRegistry(file),pa=await registry.add(a),pb=await registry.add(b);
 await writeFile(join(root,'prepared.json'),JSON.stringify({cwd:root,agents:['codex','claude']}));await writeFile(join(root,'runner-home/settings.json'),'{"machineId":"own"}');
 let spawns=0,spawned;const id='10000000-0000-0000-0000-000000000001';
 const hub=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic')return res.writeHead(401).end('{}');
 if(req.url==='/api/machines')return res.end('{"machines":[{"id":"own"}]}');
 if(req.url.endsWith('/agent-availability'))return res.end('{"agents":[{"agent":"claude","available":true}]}');
 if(req.url.endsWith('/spawn')){let raw='';for await(const part of req)raw+=part;spawned=JSON.parse(raw);spawns++;return res.end(JSON.stringify({type:'success',sessionId:id}));}
 res.end(JSON.stringify({session:{id,metadata:{machineId:'own',path:spawned.directory,flavor:spawned.agent}}}));});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();return rm(root,{recursive:true,force:true});});
 const api=createRunnerWorkspace({directory:root,hubUrl:`http://127.0.0.1:${hub.address().port}`,projectsPath:file});
 const request={requestId:'10000000-0000-0000-0000-000000000002',agent:'claude',project:pa.id};
 await assert.rejects(api.task({...request,project:b},'Bearer synthetic'));assert.equal(spawns,0);
 await api.task(request,'Bearer synthetic');assert.equal(spawned.directory,pa.path);assert.equal(spawned.agent,'claude');
 await assert.rejects(api.task({...request,project:pb.id},'Bearer synthetic'));assert.equal(spawns,1);
});
