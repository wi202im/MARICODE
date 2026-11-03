import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {resetLegacyCliProfiles} from './cli-profile-reset.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'cli-reset-'));t.after(()=>rm(root,{recursive:true,force:true}));const setup=join(root,'local-setup');await mkdir(join(setup,'profiles/claude'),{recursive:true});await writeFile(join(setup,'profiles/claude/fixture'),'old-test');const environment=join(setup,'environment.private.json'),accountConfig=join(setup,'accounts.json');await writeFile(environment,JSON.stringify({HOME:join(root,'home'),PATH:'/bin',CLAUDE_CONFIG_DIR:join(setup,'profiles/claude'),CODEX_HOME:join(setup,'profiles/codex')}));await writeFile(accountConfig,JSON.stringify({environment,directory:join(setup,'login'),binaries:{claude:'/bin/echo'}}));await writeFile(join(root,'backend.json'),JSON.stringify({accountConfig}));await writeFile(join(root,'projects.json'),'keep');return {root,setup,environment,accountConfig};}
test('one-time reset removes only app-owned profiles and forces fresh CLI connection; later launches preserve new data',async t=>{
 const f=await fixture(t),external=join(f.root,'home/.claude-global');await mkdir(external,{recursive:true});await writeFile(join(external,'fixture'),'keep');
 assert.equal((await resetLegacyCliProfiles(f.root)).reset,true);await assert.rejects(access(join(f.setup,'profiles')));
 const env=JSON.parse(await readFile(f.environment,'utf8')),cfg=JSON.parse(await readFile(f.accountConfig,'utf8'));
 assert.equal(env.CLAUDE_CONFIG_DIR,join(f.root,'home/.claude'));assert.equal(cfg.cliConnectionRequired,true);assert.equal(await readFile(join(external,'fixture'),'utf8'),'keep');assert.equal(await readFile(join(f.root,'projects.json'),'utf8'),'keep');
 await mkdir(join(f.setup,'profiles'));await writeFile(join(f.setup,'profiles/new'),'new');assert.equal((await resetLegacyCliProfiles(f.root)).reset,false);assert.equal(await readFile(join(f.setup,'profiles/new'),'utf8'),'new');
});
test('reset refuses symlinked app profile roots and external config paths without deleting data',async t=>{
 const f=await fixture(t);await rm(join(f.setup,'profiles'),{recursive:true});const external=join(f.root,'external');await mkdir(external);await writeFile(join(external,'keep'),'keep');await symlink(external,join(f.setup,'profiles'));
 await assert.rejects(resetLegacyCliProfiles(f.root));assert.equal(await readFile(join(external,'keep'),'utf8'),'keep');
 await rm(join(f.setup,'profiles'));await writeFile(f.accountConfig,JSON.stringify({environment:join(f.root,'other')}));await assert.rejects(resetLegacyCliProfiles(f.root));
});
