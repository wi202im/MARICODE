import {projectRegistry} from '../../pilots/hapi/client-probe/project-registry.mjs';
import {resolveHapiBinary} from './bundled-hapi.mjs';
import {mkdir,readFile,writeFile,stat,access,rm,lstat,rename} from 'node:fs/promises';
import {saveRemoteOrigin} from './remote-config.mjs';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import {homedir,userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {checkDataFormat} from './data-format.mjs';
import {createAccountRegistration} from '../../pilots/hapi/client-probe/account-registration.mjs';
import {toolPath} from './cli-profile-reset.mjs';
const absolute=p=>typeof p==='string'&&isAbsolute(p)&&!/[\u0000-\u001f:]/.test(p);
async function absent(path){try{await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('Existing configuration preserved');}
export async function initializeDesktop({directory,binary}){
 try{await stat(join(directory,'backend.json'));return;}catch(e){if(e.code!=='ENOENT')throw e;}
 await configureDesktop({directory,binary,empty:true});
}
export async function configureDesktop(input){
 const {directory,binary:selection,agent,agentBinary}=input;
 const project=input.empty?join(directory,'local-setup','working-directory'):input.project;
 const binary=resolveHapiBinary(selection);
 if((!input.empty&&!['codex','claude'].includes(agent))||![directory,project,binary,...(input.empty?[]:[agentBinary])].every(absolute))throw Error('Invalid selection');
 for(const file of [binary,...(input.empty?[]:[agentBinary])]){if(!(await stat(file)).isFile())throw Error('Executable required');await access(file,constants.X_OK);}
 if(!input.empty&&!(await stat(project)).isDirectory())throw Error('Project folder required');
 await mkdir(directory,{recursive:true,mode:0o700});
 const lock=join(directory,'web.lock'),setup=join(directory,'local-setup');await mkdir(lock,{mode:0o700});let created=false;
 try{
  await checkDataFormat(directory);await absent(join(directory,'backend.json'));await absent(setup);
  await mkdir(setup,{mode:0o700});created=true;
  for(const sub of ['login',...(input.empty?['working-directory']:[])])await mkdir(join(setup,sub),{recursive:true,mode:0o700});
  const save=(path,value)=>writeFile(path,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
  // CLI defaults are candidates only; local connection confirmation is required before execution.
  const environment=join(setup,'environment.private.json'),accountConfig=join(setup,'accounts.json');
  await save(environment,{HOME:homedir(),USER:userInfo().username,LANG:'en_US.UTF-8',PATH:await toolPath([...new Set([dirname(process.execPath),...(agentBinary?[dirname(agentBinary)]:[]),'/usr/bin','/bin','/usr/sbin','/sbin'])].join(':')),CODEX_HOME:join(homedir(),'.codex'),CLAUDE_CONFIG_DIR:join(homedir(),'.claude')});
  await save(accountConfig,{environment,cliConnectionRequired:true,cwd:project,directory:join(setup,'login'),binaries:input.empty?{}:{[agent]:agentBinary}});
  // Publish last. A second request cannot overwrite any existing installation.
  await save(join(directory,'backend.json'),{version:1,binary:selection,accountConfig,port:61193});
 }catch(error){if(created)await rm(setup,{recursive:true});throw error;}
 finally{await rm(lock,{recursive:true});}
}
async function localAccount(directory){
 const setup=join(directory,'local-setup'),configPath=join(setup,'accounts.json');
 const backend=JSON.parse(await readFile(join(directory,'backend.json'),'utf8'));
 if(backend.version!==1||backend.accountConfig!==configPath)throw Error('External configuration preserved');
 const config=JSON.parse(await readFile(configPath,'utf8'));
 if(config.environment!==join(setup,'environment.private.json')||config.directory!==join(setup,'login'))throw Error('External configuration preserved');
 return {configPath,config};
}
export async function changeDesktopProject({directory,project,expectedProject}){
 if(![directory,project,expectedProject].every(absolute)||!(await stat(project)).isDirectory())throw Error('Invalid project');
 const lock=join(directory,'web.lock');await mkdir(lock,{mode:0o700});
 let registrationLock,temp;
 try{
  await checkDataFormat(directory);
  const {configPath}=await localAccount(directory);
  await mkdir(configPath+'.register-lock',{mode:0o700});registrationLock=configPath+'.register-lock';
  const {config}=await localAccount(directory);
  if(config.cwd!==expectedProject)throw Error('Configuration changed');
  for(const agent of ['codex','claude']){
   const login=join(config.directory,agent+'.login');
   try{await lstat(login);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   const state=JSON.parse(await readFile(join(login,'state.json'),'utf8'));
   if(state.phase!=='finished')throw Error('Login pending');
  }
  temp=configPath+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify({...config,cwd:project})+'\n',{flag:'wx',mode:0o600});
  await rename(temp,configPath);temp=undefined;
 }finally{
  if(temp)await rm(temp,{force:true});
  if(registrationLock)await rm(registrationLock,{recursive:true});
  await rm(lock,{recursive:true});
 }
}
export async function addDesktopAgent({directory,agent,agentBinary}){
 if(!['codex','claude'].includes(agent)||![directory,agentBinary].every(absolute))throw Error('Invalid selection');
 const lock=join(directory,'web.lock');await mkdir(lock,{mode:0o700});
 try{
  await checkDataFormat(directory);
  const {configPath}=await localAccount(directory);
  await createAccountRegistration(configPath,{[agent]:[agentBinary]}).register({agent,path:agentBinary});
 }finally{await rm(lock,{recursive:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>16384)throw Error('Invalid input');}const input=JSON.parse(raw);if(input.action==='initialize')await initializeDesktop(input);else if(input.action==='add-project')await projectRegistry(join(input.directory,'projects.json')).add(input.project);else if(input.action==='remote-origin')await saveRemoteOrigin(input);else if(input.action==='change-project')await changeDesktopProject(input);else if(input.action==='add-agent')await addDesktopAgent(input);else if(input.action===undefined)await configureDesktop(input);else throw Error('Invalid action');console.log('CONFIGURED');}
 catch(error){const denied=['EACCES','EPERM'].includes(error?.code);console.error(denied?'SETUP_ACCESS_DENIED':'Setup failed. Existing settings were preserved.');process.exitCode=denied?13:1;}
}
