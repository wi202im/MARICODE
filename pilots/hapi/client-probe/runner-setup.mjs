import {workspaceChoices,workspaceRequest,createWorkspacePlans} from './workspace-plans.mjs';
import {projectRegistry,legacyProjectId} from './project-registry.mjs';
import {randomUUID} from 'node:crypto';
import {createRunnerWorkspace} from './runner-workspace.mjs';
import {readFile,readdir,stat,mkdir,rm,writeFile,rename} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {prepareRunner,accountRevision} from './machine-setup.mjs';
import {launchRunner} from './runner-launch.mjs';
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
export function createRunnerSetup(config,{prepare=prepareRunner,launch=launchRunner,connection=runnerConnected,hasActive=runnerHasActive}={}){
 const url=new URL(config.hubUrl);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Local Hub required');
 if(['directory','accountConfig','binary','tokenFile'].some(k=>typeof config[k]!=='string'||!isAbsolute(config[k])))throw Error('Absolute launcher paths required');
 const c={...config,hubUrl:url.origin,taskDirectory:join(config.directory,'tasks')},slot=config.directory;let busy=false,phase=null,child=null,resumePending=null;
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
  await authorize(authorization);
  if(!c.projectsPath){const t=await createRunnerWorkspace(c).target(authorization);return [{key:'',label:t.project,path:t.project}];}
  const registry=projectRegistry(c.projectsPath);const registered=await registry.list();const availability=new Map();for(const p of registered){try{await registry.get(p.id);availability.set(p.id,true);}catch{availability.set(p.id,false);}}
  const rows=registered.map(p=>({key:p.id,label:p.name,path:p.path,available:availability.get(p.id),projectId:p.projectId,projectLabel:p.projectLabel,workspaceId:p.workspaceId,workspaceLabel:p.workspaceLabel,...(p.parentId?{parentKey:p.parentId,worktree:p.worktree===true}:{})}));
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
 const plans=c.projectsPath?createWorkspacePlans({directory:slot+'.workspace-plans',worktreeDirectory:slot+'.worktrees',registry:projectRegistry(c.projectsPath)}):null;
 const api={status,projects,
  async navigation(authorization){await authorize(authorization);if(!c.projectsPath)throw Error('목록 관리 미지원');return projectRegistry(c.projectsPath).navigation();},
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
    if(input?.kind==='session'){
     const allowed=await api.workspace(authorization);if(!allowed.some(s=>s.id===input.id))throw Error('이 컴퓨터의 등록된 세션을 선택하세요.');
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
    await registry.edit(input,{legacyPath});return {ok:true};
   });
  },
  async workspaceChoices(authorization,key){const p=await selectedProject(authorization,key);return workspaceChoices(p.path);},
  async ready(authorization,project,agent){await authorize(authorization);return exclusive(()=>ensureReady(authorization,project,agent));},
  async reconcileResume(id,authorization){
   await authorize(authorization);
   if(resumePending?.id!==id)return true;
   if(busy)return false;
   return exclusive(async()=>{
    const pending=resumePending;if(!pending||pending.id!==id)return true;
    // Only this owner's failed resume is recoverable here. A restart, failed
    // stop, or online machine alone never grants process ownership/readiness.
    if(phase!=='unknown'||child!==pending.child||!child?.running||c.directory!==pending.directory||!pending.nativeId)return false;
    try{
     if(await machineId(c)!==pending.machineId||!await connection(c))return false;
     const r=await fetch(c.hubUrl+'/api/sessions/'+encodeURIComponent(id),{headers:{authorization},redirect:'error',signal:AbortSignal.timeout(5000)});
     if(!r.ok)return false;const s=(await r.json()).session,m=s?.metadata;
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
     pending={id:resume.id,machineId:m.machineId,path:m.path,flavor:m.flavor,nativeKey,nativeId:typeof m[nativeKey]==='string'?m[nativeKey]:null,child,directory:c.directory};
    }
    const marker=join(c.directory,'session-operation.json');let recorded=false;
    try{
     await writeFile(marker,JSON.stringify({version:1,kind:resume?'resume':'session'}),{flag:'wx',mode:0o600,flush:true});recorded=true;
     const result=await fn();await rm(marker);return result;
    }catch{resumePending=recorded?pending:null;phase='unknown';throw Error('Session mutation unconfirmed');}
   });
  },
  async target(auth){await current();return createRunnerWorkspace(c).target(auth);},
  async task(raw,authorization,check=false){
   if(!raw?.workspace)return exclusive(()=>createRunnerWorkspace(c).task(raw,authorization,check));
   await authorize(authorization);const input=workspaceRequest(raw);
   return exclusive(async()=>{
    const project=await selectedProject(authorization,input.project);
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
    const effective={requestId:input.requestId,agent:input.agent,project:prepared.project};
    const result=await createRunnerWorkspace(c).task(effective,authorization,check);
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
   return data.sessions.filter(s=>/^[a-f0-9-]{36}$/.test(s.id)&&s.metadata?.machineId===settings.machineId&&(allowed?allowed.some(p=>p.path===s.metadata?.path):s.metadata?.path===plan.cwd))
    .map(s=>({id:s.id,...(views[s.id]?.name?{displayName:views[s.id].name}:{}),...(views[s.id]?.removed?{hidden:true}:{}),label:s.metadata?.flavor==='claude'?'Claude 작업':'Codex 작업',project:s.metadata.path,projectLabel:allowed?.find(p=>p.path===s.metadata.path)?.projectLabel??allowed?.find(p=>p.path===s.metadata.path)?.label,workspaceId:allowed?.find(p=>p.path===s.metadata.path)?.workspaceId,workspaceLabel:allowed?.find(p=>p.path===s.metadata.path)?.workspaceLabel,...(()=>{const p=allowed?.find(p=>p.path===s.metadata.path),parent=allowed?.find(x=>x.key===p?.parentKey);return p?.worktree&&parent?{worktree:{name:p.label,basePath:parent.path,worktreePath:p.path}}:{};})()}));
  },
  prepare:()=>action('unprepared','preparing',async()=>{await prepare(c.accountConfig,c.directory);phase='prepared';}),
  start:()=>action('prepared','starting',async()=>{if((await snapshot()).configuration!=='matched')throw Error('Prepared configuration changed');await launchCurrent();}),
  stop:()=>exclusive(stopOwned),
  reprepare:()=>exclusive(prepareNext),
  async close(){if(child?.running)await api.stop();}
 };
 return api;
}
