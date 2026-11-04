import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSessionTerminal,runSessionTerminal} from './session-terminal.mjs';
const sid='11111111-1111-4111-8111-111111111111';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'maricode-term-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const prepared=join(root,'gen'),cwd=join(root,"project ' $(nope)");await mkdir(join(prepared,'runner-home'),{recursive:true});await mkdir(cwd);
 await writeFile(join(prepared,'environment.private.json'),JSON.stringify({PATH:'/usr/bin:/bin',CLAUDE_CONFIG_DIR:'/profile'}));
 await writeFile(join(root,'token'),'secret-token\n');
 return {root,prepared,cwd,runner:()=>({prepared,binary:'/bin/echo',hubUrl:'http://127.0.0.1:61193',tokenFile:join(root,'token')})};
}
test('the terminal resumes the same session with the Runner environment and never replays',async t=>{
 const f=await fixture(t);let script;
 const term=createSessionTerminal({directory:()=>f.root,runner:f.runner,platform:'darwin',open:async p=>{script=p;}});
 assert.equal((await term.status()).phase,'idle');
 const opened=await term.start({sessionId:sid,agent:'claude',cwd:f.cwd});
 assert.equal(opened.phase,'opening');assert.equal(opened.sessionId,sid);assert.ok(!JSON.stringify(opened).includes('secret-token'));
 assert.ok(!(await readFile(script,'utf8')).includes('secret-token'));assert.equal((await stat(script)).mode&0o777,0o700);
 await assert.rejects(term.start({sessionId:sid,agent:'claude',cwd:f.cwd}),/이미 터미널/);
 const dir=script.slice(0,script.lastIndexOf('/'));assert.equal((await stat(join(dir,'request.private.json'))).mode&0o777,0o600);
 let plan;await runSessionTerminal(dir,{run:async p=>{plan=p;await assert.rejects(access(join(dir,'request.private.json')));return 0;},print:()=>{}});
 assert.deepEqual(plan.args,['resume',sid]);assert.equal(plan.binary,'/bin/echo');assert.equal(plan.cwd,f.cwd);
 assert.equal(plan.env.HAPI_HOME,join(f.prepared,'runner-home'));assert.equal(plan.env.HAPI_API_URL,'http://127.0.0.1:61193');assert.equal(plan.env.CLI_API_TOKEN,'secret-token');assert.equal(plan.env.CLAUDE_CONFIG_DIR,'/profile');
 assert.equal((await term.status()).phase,'finished');
 await assert.rejects(runSessionTerminal(dir,{run:async()=>assert.fail('replayed'),print:()=>{}}));
 assert.equal((await term.start({sessionId:sid,agent:'codex',cwd:f.cwd})).agent,'codex');
});
test('a window closed hard or a request never started does not block the next terminal; bad input is refused',async t=>{
 const f=await fixture(t);let clock=0,alive=true,script;
 const term=createSessionTerminal({directory:()=>f.root,runner:f.runner,platform:'darwin',open:async p=>{script=p;},alive:()=>alive,now:()=>clock});
 await term.start({sessionId:sid,agent:'claude',cwd:f.cwd});clock=61000;assert.equal((await term.status()).phase,'failed');
 await term.start({sessionId:sid,agent:'claude',cwd:f.cwd});const dir=script.slice(0,script.lastIndexOf('/'));
 await runSessionTerminal(dir,{run:async()=>{assert.equal((await term.status()).phase,'running');alive=false;assert.equal((await term.status()).phase,'finished');return 0;},print:()=>{}});
 for(const bad of [{sessionId:'x',agent:'claude',cwd:f.cwd},{sessionId:sid,agent:'gemini',cwd:f.cwd},{sessionId:sid,agent:'claude',cwd:'relative'}])await assert.rejects(term.start(bad),e=>e.rejected===true);
 await assert.rejects(createSessionTerminal({directory:()=>f.root,runner:f.runner,platform:'linux',open:async()=>{}}).start({sessionId:sid,agent:'claude',cwd:f.cwd}),/로컬 화면/);
 await assert.rejects(createSessionTerminal({directory:()=>f.root,runner:()=>null,platform:'darwin',open:async()=>{}}).start({sessionId:sid,agent:'claude',cwd:f.cwd}),/실행 환경/);
});
