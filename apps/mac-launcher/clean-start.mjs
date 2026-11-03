import {readFile,writeFile,rename,lstat,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';import {randomUUID} from 'node:crypto';
const marker='clean-start-1.1.0.json';
const resetJournal='app-reset.json',resetRequest='app-reset-request.json';
const keep=new Set([marker,resetJournal,'data-format.json','web.lock','web-ownership.sqlite','web-ownership.sqlite-wal','web-ownership.sqlite-shm','web-ownership.sqlite-journal']);
const blocked=()=>Object.assign(Error('Clean start requires the previous app and official CLI work to be stopped'),{startupKind:'configuration'});
async function info(path){try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function json(path){const s=await info(path);if(!s?.isFile()||s.isSymbolicLink())throw blocked();return JSON.parse(await readFile(path,'utf8'));}
async function plainDirectory(path){const s=await info(path);if(s&&(!s.isDirectory()||s.isSymbolicLink()))throw blocked();return !!s;}
async function save(path,value){const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx',flush:true});await rename(tmp,path);}
async function checkLogin(directory){
 const setup=join(directory,'local-setup');if(!await plainDirectory(setup))return;
 if(await info(join(setup,'accounts.json.register-lock')))throw blocked();
 const root=join(setup,'login');if(!await plainDirectory(root))return;
 for(const agent of ['claude','codex']){
  const login=join(root,agent+'.login');if(await plainDirectory(login)&&!['finished','failed'].includes((await json(join(login,'state.json'))).phase))throw blocked();
  const cli=join(root,'official-cli-'+agent);if(await plainDirectory(cli)){
   const current=await json(join(cli,'current.json'));if(!/^[a-f0-9-]{36}$/i.test(current.id??''))throw blocked();const run=join(cli,current.id);await plainDirectory(run);if(!['finished','failed'].includes((await json(join(run,'state.json'))).phase))throw blocked();
  }
 }
}
// Only under the acquired desktop runtime lock, before any Hub/Runner starts.
// Names are journaled before deletion; a crash continues this same cleanup, never a later installation.
export async function cleanStart110(directory,journal=marker){
 if(!await plainDirectory(directory)||!await plainDirectory(join(directory,'web.lock'))||!await info(join(directory,'web-ownership.sqlite')))throw blocked();
 const format=await json(join(directory,'data-format.json'));if(format.product!=='merry-development'||format.version!==1)throw blocked();
 const path=join(directory,journal);let state;
 if(await info(path)){
  state=await json(path);if(state.version!==1||typeof state.reset!=='boolean'||!['clearing','complete'].includes(state.phase))throw blocked();
  if(state.phase==='complete')return {reset:false};
  if(!Array.isArray(state.entries)||state.entries.some(n=>typeof n!=='string'||!n||n==='.'||n==='..'||/[\/\\\0]/.test(n)||keep.has(n)))throw blocked();
 }else{
  await checkLogin(directory);
  const entries=(await readdir(directory)).filter(n=>!keep.has(n));state={version:1,phase:'clearing',reset:entries.length>0,entries};await save(path,state);
 }
 // Preflight happened before publishing this journal. On resume its login files
 // may already be partly removed; do not reinterpret that as a new live login.
 for(const name of state.entries)await rm(join(directory,name),{recursive:true,force:true}); // rm unlinks symlinks; never follows project/CLI targets.
 await save(path,{version:1,phase:'complete',reset:state.reset});return {reset:state.reset};
}
// A reset is requested from the running app and performed on the next start, under the runtime lock,
// before Hub/Runner. It reuses the journaled clean start; external project and CLI folders are never followed.
export async function requestAppReset(directory){await save(join(directory,resetRequest),{version:1});}
export async function cancelAppReset(directory){await rm(join(directory,resetRequest),{force:true});}
export async function appResetRequested(directory){return !!await info(join(directory,resetRequest));}
export async function appReset(directory){
 const journal=join(directory,resetJournal),state=await info(journal)?await json(journal):null;
 if(state?.phase!=='clearing'){if(!await info(join(directory,resetRequest)))return {reset:false};await rm(journal,{force:true});}
 return {reset:(await cleanStart110(directory,resetJournal)).reset||state?.phase==='clearing'};
}
