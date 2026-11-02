import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {claudeImports,claudeSourcePath} from './claude-import.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'maricode-import-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const project=join(root,'project'),source=join(root,'source'),destination=join(root,'app-profile'),id=randomUUID();
 await mkdir(project);await mkdir(destination);const folder=join(source,'projects',project.replace(/[^a-zA-Z0-9]/g,'-'));await mkdir(folder,{recursive:true});
 const raw=JSON.stringify({type:'user',uuid:randomUUID(),sessionId:id,cwd:project,message:{role:'user',content:'synthetic private text'}})+'\n';
 const file=join(folder,id+'.jsonl');await writeFile(file,raw);
 const api=claudeImports({directory:join(root,'imports'),destination,project,machineId:randomUUID()});
 return {root,source,destination,project,id,file,folder,raw,api};
}
test('lists only matching root sessions with a short title, imports once and preserves source',async t=>{
 const f=await fixture(t);await writeFile(join(f.folder,randomUUID()+'.jsonl'),'{broken');
 const rows=await f.api.list(f.source);assert.equal(rows.sessions.length,2);assert.equal(rows.skipped,0);const selected=rows.sessions.find(r=>r.id===f.id);assert.equal(selected.title,'synthetic private text');assert.equal(rows.sessions[0].files,undefined);assert.equal(rows.sessions[0].message,undefined);
 const request={source:f.source,id:f.id,fingerprint:selected.fingerprint};let posts=0,stored;
 const register=async record=>{posts++;stored={id:record.hubId,active:false,metadata:record.metadata};};
 const lookup=async()=>stored;
 const result=await f.api.import(request,{register,lookup});assert.equal(result.state,'registered');assert.equal(posts,1);
 assert.equal((await f.api.import(request,{register,lookup})).id,result.id);assert.equal(posts,1);
 assert.equal(await readFile(f.file,'utf8'),f.raw);
 assert.equal(await readFile(join(f.destination,'projects',f.project.replace(/[^a-zA-Z0-9]/g,'-'),f.id+'.jsonl'),'utf8'),f.raw);
});
test('rejects changed source, mismatched cwd, symlinks and existing destination without registration',async t=>{
 const f=await fixture(t),row=(await f.api.list(f.source)).sessions[0];let posts=0;
 const callbacks={register:async()=>{posts++;},lookup:async()=>null};
 await writeFile(f.file,f.raw+'\n');await assert.rejects(f.api.import({source:f.source,...row},callbacks));assert.equal(posts,0);
 await writeFile(f.file,f.raw.replace(f.project,'/another-project'));assert.equal((await f.api.list(f.source)).sessions[0].importable,false);
 await rm(f.file);await writeFile(join(f.root,'outside'),f.raw);await symlink(join(f.root,'outside'),f.file);assert.equal((await f.api.list(f.source)).sessions[0].importable,false);
 await rm(f.file);await writeFile(f.file,f.raw);const dir=join(f.destination,'projects',f.project.replace(/[^a-zA-Z0-9]/g,'-'));await mkdir(dir,{recursive:true});await writeFile(join(dir,f.id+'.jsonl'),'preserve');
 await assert.rejects(f.api.import({source:f.source,...row},callbacks));assert.equal(posts,0);assert.equal(await readFile(join(dir,f.id+'.jsonl'),'utf8'),'preserve');
});
test('lost registration response only checks fixed ID; changed selection and duplicate profiles cannot overwrite',async t=>{
 const f=await fixture(t),row=(await f.api.list(f.source)).sessions[0],request={source:f.source,...row};let posts=0,stored;
 const callbacks={register:async record=>{posts++;stored={id:record.hubId,active:false,metadata:record.metadata};throw Error('lost');},lookup:async()=>stored};
 await assert.rejects(f.api.import(request,callbacks));assert.equal(posts,1);
 const result=await f.api.import(request,callbacks);assert.equal(result.state,'registered');assert.equal(posts,1);
 await assert.rejects(f.api.import({...request,fingerprint:'0'.repeat(64)},callbacks));assert.equal(posts,1);
});
test('copies only selected subagent transcripts, never account settings or other sessions',async t=>{
 const f=await fixture(t);await mkdir(join(f.folder,f.id,'subagents'),{recursive:true});await writeFile(join(f.folder,f.id,'subagents','agent-abc.jsonl'),f.raw);
 await writeFile(join(f.source,'settings.json'),'private settings');
 const row=(await f.api.list(f.source)).sessions[0];let stored;
 await f.api.import({source:f.source,...row},{register:async r=>{stored={id:r.hubId,metadata:r.metadata};},lookup:async()=>stored});
 const base=join(f.destination,'projects',f.project.replace(/[^a-zA-Z0-9]/g,'-'));
 assert.equal(await readFile(join(base,f.id,'subagents','agent-abc.jsonl'),'utf8'),f.raw);await assert.rejects(readFile(join(f.destination,'settings.json')));
});
test('display history is an immutable, paginated text view, never executable tool requests',async t=>{
 const f=await fixture(t);const lines=Array.from({length:55},(_,i)=>JSON.stringify({type:'user',uuid:randomUUID(),sessionId:f.id,cwd:f.project,message:{content:'message '+i}}));
 lines.push(JSON.stringify({type:'assistant',uuid:randomUUID(),sessionId:f.id,cwd:f.project,message:{content:[{type:'tool_use',id:'past-approval',name:'Bash',input:{command:'do not run'}}]}}));await writeFile(f.file,lines.join('\n')+'\n');
 const row=(await f.api.list(f.source)).sessions[0];let stored;
 const result=await f.api.import({source:f.source,...row},{register:async r=>{stored={id:r.hubId,metadata:r.metadata};},lookup:async()=>stored});
 const page=await f.api.history(result.id);assert.equal(page.messages.length,50);assert.equal(page.total,56);assert.equal(page.before,6);assert.equal(page.hasMore,true);assert.ok(!JSON.stringify(page).includes('do not run'));
 assert.equal((await f.api.history(result.id,page.before)).messages.length,6);
 await writeFile(f.file,'original has changed');assert.equal((await f.api.history(result.id)).total,56);
 assert.deepEqual(await f.api.history(randomUUID()),{imported:false});await assert.rejects(f.api.history(result.id,-1));
});
test('unconfirmed registration cannot be replayed and forged readback cannot attach another native session',async t=>{
 const f=await fixture(t),row=(await f.api.list(f.source)).sessions[0];let posts=0,record;
 const callbacks={register:async r=>{record=r;posts++;throw Error('timeout');},lookup:async()=>null};
 await assert.rejects(f.api.import({source:f.source,...row},callbacks));
 assert.equal((await f.api.import({source:f.source,...row},callbacks)).state,'registering');assert.equal(posts,1);
 await assert.rejects(f.api.import({source:f.source,...row},{...callbacks,lookup:async()=>({id:record.hubId,metadata:{...record.metadata,claudeSessionId:randomUUID()}})}));assert.equal(posts,1);
});
test('concurrent imports hold the lock through registration readback',async t=>{
 const f=await fixture(t),row=(await f.api.list(f.source)).sessions[0],request={source:f.source,...row};let entered,release,record,posts=0;
 const atLookup=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const callbacks={register:async r=>{record=r;posts++;},lookup:async()=>{entered();await gate;return {id:record.hubId,metadata:record.metadata};}};
 const first=f.api.import(request,callbacks);await atLookup;
 await assert.rejects(f.api.import(request,callbacks));assert.equal(posts,1);release();assert.equal((await first).state,'registered');
});

test('search distinguishes missing profile, missing project store and empty project records',async t=>{
 const f=await fixture(t);
 assert.equal((await f.api.list(join(f.root,'missing'))).status,'profile-missing');
 assert.equal((await f.api.list(f.project)).status,'store-missing');
 await rm(f.folder,{recursive:true});assert.equal((await f.api.list(f.source)).status,'project-missing');
 await mkdir(f.folder);assert.equal((await f.api.list(f.source)).status,'empty');
});

test('custom hidden profile paths expand only the current home prefix',()=>{
 assert.equal(claudeSourcePath(' ~/.claude-global ', '/fixture/home'),'/fixture/home/.claude-global');
 assert.equal(claudeSourcePath('/fixture/profile with spaces'),'/fixture/profile with spaces');
 assert.throws(()=>claudeSourcePath('.claude-global'));
 assert.throws(()=>claudeSourcePath('~another/.claude'));
});

test('same native session can continue inside a child folder without losing its original transcript',async t=>{
 const f=await fixture(t);await mkdir(join(f.project,'child'));
 const follow={type:'assistant',uuid:randomUUID(),sessionId:f.id,cwd:join(f.project,'child'),message:{content:'continued in child'}};
 const raw=f.raw+JSON.stringify(follow)+'\n';await writeFile(f.file,raw);await rm(join(f.project,'child'),{recursive:true});
 const row=(await f.api.list(f.source)).sessions[0];assert.equal(row.importable,true);let stored;
 const result=await f.api.import({source:f.source,...row},{register:async r=>stored={id:r.hubId,metadata:r.metadata},lookup:async()=>stored});
 assert.equal(result.state,'registered');assert.equal(stored.metadata.path,f.project);
 assert.equal(await readFile(join(f.destination,'projects',f.project.replace(/[^a-zA-Z0-9]/g,'-'),f.id+'.jsonl'),'utf8'),raw);
 assert.equal((await f.api.history(result.id)).total,2);
});

test('native session continued from a different device path still imports once its session id matches',async t=>{
 const f=await fixture(t);
 const raw=f.raw+JSON.stringify({type:'assistant',uuid:randomUUID(),sessionId:f.id,cwd:'/office-machine/workspace/'+f.id,message:{content:'continued on another device'}})+'\n';
 await writeFile(f.file,raw);
 const row=(await f.api.list(f.source)).sessions[0];assert.equal(row.importable,true);let stored;
 const result=await f.api.import({source:f.source,...row},{register:async r=>stored={id:r.hubId,metadata:r.metadata},lookup:async()=>stored});
 assert.equal(result.state,'registered');
 assert.equal(await readFile(join(f.destination,'projects',f.project.replace(/[^a-zA-Z0-9]/g,'-'),f.id+'.jsonl'),'utf8'),raw);
});
test('different session and invalid message IDs remain rejected with distinct safe reasons',async t=>{
 const f=await fixture(t);let posts=0;const callbacks={register:async()=>posts++,lookup:async()=>null};
 for(const [overrides,reason] of [[{sessionId:randomUUID()},'IMPORT_SESSION_ID'],[{uuid:'broken'},'IMPORT_MESSAGE_ID']]){
  const row={type:'assistant',uuid:randomUUID(),sessionId:f.id,cwd:f.project,message:{content:'private payload'},...overrides};
  await writeFile(f.file,f.raw+JSON.stringify(row)+'\n');const selected=(await f.api.list(f.source)).sessions[0];
  await assert.rejects(f.api.import({source:f.source,...selected},callbacks),e=>e.rejected===true&&e.reason===reason&&e.userMessage.includes('2행')&&!e.userMessage.includes(f.project)&&!e.userMessage.includes('private payload'));
 }
 assert.equal(posts,0);
});

test('child cwd symlink cannot make an outside project eligible for import',async t=>{
 const f=await fixture(t),outside=join(f.root,'outside'),child=join(f.project,'linked');await mkdir(outside);await symlink(outside,child);
 await writeFile(f.file,f.raw+JSON.stringify({type:'assistant',uuid:randomUUID(),sessionId:f.id,cwd:join(child,'removed-child'),message:{content:'history'}})+'\n');
 const row=(await f.api.list(f.source)).sessions[0];let posts=0;
 await assert.rejects(f.api.import({source:f.source,...row},{register:async()=>posts++,lookup:async()=>null}),e=>e.rejected&&e.reason==='IMPORT_CWD_OUTSIDE');assert.equal(posts,0);
});
