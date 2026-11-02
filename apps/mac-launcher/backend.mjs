import {hubInvocation} from '../../pilots/hapi/client-probe/hapi-process.mjs';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {mkdir,readFile,writeFile,stat,access,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRunnerSetup} from '../../pilots/hapi/client-probe/runner-setup.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function launchHub({binary,directory,port,token,recordPid}){
 // Refuse existing listeners; never adopt or terminate by PID/port.
 const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
 const url=`http://127.0.0.1:${port}`;
 const invocation=hubInvocation({directory,port,token});
 const child=spawn(binary,invocation.args,{cwd:directory,stdio:'ignore',env:invocation.env});
 let exited=false;child.on('error',()=>{});child.once('exit',()=>{exited=true;});
 async function close(){
  if(exited||child.pid===undefined)return;
  await new Promise((resolve,reject)=>{
   const done=()=>{clearTimeout(timer);resolve();};
   const timer=setTimeout(()=>{child.removeListener('exit',done);reject(Error('Hub exit unconfirmed'));},8000);
   child.once('exit',done);child.kill('SIGTERM');
  });
 }
 try{
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('Hub start failed')));});
  await recordPid?.(child.pid);
  for(let i=0;i<40;i++){
   if(exited)throw Error('Hub exited before ready');
   try{
    const r=await fetch(url+'/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessToken:token}),redirect:'error',signal:AbortSignal.timeout(500)});
    if(r.ok&&typeof (await r.json()).token==='string')return {close};
   }catch{}
   await delay(100);
  }
  throw Error('Hub readiness unconfirmed');
 }catch(e){try{await close();}catch{e.cleanupUnconfirmed=true;}throw e;}
}
async function checkIdle({upstream,token,directory}){
 const request=async(path,body)=>{const r=await fetch(upstream+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(body?{}:{authorization:'Bearer '+bearer})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Hub shutdown status unavailable');return r.json();};
 const {token:bearer}=await request('/api/auth',{accessToken:token});if(typeof bearer!=='string'||!bearer)throw Error('Hub authentication unavailable');
 const data=await request('/api/sessions');if(!Array.isArray(data.sessions)||data.sessions.some(s=>s.active))throw Error('Active sessions must finish before shutdown');
 let files;try{files=await readdir(join(directory,'runner','tasks'));}catch(e){if(e.code==='ENOENT')return;throw e;}
 for(const f of files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)))if(JSON.parse(await readFile(join(directory,'runner','tasks',f),'utf8')).state!=='created')throw Error('Unconfirmed task remains');
}
export async function startBackend({directory,binary,accountConfig,port=61193,ownership},{launch=launchHub,runner=createRunnerSetup,idle=checkIdle}={}){
 if([directory,binary,accountConfig].some(p=>typeof p!=='string'||!isAbsolute(p))||!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid backend configuration');
 if(!(await stat(binary)).isFile())throw Error('HAPI executable unavailable');await access(binary,constants.X_OK);
 const home=join(directory,'hub'),tokenFile=join(home,'token.private');
 let fresh=false;try{await mkdir(home,{mode:0o700});fresh=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 if(fresh)await writeFile(tokenFile,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
 const token=await readFile(tokenFile,'utf8');if(!/^[a-f0-9]{64}$/.test(token))throw Error('Hub credentials unavailable; existing data was preserved');
 const upstream=`http://127.0.0.1:${port}`;
 const service=runner({directory:join(directory,'runner'),projectsPath:join(directory,'projects.json'),accountConfig,binary,tokenFile,hubUrl:upstream});
 ownership?.hubStarting();
 const hub=await launch({binary,directory:home,port,token,recordPid:pid=>ownership?.hubStarted(pid)});let closing=false,closed=false,mutating=0;
 // Prevent new Runner lifecycle/session mutations while the shutdown snapshot is checked.
 const mutations=new Set(['prepare','start','stop','reprepare','ready','task','manage','generalChat','claudeImport','codexImport','runSessionMutation','reconcileResume']);
 const runnerService=new Proxy(service,{get(target,key){const value=target[key];if(!mutations.has(key)||typeof value!=='function')return value;return async(...args)=>{if(closing||closed)throw Error('Backend is closing');mutating++;try{return await value(...args);}finally{mutating--;}};}});
 return {upstream,accountConfig,runnerService,async authenticate(){
  if(closing||closed)throw Error('Backend unavailable');
  const r=await fetch(upstream+'/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessToken:token}),redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error('Authentication unavailable');const result=await r.json();if(typeof result.token!=='string'||!result.token)throw Error('Invalid authentication');return result.token;
 },async close(){
  if(closed)return;if(mutating)throw Error('Runner operation pending');if(closing)throw Error('Backend is closing');closing=true;
  try{
   const status=await service.status();
   if(!['unprepared','prepared','running','exited'].includes(status.phase))throw Error('Runner ownership or operation is unconfirmed');
   await idle({upstream,token,directory});await service.close();await hub.close();closed=true;
  }finally{closing=false;}
 }};
}
