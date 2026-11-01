import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireRuntimeLock} from './runtime-lock.mjs';
const boot='11111111-1111-4111-8111-111111111111',nextBoot='22222222-2222-4222-8222-222222222222';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'maricode-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('dead owner and dead Hub recover once; live owners and children are never adopted or signalled',async t=>{
 const directory=await fixture(t);const alive=new Set([100,101]);const env={bootId:()=>boot,pid:100,alive:p=>alive.has(p)};
 const old=await acquireRuntimeLock(directory,env);old.hubStarting();old.hubStarted(101);
 await assert.rejects(acquireRuntimeLock(directory,{...env,pid:102}),/ownership/);
 alive.delete(100);await assert.rejects(acquireRuntimeLock(directory,{...env,pid:102}),/ownership/);
 alive.delete(101);alive.add(102);const recovered=await acquireRuntimeLock(directory,{...env,pid:102});assert.equal(recovered.recovered,true);
 await assert.rejects(old.release(),/ownership/);await recovered.release();await assert.rejects(access(join(directory,'web.lock')));
});
test('legacy locks and interrupted Hub starts remain blocked',async t=>{
 const directory=await fixture(t);await mkdir(join(directory,'web.lock'));
 await assert.rejects(acquireRuntimeLock(directory,{bootId:()=>boot,pid:100,alive:()=>false}),/ownership/);await access(join(directory,'web.lock'));
 await rm(join(directory,'web.lock'),{recursive:true});const owner=await acquireRuntimeLock(directory,{bootId:()=>boot,pid:100,alive:()=>false});owner.hubStarting();
 await assert.rejects(acquireRuntimeLock(directory,{bootId:()=>boot,pid:101,alive:()=>false}),/ownership/);
 await owner.release();
});
test('unknown Runner on same boot stays blocked; a different boot permits only recorded idle recovery',async t=>{
 const directory=await fixture(t);const owner=await acquireRuntimeLock(directory,{bootId:()=>boot,pid:100,alive:()=>false});
 const runner=join(directory,'runner');await mkdir(join(runner,'runner-home'),{recursive:true});await writeFile(join(runner,'runner-home/settings.json'),'{"machineId":"own"}');
 await assert.rejects(acquireRuntimeLock(directory,{bootId:()=>boot,pid:101,alive:()=>false}),/ownership/);
 const recovered=await acquireRuntimeLock(directory,{bootId:()=>nextBoot,pid:101,alive:()=>true});assert.equal(recovered.recovered,true);await access(join(runner,'runner-stopped.json'));
 assert.equal(await readFile(join(runner,'runner-home/settings.json'),'utf8'),'{"machineId":"own"}');await recovered.release();
 await assert.rejects(owner.release(),/ownership/);
});
test('pending operations, generation locks, requests and remote forwarding block recovery even after reboot',async t=>{
 for(const path of ['runner/session-operation.json','runner.lifecycle-lock','runner/tasks/10000000-0000-4000-8000-000000000001.json','runner.workspace-plans/10000000-0000-4000-8000-000000000001.json']){
  const directory=await fixture(t);const old=await acquireRuntimeLock(directory,{bootId:()=>boot,pid:100,alive:()=>false});
  const {dirname}=await import('node:path');await mkdir(dirname(join(directory,path)),{recursive:true});
  if(path.endsWith('lock'))await mkdir(join(directory,path));else await writeFile(join(directory,path),'{"state":"pending"}');
  await assert.rejects(acquireRuntimeLock(directory,{bootId:()=>nextBoot,pid:101,alive:()=>false}),/ownership/);await access(join(directory,path));await old.release();
 }
 const directory=await fixture(t);const old=await acquireRuntimeLock(directory,{bootId:()=>boot,pid:100,alive:()=>false});old.remoteStarting();
 await assert.rejects(acquireRuntimeLock(directory,{bootId:()=>nextBoot,pid:101,alive:()=>false}),/ownership/);old.remoteStopped();await old.release();
});
