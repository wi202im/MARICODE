import {projectRegistry} from './project-registry.mjs';
import {readFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createTasks} from './tasks.mjs';
export function createRunnerWorkspace({directory,hubUrl,taskDirectory=join(directory,'tasks'),projectsPath}){
 async function request(path,authorization,body){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw Object.assign(Error('Authentication required'),{status:401});
  const r=await fetch(hubUrl+path,{method:body?'POST':'GET',headers:{authorization,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(body?120000:15000)});
  if(!r.ok)throw Object.assign(Error('Runner request failed'),{status:r.status});return r.json();
 }
 async function target(authorization){
  const plan=JSON.parse(await readFile(join(directory,'prepared.json'),'utf8')),settings=JSON.parse(await readFile(join(directory,'runner-home/settings.json'),'utf8'));
  if(typeof settings.machineId!=='string'||!settings.machineId||!isAbsolute(plan.cwd)||!Array.isArray(plan.agents))throw Error('Runner target unavailable');
  const machines=await request('/api/machines',authorization);
  if(!machines.machines?.some(m=>m.id===settings.machineId))throw Object.assign(Error('Runner offline'),{status:409});
  return {machineId:settings.machineId,project:plan.cwd,agents:plan.agents};
 }
 return {target,
  async task(input,authorization,check=false){
   if(!input||Object.keys(input).some(k=>!['requestId','agent','project'].includes(k))||!['claude','codex'].includes(input.agent)||!/^[a-f0-9-]{36}$/.test(input.requestId??'')||(input.project!==undefined&&typeof input.project!=='string')||(!projectsPath&&input.project))throw Object.assign(Error('Invalid task request'),{status:400});
   let t;try{t=await target(authorization);if(input.project){t.project=(await projectRegistry(projectsPath).get(input.project)).path;}else if(projectsPath&&t.project.endsWith('/local-setup/working-directory'))throw Object.assign(Error('Select a project'),{status:400});if(!t.agents.includes(input.agent))throw Object.assign(Error('AI not prepared'),{status:409});
   if(!check){
    // Read-only preflight must finish before creating a pending spawn record.
    const availability=await request('/api/machines/'+encodeURIComponent(t.machineId)+'/agent-availability',authorization);
    if(!Array.isArray(availability.agents)||!availability.agents.some(a=>a.agent===input.agent&&a.available===true))throw Object.assign(Error('Runner agent not ready'),{status:409});
   }
   }catch(error){if(!check)error.rejected=true;throw error;}
   const ledger=createTasks({...t,directory:taskDirectory});
   const lookup=async id=>{const r=await request('/api/sessions/'+id,authorization);return r.session;};
   const req={requestId:input.requestId,agent:input.agent};
   const result=check?await ledger.check(req,lookup):await ledger.create(req,async agent=>{
    const r=await request('/api/machines/'+t.machineId+'/spawn',authorization,{directory:t.project,agent,startingMode:'remote',sessionType:'simple',yolo:false});
    if(r.type!=='success')throw Error('Spawn unconfirmed');return r.sessionId;
   },lookup);
   return {state:result.state,session:result.state==='created'?result:null};
  }
 };
}
