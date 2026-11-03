import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,symlink,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {accountProfiles} from './account-profiles.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'cli-profile-'));t.after(()=>rm(root,{recursive:true,force:true}));const initial=join(root,'initial');await mkdir(initial);const environment=join(root,'environment.private.json'),config=join(root,'accounts.json');await writeFile(environment,JSON.stringify({HOME:root,PATH:'/bin',CLAUDE_CONFIG_DIR:initial,CODEX_HOME:initial}));await writeFile(config,JSON.stringify({environment}));return {root,initial,environment,p:accountProfiles(config)};}
test('connecting shares the selected canonical CLI folder without copying credentials and preserves the other AI environment',async t=>{
 const f=await fixture(t),source=join(f.root,'cli');await mkdir(source);await writeFile(join(source,'.credentials.json'),'synthetic-secret');await symlink(source,join(f.root,'alias'));
 await assert.rejects(f.p.connect('claude',source,false),e=>e.rejected);
 const before=await f.p.list();assert.equal(before.claude.confirmed,false);
 const r=await f.p.connect('claude',join(f.root,'alias'),true);assert.equal(r.claude.confirmed,true);assert.equal(r.claude.accounts.length,1);assert.equal(r.claude.accounts[0].path,await realpath(source));
 const env=JSON.parse(await readFile(f.environment,'utf8'));assert.equal(env.CLAUDE_CONFIG_DIR,await realpath(source));assert.equal(env.CODEX_HOME,f.initial);assert.equal(env.HOME,f.root);
 assert.equal(await readFile(join(source,'.credentials.json'),'utf8'),'synthetic-secret');assert.equal((await f.p.connect('claude',source,true)).claude.confirmed,true);
 assert.equal(f.p.add,undefined);assert.equal(f.p.remove,undefined);assert.equal(f.p.activate,undefined);
});
test('a nonexistent CLI folder is created only with explicit creation and sharing consent; external edits invalidate confirmation',async t=>{
 const f=await fixture(t),source=join(f.root,'new-cli');await assert.rejects(f.p.connect('codex',source,true));await f.p.connect('codex',source,true,{create:true});
 assert.equal((await f.p.list()).codex.confirmed,true);
 const env=JSON.parse(await readFile(f.environment,'utf8'));await writeFile(f.environment,JSON.stringify({...env,CODEX_HOME:f.initial}));assert.equal((await f.p.list()).codex.confirmed,false);
 await assert.rejects(f.p.connect('other',source,true));await assert.rejects(f.p.connect('claude','relative',true));
});
test('native ownership searches only the connected CLI profile including archived Codex sessions',async t=>{
 const f=await fixture(t),id='01a19ca6-2c4a-7d82-87dc-a1b14d35a96f';await mkdir(join(f.initial,'archived_sessions'));await writeFile(join(f.initial,'archived_sessions',`rollout-x-${id}.jsonl`),'{}');
 assert.equal((await f.p.owner('codex',id,'/p')).active,true);assert.equal(await f.p.owner('claude',id,'/p'),null);
 await mkdir(join(f.initial,'projects','-p'),{recursive:true});await writeFile(join(f.initial,'projects','-p',id+'.jsonl'),'{}');assert.equal((await f.p.owner('claude',id,'/p')).id,'default');
});

test('confirming an unchanged CLI default invalidates an earlier Runner snapshot without starting the CLI',async t=>{
 const {accountRevision}=await import('./machine-setup.mjs');const f=await fixture(t),path=join(f.root,'accounts.json');const c=JSON.parse(await readFile(path,'utf8'));await writeFile(path,JSON.stringify({...c,cliConnectionRequired:true}));
 const env=JSON.parse(await readFile(f.environment,'utf8'));await writeFile(f.environment,JSON.stringify({...env,CLAUDE_CONFIG_DIR:await realpath(f.initial)})+'\n');
 const before=await accountRevision(path);await f.p.connect('claude',f.initial,true);const connected=await accountRevision(path);assert.notEqual(before,connected);await f.p.connect('claude',f.initial,true);assert.equal(await accountRevision(path),connected);
});

test('CLI default mode omits profile overrides so Claude keeps the home-level global configuration',async t=>{
 const f=await fixture(t),path=join(f.root,'.claude');await mkdir(path);await writeFile(join(f.root,'.claude.json'),'home-global');await writeFile(join(path,'.claude.json'),'different-explicit-global');
 await f.p.connect('claude',path,true,{mode:'default'});const env=JSON.parse(await readFile(f.environment,'utf8'));
 assert.equal(env.CLAUDE_CONFIG_DIR,undefined);assert.equal((await f.p.list()).claude.confirmed,true);assert.equal((await f.p.list()).claude.accounts[0].mode,'default');
 await assert.rejects(f.p.connect('claude',f.initial,true,{mode:'default'}));assert.equal(await readFile(join(f.root,'.claude.json'),'utf8'),'home-global');
});
