import {execFile,spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm,stat,access,open as openFile,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {resumeInvocation} from './hapi-process.mjs';
// "터미널에서 이 세션 이어가기": opens a Mac Terminal running `hapi resume <session>` with the Runner's own
// environment, so every official slash command works on the same conversation and the transcript stays in the app.
// One terminal at a time; an opened request is never replayed.
const uuid=/^[a-f0-9-]{36}$/;
const absolute=s=>typeof s==='string'&&isAbsolute(s)&&!/[\x00-\x1f\x7f]/.test(s);
const reject=message=>Object.assign(Error(message),{rejected:true});
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const openTerminal=path=>new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a','Terminal',path],{timeout:10000},error=>error?reject(Error('Terminal unavailable')):resolve()));
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function save(path,data){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path);}
export const terminalPending=s=>['opening','running','unknown'].includes(s.phase);
// runner(): {prepared,binary,hubUrl,tokenFile} of the current Runner generation.
const processAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
export function createSessionTerminal({directory,runner,open=openTerminal,platform=process.platform,alive=processAlive,now=Date.now}){
 const base=()=>join(directory(),'session-terminal');
 async function status(){
  let saved;try{saved=await json(join(base(),'current.json'));}catch(e){return {phase:e.code==='ENOENT'?'idle':'unknown',supported:platform==='darwin'};}
  if(!uuid.test(saved.id))return {phase:'unknown',supported:platform==='darwin'};
  let s;try{s=await json(join(base(),saved.id,'state.json'));}catch{s={phase:'unknown'};}
  // A window closed hard leaves 'running' behind: its terminal process is gone. An open request never started is stale after a minute.
  if(s.phase==='running'&&Number.isInteger(s.pid)&&!alive(s.pid))s={phase:'finished'};
  if(s.phase==='opening'&&Number.isFinite(s.at)&&now()-s.at>60000)s={phase:'failed'};
  return {phase:['opening','running','finished','failed'].includes(s.phase)?s.phase:'unknown',supported:platform==='darwin',sessionId:saved.sessionId,agent:saved.agent,...(Number.isInteger(s.exitCode)?{exitCode:s.exitCode}:{})};
 }
 async function start({sessionId,agent,cwd}){
  if(!uuid.test(sessionId)||!['claude','codex'].includes(agent)||!absolute(cwd))throw reject('이어 갈 세션을 확인하세요.');
  if(platform!=='darwin')throw reject('터미널은 해당 Mac의 로컬 화면에서 열 수 있습니다.');
  await mkdir(base(),{recursive:true,mode:0o700});
  const lock=join(base(),'lock');try{await mkdir(lock,{mode:0o700});}catch{throw reject('다른 터미널 열기 요청을 처리 중입니다. 잠시 뒤 상태를 확인하세요.');}
  try{
   const previous=await status();
   if(terminalPending(previous))throw reject(previous.phase==='unknown'?'이전 터미널의 결과를 확인하지 못했습니다. 터미널 창을 확인하세요. 다시 열지 않았습니다.':'이미 터미널에서 연 세션이 있습니다. 그 창을 닫은 뒤 다시 여세요.');
   const r=runner();
   if(!absolute(r?.prepared)||!absolute(r?.binary)||!absolute(r?.tokenFile))throw reject('실행 환경이 준비되지 않았습니다. 메시지를 한 번 보내 실행 환경을 켠 뒤 다시 여세요.');
   if(!(await stat(r.binary)).isFile())throw Error('HAPI unavailable');await access(r.binary,constants.X_OK);
   const url=new URL(r.hubUrl);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw Error('Local Hub required');
   const environment=await json(join(r.prepared,'environment.private.json'));
   if(!environment||Array.isArray(environment)||Object.entries(environment).some(([k,v])=>!k||/[=\0]/.test(k)||typeof v!=='string'||v.includes('\0'))||typeof environment.PATH!=='string')throw Error('Invalid environment');
   const token=(await readFile(r.tokenFile,'utf8')).trim();if(!token||/[\r\n\0]/.test(token))throw Error('Invalid token');
   if(!(await stat(cwd)).isDirectory())throw reject('작업 폴더에 접근할 수 없습니다.');
   const invocation=resumeInvocation({environment,home:join(r.prepared,'runner-home'),hubUrl:url.origin,token,sessionId});
   const id=randomUUID(),dir=join(base(),id);await mkdir(dir,{mode:0o700});
   // The token lives only in this 0600 request file, deleted as soon as the terminal starts it.
   await writeFile(join(dir,'request.private.json'),JSON.stringify({binary:r.binary,args:invocation.args,env:invocation.env,cwd,agent}),{mode:0o600,flag:'wx'});
   await save(join(dir,'state.json'),{phase:'opening',at:now()});
   await save(join(base(),'current.json'),{id,sessionId,agent});
   const script=join(dir,'session-terminal.command');await writeFile(script,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} ${quote(dir)}\n`,{mode:0o700,flag:'wx'});
   try{await open(script);}catch{throw Error('터미널 창 실행 결과를 확인하지 못했습니다. 터미널을 확인하세요. 자동으로 다시 열지 않습니다.');}
   return status();
  }finally{await rm(lock,{recursive:true,force:true});}
 }
 return {status,start};
}
const runResume=plan=>new Promise((resolve,reject)=>{
 const child=spawn(plan.binary,plan.args,{cwd:plan.cwd,env:plan.env,stdio:'inherit'});
 const hangup=()=>child.kill('SIGHUP');process.on('SIGHUP',hangup);
 const cleanup=()=>process.off('SIGHUP',hangup);
 child.once('error',()=>{cleanup();reject(Error('HAPI unavailable'));});
 child.once('exit',code=>{cleanup();resolve(code??129);});
});
export async function runSessionTerminal(directory,{run=runResume,print=s=>process.stdout.write(s+'\n')}={}){
 const handle=await openFile(join(directory,'started'),'wx',0o600);await handle.close();
 try{
  const plan=await json(join(directory,'request.private.json'));await rm(join(directory,'request.private.json'),{force:true});
  await save(join(directory,'state.json'),{phase:'running',pid:process.pid});
  print(`Maricode · 앱에서 쓰던 같은 세션을 공식 ${plan.agent==='codex'?'Codex':'Claude Code'} 화면으로 엽니다. 모든 / 명령을 쓸 수 있고 대화는 앱에도 기록됩니다.`);
  print(plan.agent==='codex'?'Codex는 앱과 동시에 쓸 수 있습니다. 끝나면 /exit 후 이 창을 닫으세요.':'앱에서 메시지를 보내면 세션이 앱으로 돌아갑니다. 끝나면 /exit 후 이 창을 닫으세요.');
  const exitCode=await run(plan);await save(join(directory,'state.json'),{phase:'finished',exitCode});
  print('터미널 세션을 마쳤습니다. 이 창을 닫고 Maricode로 돌아가세요.');
 }catch(e){await save(join(directory,'state.json'),{phase:'failed'});throw e;}
 finally{await rm(join(directory,'request.private.json'),{force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){runSessionTerminal(process.argv[2]).catch(()=>{console.error('터미널을 열지 못했거나 이미 실행한 요청입니다. Maricode에서 상태를 확인하세요.');process.exitCode=1;});}
