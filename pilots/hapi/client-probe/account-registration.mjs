import {readFile,writeFile,rename,mkdir,rm,stat,access} from 'node:fs/promises';
import {constants} from 'node:fs';import {isAbsolute,join} from 'node:path';import {randomUUID} from 'node:crypto';
const agents=['claude','codex'];
const absolute=p=>typeof p==='string'&&isAbsolute(p)&&!/[\u0000-\u001f]/.test(p);
export function createAccountRegistration(configPath,candidates={}){
 const allowed=Object.fromEntries(agents.map(a=>[a,Array.isArray(candidates[a])?[...new Set(candidates[a].filter(absolute))]:[]]));
 async function config(){const c=JSON.parse(await readFile(configPath,'utf8'));if(!c||![c.environment,c.directory,c.cwd].every(absolute)||!c.binaries||typeof c.binaries!=='object'||Array.isArray(c.binaries))throw Error('Configuration unavailable');return c;}
 async function executable(path){try{return (await stat(path)).isFile()&&await access(path,constants.X_OK).then(()=>true);}catch{return false;}}
 async function list(){const c=await config();return {providers:await Promise.all(agents.map(async agent=>({agent,registered:Object.hasOwn(c.binaries,agent),path:typeof c.binaries[agent]==='string'?c.binaries[agent]:null,candidates:(await Promise.all(allowed[agent].map(async p=>await executable(p)?p:null))).filter(Boolean)})))};}
 async function register(input){
  if(!input||Object.keys(input).sort().join(',')!=='agent,path'||!agents.includes(input.agent)||!allowed[input.agent].includes(input.path))throw Error('Candidate not allowed');
  const lock=configPath+'.register-lock',temp=configPath+'.'+randomUUID()+'.tmp';await mkdir(lock,{mode:0o700});
  try{const c=await config();if(Object.hasOwn(c.binaries,input.agent))throw Error('Already registered');
   try{await access(join(c.directory,input.agent+'.login'));throw Error('Login record exists');}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!await executable(input.path))throw Error('Executable unavailable');
   await writeFile(temp,JSON.stringify({...c,binaries:{...c.binaries,[input.agent]:input.path}})+'\n',{flag:'wx',mode:0o600});await rename(temp,configPath);
   return {registered:true};
  }finally{await rm(temp,{force:true});await rm(lock,{recursive:true});}
 }
 return {list,register};
}
