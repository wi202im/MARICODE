import {readFile,writeFile,rename,mkdir,rm,readdir,stat,realpath} from 'node:fs/promises';
import {join,dirname,isAbsolute,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
const keys={claude:'CLAUDE_CONFIG_DIR',codex:'CODEX_HOME'};
const rejected=message=>Object.assign(Error(message),{rejected:true,userMessage:message});
async function writeJson(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx',flush:true});await rename(temp,path);}
// One installed CLI connection per AI. The historical module name remains for internal callers;
// this is no longer an account/profile manager and never copies credentials or creates app profiles.
export function accountProfiles(configPath){
 async function load(){
  const c=JSON.parse(await readFile(configPath,'utf8'));if(typeof c.environment!=='string'||!isAbsolute(c.environment))throw Error('CLI environment invalid');
  const env=JSON.parse(await readFile(c.environment,'utf8')),registry=join(dirname(c.environment),'cli-connections.json');let saved={};
  try{saved=JSON.parse(await readFile(registry,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  return {environment:c.environment,registry,env,saved};
 }
 const view=async s=>Object.fromEntries((await Promise.all(Object.entries(keys).map(async([agent,key])=>{
  const mode=s.env[key]?'explicit':'default',raw=s.env[key]||(typeof s.env.HOME==='string'?join(s.env.HOME,agent==='claude'?'.claude':'.codex'):null);
  if(typeof raw!=='string'||!isAbsolute(raw))return null;
  const path=await realpath(raw).catch(()=>resolve(raw)),confirmed=s.saved[agent]?.path===path&&s.saved[agent]?.mode===mode;
  return [agent,{active:'default',confirmed,accounts:[{id:'default',alias:confirmed?'기존 CLI':'CLI 연결 확인 필요',source:confirmed?'cli':'unconfirmed',path,mode,active:true}]}];
 }))).filter(Boolean));
 async function locked(fn){const lock=configPath+'.register-lock';try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw rejected('다른 설정 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');throw e;}try{return await fn();}finally{await rm(lock,{recursive:true});}}
 return {
  async list(){return view(await load());},
  async connect(agent,path,confirm,{create=false,mode='explicit'}={}){
   if(!keys[agent]||confirm!==true||!['default','explicit'].includes(mode))throw rejected('기존 CLI 설정·로그인 폴더를 공유할지 확인하세요.');
   if(typeof path!=='string'||!isAbsolute(path)||/[\x00-\x1f]/.test(path))throw rejected('기존 CLI 설정 폴더의 절대 경로를 선택하세요.');
   return locked(async()=>{
    let canonical;try{if(create===true)await mkdir(path,{recursive:true,mode:0o700});canonical=await realpath(path);if(!(await stat(canonical)).isDirectory())throw Error();}catch{throw rejected('CLI 설정 폴더를 확인하지 못했습니다. 경로·권한을 확인하세요.');}
    const s=await load();
    if(mode==='default'){const home=s.env.HOME;if(typeof home!=='string'||!isAbsolute(home)||canonical!==await realpath(join(home,agent==='claude'?'.claude':'.codex')).catch(()=>null))throw rejected('CLI 기본 위치와 선택한 폴더가 다릅니다. 위치를 다시 확인하세요.');}
    // Incomplete writes cannot certify a different path. The stored confirmation must match the environment.
    const env={...s.env};if(mode==='default')delete env[keys[agent]];else env[keys[agent]]=canonical;
    const connection={path:canonical,mode};await writeJson(s.environment,env);
    await writeJson(s.registry,{...s.saved,[agent]:connection});s.env=env;s.saved[agent]=connection;return view(s);
   });
  },
  async owner(agent,nativeId,cwd){
   if(!keys[agent]||typeof nativeId!=='string'||!/^[\w-]{8,80}$/.test(nativeId))return null;
   const a=(await view(await load()))[agent]?.accounts[0];if(!a)return null;
   if(agent==='claude'){try{await stat(join(a.path,'projects',resolve(cwd).replace(/[^a-zA-Z0-9]/g,'-'),nativeId+'.jsonl'));return {...a,removed:false};}catch{return null;}}
   return await hasRollout(join(a.path,'sessions'),nativeId)||await hasRollout(join(a.path,'archived_sessions'),nativeId)?{...a,removed:false}:null;
  }
 };
}
async function hasRollout(root,id){
 let entries;try{entries=await readdir(root,{withFileTypes:true});}catch{return false;}
 for(const e of entries){if(e.isDirectory()&&await hasRollout(join(root,e.name),id))return true;if(e.isFile()&&e.name.startsWith('rollout-')&&e.name.endsWith(`-${id}.jsonl`))return true;}
 return false;
}
