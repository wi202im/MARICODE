import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createAccountRegistration} from './account-registration.mjs';
test('registration only adds a permitted executable and preserves existing environment and other AI',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-register-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'config.json'),binary=join(root,'codex');
 await writeFile(binary,'not executed',{mode:0o700});const base={environment:join(root,'env.json'),cwd:root,directory:root,binaries:{claude:'/existing/claude'}};await writeFile(path,JSON.stringify(base));
 const r=createAccountRegistration(path,{codex:[binary]});assert.deepEqual((await r.list()).providers.find(p=>p.agent==='codex').candidates,[binary]);
 await assert.rejects(()=>r.register({agent:'codex',path:'/bin/sh'}));
 await r.register({agent:'codex',path:binary});assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{...base,binaries:{...base.binaries,codex:binary}});
 await assert.rejects(()=>r.register({agent:'codex',path:binary}));
});
test('concurrent registration, pending login and non-executable candidates cannot overwrite config',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-register-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'config.json'),binary=join(root,'codex');
 await writeFile(binary,'test',{mode:0o700});const base={environment:join(root,'env.json'),cwd:root,directory:root,binaries:{}};await writeFile(path,JSON.stringify(base));
 const r=createAccountRegistration(path,{codex:[binary]});await mkdir(join(root,'codex.login'));
 await assert.rejects(()=>r.register({agent:'codex',path:binary}));await rm(join(root,'codex.login'),{recursive:true});
 const results=await Promise.allSettled([r.register({agent:'codex',path:binary}),r.register({agent:'codex',path:binary})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const bad=join(root,'bad');await writeFile(bad,'test',{mode:0o600});assert.equal((await createAccountRegistration(path,{claude:[bad]}).list()).providers[0].candidates.length,0);
});
