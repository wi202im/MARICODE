import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {codexImports} from './codex-import.mjs';

const id='01a19ca6-2c4a-7d82-87dc-a1b14d35a96f',other='01a19ca6-2c4a-7d82-87dc-a1b14d35a970',child='01a19ca6-2c4a-7d82-87dc-a1b14d35a971';
const rollout=(thread,cwd,extra={})=>[JSON.stringify({type:'session_meta',payload:{id:thread,cwd,source:'cli',...extra}}),JSON.stringify({type:'event_msg',payload:{type:'user_message',message:'단어는 MANGO77 이야'}}),''].join('\n');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'codex-import-')),source=join(root,'src'),destination=join(root,'dst'),project=join(root,'project'),day=join(source,'sessions/2026/11/02');
 await mkdir(day,{recursive:true});await mkdir(project);
 await writeFile(join(day,`rollout-2026-11-02T23-24-59-${id}.jsonl`),rollout(id,project));
 await writeFile(join(day,`rollout-2026-11-02T23-25-00-${other}.jsonl`),rollout(other,join(root,'elsewhere')));
 await writeFile(join(day,`rollout-2026-11-02T23-25-01-${child}.jsonl`),rollout(child,project,{source:{subagent:'review'}}));
 return {root,source,destination,project,day};
}
test('lists only top-level Codex threads started in the project, titled from the index or first prompt',async()=>{
 const f=await fixture(),imports=codexImports({project:f.project,destination:f.destination});
 let r=await imports.list(f.source);
 assert.deepEqual(r.sessions.map(s=>[s.id,s.title]),[[id,'단어는 MANGO77 이야']]);assert.equal(r.status,'ok');
 await writeFile(join(f.source,'session_index.jsonl'),JSON.stringify({id,thread_name:'망고 대화'})+'\n');
 r=await imports.list(f.source);assert.equal(r.sessions[0].title,'망고 대화');
 assert.equal((await imports.list(join(f.root,'missing'))).status,'profile-missing');
 await assert.rejects(imports.list(f.destination),/원래 Codex 기록 폴더/);
});
test('copies the selected rollout once into the private profile and never overwrites a different record',async()=>{
 const f=await fixture(),imports=codexImports({project:f.project,destination:f.destination});
 const row=(await imports.list(f.source)).sessions[0];
 assert.deepEqual(await imports.copy(f.source,id,row.fingerprint),{copied:true,title:'단어는 MANGO77 이야'});
 const copied=join(f.destination,'sessions/2026/11/02',`rollout-2026-11-02T23-24-59-${id}.jsonl`);
 assert.equal(await readFile(copied,'utf8'),rollout(id,f.project));
 assert.deepEqual(await imports.copy(f.source,id,row.fingerprint),{copied:false,title:'단어는 MANGO77 이야'});
 await writeFile(copied,'changed');await assert.rejects(imports.copy(f.source,id,row.fingerprint),e=>e.rejected&&/덮어쓰지/.test(e.message));
});
test('rejects stale, foreign-project and subagent selections before copying',async()=>{
 const f=await fixture(),imports=codexImports({project:f.project,destination:f.destination});
 const row=(await imports.list(f.source)).sessions[0];
 await utimes(join(f.day,`rollout-2026-11-02T23-24-59-${id}.jsonl`),new Date(),new Date(Date.now()+5000));
 await assert.rejects(imports.copy(f.source,id,row.fingerprint),/바뀌었습니다/);
 await assert.rejects(imports.copy(f.source,other,'x'),e=>e.rejected);
 await assert.rejects(imports.copy(f.source,'../../etc','x'),/형식/);
});
test('reads the first prompt from the Codex 0.166 item_completed shape',async()=>{
 const {codexSessionHead}=await import('./codex-import.mjs');
 const text=[JSON.stringify({type:'session_meta',payload:{id,cwd:'/p',source:'exec'}}),JSON.stringify({type:'event_msg',payload:{type:'item_completed',item:{type:'UserMessage',content:[{type:'text',text:'단어는 KIWI88'}]}}})].join('\n');
 assert.equal(codexSessionHead(text,id).first,'단어는 KIWI88');
});
