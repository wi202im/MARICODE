import {execFile,spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm,stat,access,symlink,open as openFile,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {accountProfiles} from './account-profiles.mjs';
const agents=['claude','codex'],uuid=/^[a-f0-9-]{36}$/;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const absolute=s=>typeof s==='string'&&isAbsolute(s)&&!/[\x00-\x1f\x7f]/.test(s);
const reject=message=>Object.assign(Error(message),{rejected:true});
const openTerminal=path=>new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a','Terminal',path],{timeout:10000},error=>error?reject(Error('Terminal unavailable')):resolve()));
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function save(path,data){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path);}
export const cliPending=s=>!['idle','finished','failed'].includes(s.phase);
export function createOfficialCli(configPath,{open=openTerminal,platform=process.platform}={}){
 async function root(agent){if(!agents.includes(agent))throw reject('지원하지 않는 AI입니다.');const c=await json(configPath);if(!absolute(c.directory))throw Error('Invalid CLI directory');return join(c.directory,'official-cli-'+agent);}
 async function status(agent){
  const base=await root(agent);let saved;
  try{saved=await json(join(base,'current.json'));}catch(e){if(e.code==='ENOENT')return {phase:'idle',supported:platform==='darwin'};return {phase:'unknown',supported:platform==='darwin'};}
  if(!uuid.test(saved.id))return {phase:'unknown',supported:platform==='darwin'};
  let s;try{s=await json(join(base,saved.id,'state.json'));}catch{s={phase:'unknown'};}
  return {phase:['opening','running','finished','failed'].includes(s.phase)?s.phase:'unknown',supported:platform==='darwin',id:saved.id,agent,cwd:saved.cwd,accountId:saved.accountId,alias:saved.alias,...(Number.isInteger(s.exitCode)?{exitCode:s.exitCode}:{})};
 }
 async function start(input){
  if(!input||Object.keys(input).some(k=>!['agent','accountId','cwd'].includes(k))||!agents.includes(input.agent)||!absolute(input.cwd))throw reject('공식 CLI 실행 대상을 확인하세요.');
  if(platform!=='darwin')throw reject('공식 CLI 창은 해당 Mac의 로컬 화면에서 열 수 있습니다.');
  // Same lock as registration / profile switching. Only server-selected folders reach this method.
  const lock=configPath+'.register-lock';try{await mkdir(lock,{mode:0o700});}catch{throw reject('다른 설정 작업이 진행 중입니다. 상태를 확인한 뒤 다시 시도하세요.');}
  try{
   if(cliPending(await status(input.agent)))throw reject('이미 연 CLI 창이 있거나 실행 결과가 미확인입니다. 터미널을 확인하세요. 다시 실행하지 않았습니다.');
   const c=await json(configPath),env=await json(c.environment),profiles=await accountProfiles(configPath).list(),p=profiles[input.agent];
   if(!p?.active||p.active!==input.accountId)throw reject('사용 계정이 바뀌었습니다. AI 계정 상태를 새로 확인하세요.');
   const binary=c.binaries?.[input.agent];if(!absolute(binary)||!(await stat(binary)).isFile())throw reject('AI 실행 파일을 연결하세요.');await access(binary,constants.X_OK);
   if(!(await stat(input.cwd)).isDirectory())throw reject('작업 폴더에 접근할 수 없습니다.');
   if(!env||Array.isArray(env)||Object.entries(env).some(([k,v])=>!k||/[=\0]/.test(k)||typeof v!=='string'||v.includes('\0'))||typeof env.PATH!=='string')throw Error('Invalid CLI environment');
   const base=await root(input.agent),id=randomUUID(),dir=join(base,id);await mkdir(base,{recursive:true,mode:0o700});await mkdir(dir,{mode:0o700});
   await mkdir(join(dir,'bin'),{mode:0o700});await symlink(binary,join(dir,'bin',input.agent));
   // No user's shell startup files: they could silently replace the selected profile or executable.
   const rc=`PS1='Maricode CLI \\w > '\ncd -- ${quote(input.cwd)} || exit 1\nprintf '%s\\n' 'Maricode 공식 CLI · 별도 실행' '기존 앱 대화를 재개하지 않습니다. 이 터미널의 대화는 앱에 자동 표시되지 않습니다.' ${quote(input.agent==='claude'?'Claude가 열리면 /mcp로 관리하세요. 종료 후 여기서 claude mcp --help, claude mcp add/remove 등을 사용할 수 있습니다.':'Codex 공식 명령을 사용할 수 있습니다. 종료 후 여기서 codex --help로 명령을 확인하세요.')} '설정은 같은 계정·폴더의 다른 세션에도 영향을 줄 수 있습니다. 앱 실행 중 대화에 즉시 반영된 것으로 간주하지 마세요.'\n${quote(binary)}\nprintf '%s\\n' '공식 CLI가 끝났습니다. 추가 설정 명령을 실행하거나 exit로 이 설정 창을 종료하세요.'\n`;
   await writeFile(join(dir,'shell.rc'),rc,{mode:0o600,flag:'wx'});
   await writeFile(join(dir,'request.private.json'),JSON.stringify({cwd:input.cwd,env:{...env,PATH:join(dir,'bin')+':'+env.PATH}}),{mode:0o600,flag:'wx'});
   await save(join(dir,'state.json'),{phase:'opening'});
   await save(join(base,'current.json'),{id,...input,alias:p.accounts.find(a=>a.id===p.active)?.alias??'현재 계정'});
   const script=join(dir,'official-cli.command');await writeFile(script,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} ${quote(dir)}\n`,{mode:0o700,flag:'wx'});
   try{await open(script);}catch{throw Error('CLI 창 실행 결과를 확인하지 못했습니다. 터미널을 확인하세요. 자동으로 다시 열지 않습니다.');}
   return status(input.agent);
  }finally{await rm(lock,{recursive:true});}
 }
 return {status,start};
}
const runShell=plan=>new Promise((resolve,reject)=>{
 const child=spawn('/bin/bash',['--noprofile','--rcfile',plan.rc,'-i'],{cwd:plan.cwd,env:plan.env,stdio:'inherit'});
 const hangup=()=>child.kill('SIGHUP');process.on('SIGHUP',hangup);
 const cleanup=()=>process.off('SIGHUP',hangup);
 child.once('error',()=>{cleanup();reject(Error('CLI shell unavailable'));});
 child.once('exit',code=>{cleanup();resolve(code??129);});
});
export async function runOfficialCli(directory,{run=runShell}={}){
 const handle=await openFile(join(directory,'started'),'wx',0o600);await handle.close();
 try{
  const plan=await json(join(directory,'request.private.json'));await save(join(directory,'state.json'),{phase:'running'});
  const exitCode=await run({...plan,rc:join(directory,'shell.rc')});await save(join(directory,'state.json'),{phase:'finished',exitCode});
 }catch(e){await save(join(directory,'state.json'),{phase:'failed'});throw e;}
 finally{await rm(join(directory,'request.private.json'),{force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){runOfficialCli(process.argv[2]).catch(()=>{console.error('CLI를 실행하지 못했거나 이미 실행한 요청입니다. Maricode에서 상태를 확인하세요.');process.exitCode=1;});}
