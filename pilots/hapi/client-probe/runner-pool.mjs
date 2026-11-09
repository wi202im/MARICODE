import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createRunnerSetup,ownerAuthorization} from './runner-setup.mjs';
import {projectRegistry} from './project-registry.mjs';
// Several HAPI Runners on one Mac. The primary Runner keeps today's behaviour; a folder that would force a
// restart of a busy primary gets its own Runner (own HAPI_HOME, so its own machine id) instead of waiting.
// A session stays on the Runner that created it (HAPI resumes only on the same machine), so assignments are durable.
// An idle dedicated Runner (no app request for idleMs; its own stop refuses while sessions run) is stopped;
// the next send or resume starts it again with the same machine id.
export function createRunnerPool(config,{createUnit=cfg=>createRunnerSetup(cfg),sessionMachine,resolvePath,now=Date.now,idleMs=600000,sweepMs=60000}={}){
 const file=config.directory+'.assignments.json',units=new Map(),used=new Map();let saving=Promise.resolve(),sweeping=false;
 const use=u=>{if(u!==primary)used.set(u,now());return u;};
 const pathOf=resolvePath??(async key=>(await projectRegistry(config.projectsPath).get(key)).path);
 const machineOf=sessionMachine??(async id=>{
  const r=await fetch(config.hubUrl+'/api/sessions/'+encodeURIComponent(id),{headers:{authorization:await ownerAuthorization(config)},redirect:'error',signal:AbortSignal.timeout(5000)});
  return r.ok?(await r.json()).session?.metadata?.machineId??null:null;
 });
 async function load(){try{const a=JSON.parse(await readFile(file,'utf8'));return {rows:a.rows??{},requests:a.requests??{}};}catch(e){if(e.code==='ENOENT')return {rows:{},requests:{}};throw e;}}
 // Serialized read-modify-write; the file is replaced atomically.
 function update(fn){const next=saving.then(async()=>{const a=await load();if(await fn(a)===false)return a;const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(a)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file);return a;});saving=next.catch(()=>{});return next;}
 const primary=createUnit({...config,excludeKeys:async()=>Object.keys((await load()).rows)},'primary');
 function unit(id){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid Runner assignment');
  if(!units.has(id))units.set(id,createUnit({...config,directory:config.directory+'.project-'+id,shared:config.directory,
   // Roots are exactly the folders assigned to this Runner, including the one it is starting for.
   roots:async project=>{const a=await update(a=>{if(!project||a.rows[project])return false;a.rows[project]=id;});
    const paths=[];for(const [key,owner] of Object.entries(a.rows))if(owner===id)try{paths.push(await pathOf(key));}catch{/* A missing folder does not block the others. */}
    return paths;}},'dedicated'));
  return units.get(id);
 }
 async function all(){const a=await load();for(const id of new Set([...Object.values(a.rows),...Object.values(a.requests)]))unit(id);return [primary,...units.values()];}
 async function forRow(key,agent,{create=true}={}){
  const a=await load();if(key&&a.rows[key])return unit(a.rows[key]);
  if(!key||!create||await primary.placement(key,agent)!=='busy')return primary;
  const id=randomUUID();await update(a=>{a.rows[key]??=id;});return unit((await load()).rows[key]);
 }
 async function byMachine(id,{required=false}={}){if(id)for(const u of await all())if(await u.machine()===id)return u;if(required)throw Error('Session Runner unavailable');return primary;}
 async function bySession(id,options){return byMachine(id?await machineOf(id):null,options);}
 async function sweepIdle(){
  if(sweeping)return;sweeping=true;
  try{for(const u of (await all()).slice(1)){
   if((await u.status().catch(()=>null))?.phase!=='running'){used.delete(u);continue;}
   if(!used.has(u))used.set(u,now());
   if(now()-used.get(u)<idleMs)continue;
   // Refused (sessions running, unconfirmed requests) or failed: the next sweep tries again.
   try{await u.stop();used.delete(u);}catch{}
  }}finally{sweeping=false;}
 }
 const timer=sweepMs?setInterval(()=>sweepIdle().catch(()=>{}),sweepMs).unref():null;
 const scoped=scope=>typeof scope==='string'?forRow(scope,undefined,{create:false}):scope?.session?bySession(scope.session):primary;
 const pass=name=>(...args)=>primary[name](...args);
 return {
  projects:pass('projects'),generalChat:pass('generalChat'),workspaceChoices:pass('workspaceChoices'),accountProfiles:pass('accountProfiles'),
  prepare:pass('prepare'),start:pass('start'),stop:pass('stop'),reprepare:pass('reprepare'),sessionTerminalStatus:pass('sessionTerminalStatus'),
  async assignedElsewhere(){return Object.keys((await load()).rows);},
  async status(scope){return (await scoped(scope)).status();},
  async target(auth,scope){return (await scoped(scope)).target(auth);},
  async localMachine(scope){return (await scoped(scope)).localMachine();},
  // Existing sessions stay on their original machine even if newer work in the
  // same folder was assigned elsewhere. Never allocate a replacement on resume.
  async ready(auth,key,agent,scope){return use(scope?.session?await bySession(scope.session,{required:true}):await forRow(key,agent)).ready(auth,key,agent);},
  async task(raw,auth,check=false){
   const a=await load(),request=raw?.requestId;let u;
   if(request&&a.requests[request])u=unit(a.requests[request]);
   else if(check)u=await forRow(raw?.project,raw?.agent,{create:false});
   else if(['new','existing'].includes(raw?.workspace?.mode)&&!a.rows[raw.project]){
    // A new worktree needs a restart of the Runner that serves it; a busy primary hands the whole request over.
    if(await primary.placement(raw.project,raw.agent)==='busy'||await primary.placement('',raw.agent)==='busy'){const id=randomUUID();await update(a=>{a.requests[request]=id;});u=unit(id);}
    else u=primary;
   }else{u=await forRow(raw?.project,raw?.agent);if(u!==primary&&request)await update(a=>{a.requests[request]??=[...units].find(([,v])=>v===u)[0];});}
   return use(u).task(raw,auth,check);
  },
  async workspace(auth){const seen=new Set(),out=[];for(const u of await all())for(const s of await u.workspace(auth))if(!seen.has(s.id)){seen.add(s.id);out.push(s);}return out;},
  async navigation(auth){
   const base=await primary.navigation(auth),known=new Set(base.removed.map(r=>r.kind+':'+r.id));
   for(const u of units.values())for(const r of (await u.navigation(auth)).removed)if(r.kind==='session'&&!known.has('session:'+r.id)){known.add('session:'+r.id);const at=base.removed.findIndex(p=>p.kind!=='session'&&p.name===r.parent);base.removed.splice(at<0?base.removed.length:at+1,0,r);}
   return base;
  },
  async manage(auth,input){return (input?.kind==='session'?await bySession(input.id):primary).manage(auth,input);},
  async branches(auth,id){return (await bySession(id)).branches(auth,id);},
  async branchPin(auth,input){return (await bySession(input?.id)).branchPin(auth,input);},
  async branchRemote(auth,id){return (await bySession(id)).branchRemote(auth,id);},
  async branchPull(auth,input){return (await bySession(input?.id)).branchPull(auth,input);},
  async claudeImport(auth,input,action){return (action==='list'?primary:await forRow(input?.project,'claude',{create:action!=='check'})).claudeImport(auth,input,action);},
  async codexImport(auth,input,action){return (action==='list'?primary:await forRow(input?.project,'codex',{create:action!=='check'})).codexImport(auth,input,action);},
  async claudeImportHistory(auth,id,before){return (await bySession(id)).claudeImportHistory(auth,id,before);},
  async openSessionTerminal(auth,input){return use(await bySession(input?.id)).openSessionTerminal(auth,input);},
  async reconcileResume(id,auth){return use(await bySession(id)).reconcileResume(id,auth);},
  async runSessionMutation(fn,{resume,session}={}){return use(resume?await byMachine(resume.metadata?.machineId):session?await bySession(session):primary).runSessionMutation(fn,{resume});},
  sweepIdle,
  // A new CLI connection applies to every Runner: dedicated ones stop first (refused while their sessions run).
  async accountProfile(auth,input){
   if(input?.action==='connect')for(const u of (await all()).slice(1))if((await u.status()).phase==='running')await u.stop();
   return primary.accountProfile(auth,input);
  },
  async close(){clearInterval(timer);const errors=[];for(const u of await all())try{await u.close();}catch(e){errors.push(e);}if(errors.length)throw errors[0];}
 };
}
