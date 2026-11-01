import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {EventEmitter} from 'node:events';
import {launchRunner} from './runner-launch.mjs';
import {spawn as spawnProcess,execFileSync} from 'node:child_process';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'merry-launch-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const prepared=join(root,'prepared');await mkdir(prepared);
 await writeFile(join(prepared,'environment.private.json'),JSON.stringify({PATH:'/usr/bin:/bin',HAPI_HOME:'/existing',HAPI_API_URL:'http://old',CLI_API_TOKEN:'old',HAPI_RUNNER_HANDOFF_FROM_PID:'42',CODEX_HOME:root}));
 await writeFile(join(prepared,'prepared.json'),JSON.stringify({environment:join(prepared,'environment.private.json'),cwd:root,agents:['codex']}));
 return {prepared,binary:'/bin/echo',hubUrl:'http://127.0.0.1:12345',token:'synthetic'};
}
test('launch uses a fresh identity and foreground runner, never replacement; duplicate start blocked',async t=>{
 const options=await fixture(t),calls=[];
 const spawn=(binary,args,opts)=>{calls.push({binary,args,opts});const child=new EventEmitter();child.kill=signal=>{calls.push(signal);child.emit('exit',0,signal);return true;};queueMicrotask(()=>child.emit('spawn'));return child;};
 const runner=await launchRunner(options,{spawn});
 assert.deepEqual(calls[0].args,['runner','start-sync','--workspace-root',calls[0].opts.cwd]);
 assert.notEqual(calls[0].opts.env.HAPI_HOME,'/existing');assert.equal(calls[0].opts.env.CLI_API_TOKEN,'synthetic');
 assert.equal(calls[0].opts.env.HAPI_DISABLE_VERSION_HANDOFF,'1');assert.equal(calls[0].opts.env.HAPI_RUNNER_HANDOFF_FROM_PID,undefined);assert.equal(calls[0].opts.stdio,'ignore');
 await assert.rejects(()=>launchRunner(options,{spawn}));assert.equal(calls.length,1);
 await runner.stop();assert.equal(calls[1],'SIGTERM');
 await assert.rejects(()=>launchRunner(options,{spawn}));
});
test('launch refuses non-loopback hub and preserves uncertain starts without retry',async t=>{
 const options=await fixture(t);
 await assert.rejects(()=>launchRunner({...options,hubUrl:'https://example.com'}));
 let count=0;const spawn=()=>{count++;throw Error('contains secret');};
 await assert.rejects(()=>launchRunner(options,{spawn}),e=>!e.message.includes('secret'));
 await assert.rejects(()=>launchRunner(options,{spawn}));assert.equal(count,1);
});
test('signal error is not treated as process exit',async t=>{
 const options=await fixture(t);let child;
 const runner=await launchRunner(options,{spawn:()=>{child=new EventEmitter();child.kill=()=>{child.emit('error',Error('EPERM'));return false;};queueMicrotask(()=>child.emit('spawn'));return child;}});
 let closed=false;runner.closed.then(()=>{closed=true;});
 await assert.rejects(()=>runner.stop());assert.equal(runner.running,true);assert.equal(closed,false);
 child.emit('exit',0);await runner.closed;assert.equal(runner.running,false);
});

test('runner invocation restricts every registered project explicitly',async()=>{
 const {runnerInvocation}=await import('./hapi-process.mjs');
 const invocation=runnerInvocation({environment:{},home:'/tmp/owned',hubUrl:'http://127.0.0.1:1234',token:'synthetic',cwd:'/tmp/default',workspaceRoots:['/tmp/alpha','/tmp/beta']});
 assert.deepEqual(invocation.args,['runner','start-sync','--workspace-root','/tmp/alpha','--workspace-root','/tmp/beta']);
});

test('owned runner has a separate process group so a stopped probe cannot suspend the app', {skip:process.platform==='win32'}, async t=>{
 const options=await fixture(t);
 const binary=join(options.prepared,'idle-runner');
 await writeFile(binary,`#!${process.execPath}\nsetInterval(()=>{},1000);\n`,{mode:0o700});
 let child;
 const runner=await launchRunner({...options,binary},{spawn:(...args)=>(child=spawnProcess(...args))});
 t.after(async()=>{if(runner.running){child.kill('SIGCONT');await runner.stop();}});
 const group=pid=>Number(execFileSync('/bin/ps',['-o','pgid=','-p',String(pid)],{encoding:'utf8'}).trim());
 assert.equal(group(child.pid),child.pid,'runner must own its process group');
 assert.notEqual(group(child.pid),group(process.pid),'app must stay outside the runner group');
 // Only signal the verified, newly created group; never the test/app group.
 process.kill(-child.pid,'SIGSTOP');
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(runner.running,true,'suspension is not process exit');
 process.kill(-child.pid,'SIGCONT');
 await runner.stop();
 assert.equal(runner.running,false,'owned child remains observable and stoppable');
});
