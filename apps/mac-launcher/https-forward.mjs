import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {remoteOrigin} from './remote-config.mjs';
const binary='/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const env={PATH:'/usr/bin:/bin',HOME:process.env.HOME,LANG:'en_US.UTF-8',TERM:'xterm-256color'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function query(args){const {stdout}=await promisify(execFile)(binary,args,{env,timeout:5000,maxBuffer:1048576});return JSON.parse(stdout);}
export const readTailscaleStatus=()=>query(['status','--json']);
export function launchOwned(args,onExit,{spawnChild=spawn,timeout=5000}={}){
 const child=spawnChild(binary,args,{env,stdio:'ignore'});let ended=false,signalError=false;
 const exited=new Promise(resolve=>{
  child.on('error',()=>{if(child.pid===undefined){ended=true;resolve();onExit();}else signalError=true;});
  child.once('exit',()=>{ended=true;resolve();onExit();});
 });
 return {get alive(){return !ended;},async stop(){
  if(ended)return;
  signalError=false;
  if(!child.kill('SIGINT')||signalError)throw Error('Forward signal unconfirmed');
  let timer;try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Forward exit unconfirmed')),timeout);})]);}finally{clearTimeout(timer);}
 }};
}
export function createHttpsForward(deps={}){
 const read=deps.query??query,start=deps.launch??launchOwned,wait=deps.delay??delay;
 let phase='stopped',child,owner;
 async function stop(){
  if(phase==='stopped')return;
  if(phase==='starting'||phase==='stopping')throw Error('Forward operation pending');
  phase='stopping';
  try{
   await child?.stop();
   const config=await read(['serve','status','--json']);
   if(owner?config.Foreground?.[owner]:Object.keys(config).length!==0)throw Error('Forward cleanup unconfirmed');
   child=undefined;owner=undefined;phase='stopped';
  }catch{phase='unknown';throw Error('Forward cleanup unconfirmed');}
 }
 return {get phase(){return phase;},async start({origin,target}){
  if(phase!=='stopped')throw Error('Forward already owned or unknown');
  remoteOrigin(origin);const url=new URL(origin),port=url.port||'443',hostPort=url.hostname+':'+port;
  if(!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(target))throw Error('Loopback target required');
  phase='starting';
  try{
   const self=await read(['status','--json']);
   if(self.BackendState!=='Running'||self.Self?.DNSName?.replace(/\.$/,'')!==url.hostname)throw Error('Tailscale machine mismatch');
   const before=await read(['serve','status','--json']);
   if(Object.keys(before).length!==0)throw Error('Existing Serve configuration preserved');
   child=start(['serve','--https='+port,target],()=>{if(phase==='running'){phase='unknown';deps.onExit?.();}});
   for(let i=0;i<20;i++){
    const config=await read(['serve','status','--json']);
    const matches=Object.entries(config.Foreground??{}).filter(([,v])=>v.TCP?.[port]?.HTTPS===true&&v.Web?.[hostPort]?.Handlers?.['/']?.Proxy===target);
    if(child.alive===false)throw Error('Forward exited during startup');
    if(matches.length===1){owner=matches[0][0];phase='running';return;}
    await wait(250);
   }
   throw Error('Forward start unconfirmed');
  }catch{
   phase='unknown';
   if(child){try{await stop();}catch{throw Error('Forward cleanup unconfirmed');}}
   else phase='stopped';
   throw Error('Forward unavailable; existing settings preserved');
  }
 },stop};
}
