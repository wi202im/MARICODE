import {runnerInvocation} from './hapi-process.mjs';
import {spawn as spawnProcess} from 'node:child_process';
import {readFile,writeFile,mkdir,stat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';
const absolute=p=>typeof p==='string'&&isAbsolute(p)&&!/[\u0000-\u001f]/.test(p);
// Launcher API: a process start is not proof of Hub connection or AI readiness.
// Only a fresh snapshot may be started. Unknown/finished attempts are not reused.
export async function launchRunner({prepared,binary,hubUrl,token},{spawn=spawnProcess}={}){
 if(!absolute(prepared)||!absolute(binary)||typeof token!=='string'||!token||/[\r\n\0]/.test(token))throw Error('Invalid runner configuration');
 const url=new URL(hubUrl);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Local Hub required');
 if(!(await stat(binary)).isFile())throw Error('Runner executable unavailable');await access(binary,constants.X_OK);
 const plan=JSON.parse(await readFile(join(prepared,'prepared.json'),'utf8'));
 if(plan.environment!==join(prepared,'environment.private.json')||!absolute(plan.cwd)||!(await stat(plan.cwd)).isDirectory())throw Error('Invalid prepared environment');
 const workspaceRoots=plan.workspaceRoots??[plan.cwd];
 if(!Array.isArray(workspaceRoots)||!workspaceRoots.length)throw Error('Explicit workspace roots required');
 for(const root of workspaceRoots)if(!absolute(root)||!(await stat(root)).isDirectory())throw Error('Invalid workspace root');
 const env=JSON.parse(await readFile(plan.environment,'utf8'));
 if(!env||Array.isArray(env)||typeof env!=='object'||Object.entries(env).some(([k,v])=>!k||/[=\0]/.test(k)||typeof v!=='string'||v.includes('\0')))throw Error('Invalid prepared environment');
 // Exclusive directory is also the no-retry guard. Never point HAPI at an old identity.
 if(plan.machineId!==undefined&&!/^[a-f0-9-]{36}$/.test(plan.machineId))throw Error('Invalid machine identity');
 const home=join(prepared,'runner-home');await mkdir(home,{mode:0o700});
 if(plan.machineId)await writeFile(join(home,'settings.json'),JSON.stringify({machineId:plan.machineId}),{mode:0o600,flag:'wx'});
 const invocation=runnerInvocation({environment:env,home,hubUrl:url.origin,token,cwd:plan.cwd,workspaceRoots});
 let child,exited=false;
 // POSIX: isolate terminal/job-control signals from the app and Hub. Keep the
 // child referenced and observed; this is not an unmanaged background service.
 try{child=spawn(binary,invocation.args,{env:invocation.env,cwd:plan.cwd,stdio:'ignore',detached:process.platform!=='win32'});}
 catch{throw Error('Runner start could not be confirmed. Do not retry this snapshot.');}
 child.on('error',()=>{}); // Control errors are not proof that a started child exited.
 const closed=new Promise(resolve=>{child.once('exit',()=>{exited=true;resolve();});});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('Runner start could not be confirmed. Do not retry this snapshot.')));});
 return {
  get running(){return !exited;},
  closed,
  async stop(){
   if(exited)return;
   await new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);child.removeListener('exit',done);child.removeListener('error',failed);};
    const done=()=>{cleanup();resolve();};
    const failed=()=>{cleanup();reject(Error('Runner exit not confirmed'));};
    const timer=setTimeout(failed,8000);
    child.once('exit',done);child.once('error',failed);
    try{if(!child.kill('SIGTERM'))failed();}catch{failed();}
   });
  }
 };
}
