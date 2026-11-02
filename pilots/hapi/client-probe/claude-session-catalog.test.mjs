import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,open,rm,symlink,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {claudeImports} from './claude-import.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'claude-catalog-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const project=join(root,'project'),source=join(root,'source'),folder=join(source,'projects',project.replace(/[^a-zA-Z0-9]/g,'-'));
 await mkdir(project);await mkdir(folder,{recursive:true});const destination=join(root,'destination');await mkdir(destination);
 const api=claudeImports({directory:join(root,'imports'),destination,project,machineId:'fixture'});
 const row=(id,text,extra={})=>({type:'user',uuid:randomUUID(),sessionId:id,cwd:project,message:{content:text},...extra});
 const put=async(id,rows)=>writeFile(join(folder,id+'.jsonl'),rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n');
 return {root,project,source,folder,api,row,put};
}
test('native custom title and AI title win over internal CLI messages; command-only sessions show command names',async t=>{
 const f=await fixture(t),ids=Array.from({length:4},randomUUID);
 await f.put(ids[0],[f.row(ids[0],'<local-command-caveat>internal text</local-command-caveat>'),{type:'ai-title',aiTitle:'기존 자동 제목',sessionId:ids[0]}]);
 await f.put(ids[1],[f.row(ids[1],'first prompt'),{type:'custom-title',customTitle:'직접 지정한 이름',sessionId:ids[1]},{type:'ai-title',aiTitle:'ignored',sessionId:ids[1]}]);
 await f.put(ids[2],[f.row(ids[2],'<local-command-caveat>internal</local-command-caveat>'),f.row(ids[2],'<command-name>/login</command-name><command-message>login</command-message>')]);
 await f.put(ids[3],[f.row(ids[3],[{type:'text',text:'<system-reminder>injected</system-reminder>'},{type:'text',text:'진짜 첫 입력'}])]);
 const list=await f.api.list(f.source),names=new Map(list.sessions.map(r=>[r.id,r.title]));
 assert.equal(names.get(ids[0]),'기존 자동 제목');assert.equal(names.get(ids[1]),'직접 지정한 이름');assert.equal(names.get(ids[2]),'/login');assert.equal(names.get(ids[3]),'진짜 첫 입력');
});
test('large and malformed sessions stay visible, independent of the aggregate transcript size',async t=>{
 const f=await fixture(t),ids=Array.from({length:3},randomUUID);
 for(const id of ids.slice(0,2)){
  const fd=await open(join(f.folder,id+'.jsonl'),'w');await fd.write(JSON.stringify(f.row(id,'large session'))+'\n');
  await fd.truncate(90*1024*1024);await fd.write('\n'+JSON.stringify({type:'ai-title',aiTitle:'큰 기록 '+id.slice(0,4),sessionId:id})+'\n',90*1024*1024);await fd.close();
 }
 await f.put(ids[2],['{unfinished']);
 const list=await f.api.list(f.source);assert.equal(list.sessions.length,3);assert.equal(list.skipped,0);assert.equal(list.total,3);
 assert.ok(list.sessions.filter(r=>ids.slice(0,2).includes(r.id)).every(r=>r.title.startsWith('큰 기록 ')));
 assert.ok(list.sessions.find(r=>r.id===ids[2]).warning);
});
test('pagination exposes older records instead of silently dropping a folder with more than 500 sessions',async t=>{
 const f=await fixture(t),ids=Array.from({length:502},randomUUID);
 for(const [i,id] of ids.entries()){await f.put(id,[f.row(id,'session '+i)]);await utimes(join(f.folder,id+'.jsonl'),1000+i,1000+i);}
 let offset=0,all=[];do{const page=await f.api.list(f.source,offset);assert.equal(page.total,502);all.push(...page.sessions);offset=page.nextOffset;}while(offset!==null);
 assert.equal(all.length,502);assert.equal(new Set(all.map(r=>r.id)).size,502);assert.equal(all[0].id,ids.at(-1));assert.equal(all.at(-1).id,ids[0]);
});
test('catalog titles cannot be forged through nested tool input, and unsafe records remain non-importable',async t=>{
 const f=await fixture(t),id=randomUUID(),link=randomUUID();
 await f.put(id,[f.row(id,'real prompt'),{type:'assistant',message:{content:[{type:'tool_use',input:{customTitle:'forged'}}]}}]);
 await symlink(join(f.folder,id+'.jsonl'),join(f.folder,link+'.jsonl'));
 const list=await f.api.list(f.source);assert.equal(list.sessions.find(r=>r.id===id).title,'real prompt');assert.equal(list.sessions.find(r=>r.id===link).importable,false);
 let posts=0;await assert.rejects(f.api.import({source:f.source,...list.sessions.find(r=>r.id===link)},{register:async()=>posts++,lookup:async()=>null}));assert.equal(posts,0);
});

test('selected catalog fingerprint detects child changes and imports a large valid session with its native name',async t=>{
 const f=await fixture(t),id=randomUUID();
 const child=join(f.folder,id,'subagents');await mkdir(child,{recursive:true});await writeFile(join(child,'agent-a.jsonl'),'original\n');
 // A valid large tool result previously consumed the entire 64 MiB import budget.
 await f.put(id,[f.row(id,'first prompt'),{type:'progress',data:'x'.repeat(65*1024*1024)},{type:'ai-title',aiTitle:'CLI와 같은 이름',sessionId:id}]);
 const chosen=(await f.api.list(f.source)).sessions[0];assert.equal(chosen.title,'CLI와 같은 이름');assert.equal(chosen.importable,true);
 await writeFile(join(child,'agent-a.jsonl'),'changed\n');let registered;
 const hub={register:async record=>{registered=record;},lookup:async()=>registered?{id:registered.hubId,metadata:registered.metadata}:null};
 await assert.rejects(f.api.import({...chosen,source:f.source},hub),/원본 기록이 바뀌었습니다/);assert.equal(registered,undefined);
 const updated=(await f.api.list(f.source)).sessions[0];const result=await f.api.import({...updated,source:f.source},hub);
 assert.equal(result.state,'registered');assert.equal(registered.metadata.name,'CLI와 같은 이름');
});
