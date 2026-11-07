import {readdir,lstat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {accountProfiles} from './account-profiles.mjs';

// Compatibility boundary: Codex CLI rollout files (CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl)
// record `event_msg` token_count payloads with `rate_limits` from the subscription service.
// Only the newest valid record is returned, normalized; paths and conversation text never leave this module.
// Symlinks are not followed. Nothing is written.
const valid=w=>w&&typeof w==='object'&&Number.isFinite(w.used_percent)&&w.used_percent>=0&&w.used_percent<=1000&&Number.isInteger(w.window_minutes)&&w.window_minutes>0&&Number.isFinite(w.resets_at)&&w.resets_at>1e9;
export function codexLimitRecord(line){
 let d;try{d=JSON.parse(line);}catch{return null;}
 const p=d?.payload,r=p?.rate_limits;if(d?.type!=='event_msg'||p?.type!=='token_count'||!r||typeof r!=='object')return null;
 const windows=['primary','secondary'].filter(name=>valid(r[name])).map(name=>({name,usedPercent:r[name].used_percent,windowMinutes:r[name].window_minutes,resetsAt:Math.round(r[name].resets_at*1000)}));
 if(!windows.length)return null;
 const c=r.credits,observedAt=Date.parse(d.timestamp);
 return {state:'ok',plan:typeof r.plan_type==='string'?r.plan_type.slice(0,40):null,observedAt:Number.isFinite(observedAt)?observedAt:null,windows,
  credits:c&&typeof c==='object'?{hasCredits:c.has_credits===true,unlimited:c.unlimited===true,balance:typeof c.balance==='number'||typeof c.balance==='string'?String(c.balance).slice(0,40):null}:null};
}
async function entries(dir){try{return (await readdir(dir)).sort().reverse();}catch{return [];}}
async function newestRollouts(root,max){
 const found=[];
 async function walk(dir,depth){
  for(const name of await entries(dir)){
   if(found.length>=max*4)return;
   const path=join(dir,name);let s;try{s=await lstat(path);}catch{continue;}
   if(s.isSymbolicLink())continue;
   if(s.isDirectory()&&depth<3)await walk(path,depth+1);
   else if(s.isFile()&&/^rollout-.*\.jsonl$/.test(name))found.push({path,mtime:s.mtimeMs,size:s.size});
  }
 }
 await walk(root,0);return found.sort((a,b)=>b.mtime-a.mtime).slice(0,max);
}
async function tail(file,bytes){
 const handle=await open(file.path,'r');
 try{const start=Math.max(0,file.size-bytes),buffer=Buffer.alloc(file.size-start);await handle.read(buffer,0,buffer.length,start);
  const lines=buffer.toString('utf8').split('\n');if(start>0)lines.shift();return lines;}
 finally{await handle.close();}
}
export async function readCodexLimits(home,{maxFiles=8,tailBytes=2*1024*1024}={}){
 for(const file of await newestRollouts(join(home,'sessions'),maxFiles)){
  let lines;try{lines=await tail(file,tailBytes);}catch{continue;}
  for(let i=lines.length-1;i>=0;i--){if(!lines[i].includes('rate_limits'))continue;const record=codexLimitRecord(lines[i]);if(record)return record;}
 }
 return {state:'no-records'};
}
// Reads only the Codex settings folder the user confirmed as the connected CLI.
export function createUsageLimits(configPath){
 return {async codex(){
  let connection;try{connection=(await accountProfiles(configPath).list()).codex;}catch{return {state:'unavailable'};}
  if(!connection?.confirmed)return {state:'connection-required'};
  return readCodexLimits(connection.accounts[0].path);
 }};
}
