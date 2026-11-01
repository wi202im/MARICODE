import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initializeMachine,prepareRunner,machineOptions} from './machine-setup.mjs';
const exec=promisify(execFile);
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'merry-machine-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const environment=join(root,'env.json');await writeFile(environment,JSON.stringify({PATH:'/usr/bin:/bin',HOME:root,CLAUDE_CONFIG_DIR:join(root,'claude'),CODEX_HOME:join(root,'codex'),TEST_PRIVATE:'synthetic'}));
 return {root,environment,cwd:root,directory:join(root,'machine')};
}
test('machine initialization is exclusive and leaves existing environment untouched',async t=>{
 const f=await fixture(t),before=await readFile(f.environment,'utf8');
 const config=await initializeMachine(f);const c=JSON.parse(await readFile(config,'utf8'));
 assert.deepEqual(c.binaries,{});assert.equal(c.environment,f.environment);assert.equal((await stat(f.directory)).mode&0o777,0o700);
 await assert.rejects(()=>initializeMachine(f));assert.equal(await readFile(f.environment,'utf8'),before);
});
test('prepared runner executes registered paths and preserves account environment without modifying config',async t=>{
 const f=await fixture(t),config=await initializeMachine(f),binary=join(f.root,'selected code');
 await writeFile(binary,'#!/bin/sh\nprintf selected',{mode:0o700});
 const c=JSON.parse(await readFile(config,'utf8'));c.binaries={codex:binary,claude:binary};await writeFile(config,JSON.stringify(c));
 const before=await readFile(config,'utf8'),out=join(f.root,'prepared'),result=await prepareRunner(config,out);
 const env=JSON.parse(await readFile(result.environment,'utf8'));assert.equal(env.CODEX_HOME,join(f.root,'codex'));assert.equal(env.TEST_PRIVATE,'synthetic');
 assert.equal((await exec('/usr/bin/env',['codex'],{env,cwd:f.root})).stdout,'selected');
 assert.equal((await exec(env.HAPI_CLAUDE_PATH,[],{env,cwd:f.root})).stdout,'selected');
 assert.equal(await readFile(config,'utf8'),before);assert.equal((await stat(result.environment)).mode&0o777,0o600);
 await assert.rejects(()=>prepareRunner(config,out));
});
test('missing AI is blocked rather than falling back and invalid paths create no prepared environment',async t=>{
 const f=await fixture(t),config=await initializeMachine(f);
 const c=JSON.parse(await readFile(config,'utf8'));c.binaries={codex:'/missing/codex'};await writeFile(config,JSON.stringify(c));
 const out=join(f.root,'prepared');await assert.rejects(()=>prepareRunner(config,out));await assert.rejects(()=>stat(out));
 c.binaries={};await writeFile(config,JSON.stringify(c));const result=await prepareRunner(config,out),env=JSON.parse(await readFile(result.environment,'utf8'));
 await assert.rejects(()=>exec('/usr/bin/env',['codex'],{env}),e=>e.code===126);
 await assert.rejects(()=>exec(env.HAPI_CLAUDE_PATH,[],{env}),e=>e.code===126);
});

test('launcher discovers candidates without executing them and loads per-machine options',async t=>{
 const f=await fixture(t),binary=join(f.root,'codex');
 await writeFile(binary,'not executable code',{mode:0o700});
 await writeFile(f.environment,JSON.stringify({PATH:f.root+':/usr/bin:/bin'}));
 await initializeMachine(f);const options=await machineOptions(f.directory);
 assert.equal(options.accountConfig,join(f.directory,'accounts.json'));
 assert.deepEqual(options.accountCandidates.codex,[binary]);
 assert.deepEqual(JSON.parse(await readFile(options.accountConfig,'utf8')).binaries,{});
});
test('runner output cannot contain PATH separators that would bypass the isolated bin',async t=>{
 const f=await fixture(t),config=await initializeMachine(f),out=join(f.root,'invalid:path');
 await assert.rejects(()=>prepareRunner(config,out));await assert.rejects(()=>stat(out));
});
test('snapshot records source revision and registered executable paths',async t=>{
 const {accountRevision}=await import('./machine-setup.mjs');const f=await fixture(t),config=await initializeMachine(f);
 const out=join(f.root,'snapshot'),result=await prepareRunner(config,out);
 assert.equal(result.sourceRevision,await accountRevision(config));assert.deepEqual(result.binaries,{});
 const c=JSON.parse(await readFile(config,'utf8'));c.cwd=tmpdir();await writeFile(config,JSON.stringify(c));
 assert.notEqual(result.sourceRevision,await accountRevision(config));
});
