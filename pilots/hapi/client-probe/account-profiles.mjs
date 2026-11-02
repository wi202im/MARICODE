import {readFile,writeFile,rename,mkdir,rm,readdir,stat} from 'node:fs/promises';
import {join,dirname,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

// Several accounts per AI, one active at a time (the Runner has one environment). Each account
// is its own CLAUDE_CONFIG_DIR / CODEX_HOME; switching rewrites only that key of the account
// environment, under the same lock prepareRunner uses. Credentials are never read or copied.
const keys={claude:'CLAUDE_CONFIG_DIR',codex:'CODEX_HOME'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const rejected=message=>Object.assign(Error(message),{rejected:true,userMessage:message});
async function writeJson(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,1)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path);}
export function accountProfiles(configPath){
 async function paths(){const c=JSON.parse(await readFile(configPath,'utf8'));if(typeof c.environment!=='string'||!isAbsolute(c.environment))throw Error('Account configuration invalid');return {environment:c.environment,registry:join(dirname(c.environment),'account-profiles.json')};}
 async function load(){
  const p=await paths(),env=JSON.parse(await readFile(p.environment,'utf8'));let saved=null;
  try{saved=JSON.parse(await readFile(p.registry,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const agents={};
  for(const [agent,key] of Object.entries(keys)){
   const current=typeof env[key]==='string'&&isAbsolute(env[key])?resolve(env[key]):null;if(!current)continue;
   const accounts=Array.isArray(saved?.agents?.[agent]?.accounts)?saved.agents[agent].accounts.filter(a=>(a.id==='default'||uuid.test(a.id))&&typeof a.alias==='string'&&typeof a.path==='string'&&isAbsolute(a.path)):[];
   if(!accounts.some(a=>a.id==='default'))accounts.unshift({id:'default',alias:'기본 계정',path:current});
   // The environment file is authoritative for what the Runner uses; a path outside the list is shown as-is.
   const active=accounts.find(a=>resolve(a.path)===current);
   agents[agent]={active:active?.id??null,activePath:current,accounts};
  }
  return {...p,env,agents};
 }
 const view=s=>Object.fromEntries(Object.entries(s.agents).map(([agent,a])=>[agent,{active:a.active,accounts:a.accounts.map(({id,alias})=>({id,alias,active:id===a.active}))}]));
 async function save(s){await writeJson(s.registry,{version:1,agents:Object.fromEntries(Object.entries(s.agents).map(([agent,a])=>[agent,{accounts:a.accounts}]))});}
 async function locked(fn){const lock=configPath+'.register-lock';try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw rejected('다른 설정 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');throw e;}try{return await fn();}finally{await rm(lock,{recursive:true});}}
 return {
  async list(){return view(await load());},
  async add(agent,alias){
   if(!keys[agent])throw rejected('지원하지 않는 AI입니다.');
   alias=typeof alias==='string'?alias.trim().replace(/\s+/g,' '):'';if(!alias||alias.length>40)throw rejected('계정 이름을 1~40자로 입력하세요.');
   return locked(async()=>{
    const s=await load(),a=s.agents[agent];if(!a)throw rejected('이 AI의 전용 프로필이 설정되지 않았습니다.');
    if(a.accounts.some(x=>x.alias===alias))throw rejected('같은 이름의 계정이 이미 있습니다.');
    const id=randomUUID(),path=join(dirname(a.activePath),`${agent}-${id}`);await mkdir(path,{mode:0o700});
    a.accounts.push({id,alias,path});await save(s);return {id,...view(s)};
   });
  },
  async activate(agent,id){
   return locked(async()=>{
    const s=await load(),a=s.agents[agent],target=a?.accounts.find(x=>x.id===id);if(!target)throw rejected('등록된 계정을 선택하세요.');
    if(a.active===id)return {changed:false,...view(s)};
    if(!(await stat(target.path)).isDirectory())throw rejected('계정 프로필 폴더를 찾지 못했습니다.');
    await save(s);await writeJson(s.environment,{...s.env,[keys[agent]]:target.path});
    a.active=id;a.activePath=resolve(target.path);return {changed:true,...view(s)};
   });
  },
  // Which account's profile holds this native session. null = no profile has it (e.g. not started yet).
  async owner(agent,nativeId,cwd){
   if(!keys[agent]||typeof nativeId!=='string'||!/^[\w-]{8,80}$/.test(nativeId))return null;
   const s=await load(),a=s.agents[agent];if(!a)return null;
   for(const account of a.accounts){
    if(agent==='claude'){try{await stat(join(account.path,'projects',resolve(cwd).replace(/[^a-zA-Z0-9]/g,'-'),nativeId+'.jsonl'));return {...account,active:account.id===a.active};}catch{}}
    // Codex moves a thread's rollout to archived_sessions when the session is archived.
    else if(await hasRollout(join(account.path,'sessions'),nativeId)||await hasRollout(join(account.path,'archived_sessions'),nativeId))return {...account,active:account.id===a.active};
   }
   return null;
  }
 };
}
async function hasRollout(root,id){
 let entries;try{entries=await readdir(root,{withFileTypes:true});}catch{return false;}
 for(const e of entries){if(e.isDirectory()&&await hasRollout(join(root,e.name),id))return true;if(e.isFile()&&e.name.startsWith('rollout-')&&e.name.endsWith(`-${id}.jsonl`))return true;}
 return false;
}
