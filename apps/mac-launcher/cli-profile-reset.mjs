import {readFile,writeFile,rename,lstat,rm} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';import {homedir} from 'node:os';import {randomUUID} from 'node:crypto';
const key='cli-shared-profile-v1';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function plain(path,directory=false){try{const s=await lstat(path);if(s.isSymbolicLink()||!(directory?s.isDirectory():s.isFile()))throw Error('CLI reset boundary invalid');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function save(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx',flush:true});await rename(temp,path);}
// Called only after acquiring the desktop runtime lock, before starting Hub/Runner.
// A durable marker makes this a one-time transition, not an every-update cleanup.
export async function resetLegacyCliProfiles(directory){
 const marker=join(directory,key+'.json');if(await plain(marker)){if((await json(marker)).version!==1)throw Error('CLI reset marker invalid');return {reset:false};}
 const setup=join(directory,'local-setup'),configPath=join(setup,'accounts.json'),environment=join(setup,'environment.private.json');
 if(!await plain(join(directory,'backend.json')))return {reset:false};
 if((await json(join(directory,'backend.json'))).accountConfig!==configPath)return {reset:false};
 await plain(setup,true);if(!await plain(configPath)||!await plain(environment))throw Error('CLI reset configuration missing');
 const cfg=await json(configPath);if(cfg.environment!==environment)throw Error('CLI reset configuration boundary invalid');
 const env=await json(environment),profiles=join(setup,'profiles');
 const legacy=await plain(profiles,true);await plain(join(setup,'account-profiles.json'));
 // Old official login processes must finish before their profile is removed.
 if(legacy)for(const agent of ['claude','codex']){const login=join(setup,'login',agent+'.login');if(await plain(login,true)){const state=await json(join(login,'state.json'));if(state.phase!=='finished')throw Error('CLI login still pending');}}
 if(legacy){
  const home=typeof env.HOME==='string'&&isAbsolute(env.HOME)?env.HOME:homedir();
  // Reset only app connection fields. Existing CLI folders, project files and Hub history are untouched.
  await save(environment,{...env,CLAUDE_CONFIG_DIR:join(home,'.claude'),CODEX_HOME:join(home,'.codex')});
  await save(configPath,{...cfg,cliConnectionRequired:true});
  await rm(join(setup,'account-profiles.json'),{force:true});
  await rm(join(setup,'cli-connections.json'),{force:true});
  await rm(profiles,{recursive:true});
 }
 await save(marker,{version:1,reset:legacy});return {reset:legacy};
}
