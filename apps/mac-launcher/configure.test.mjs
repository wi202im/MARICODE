import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir,homedir,userInfo} from 'node:os';
import {join} from 'node:path';
import {configureDesktop} from './configure.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'merry-config-'));t.after(()=>rm(root,{recursive:true,force:true}));const project=join(root,'project'),binary=join(root,'tool');await mkdir(project);await writeFile(binary,'#!/bin/sh\nexit 99\n',{mode:0o700});return {directory:join(root,'data'),project,binary,agent:'codex',agentBinary:binary};}
test('first setup uses CLI defaults without private profiles or copying credentials and requires connection confirmation',async t=>{
 const input=await fixture(t);await configureDesktop(input);
 const backend=JSON.parse(await readFile(join(input.directory,'backend.json'),'utf8'));
 const account=JSON.parse(await readFile(backend.accountConfig,'utf8'));
 const env=JSON.parse(await readFile(account.environment,'utf8'));
 assert.deepEqual(Object.keys(account.binaries),['codex']);assert.equal(account.cwd,input.project);
 assert.equal(env.CODEX_HOME,join(homedir(),'.codex'));
 assert.equal(env.CLAUDE_CONFIG_DIR,join(homedir(),'.claude'));
 // Claude finds its macOS keychain login by USER; without it a signed-in CLI reports signed out.
 assert.equal(env.USER,userInfo().username);
 assert.equal(account.cliConnectionRequired,true);await assert.rejects(stat(join(input.directory,'local-setup/profiles')));
 assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined);
 assert.equal((await stat(account.environment)).mode&0o777,0o600);
 const before=await readFile(join(input.directory,'backend.json'),'utf8');
 await assert.rejects(configureDesktop(input));assert.equal(await readFile(join(input.directory,'backend.json'),'utf8'),before);
});
test('running instance lock and invalid selection leave configuration absent',async t=>{
 const input=await fixture(t);await mkdir(input.directory);await mkdir(join(input.directory,'web.lock'));
 await assert.rejects(configureDesktop(input));await assert.rejects(readFile(join(input.directory,'backend.json')));
 await rm(join(input.directory,'web.lock'),{recursive:true});
 await assert.rejects(configureDesktop({...input,agent:'other'}));await assert.rejects(readFile(join(input.directory,'backend.json')));
});

test('adding the second AI preserves existing paths and profiles and refuses running or legacy configurations',async t=>{
 const {addDesktopAgent}=await import('./configure.mjs');const input=await fixture(t);await configureDesktop(input);
 const configPath=join(input.directory,'local-setup/accounts.json');
 const before=JSON.parse(await readFile(configPath,'utf8')),env=await readFile(before.environment,'utf8');
 await mkdir(join(input.directory,'web.lock'));
 await assert.rejects(addDesktopAgent({directory:input.directory,agent:'claude',agentBinary:input.binary}));
 await rm(join(input.directory,'web.lock'),{recursive:true});
 await addDesktopAgent({directory:input.directory,agent:'claude',agentBinary:input.binary});
 const after=JSON.parse(await readFile(configPath,'utf8'));
 assert.deepEqual(after,{...before,binaries:{...before.binaries,claude:input.binary}});
 assert.equal(await readFile(before.environment,'utf8'),env);
 await assert.rejects(addDesktopAgent({directory:input.directory,agent:'codex',agentBinary:input.binary}));
 await writeFile(join(input.directory,'backend.json'),JSON.stringify({version:1,accountConfig:'/other/accounts.json'}));
 await assert.rejects(addDesktopAgent({directory:input.directory,agent:'claude',agentBinary:input.binary}));
});

test('changing the default project is atomic, guarded and preserves account profiles',async t=>{
 const {changeDesktopProject}=await import('./configure.mjs');const input=await fixture(t);await configureDesktop(input);
 const path=join(input.directory,'local-setup/accounts.json'),before=JSON.parse(await readFile(path,'utf8'));
 const next=join(input.directory,'next');await mkdir(next);
 await assert.rejects(changeDesktopProject({directory:input.directory,project:next,expectedProject:'/stale'}));
 await mkdir(join(input.directory,'web.lock'));
 await assert.rejects(changeDesktopProject({directory:input.directory,project:next,expectedProject:input.project}));
 await rm(join(input.directory,'web.lock'),{recursive:true});
 await mkdir(join(before.directory,'claude.login'));
 await assert.rejects(changeDesktopProject({directory:input.directory,project:next,expectedProject:input.project}));
 assert.deepEqual(JSON.parse(await readFile(path,'utf8')),before);
 await writeFile(join(before.directory,'claude.login/state.json'),JSON.stringify({phase:'finished'}));
 await changeDesktopProject({directory:input.directory,project:next,expectedProject:input.project});
 assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{...before,cwd:next});
 assert.equal(JSON.parse(await readFile(join(before.directory,'claude.login/state.json'),'utf8')).phase,'finished');
 await assert.rejects(changeDesktopProject({directory:input.directory,project:input.project,expectedProject:input.project}));
});

test('setup CLI reports access denial separately without exposing file paths',async t=>{
 const {chmod}=await import('node:fs/promises');const {spawnSync}=await import('node:child_process');
 const input=await fixture(t);await chmod(input.binary,0o600);
 const result=spawnSync(process.execPath,['apps/mac-launcher/configure.mjs'],{input:JSON.stringify(input),encoding:'utf8'});
 assert.equal(result.status,13);assert.equal(result.stderr.trim(),'SETUP_ACCESS_DENIED');
 await assert.rejects(readFile(join(input.directory,'backend.json')));
});

test('empty desktop initialization does not require a project or AI and preserves existing configurations',async t=>{
 const {initializeDesktop}=await import('./configure.mjs');const input=await fixture(t);
 await initializeDesktop({directory:input.directory,binary:input.binary});
 const c=JSON.parse(await readFile(join(input.directory,'local-setup/accounts.json'),'utf8'));
 assert.deepEqual(c.binaries,{});assert.notEqual(c.cwd,input.project);
 const before=await readFile(join(input.directory,'backend.json'),'utf8');
 await initializeDesktop({directory:input.directory,binary:input.binary});assert.equal(await readFile(join(input.directory,'backend.json'),'utf8'),before);
});
