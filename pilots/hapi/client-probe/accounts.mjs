import {accountProfiles} from './account-profiles.mjs';
import {execFile,spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm,access,stat,open as openFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const agents=['claude','codex'];
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export function accountStatus(agent,result){
 if(result.missing)return {state:'not-installed'};
 if(agent==='claude'){
  try{const d=JSON.parse(result.stdout);if(d.loggedIn===false)return {state:'signed-out'};if(d.loggedIn===true)return {state:d.authMethod==='claude.ai'?'connected':'other-auth',method:d.authMethod==='claude.ai'?'subscription':'other'};}catch{}
 }else{
  const text=(result.stdout??'')+(result.stderr??'');
  if(result.code===0&&text.includes('Logged in using ChatGPT'))return {state:'connected',method:'subscription'};
  if(result.code===0&&text.includes('Logged in using'))return {state:'other-auth',method:'other'};
  if(result.code===1&&text.trim()==='Not logged in')return {state:'signed-out'};
 }
 return {state:'unknown'};
}
export const runStatus=(binary,args,options)=>new Promise(resolve=>{
 execFile(binary,args,{...options,timeout:15000,maxBuffer:65536},(error,stdout,stderr)=>resolve({code:error?error.code:0,missing:error?.code==='ENOENT',stdout,stderr}));
});
const openTerminal=path=>new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a','Terminal',path],{timeout:10000},error=>error?reject(Error('Login window unavailable')):resolve()));
async function config(path,agent){
 const c=JSON.parse(await readFile(path,'utf8'));
 if(!c||typeof c!=='object'||Array.isArray(c))throw Error('Account configuration invalid');
 if(c.binaries?.[agent]===undefined)throw Object.assign(Error('AI not configured'),{code:'AI_NOT_CONFIGURED'});
 if(![c.environment,c.directory,c.cwd,c.binaries[agent]].every(p=>typeof p==='string'&&isAbsolute(p)&&!p.includes('\0')))throw Error('Account configuration invalid');
 const env=JSON.parse(await readFile(c.environment,'utf8'));
 if(!env||Array.isArray(env)||typeof env!=='object'||Object.values(env).some(v=>typeof v!=='string'))throw Error('Account environment invalid');
 // Login belongs to the configured CLI profile, not a project that may have been removed.
 // Preserve the original cwd when available; only absence permits the existing account directory.
 let cwd=c.cwd;
 try{if(!(await stat(cwd)).isDirectory())throw Error('Account working directory invalid');}
 catch(error){if(error.code!=='ENOENT')throw error;cwd=c.directory;if(!(await stat(cwd)).isDirectory())throw Error('Account directory invalid');}
 return {...c,cwd,env};
}
const statusArgs=agent=>agent==='claude'?['auth','status','--json']:['login','status'];
export function createAccounts(configPath,{run=runStatus,open=openTerminal}={}){
 const starting=new Set();
 const checkAgent=agent=>{if(!agents.includes(agent))throw Error('Unknown agent');};
 async function status(agent){
  checkAgent(agent);let c;try{c=await config(configPath,agent);}catch(e){return {state:e.code==='AI_NOT_CONFIGURED'?'not-configured':'configuration-error',loginPending:false,loginPhase:null};}if(c.cliConnectionRequired&&!(await accountProfiles(configPath).list())[agent]?.confirmed)return {state:'connection-required',loginPending:false,loginPhase:null};const result=accountStatus(agent,await run(c.binaries[agent],statusArgs(agent),{env:c.env,cwd:c.cwd}));
  const lock=join(c.directory,agent+'.login');let phase=null;
  try{phase=JSON.parse(await readFile(join(lock,'state.json'),'utf8')).phase;}catch{try{await access(lock);phase='opening';}catch{}}
  return {...result,loginPending:phase==='opening'||phase==='running',loginPhase:phase};
 }
 async function start(agent){
  checkAgent(agent);if(starting.has(agent))return status(agent);starting.add(agent);
  try{const before=await status(agent);if(before.state!=='signed-out'||before.loginPending)return before;
  const c=await config(configPath,agent),lock=join(c.directory,agent+'.login');await mkdir(c.directory,{recursive:true,mode:0o700});
  // Only a known finished attempt can be replaced. An uncertain launch stays locked.
  if(before.loginPhase==='finished')await rm(lock,{recursive:true});
  try{await mkdir(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')return status(agent);throw error;}
  await writeFile(join(lock,'state.json'),JSON.stringify({phase:'opening'}),{mode:0o600});
  const script=join(lock,'login.command');
  await writeFile(script,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} ${quote(configPath)} ${quote(agent)}\n`,{mode:0o700});
  try{await open(script);}catch{throw Error('로그인 창 실행 결과를 확인할 수 없습니다. Mac 터미널을 확인하세요. 자동으로 다시 열지 않습니다.');}
  return {...before,loginPending:true,loginPhase:'opening'};
  }finally{starting.delete(agent);}
 }
 return {status,start};
}
async function loginInTerminal(configPath,agent){
 if(!agents.includes(agent))throw Error('Unknown agent');const c=await config(configPath,agent),lock=join(c.directory,agent+'.login');
 if(c.cliConnectionRequired&&!(await accountProfiles(configPath).list())[agent]?.confirmed)throw Error('CLI connection confirmation required');
 // Opening the same .command twice must not start two login flows.
 const handle=await openFile(join(lock,'started'),'wx',0o600);await handle.close();
 await writeFile(join(lock,'state.json'),JSON.stringify({phase:'running'}),{mode:0o600});
 try{
  const state=accountStatus(agent,await runStatus(c.binaries[agent],statusArgs(agent),{env:c.env,cwd:c.cwd}));
  if(state.state!=='signed-out'){console.log('기존 인증이 있거나 상태를 확인할 수 없어 새 로그인을 시작하지 않았습니다.');return;}
  console.log('Maricode 시험 환경의 공식 로그인입니다. 완료 후 웹 화면에서 AI 연결 상태를 다시 확인하세요.');
  await new Promise((resolve,reject)=>{const child=spawn(c.binaries[agent],agent==='claude'?['auth','login','--claudeai']:['login'],{env:c.env,cwd:c.cwd,stdio:'inherit'});child.once('error',()=>reject(Error('Login could not start')));child.once('exit',()=>resolve());});
 }finally{await writeFile(join(lock,'state.json'),JSON.stringify({phase:'finished'}),{mode:0o600});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){loginInTerminal(process.argv[2],process.argv[3]).catch(()=>{console.error('로그인 절차를 완료하지 못했습니다. 연결 상태를 확인하세요.');process.exitCode=1;});}
