import {createHash} from 'node:crypto';
// Mac launcher preparation only: never installs software, starts a Runner or changes a running one.
import {readFile,writeFile,mkdir,rm,stat,access,symlink,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const agents=['claude','codex'];
const absolute=p=>typeof p==='string'&&isAbsolute(p)&&!/[\u0000-\u001f]/.test(p);
function requirePath(p){if(!absolute(p))throw Error('Invalid absolute path');}
async function environmentAt(path){
 requirePath(path);const env=JSON.parse(await readFile(path,'utf8'));
 if(!env||typeof env!=='object'||Array.isArray(env)||Object.entries(env).some(([k,v])=>!k||/[=\0]/.test(k)||typeof v!=='string'||v.includes('\0')))throw Error('Invalid environment');
 if(typeof env.PATH!=='string'||env.PATH.split(':').some(p=>!absolute(p)))throw Error('Explicit absolute PATH required');
 return env;
}
async function privateFile(path,data){await writeFile(path,JSON.stringify(data)+'\n',{mode:0o600,flag:'wx'});}
export async function initializeMachine({directory,environment,cwd}){
 for(const p of [directory,environment,cwd])requirePath(p);
 const env=await environmentAt(environment);if(!(await stat(cwd)).isDirectory())throw Error('Invalid working directory');
 // Non-recursive exclusive mkdir never takes ownership of a pre-existing installation.
 await mkdir(directory,{mode:0o700});
 try{
  await mkdir(join(directory,'login'),{mode:0o700});
  const config=join(directory,'accounts.json');
  await privateFile(config,{environment,cwd,directory:join(directory,'login'),binaries:{}});
  const candidates={};
  for(const agent of agents){
   const paths=env.PATH.split(':').map(p=>join(p,agent));
   if(agent==='claude'&&absolute(env.HAPI_CLAUDE_PATH))paths.unshift(env.HAPI_CLAUDE_PATH);
   candidates[agent]=[];
   for(const path of new Set(paths)){try{if((await stat(path)).isFile()){await access(path,constants.X_OK);candidates[agent].push(path);}}catch{}}
  }
  await privateFile(join(directory,'candidates.json'),candidates);
  return config;
 }catch(e){await rm(directory,{recursive:true,force:true});throw e;}
}
export async function machineOptions(directory){
 requirePath(directory);
 const accountCandidates=JSON.parse(await readFile(join(directory,'candidates.json'),'utf8'));
 if(!accountCandidates||agents.some(a=>!Array.isArray(accountCandidates[a])||accountCandidates[a].some(p=>!absolute(p))))throw Error('Invalid candidate paths');
 return {accountConfig:join(directory,'accounts.json'),accountCandidates};
}
export async function accountRevision(configPath){
 const raw=await readFile(configPath,'utf8'),c=JSON.parse(raw);
 const environment=await readFile(c.environment,'utf8'),paths={};
 for(const agent of agents)if(c.binaries?.[agent])paths[agent]=await realpath(c.binaries[agent]);
 return createHash('sha256').update(JSON.stringify([raw,environment,paths])).digest('hex');
}
export async function prepareRunner(configPath,directory){
 requirePath(configPath);requirePath(directory);if(directory.includes(':'))throw Error('Invalid PATH directory');
 // Shares registration's lock. No registered path can change while its snapshot is prepared.
 const lock=configPath+'.register-lock';await mkdir(lock,{mode:0o700});
 let created=false;
 try{
  const sourceRevision=await accountRevision(configPath);
  const config=JSON.parse(await readFile(configPath,'utf8'));
  if(!config||!config.binaries||Array.isArray(config.binaries)||typeof config.binaries!=='object'||Object.keys(config.binaries).some(a=>!agents.includes(a)))throw Error('Invalid AI configuration');
  requirePath(config.cwd);if(!(await stat(config.cwd)).isDirectory())throw Error('Invalid working directory');
  const env=await environmentAt(config.environment),binaries={};
  for(const agent of agents){
   const path=config.binaries[agent];if(path===undefined)continue;
   requirePath(path);if(!(await stat(path)).isFile())throw Error('Executable unavailable');await access(path,constants.X_OK);
   binaries[agent]=await realpath(path);
  }
  await mkdir(directory,{mode:0o700});created=true;const bin=join(directory,'bin');await mkdir(bin,{mode:0o700});
  for(const agent of agents){
   if(binaries[agent])await symlink(binaries[agent],join(bin,agent));
   else await writeFile(join(bin,agent),'#!/bin/sh\necho "AI path is not registered for this runtime" >&2\nexit 126\n',{mode:0o700,flag:'wx'});
  }
  const environment=join(directory,'environment.private.json');
  await privateFile(environment,{...env,PATH:bin+':'+env.PATH,HAPI_CLAUDE_PATH:join(bin,'claude')});
  if(await accountRevision(configPath)!==sourceRevision)throw Error('Account configuration changed during preparation');
  const result={environment,cwd:config.cwd,agents:Object.keys(binaries),binaries,sourceRevision};
  await privateFile(join(directory,'prepared.json'),result);
  return result;
 }catch(e){if(created)await rm(directory,{recursive:true,force:true});throw e;}
 finally{await rm(lock,{recursive:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [action,...args]=process.argv.slice(2);
  if(action==='init'&&args.length===3)await initializeMachine({directory:args[0],environment:args[1],cwd:args[2]});
  else if(action==='prepare'&&args.length===2)await prepareRunner(args[0],args[1]);
  else throw Error('Invalid command');
  console.log('Preparation saved. No process was started.');
 }catch{console.error('Preparation failed. Existing configuration was not replaced.');process.exitCode=1;}
}
