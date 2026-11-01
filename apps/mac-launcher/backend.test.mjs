import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startBackend} from './backend.mjs';
test('backend preserves token across launches and refuses shutdown when Runner state is unknown',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'merry-backend-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let phase='unprepared',stops=0;
 const options={directory,binary:'/bin/echo',accountConfig:join(directory,'accounts.json'),port:61193};
 const deps={idle:async()=>{},launch:async()=>({close:async()=>{stops++;}}),runner:()=>({status:async()=>({phase}),close:async()=>{}})};
 const first=await startBackend(options,deps);const token=await readFile(join(directory,'hub','token.private'),'utf8');
 phase='unknown';await assert.rejects(first.close());assert.equal(stops,0);
 phase='unprepared';await first.close();assert.equal(stops,1);
 const second=await startBackend(options,deps);assert.equal(await readFile(join(directory,'hub','token.private'),'utf8'),token);await second.close();
});
test('Runner rejection leaves Hub running and blocks concurrent mutations while closing',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'merry-backend-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let release,stops=0;const gate=new Promise(r=>release=r);
 const backend=await startBackend({directory,binary:'/bin/echo',accountConfig:join(directory,'accounts.json'),port:61193},{idle:async()=>{},launch:async()=>({close:async()=>{stops++;}}),runner:()=>({status:async()=>({phase:'running'}),close:async()=>{await gate;throw Error('active');},start:async()=>{throw Error('must not execute');}})});
 const closing=backend.close();await assert.rejects(backend.runnerService.start(),/closing/);release();await assert.rejects(closing,/active/);assert.equal(stops,0);
});
test('shutdown rejects an already admitted mutation and checks Hub even after Runner exits',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'merry-backend-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let release,stops=0,active=true;const gate=new Promise(r=>release=r);
 const backend=await startBackend({directory,binary:'/bin/echo',accountConfig:join(directory,'accounts.json'),port:61193},{launch:async()=>({close:async()=>{stops++;}}),idle:async()=>{if(active)throw Error('active');},runner:()=>({status:async()=>({phase:'exited'}),close:async()=>{},start:async()=>gate})});
 const starting=backend.runnerService.start();await assert.rejects(backend.close(),/pending/);assert.equal(stops,0);release();await starting;
 await assert.rejects(backend.close(),/active/);assert.equal(stops,0);active=false;await backend.close();assert.equal(stops,1);
});
test('missing credentials in an existing Hub directory are not regenerated',async t=>{
 const {mkdir,access}=await import('node:fs/promises');const directory=await mkdtemp(join(tmpdir(),'merry-backend-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(join(directory,'hub'));let launches=0;
 await assert.rejects(startBackend({directory,binary:'/bin/echo',accountConfig:join(directory,'accounts.json')},{launch:async()=>{launches++;}}));
 assert.equal(launches,0);await assert.rejects(access(join(directory,'hub/token.private')));
});

test('navigation mutation prevents shutdown until its atomic update completes',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'maricode-navigation-close-'));t.after(()=>rm(directory,{recursive:true,force:true}));let release;const gate=new Promise(r=>release=r);
 const backend=await startBackend({directory,binary:'/bin/echo',accountConfig:join(directory,'accounts.json')},{idle:async()=>{},launch:async()=>({close:async()=>{}}),runner:()=>({status:async()=>({phase:'running'}),close:async()=>{},manage:async()=>gate})});
 const editing=backend.runnerService.manage();await assert.rejects(backend.close(),/pending/);release();await editing;await backend.close();
});
test('resume reconciliation excludes shutdown while its readback is outstanding',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'maricode-resume-close-'));t.after(()=>rm(directory,{recursive:true,force:true}));let release;const gate=new Promise(r=>release=r);
 const backend=await startBackend({directory,binary:'/bin/echo',accountConfig:join(directory,'accounts.json')},{idle:async()=>{},launch:async()=>({close:async()=>{}}),runner:()=>({status:async()=>({phase:'running'}),close:async()=>{},reconcileResume:async()=>gate})});
 const checking=backend.runnerService.reconcileResume();await assert.rejects(backend.close(),/pending/);release();await checking;await backend.close();await assert.rejects(backend.runnerService.reconcileResume(),/closing/);
});
