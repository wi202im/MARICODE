import {sessionTitle} from './workspace.mjs';
import {workspaceChoices,workspaceRequest,createWorkspacePlans} from './workspace-plans.mjs';
import {projectRegistry,legacyProjectId} from './project-registry.mjs';
import {randomUUID} from 'node:crypto';
import {createRunnerWorkspace} from './runner-workspace.mjs';
import {readFile,readdir,stat,lstat,realpath,mkdir,rm,writeFile,rename} from 'node:fs/promises';
import {join,isAbsolute,dirname,basename} from 'node:path';
import {prepareRunner,accountRevision} from './machine-setup.mjs';
import {launchRunner} from './runner-launch.mjs';
import {claudeImports} from './claude-import.mjs';
import {codexImports} from './codex-import.mjs';
import {accountProfiles} from './account-profiles.mjs';
import {createCommandCards,commandContextKey} from './command-cards.mjs';
import {createOfficialCli,cliPending} from './official-cli.mjs';
import {discoverClaudeSource,discoverCliSource} from './claude-source.mjs';
import {homedir} from 'node:os';
import {repoStates,pinMismatches,pinFrom,validBranch} from './branch-pin.mjs';
async function ownerAuthorization(config){
 const token=await readFile(config.tokenFile,'utf8');
 const auth=await fetch(config.hubUrl+'/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessToken:token}),redirect:'error',signal:AbortSignal.timeout(3000)});
 if(!auth.ok)throw Error();const {token:bearer}=await auth.json();if(typeof bearer!=='string'||!bearer)throw Error();return 'Bearer '+bearer;
}
async function machineId(config){return JSON.parse(await readFile(join(config.directory,'runner-home/settings.json'),'utf8')).machineId;}
export async function runnerConnected(config){
 const id=await machineId(config);if(typeof id!=='string'||!id)return false;
 const authorization=await ownerAuthorization(config);
 const r=await fetch(config.hubUrl+'/api/machines',{headers:{authorization},redirect:'error',signal:AbortSignal.timeout(3000)});
 if(!r.ok)throw Error();const data=await r.json();
 if(!Array.isArray(data.machines)||!data.machines.some(m=>m.id===id))return false;
 // A persisted machine may appear before its RPC handlers have re-registered.
 const ready=await fetch(config.hubUrl+'/api/machines/'+encodeURIComponent(id)+'/agent-availability',{headers:{authorization},redirect:'error',signal:AbortSignal.timeout(3000)});
 if(!ready.ok)return false;const availability=await ready.json();
 return Array.isArray(availability.agents)&&availability.agents.some(a=>['claude','codex'].includes(a.agent)&&typeof a.available==='boolean');
}
async function runnerHasActive(config){
 const id=await machineId(config);if(typeof id!=='string'||!id)throw Error('Runner identity unavailable');
 const r=await fetch(config.hubUrl+'/api/sessions',{headers:{authorization:await ownerAuthorization(config)},redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.sessions))throw Error();
 return data.sessions.some(s=>s.active&&s.metadata?.machineId===id);
}
export function createRunnerSetup(config,{prepare=prepareRunner,launch=launchRunner,connection=runnerConnected,hasActive=runnerHasActive,officialCli=createOfficialCli(config.accountConfig),commandCards=createCommandCards(config.accountConfig,config.directory+'.command-cards'),now=Date.now}={}){
 const url=new URL(config.hubUrl);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Local Hub required');
 if(['directory','accountConfig','binary','tokenFile'].some(k=>typeof config[k]!=='string'||!isAbsolute(config[k])))throw Error('Absolute launcher paths required');
 const c={...config,hubUrl:url.origin,taskDirectory:join(config.directory,'tasks')},slot=config.directory;let busy=false,phase=null,child=null,resumePending=null;
 async function generalDirectory(){return join(await realpath(dirname(slot)),basename(slot)+'.general','general-chat');}
 async function prepareGeneralDirectory(){
  const path=await generalDirectory();
  for(const part of [dirname(path),path]){
   try{await mkdir(part,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
   if(!(await lstat(part)).isDirectory()||await realpath(part)!==part)throw Error('General chat folder changed');
  }
  return path;
 }
 async function current(){
  try{const saved=JSON.parse(await readFile(slot+'.current.json','utf8')).directory;
   if(typeof saved!=='string'||!saved.startsWith(slot+'.generation-')||!/^[a-f0-9-]{36}$/.test(saved.slice((slot+'.generation-').length)))throw Error('Invalid generation');
   if(saved!==c.directory){if(child?.running)throw Error('Running generation changed');c.directory=saved;phase=null;child=null;}
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 async function exclusive(fn){
  if(busy)throw Error('Operation pending');busy=true;let locked=false;
  try{await mkdir(slot+'.lifecycle-lock',{mode:0o700});locked=true;await current();return await fn();}
  finally{if(locked)await rm(slot+'.lifecycle-lock',{recursive:true});busy=false;}
 }

 async function exists(p){try{await stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 async function handoffLinks(){try{return JSON.parse(await readFile(slot+'.handoffs.json','utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
 async function state(){
  await current();
  if(phase)return phase==='running'&&!child?.running?'exited':phase;
  if(await exists(join(c.directory,'session-operation.json')))return 'unknown';
  if(await exists(join(c.directory,'runner-stopped.json')))return 'exited';
  if(await exists(join(c.directory,'runner-home')))return 'unknown';
  if(await exists(join(c.directory,'prepared.json')))return 'prepared';
  return await exists(c.directory)?'unknown':'unprepared';
 }
 async function snapshot(){
  try{
   const plan=JSON.parse(await readFile(join(c.directory,'prepared.json'),'utf8'));
   const configuration=plan.sourceRevision&&plan.sourceRevision===await accountRevision(c.accountConfig)?'matched':plan.sourceRevision?'changed':'unknown';
   return {configuration,project:plan.cwd,agents:plan.agents,binaries:plan.binaries};
  }catch{return {configuration:'unknown'};}
 }
 async function status(){
  const currentPhase=await state();let hub='not-checked';
  // Observe a surviving Runner after a web restart; never adopt its process.
  // A failed action in this owner must remain unconfirmed, even if Hub is online.
  const observed=currentPhase==='unknown'&&phase===null&&!child&&await exists(join(c.directory,'runner-home'));
  if(currentPhase==='running'||observed){try{hub=await connection(c)?'connected':'disconnected';}catch{hub='unknown';}}
  return {phase:currentPhase,observed,hub,hubUrl:c.hubUrl,...await snapshot(),workspaceAvailable:(currentPhase==='running'||observed)&&hub==='connected'};
 }
 async function action(expected,next,fn){
  return exclusive(async()=>{
   if(await state()!==expected)throw Error('Operation not available');phase=next;
   try{await fn();}catch{phase='unknown';throw Error('Result unconfirmed');}
  });
 }
 async function unresolvedTasks(){
  let files;try{files=await readdir(c.taskDirectory);}catch(e){if(e.code==='ENOENT')return false;throw e;}
  for(const f of files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)))if(JSON.parse(await readFile(join(c.taskDirectory,f),'utf8')).state!=='created')return true;
  return false;
 }
 async function authorize(authorization){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw Object.assign(Error('Authentication required'),{status:401});
  const r=await fetch(c.hubUrl+'/api/sessions',{headers:{authorization},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Object.assign(Error('Workspace unavailable'),{status:r.status});return r.json();
 }
 async function activeAuthorizedSessions(auth){const data=await authorize(auth);if(!Array.isArray(data.sessions))throw Error('Session state unavailable');return data.sessions.some(s=>s.active);}
 async function projects(authorization){
  await authorize(authorization);const generalPath=await generalDirectory();
  if(!c.projectsPath){const t=await createRunnerWorkspace(c).target(authorization);return [{key:'',label:t.project,path:t.project}];}
  const registry=projectRegistry(c.projectsPath);const registered=await registry.list();const availability=new Map();for(const p of registered){try{await registry.get(p.id);availability.set(p.id,true);}catch{availability.set(p.id,false);}}
  const rows=registered.map(p=>({key:p.id,label:p.path===generalPath?'일반 대화':p.name,general:p.path===generalPath,path:p.path,available:availability.get(p.id),projectId:p.projectId,projectLabel:p.path===generalPath?'일반 대화':p.projectLabel,workspaceId:p.workspaceId,workspaceLabel:p.workspaceLabel,...(p.parentId?{parentKey:p.parentId,worktree:p.worktree===true}:{})}));
  const cfg=JSON.parse(await readFile(c.accountConfig,'utf8'));
  if(!cfg.cwd.endsWith('/local-setup/working-directory')&&!(await registry.list({includeRemoved:true})).some(p=>p.path===cfg.cwd))rows.unshift({key:'',label:cfg.cwd.split('/').at(-1),path:cfg.cwd,projectId:legacyProjectId(cfg.cwd)});
  return rows;
 }
 async function launchCurrent(){
  const path=join(c.directory,'prepared.json'),plan=JSON.parse(await readFile(path,'utf8'));
  let roots=[plan.cwd];
  if(c.projectsPath){
   const registry=projectRegistry(c.projectsPath),rows=await registry.list();
   roots=[];for(const row of rows){try{roots.push((await registry.get(row.id)).path);}catch{/* Missing unrelated folders do not block healthy workspaces. */}}
   if(!plan.cwd.endsWith('/local-setup/working-directory'))roots.push(plan.cwd);
   if(!roots.length)roots=[plan.cwd];
  }
  if(c.projectsPath)roots.push(await prepareGeneralDirectory());
  await writeFile(path,JSON.stringify({...plan,workspaceRoots:[...new Set(roots)]})+'\n',{mode:0o600});
  const token=await readFile(c.tokenFile,'utf8');child=await launch({prepared:c.directory,binary:c.binary,hubUrl:c.hubUrl,token});phase='running';
 }
 async function refreshRequired(project,agent){
  const plan=JSON.parse(await readFile(join(c.directory,'prepared.json'),'utf8'));
  const path=c.projectsPath&&project?(await projectRegistry(c.projectsPath).get(project)).path:plan.cwd;
  return !(plan.workspaceRoots??[plan.cwd]).includes(path)||(agent!==undefined&&!plan.agents?.includes(agent));
 }
 async function stopOwned(){
  if(await state()!=='running'||!child)throw Error('Owned running process required');
  if(await unresolvedTasks())throw Object.assign(Error('Unconfirmed session requests remain'),{code:'RUNNER_UNCONFIRMED'});
  if(await hasActive(c))throw Object.assign(Error('Active sessions must finish before refresh'),{code:'RUNNER_ACTIVE'});
  phase='stopping';
  try{await child.stop();await writeFile(join(c.directory,'runner-stopped.json'),'{}',{mode:0o600,flag:'wx'});phase='exited';}
  catch{phase='unknown';throw Error('Stop unconfirmed');}
 }
 async function prepareNext(){
  const prior=await state();if(!['prepared','exited'].includes(prior))throw Error('Cannot replace this generation');
  let id;
  if(await exists(join(c.directory,'runner-home'))){if(await unresolvedTasks()||await hasActive(c))throw Error('Active or unconfirmed sessions remain');id=await machineId(c);}
  else{id=JSON.parse(await readFile(join(c.directory,'prepared.json'),'utf8')).machineId;}
  const next=slot+'.generation-'+randomUUID();phase='preparing';
  try{
   await prepare(c.accountConfig,next);
   if(id){const path=join(next,'prepared.json'),plan=JSON.parse(await readFile(path,'utf8'));await writeFile(path,JSON.stringify({...plan,machineId:id})+'\n',{mode:0o600});}
   const temp=slot+'.current.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({directory:next}),{mode:0o600,flag:'wx'});await rename(temp,slot+'.current.json');
   c.directory=next;child=null;phase='prepared';
  }catch{phase='unknown';throw Error('Preparation unconfirmed');}
 }
 async function ensureReady(authorization,project,agent){
    // Validate the registered folder before stopping or preparing anything.
    if(project!==undefined&&typeof project!=='string')throw Error('Invalid project');
    if(project){if(!c.projectsPath)throw Error('Projects unavailable');await projectRegistry(c.projectsPath).get(project);}
    if(agent!==undefined&&!['codex','claude'].includes(agent))throw Error('Invalid agent');
    const cfg=JSON.parse(await readFile(c.accountConfig,'utf8'));
    if(cfg.cliConnectionRequired){const links=await accountProfiles(c.accountConfig).list();if(agent?!links[agent]?.confirmed:!Object.values(links).some(p=>p.confirmed))throw Object.assign(Error('AI 연결에서 기존 CLI 설정 위치를 먼저 연결하세요.'),{rejected:true,status:409});}
    const before=await state();
    if(before==='running'){
     if(!await refreshRequired(project,agent))return;
     await stopOwned();await prepareNext();
    }else{
     if(!['unprepared','prepared','exited'].includes(before))throw Error('Runner state requires review');
     if(before==='exited')await prepareNext();
     if(before==='unprepared'){phase='preparing';try{await prepare(c.accountConfig,c.directory);phase='prepared';}catch{phase='unknown';throw Error('Preparation unconfirmed');}}
     if(before==='prepared'&&(await snapshot()).configuration!=='matched')await prepareNext();
    }
    if((await snapshot()).configuration!=='matched')throw Error('Configuration changed');
    phase='starting';try{await launchCurrent();}catch{phase='unknown';throw Error('Start unconfirmed');}

 }
 async function selectedProject(authorization,key){
  const rows=await projects(authorization),row=rows.find(p=>p.key===key);if(!row)throw Object.assign(Error('등록된 프로젝트를 선택하세요.'),{rejected:true,status:400});
  if(row.available===false)throw Object.assign(Error('이 작업공간의 폴더가 없거나 접근할 수 없습니다. 폴더 위치·접근 권한을 확인하거나 목록에서 등록을 해제해 주세요.'),{rejected:true,status:400});
  return key?projectRegistry(c.projectsPath).get(key):{id:'',path:row.path};
 }
 async function commandScope(authorization,id){
  await current();const data=await authorize(authorization),s=data.sessions?.find(s=>s.id===id),m=s?.metadata;
  if(!m||!['claude','codex'].includes(m.flavor)||m.machineId!==await machineId(c))throw Object.assign(Error('이 컴퓨터의 세션을 선택하세요.'),{rejected:true,status:403});
  const rows=await projects(authorization),row=rows.find(p=>p.path===m.path&&p.available!==false);if(!row)throw Object.assign(Error('등록된 작업 폴더를 확인하세요.'),{rejected:true});
  const project=await selectedProject(authorization,row.key),profiles=accountProfiles(c.accountConfig),p=(await profiles.list())[m.flavor];
  const owner=await profiles.owner(m.flavor,m[m.flavor==='claude'?'claudeSessionId':'codexSessionId']??m.agentSessionId,m.path);
  if(!p?.active||!owner?.active||owner.removed)throw Object.assign(Error('이 세션의 원래 계정으로 전환하고 세션 기록을 확인하세요. 다른 계정의 설정은 변경하지 않습니다.'),{rejected:true});
  return {sessionId:id,agent:m.flavor,cwd:project.path,accountId:p.active,alias:owner.alias,revision:await accountRevision(c.accountConfig)};
 }
 const plans=c.projectsPath?createWorkspacePlans({directory:slot+'.workspace-plans',worktreeDirectory:slot+'.worktrees',registry:projectRegistry(c.projectsPath)}):null;
 const api={status,projects,
  async generalChat(authorization){
   await authorize(authorization);if(!c.projectsPath)throw Error('General chat unavailable');
   return exclusive(async()=>{
    const generalPath=await prepareGeneralDirectory();
    const row=await projectRegistry(c.projectsPath).add(generalPath);
    return {project:row.id};
   });
  },
  async claudeImportHistory(authorization,id,before){
   await current();
   const available=await api.workspace(authorization),session=available.find(s=>s.id===id);if(!session)throw Error('등록된 세션을 선택하세요.');
   return claudeImports({directory:slot+'.claude-imports',project:session.project,machineId:await machineId(c)}).history(id,before);
  },
  async claudeImport(authorization,input,action){
   await authorize(authorization);
   if(!input||Object.keys(input).some(k=>!['project','source','id','fingerprint',...(action==='list'?['offset']:[])].includes(k))||typeof input.project!=='string'||!['list','import','check'].includes(action))throw Error('가져오기 요청을 확인하세요.');
   return exclusive(async()=>{
    const p=await selectedProject(authorization,input.project);
    // A selected list result supplies an absolute source for import/check, so
    // later shell changes cannot silently retarget an already chosen record.
    // Older pending records used an empty source for ~/.claude; preserve that
    // meaning instead of applying new discovery to an uncertain registration.
    const cfg=JSON.parse(await readFile(c.accountConfig,'utf8'));
    const link=(await accountProfiles(c.accountConfig).list()).claude,connected=link?.confirmed,destination=link?.accounts[0]?.path;
    const discovery=await discoverClaudeSource({source:input.source||(action==='list'&&connected?destination:action==='list'?'':join(homedir(),'.claude'))}),source=discovery.source;
    if(!source)return {sessions:[],skipped:0,status:'source-unresolved',sourceOrigin:discovery.origin};
    const makeImports=id=>claudeImports({directory:slot+'.claude-imports',project:p.path,destination,machineId:id});
    if(action==='list')return {...await makeImports('not-started').list(source,input.offset??0),sourceOrigin:discovery.origin};
    const callbacks={
     register:async record=>{
      const token=await readFile(c.tokenFile,'utf8');
      const r=await fetch(c.hubUrl+'/cli/sessions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({id:record.hubId,tag:'maricode-import-'+record.hubId,metadata:record.metadata,agentState:{controlledByUser:false}}),redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw Error('세션 등록 결과를 확인하세요. 자동 재등록하지 않습니다.');
     },
     lookup:async id=>{
      const r=await fetch(c.hubUrl+'/api/sessions/'+encodeURIComponent(id),{headers:{authorization},redirect:'error',signal:AbortSignal.timeout(5000)});
      if(r.status===404)return null;if(!r.ok)throw Error('등록 결과 조회 실패');return (await r.json()).session;
     }
    };
    // Recover an existing attempt before preparing/restarting anything. A check
    // needs only the durable import journal and Hub, not a healthy CLI/Runner.
    const priorMachine=await exists(join(c.directory,'runner-home/settings.json'))?await machineId(c):null;
    const prior=await makeImports(priorMachine).import({...input,source},callbacks,true);
    if(action==='check'||prior.state!=='none')return prior;
    // No import was admitted. Errors below must not masquerade as a lost
    // registration, but Runner's own lifecycle uncertainty remains protected.
    const reject=(reason,message)=>Object.assign(Error(message),{rejected:true,reason,userMessage:'가져오기를 시작하지 않았습니다. '+message});
    if(typeof destination!=='string'||!isAbsolute(destination)||cfg.cliConnectionRequired&&!connected)throw reject('IMPORT_CLI_CONNECTION','AI 연결에서 기존 Claude CLI 설정 위치를 먼저 연결하세요. 목록 조회만으로 AI가 연결되지는 않습니다.');
    if(!cfg.binaries?.claude)throw reject('IMPORT_CLI_BINARY','Claude 실행 파일이 연결되지 않았습니다. AI 연결에서 기존 CLI를 연결하세요.');
    try{await ensureReady(authorization,input.project,'claude');}
    catch{throw reject('IMPORT_RUNNER_PREPARE','실행 환경을 준비하지 못했습니다. AI 연결과 컴퓨터 설정의 실행 상태를 확인하세요. 실행 상태가 미확인이면 먼저 그 상태를 확인해야 합니다.');}
    let ready=false;for(let attempt=0;attempt<15;attempt++){try{ready=await connection(c);}catch{}if(ready)break;await new Promise(r=>setTimeout(r,300));}
    if(!ready)throw reject('IMPORT_RUNNER_CONNECT','실행기의 서버 연결을 확인하지 못했습니다. 컴퓨터 설정의 실행 상태를 확인하세요.');
    let target;
    try{target=await createRunnerWorkspace(c).target(authorization);}
    catch{throw reject('IMPORT_RUNNER_TARGET','연결된 실행 컴퓨터를 확인하지 못했습니다. 서버 연결과 실행 상태를 확인하세요.');}
    if(!target.agents.includes('claude'))throw reject('IMPORT_CLI_BINARY','실행기에 Claude가 준비되지 않았습니다. AI 연결에서 기존 CLI 실행 파일을 확인하세요.');
    const sessions=await authorize(authorization);
    if(sessions.sessions?.some(s=>s.metadata?.machineId===target.machineId&&s.metadata?.flavor==='claude'&&(s.metadata?.claudeSessionId??s.metadata?.agentSessionId)===input.id&&s.metadata?.path!==p.path))throw reject('IMPORT_PROJECT_CONFLICT','이 세션 ID가 다른 작업 폴더에 연결돼 있습니다.');
    return makeImports(target.machineId).import({...input,source},callbacks);
   });
  },
  // HAPI's session list summarizes the native engine ID as metadata.agentSessionId.
  async codexImport(authorization,input,action){
   await authorize(authorization);
   if(!input||Object.keys(input).some(k=>!['project','source','id','fingerprint',...(action==='list'?['offset']:[])].includes(k))||typeof input.project!=='string'||!['list','import','check'].includes(action))throw Error('가져오기 요청을 확인하세요.');
   return exclusive(async()=>{
    const p=await selectedProject(authorization,input.project);
    const cfg=JSON.parse(await readFile(c.accountConfig,'utf8')),env=JSON.parse(await readFile(cfg.environment,'utf8'));
    const link=(await accountProfiles(c.accountConfig).list()).codex,destination=link?.accounts[0]?.path;
    if(typeof destination!=='string'||!isAbsolute(destination))throw Error('Codex CLI 설정 연결이 필요합니다.');
    const source=input.source||(link?.confirmed?destination:join(homedir(),'.codex')),imports=codexImports({project:p.path,destination});
    if(action==='list')return {...await imports.list(source,input.offset??0),sourceOrigin:input.source?'selected':'default'};
    const registered=async machineId=>(await authorize(authorization)).sessions?.find(s=>s.metadata?.machineId===machineId&&s.metadata?.flavor==='codex'&&(s.metadata?.codexSessionId??s.metadata?.agentSessionId)===input.id&&s.metadata?.path===p.path)?.id;
    if(action==='check'){
     if(!await exists(join(c.directory,'runner-home/settings.json')))return {state:'none'};
     const id=await registered(await machineId(c));return id?{state:'registered',id}:{state:'none'};
    }
    await ensureReady(authorization,input.project,'codex');
    let ready=false;for(let attempt=0;attempt<15;attempt++){try{ready=await connection(c);}catch{}if(ready)break;await new Promise(r=>setTimeout(r,300));}
    if(!ready)throw Error('실행기 연결을 먼저 확인하세요. 가져오기를 실행하지 않았습니다.');
    const target=await createRunnerWorkspace(c).target(authorization);
    const {title}=await imports.copy(source,input.id,input.fingerprint),existing=await registered(target.machineId);
    if(existing)return {state:'registered',id:existing};
    // Register without messages: HAPI's Codex resume replays the thread with stable IDs, while
    // /api/codex/sync-session's appended copies would show every earlier turn twice. The tag is
    // deterministic, so getOrCreateSession returns the same session if this request is retried.
    const token=await readFile(c.tokenFile,'utf8');
    const r=await fetch(c.hubUrl+'/cli/sessions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({tag:'maricode-codex-import-'+target.machineId+'-'+input.id,metadata:{path:p.path,machineId:target.machineId,flavor:'codex',codexSessionId:input.id,name:title,host:'이 컴퓨터'},agentState:{controlledByUser:false}}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('Codex 기록 등록 결과를 확인하지 못했습니다. 자동 재등록하지 않습니다.');
    const id=await registered(target.machineId);
    if(!id)throw Error('Codex 기록 등록 결과를 확인하지 못했습니다.');
    return {state:'registered',id};
   });
  },
  async commandCardCapabilities(authorization,id){return exclusive(async()=>commandCards.capabilities(await commandScope(authorization,id)));},
  async commandCardResult(authorization,id,requestId){return commandCards.result(await commandScope(authorization,id),requestId);},
  async commandCardRun(authorization,id,input){
   if(!input||typeof input.contextKey!=='string')throw Object.assign(Error('명령 카드를 다시 여세요.'),{rejected:true});
   let admitted=false;try{return await exclusive(async()=>{const scope=await commandScope(authorization,id);if(input.contextKey!==commandContextKey(scope))throw Object.assign(Error('대상 계정·폴더가 바뀌었습니다. 명령 카드를 다시 여세요.'),{rejected:true});
    if(['mcp-add','mcp-remove','mcp-login'].includes(input.action)&&cliPending(await officialCli.status(scope.agent)))throw Object.assign(Error('별도 공식 CLI 창을 종료한 뒤 설정을 변경하세요.'),{rejected:true});
    const {contextKey,...request}=input;admitted=true;return commandCards.execute(scope,request);
   });}catch(error){if(!admitted&&!error.rejected)throw Object.assign(Error('명령을 시작하지 않았습니다. 연결·계정·다른 설정 작업을 확인하세요.'),{rejected:true,status:error.status});throw error;}
  },
  async officialCliStatus(authorization){await authorize(authorization);return Object.fromEntries(await Promise.all(['claude','codex'].map(async agent=>[agent,await officialCli.status(agent)])));},
  async openOfficialCli(authorization,input){
   await authorize(authorization);
   if(!input||Object.keys(input).some(k=>!['agent','accountId','project'].includes(k))||!['claude','codex'].includes(input.agent)||typeof input.project!=='string'||typeof input.accountId!=='string')throw Object.assign(Error('공식 CLI 실행 대상을 확인하세요.'),{rejected:true});
   return exclusive(async()=>{const project=await selectedProject(authorization,input.project);return officialCli.start({agent:input.agent,accountId:input.accountId,cwd:project.path});});
  },
  async accountProfiles(authorization){await authorize(authorization);return accountProfiles(c.accountConfig).list();},
  async accountProfile(authorization,input){
   await authorize(authorization);
   const fields={discover:['source'],connect:['source','confirm','create','mode']};
   if(!input||!fields[input.action]||Object.keys(input).some(k=>!['action','agent',...fields[input.action]].includes(k))||!['claude','codex'].includes(input.agent))throw Object.assign(Error('계정 요청을 확인하세요.'),{rejected:true,status:400});
   const profiles=accountProfiles(c.accountConfig);
   if(input.action==='discover'){
    const found=await discoverCliSource(input.agent,{source:input.source??''}),cfg=JSON.parse(await readFile(c.accountConfig,'utf8')),env=JSON.parse(await readFile(cfg.environment,'utf8'));
    return {...found,mode:found.origin==='default'?'default':'explicit',exists:!!found.source&&await stat(found.source).then(s=>s.isDirectory()).catch(()=>false),binary:cfg.binaries?.[input.agent]??null,current:(await profiles.list())[input.agent]?.accounts[0]?.path??null};
   }
   if(typeof input.source!=='string'||!input.source.trim()||input.confirm!==true||input.create!==undefined&&typeof input.create!=='boolean'||input.mode!==undefined&&!['default','explicit'].includes(input.mode))throw Object.assign(Error('기존 CLI 설정 공유를 확인하세요.'),{rejected:true});
   const found=await discoverCliSource(input.agent,{source:input.source});
   return exclusive(async()=>{
    const cfg=JSON.parse(await readFile(c.accountConfig,'utf8'));
    try{const phase=JSON.parse(await readFile(join(cfg.directory,input.agent+'.login/state.json'),'utf8')).phase;if(phase!=='finished')throw Object.assign(Error('공식 로그인을 마친 뒤 CLI 연결을 변경하세요.'),{rejected:true});}catch(e){if(e.code!=='ENOENT')throw e;}
    if(await commandCards.pending(input.agent))throw Object.assign(Error('앞선 MCP 설정 변경 결과가 미확인입니다. CLI 연결을 변경하지 않았습니다.'),{rejected:true});
    if(cliPending(await officialCli.status(input.agent)))throw Object.assign(Error('공식 CLI 창을 exit로 종료한 뒤 CLI 연결을 변경하세요. 실행 결과가 미확인이면 터미널을 먼저 확인하세요.'),{rejected:true});
    const before=await state();
    if(!['unprepared','prepared','exited','running'].includes(before)||before==='running'&&!child)throw Object.assign(Error('실행기 상태를 확인한 뒤 전환하세요. CLI 연결을 변경하지 않았습니다.'),{rejected:true});
    if(await unresolvedTasks()||(before==='running'?await hasActive(c):await activeAuthorizedSessions(authorization)))throw Object.assign(Error('실행 중인 대화나 확인되지 않은 생성 요청이 있어 CLI 연결을 변경하지 않았습니다. 실행을 종료한 뒤 다시 시도하세요.'),{rejected:true});
    // Stop before rewriting the environment: if anything fails afterwards the Runner is not left on the old login.
    if(before==='running')await stopOwned();
    const result=await profiles.connect(input.agent,found.source,true,{create:input.create===true,mode:input.mode??'explicit'});
    // Prepare on the next chat request; linking does not start AI or require a running Hub machine.
    return result;
   });
  },
  // Branch pin: the allowed branches per repository of a registered local session's folder.
  async branches(authorization,id){
   const s=(await api.workspace(authorization)).find(x=>x.id===id);if(!s)throw Error('이 컴퓨터의 등록된 세션을 선택하세요.');
   const pin=(await projectRegistry(c.projectsPath).navigation()).sessions[id]?.branchPin??null,repos=await repoStates(s.project);
   return {pin,repos,mismatches:pinMismatches(pin,repos)};
  },
  async branchPin(authorization,input){
   if(!input||Object.keys(input).some(k=>!['id','action','repo','branch'].includes(k))||!['enable','disable','add','remove'].includes(input.action))throw Error('브랜치 고정 요청을 확인하세요.');
   const now=await api.branches(authorization,input.id),repos=now.repos;let pin=now.pin?structuredClone(now.pin):null;
   if(input.action==='enable'){if(!repos.some(r=>r.current))throw Error('세션 폴더와 바로 아래 폴더에서 브랜치에 있는 Git 저장소를 찾지 못했습니다.');pin=pinFrom(repos);}
   else if(input.action==='disable')pin=null;
   else{
    if(!pin)throw Error('먼저 브랜치 고정을 켜세요.');
    if(!validBranch(input.branch)||typeof input.repo!=='string')throw Error('브랜치를 확인하세요.');
    if(input.action==='add'){const r=repos.find(x=>x.repo===input.repo);if(!r?.branches.includes(input.branch))throw Error('저장소에 없는 브랜치입니다.');pin.repos[input.repo]=[...new Set([...(pin.repos[input.repo]??[]),input.branch])];}
    else pin.repos[input.repo]=(pin.repos[input.repo]??[]).filter(b=>b!==input.branch);
   }
   await projectRegistry(c.projectsPath).edit({kind:'session',id:input.id,action:'branch-pin',pin});
   return api.branches(authorization,input.id);
  },
  async navigation(authorization){
   const data=await authorize(authorization);if(!c.projectsPath)throw Error('목록 관리 미지원');
   const registry=projectRegistry(c.projectsPath),nav=await registry.navigation(),generalPath=await generalDirectory();
   const removed=nav.removed.map(r=>r.path===generalPath?{...r,name:'일반 대화'}:r);
   // Sessions inside a removed project/workspace are listed under it so they can be deleted without restoring it first.
   const settings=await readFile(join(c.directory,'runner-home/settings.json'),'utf8').then(JSON.parse).catch(()=>null);
   const parents=removed.filter(r=>r.kind!=='session');
   for(const s of Array.isArray(data.sessions)?data.sessions:[]){const parent=parents.find(r=>r.path===s.metadata?.path);
    if(parent&&settings?.machineId&&s.metadata?.machineId===settings.machineId)removed.splice(removed.indexOf(parent)+1,0,{kind:'session',id:s.id,name:nav.sessions[s.id]?.name??sessionTitle({id:s.id},s),parent:parent.name});}
   return {...nav,removed};
  },
  async manage(authorization,input){
   await authorize(authorization);
   return exclusive(async()=>{
    if(!c.projectsPath)throw Error('목록 관리 미지원');
    const registry=projectRegistry(c.projectsPath),rows=await registry.list({includeRemoved:true});
    const cfg=JSON.parse(await readFile(c.accountConfig,'utf8'));
    const legacyPath=typeof cfg.cwd==='string'&&!cfg.cwd.endsWith('/local-setup/working-directory')?cfg.cwd:undefined;
    if(legacyPath&&!rows.some(r=>r.path===legacyPath))rows.push({projectId:legacyProjectId(legacyPath),path:legacyPath});
    const data=await authorize(authorization);if(!Array.isArray(data.sessions))throw Error('세션 상태를 확인하지 못했습니다.');
    let affected;
    let insideRemoved=false;
    if(input?.kind==='session'){
     const allowed=await api.workspace(authorization);
     if(!allowed.some(s=>s.id===input.id)){
      // Deleting is also allowed for a session listed under a removed project on this machine.
      insideRemoved=input.action==='delete'&&(await api.navigation(authorization)).removed.some(r=>r.kind==='session'&&r.id===input.id);
      if(!insideRemoved)throw Error('이 컴퓨터의 등록된 세션을 선택하세요.');}
     affected=data.sessions.filter(s=>s.id===input.id);
    }else{
     const targets=rows.filter(r=>input?.kind==='project'?r.projectId===input.id:input?.kind==='workspace'&&r.workspaceId===input.id);
     if(!targets.length)throw Error('등록된 항목을 선택하세요.');
     affected=data.sessions.filter(s=>targets.some(r=>r.path===s.metadata?.path));
    }
    if(input.action==='remove'){
     if(affected.some(s=>s.active||s.thinking||Object.keys(s.agentState?.requests??{}).length))throw Error('실행 중인 세션을 먼저 종료하세요. 대화 기록은 유지됩니다.');
     if(await unresolvedTasks())throw Error('미확인 세션 생성 결과를 먼저 확인하세요.');
     let records=[];try{records=await readdir(slot+'.workspace-plans');}catch(e){if(e.code!=='ENOENT')throw e;}
     for(const name of records.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)))if(JSON.parse(await readFile(join(slot+'.workspace-plans',name),'utf8')).state!=='ready')throw Error('미확인 작업공간 준비 결과를 먼저 확인하세요.');
    }
    if(input.action==='delete'){
     // App record only: the Hub session and its messages. The CLI's own transcript file is untouched.
     if(input.kind!=='session')throw Error('세션만 영구 삭제할 수 있습니다.');
     if(!insideRemoved&&!(await registry.navigation()).sessions[input.id]?.removed)throw Error('목록에서 제거한 세션만 기록을 삭제할 수 있습니다.');
     if(affected.some(s=>s.active||s.thinking||Object.keys(s.agentState?.requests??{}).length))throw Error('실행 중인 세션은 삭제할 수 없습니다.');
     const r=await fetch(c.hubUrl+'/api/sessions/'+encodeURIComponent(input.id),{method:'DELETE',headers:{authorization},redirect:'error',signal:AbortSignal.timeout(15000)});
     if(!r.ok)throw Error('삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 결과부터 확인하세요.');
    }
    await registry.edit(input,{legacyPath});return {ok:true};
   });
  },
  async workspaceChoices(authorization,key){const p=await selectedProject(authorization,key);return p.path===await generalDirectory()?{kind:'folder',path:p.path,branches:[],worktrees:[]}:workspaceChoices(p.path);},
  async ready(authorization,project,agent){await authorize(authorization);return exclusive(()=>ensureReady(authorization,project,agent));},
  async reconcileResume(id,authorization){
   await authorize(authorization);
   if(resumePending?.id!==id)return true;
   if(busy)return false;
   return exclusive(async()=>{
    const pending=resumePending;if(!pending||pending.id!==id)return true;
    // Only this owner's failed resume is recoverable here. A restart, failed
    // stop, or online machine alone never grants process ownership/readiness.
    if(phase!=='unknown'||child!==pending.child||c.directory!==pending.directory)return false;
    // A resume that never became active is released only after a settle window, and never replayed.
    const settled=now()-pending.failedAt>=15000,release=async next=>{if(next==='exited')await writeFile(join(c.directory,'runner-stopped.json'),'{}',{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});await rm(join(c.directory,'session-operation.json'),{force:true});resumePending=null;phase=next;return true;};
    if(!child?.running)return settled?release('exited'):false;
    try{
     if(await machineId(c)!==pending.machineId||!await connection(c))return false;
     const r=await fetch(c.hubUrl+'/api/sessions/'+encodeURIComponent(id),{headers:{authorization},redirect:'error',signal:AbortSignal.timeout(5000)});
     if(!r.ok)return false;const s=(await r.json()).session,m=s?.metadata;
     if(s?.id===id&&s.active===false&&m?.machineId===pending.machineId)return settled?release('running'):false;
     if(!pending.nativeId)return false;
     if(s?.id!==id||s.active!==true||m?.machineId!==pending.machineId||m?.path!==pending.path||m?.flavor!==pending.flavor||m?.[pending.nativeKey]!==pending.nativeId||!child.running)return false;
     await rm(join(c.directory,'session-operation.json'));
     resumePending=null;phase='running';return true;
    }catch{return false;}
   });
  },
  async runSessionMutation(fn,{resume}={}){
   return exclusive(async()=>{if(await state()!=='running')throw Object.assign(Error('Runner not available'),{status:409});
    let pending=null;
    if(resume){
     const m=resume.metadata;
     if(!/^[a-f0-9-]{36}$/.test(resume.id??'')||resume.active!==false||!['codex','claude'].includes(m?.flavor)||m.machineId!==await machineId(c))throw Error('Resume identity unavailable');
     const nativeKey=m.flavor==='codex'?'codexSessionId':'claudeSessionId';
     // Resume only a native record in the connected CLI. Removed legacy profiles cannot silently create a fresh conversation.
     const owner=await accountProfiles(c.accountConfig).owner(m.flavor,m[nativeKey]??m.agentSessionId,m.path).catch(()=>null);
     if(!owner&&(JSON.parse(await readFile(c.accountConfig,'utf8'))).cliConnectionRequired)throw Object.assign(Error('현재 연결한 CLI에서 이 대화의 원본 기록을 찾지 못했습니다. 기존 대화 찾기로 다시 연결하세요.'),{rejected:true,status:409});
     pending={id:resume.id,machineId:m.machineId,path:m.path,flavor:m.flavor,nativeKey,nativeId:typeof m[nativeKey]==='string'?m[nativeKey]:null,child,directory:c.directory};
    }
    const marker=join(c.directory,'session-operation.json');let recorded=false;
    try{
     await writeFile(marker,JSON.stringify({version:1,kind:resume?'resume':'session'}),{flag:'wx',mode:0o600,flush:true});recorded=true;
     const result=await fn();await rm(marker);return result;
    }catch{resumePending=recorded&&pending?{...pending,failedAt:now()}:null;phase='unknown';throw Error('Session mutation unconfirmed');}
   });
  },
  async target(auth){await current();return createRunnerWorkspace(c).target(auth);},
  // This Mac's Runner identity from its own files; valid while the Runner is stopped.
  async localMachine(){await current();const id=await machineId(c);if(typeof id!=='string'||!id)throw Error('No local machine');return id;},
  async task(raw,authorization,check=false){
   if(!raw?.workspace&&!raw?.handoffFrom)return exclusive(()=>createRunnerWorkspace(c).task(raw,authorization,check));
   await authorize(authorization);const input=workspaceRequest(raw);
   return exclusive(async()=>{
    const project=await selectedProject(authorization,input.project);
    if(project.path===await generalDirectory()&&input.workspace.mode!=='current')throw Object.assign(Error('일반 대화에서는 브랜치·워크트리를 만들지 않습니다.'),{rejected:true,status:400});
    if(input.workspace.mode!=='current'&&!project.id)throw Object.assign(Error('먼저 이 폴더를 프로젝트로 등록하세요.'),{rejected:true,status:400});
    let prepared;
    if(input.workspace.mode!=='current'){
     let legacy;try{legacy=JSON.parse(await readFile(join(c.taskDirectory,input.requestId+'.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
     if(legacy){try{await readFile(join(slot+'.workspace-plans',input.requestId+'.json'));}catch{throw Object.assign(Error('기존 세션 요청의 작업 방식을 바꿀 수 없습니다.'),{rejected:true});}}
    }
    if(!plans)prepared={project:input.project,path:project.path};
    else prepared=await plans.prepare(input,project,async()=>{
     const active=['unprepared','prepared'].includes(await state())?await activeAuthorizedSessions(authorization):await hasActive(c);
     if(await unresolvedTasks()||active)throw Object.assign(Error('기존 실행 세션이나 미확인 생성 요청이 있어 작업 공간을 변경하지 않았습니다. 실행을 마친 뒤 다시 시도하세요.'),{rejected:true});
    },{check});
    if(!prepared)return {state:'none'};
    if(!check){
     try{await ensureReady(authorization,prepared.project,input.agent);
      for(let attempt=0;attempt<15;attempt++){
       // A spawned Runner may not have written its identity or registered RPC yet.
       // Retry only the readiness read; never replay launch or session creation.
       let connected=false;try{connected=await connection(c);}catch{}
       if(connected)break;if(attempt===14)throw Error('Runner connection unavailable');
       await new Promise(r=>setTimeout(r,300));
      }
     }catch(error){throw Object.assign(Error('작업 폴더 선택은 보존했습니다. 실행기 준비 상태를 확인한 뒤 같은 요청의 결과를 확인하세요.'),{rejected:false,reason:'RUNNER_SETUP'});}
    }
    if(!check&&prepared.branch&&(await workspaceChoices(prepared.path)).branch!==prepared.branch)throw Error('선택 후 브랜치가 바뀌었습니다. 세션을 만들지 않았습니다.');
    // A handoff target records its source so the new session can link back; the source must be this project's other-AI session.
    if(input.handoffFrom){const source=(await api.workspace(authorization)).find(s=>s.id===input.handoffFrom);if(!source||source.project!==prepared.path||source.agent===input.agent)throw Object.assign(Error('인계 출처 세션을 확인하지 못해 만들지 않았습니다.'),{rejected:true,status:400});}
    const effective={requestId:input.requestId,agent:input.agent,project:prepared.project};
    const result=await createRunnerWorkspace(c).task(effective,authorization,check);
    if(input.handoffFrom&&result.state==='created'&&/^[a-f0-9-]{36}$/.test(result.session?.id??'')){const links=await handoffLinks();if(links[result.session.id]!==input.handoffFrom){links[result.session.id]=input.handoffFrom;const temp=slot+'.handoffs.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(links),{mode:0o600,flag:'wx'});await rename(temp,slot+'.handoffs.json');}}
    return result.state==='none'?{state:'prepared'}:result;
   });
  },
  async workspace(authorization){
   await current();
   if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw Error('Authentication required');
   if(c.projectsPath&&['unprepared','prepared'].includes(await state())){await authorize(authorization);return [];}
   const allowed=c.projectsPath?await projects(authorization):null;
   const views=c.projectsPath?(await projectRegistry(c.projectsPath).navigation()).sessions:{};
   const plan=JSON.parse(await readFile(join(c.directory,'prepared.json'),'utf8'));
   const settings=JSON.parse(await readFile(join(c.directory,'runner-home/settings.json'),'utf8'));
   if(typeof settings.machineId!=='string'||!settings.machineId||typeof plan.cwd!=='string')throw Error('Runner identity unavailable');
   const r=await fetch(c.hubUrl+'/api/sessions',{headers:{authorization},redirect:'error',signal:AbortSignal.timeout(5000)});
   if(!r.ok)throw Object.assign(Error('Workspace unavailable'),{status:r.status});
   const data=await r.json();if(!Array.isArray(data.sessions))throw Error('Workspace unavailable');
   const links=await handoffLinks().catch(()=>({}));
   return data.sessions.filter(s=>/^[a-f0-9-]{36}$/.test(s.id)&&s.metadata?.machineId===settings.machineId&&(allowed?allowed.some(p=>p.path===s.metadata?.path):s.metadata?.path===plan.cwd))
    .map(s=>({id:s.id,...(typeof links[s.id]==='string'&&data.sessions.some(x=>x.id===links[s.id])?{parentId:links[s.id]}:{}),...(views[s.id]?.name?{displayName:views[s.id].name}:{}),...(views[s.id]?.removed?{hidden:true}:{}),...(views[s.id]?.branchPin?{branchPin:views[s.id].branchPin}:{}),agent:s.metadata?.flavor,updatedAt:s.updatedAt,createdAt:s.createdAt,label:sessionTitle({id:s.id},s),project:s.metadata.path,projectLabel:allowed?.find(p=>p.path===s.metadata.path)?.projectLabel??allowed?.find(p=>p.path===s.metadata.path)?.label,workspaceId:allowed?.find(p=>p.path===s.metadata.path)?.workspaceId,workspaceLabel:allowed?.find(p=>p.path===s.metadata.path)?.workspaceLabel,...(()=>{const p=allowed?.find(p=>p.path===s.metadata.path),parent=allowed?.find(x=>x.key===p?.parentKey);return p?.worktree&&parent?{worktree:{name:p.label,basePath:parent.path,worktreePath:p.path}}:{};})()}));
  },
  prepare:()=>action('unprepared','preparing',async()=>{await prepare(c.accountConfig,c.directory);phase='prepared';}),
  start:()=>action('prepared','starting',async()=>{if((await snapshot()).configuration!=='matched')throw Error('Prepared configuration changed');await launchCurrent();}),
  stop:()=>exclusive(stopOwned),
  reprepare:()=>exclusive(prepareNext),
  async close(){if(commandCards.running?.())throw Error('CLI 명령·인증이 진행 중입니다. 결과 확인 후 종료하세요.');if(child?.running)await api.stop();}
 };
 return api;
}
