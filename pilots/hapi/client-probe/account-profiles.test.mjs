import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {accountProfiles} from './account-profiles.mjs';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'profiles-')),setup=join(root,'local-setup'),profiles=join(setup,'profiles');
 await mkdir(join(profiles,'claude'),{recursive:true});await mkdir(join(profiles,'codex'),{recursive:true});
 const environment=join(setup,'environment.private.json'),config=join(setup,'accounts.json');
 await writeFile(environment,JSON.stringify({HOME:'/h',CLAUDE_CONFIG_DIR:join(profiles,'claude'),CODEX_HOME:join(profiles,'codex')}));
 await writeFile(config,JSON.stringify({environment}));
 return {root,profiles,environment,config,p:accountProfiles(config)};
}
test('the existing profile is the default account and adding one creates its own private folder without switching',async()=>{
 const f=await fixture();
 assert.deepEqual((await f.p.list()).codex,{active:'default',accounts:[{id:'default',alias:'기본 계정',active:true}]});
 const added=await f.p.add('codex',' 회사  계정 ');
 assert.deepEqual(added.codex.accounts.map(a=>[a.alias,a.active]),[['기본 계정',true],['회사 계정',false]]);
 assert.equal(JSON.parse(await readFile(f.environment,'utf8')).CODEX_HOME,join(f.profiles,'codex'));
 await assert.rejects(f.p.add('codex','회사 계정'),/이미/);await assert.rejects(f.p.add('codex',''),/1~40/);await assert.rejects(f.p.add('gemini','x'),/지원하지/);
});
test('switching rewrites only that engine key and keeps other environment values',async()=>{
 const f=await fixture(),{id}=await f.p.add('claude','개인');
 const r=await f.p.activate('claude',id);assert.equal(r.changed,true);assert.equal(r.claude.active,id);
 const env=JSON.parse(await readFile(f.environment,'utf8'));
 assert.equal(env.CLAUDE_CONFIG_DIR,join(f.profiles,'claude-'+id));assert.equal(env.CODEX_HOME,join(f.profiles,'codex'));assert.equal(env.HOME,'/h');
 assert.equal((await f.p.activate('claude',id)).changed,false);
 assert.equal((await f.p.activate('claude','default')).claude.active,'default');
 await assert.rejects(f.p.activate('claude','nope'),e=>e.rejected);
});
test('a session belongs to the account whose profile holds its native transcript',async()=>{
 const f=await fixture(),{id}=await f.p.add('codex','두번째'),thread='01a19ca6-2c4a-7d82-87dc-a1b14d35a96f';
 await mkdir(join(f.profiles,'codex-'+id,'sessions/2026/11/03'),{recursive:true});
 await writeFile(join(f.profiles,'codex-'+id,'sessions/2026/11/03',`rollout-2026-11-03T00-00-00-${thread}.jsonl`),'{}');
 const owner=await f.p.owner('codex',thread,'/p');assert.equal(owner.id,id);assert.equal(owner.active,false);
 assert.equal(await f.p.owner('codex','01a19ca6-2c4a-7d82-87dc-a1b14d35a000','/p'),null);
 const archived='01a19ca6-2c4a-7d82-87dc-a1b14d35a111';await mkdir(join(f.profiles,'codex','archived_sessions'),{recursive:true});await writeFile(join(f.profiles,'codex','archived_sessions',`rollout-2026-11-03T00-00-00-${archived}.jsonl`),'{}');
 assert.equal((await f.p.owner('codex',archived,'/p')).id,'default');
 const cwd='/work/proj',claude='3b37803a-b28e-42b7-8571-e02171dfa2ec';
 await mkdir(join(f.profiles,'claude','projects','-work-proj'),{recursive:true});await writeFile(join(f.profiles,'claude','projects','-work-proj',claude+'.jsonl'),'{}');
 assert.equal((await f.p.owner('claude',claude,cwd)).active,true);
});
