import {createPermissionBox} from './permissions.mjs';
import {createSessionStream} from './live.mjs';
import {createOutbox} from './outbox.mjs';
import {messageView,confirmedDraft,relativePath} from '../core.mjs';
import {serverAddress} from './registry.mjs';
function permissionViews(session){
 const requests=session?.agentState?.requests;
 if(!requests||typeof requests!=='object'||Array.isArray(requests))return [];
 return Object.entries(requests).filter(([,r])=>r&&typeof r.tool==='string').map(([id,r])=>({id,tool:r.tool,details:JSON.stringify(r.arguments??null,null,2)}));
}
export function createServerConnection(address,{fetcher=fetch,onChange=()=>{},storage}={}){
 const origin=serverAddress(address);let token='',status='signed-out',sessions=0,generation=0,busy=false,controller,catalog=[],selectedId='',session=null,messages=[],historyStatus='idle',hasOlder=false,sendStatus='idle';const emptyFiles=()=>({status:'idle',directory:'',path:'',content:'',entries:[]});let fileRead=false,files=emptyFiles();const drafts=new Map();let live=null,liveWanted=false,liveStatus='off',permissionStatus='idle';
 const permissionBox=(id,post)=>createPermissionBox(origin,id,storage,post);
 const permissionPending=()=>{if(!selectedId)return false;try{return !!permissionBox(selectedId).pending;}catch{return true;}};
 const permissionBlocked=id=>{try{return permissionBox(selectedId).blocked(id);}catch{return true;}};
 const reconcilePermissions=snapshot=>{try{permissionBox(snapshot.id).reconcile(snapshot.agentState?.requests);}catch{permissionStatus='storage-blocked';}};
 const outbox=(id,post)=>createOutbox(origin,id,storage,post);
 const pending=()=>{if(!selectedId)return false;try{return !!outbox(selectedId).pending;}catch{return true;}};
 const workspaceBlocked=()=>{if(busy||status!=='connected'||!selectedId)return true;try{return catalog.some(s=>outbox(s.id).pending||permissionBox(s.id).pending);}catch{return true;}};
 const state=()=>({origin,status,sessions,busy,workspaceBlocked:workspaceBlocked(),permissionStatus,permissionPending:permissionPending(),permissions:status==='connected'?(session?.permissions??[]).map(p=>({...p,blocked:permissionBlocked(p.id)})):[],fileRead,files:{...files,entries:files.entries.map(e=>({...e}))},liveStatus,pending:pending(),draft:drafts.get(selectedId)??'',sendStatus,messages:messages.map(m=>({...m})),historyStatus,hasOlder,catalog:catalog.map(s=>({...s})),selectedId,session:session?{...session}:null});const emit=()=>onChange(state());
 async function request(path,body,signal=controller.signal){const r=await fetcher(origin+path,{method:body?'POST':'GET',credentials:'omit',redirect:'error',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});if(!r.ok)throw Object.assign(Error('Connection failed'),{status:r.status});return r.json();}
 async function run(credential,selection){if(busy)return;if(credential!==undefined||(selection!==undefined&&selection!==selectedId))permissionStatus='idle';live?.stop();live=null;liveStatus='off';const authenticating=credential!==undefined;busy=true;files=emptyFiles();fileRead=false;sendStatus='idle';session=null;messages=[];historyStatus='idle';hasOlder=false;const mine=++generation;controller=new AbortController();status=credential!==undefined?'authenticating':'checking';emit();
 try{
  if(credential!==undefined){token='';catalog=[];selectedId='';sessions=0;const r=await request('/api/auth',{accessToken:credential});credential='';if(mine!==generation)return;if(typeof r.token!=='string'||!r.token)throw Error();token=r.token;}
  if(!token){status='signed-out';return;}
  const config=await request('/config');if(mine!==generation)return;fileRead=config.fileRead===true;
  if(!Array.isArray(config.sessions))throw Error();
  const seen=new Set();catalog=config.sessions.map(s=>{if(typeof s.id!=='string'||!/^[a-zA-Z0-9-]+$/.test(s.id)||seen.has(s.id))throw Error();seen.add(s.id);return {id:s.id,label:typeof s.label==='string'?s.label:s.id};});sessions=catalog.length;
  if(!catalog.length){status='no-session';selectedId='';return;}
  selectedId=catalog.some(s=>s.id===(selection??selectedId))?(selection??selectedId):catalog[0].id;
  const result=await request(`/api/sessions/${selectedId}`);if(mine!==generation)return;
  if(result.session?.id!==selectedId)throw Error();reconcilePermissions(result.session);session={permissions:permissionViews(result.session),id:selectedId,active:typeof result.session.active==='boolean'?result.session.active:null,thinking:typeof result.session.thinking==='boolean'?result.session.thinking:null};status='connected';
 }catch(e){if(mine!==generation)return;status=e.status===401?(authenticating?'rejected':'expired'):e.status===403?'denied':'unavailable';if(e.status===401){token='';catalog=[];selectedId='';sessions=0;}}
 finally{credential='';if(mine===generation){busy=false;emit();if(liveWanted&&status==='connected')startLive();}}
 }
 async function loadHistory(){
  if(busy||status!=='connected'||!session)return;
  busy=true;messages=[];hasOlder=false;historyStatus='loading';const mine=++generation,id=selectedId;controller=new AbortController();emit();
  try{const page=await request(`/api/sessions/${id}/messages?limit=50`);if(mine!==generation)return;if(!Array.isArray(page.messages))throw Error();if(storage){const box=outbox(id);const attempt=box.pending;box.reconcile(page.messages,false);if(attempt&&!box.pending){if(confirmedDraft(page.messages,attempt,(drafts.get(id)??'').trim()))drafts.delete(id);sendStatus='confirmed';}}messages=page.messages.slice(-50).map(messageView).filter(m=>m&&typeof m.text==='string');hasOlder=page.page?.hasMore===true;historyStatus='ready';}
  catch(e){if(mine!==generation)return;historyStatus='failed';if(e.status===401||e.status===403){status=e.status===401?'expired':'denied';session=null;files=emptyFiles();if(e.status===401){token='';catalog=[];selectedId='';sessions=0;}}}
  finally{if(mine===generation){busy=false;emit();}}
 }
 async function send(retrying=false){
  if(busy||status!=='connected'||session?.active!==true||(!retrying&&pending())||(retrying&&!pending()))return;
  const id=selectedId,text=(drafts.get(id)??'').trim();if(!text)return;
  busy=true;sendStatus=retrying?'receipt-check':'sending';const mine=++generation;controller=new AbortController();emit();
  try{const box=outbox(id,async(body,kind)=>{if(mine!==generation)throw Error();const result=await request(`/api/sessions/${id}/messages${kind==='state'?'/queued-state':''}`,body);if(result.ok===false||result.type==='error')throw Error();return result;});const result=await (retrying?box.retry(text):box.send(text));if(mine===generation){sendStatus=result?.reconciled?'confirmed':'checking';if(result?.reconciled&&drafts.get(id)?.trim()===text)drafts.delete(id);}}
  catch{if(mine===generation)sendStatus=retrying?'retry-blocked':'uncertain';}
  finally{if(mine===generation){busy=false;emit();}}
  if(mine===generation)await loadHistory();
 }
 async function decide(id,shown,action){
  if(busy||status!=='connected'||session?.active!==true||id!==selectedId||!['approve','deny'].includes(action)||permissionPending())return;
  const current=session.permissions.find(p=>p.id===shown?.id);
  if(!current||current.tool!==shown.tool||current.details!==shown.details||['AskUserQuestion','request_user_input'].includes(current.tool)||permissionBlocked(current.id))return;
  busy=true;permissionStatus='sending';let dispatched=false;const mine=++generation;controller=new AbortController();emit();
  try{
   const box=permissionBox(id,async(requestId,decision,body)=>{
    if(mine!==generation||selectedId!==id)throw Error('Connection changed');
    dispatched=true;const result=await request(`/api/sessions/${id}/permissions/${encodeURIComponent(requestId)}/${decision}`,body);
    if(result.ok===false||result.type==='error')throw Error('Decision not confirmed');return result;
   });
   await box.decide(current.id,{tool:current.tool,arguments:JSON.parse(current.details)},action);
   if(mine===generation)permissionStatus='checking';
  }catch{if(mine===generation)permissionStatus=dispatched?'uncertain':'not-sent';}
  // Refresh just the session; preserve the user's conversation, file and live subscription.
  if(mine===generation&&dispatched){
   try{const result=await request(`/api/sessions/${id}`);if(mine!==generation)return;
    if(result.session?.id!==id)throw Error('Invalid session');reconcilePermissions(result.session);
    session={permissions:permissionViews(result.session),id,active:typeof result.session.active==='boolean'?result.session.active:null,thinking:typeof result.session.thinking==='boolean'?result.session.thinking:null};
    if(!permissionPending())permissionStatus='no-longer-waiting';
   }catch(e){if(mine!==generation)return;permissionStatus='uncertain';if(e.status===401||e.status===403){stopLive();status=e.status===401?'expired':'denied';session=null;messages=[];files=emptyFiles();if(e.status===401){token='';catalog=[];selectedId='';sessions=0;drafts.clear();}}}
  }
  if(mine===generation){busy=false;emit();}
 }
 async function openPath(path,kind='directory'){
  if(busy||status!=='connected'||!session||!fileRead)return;
  try{path=relativePath(path);}catch{files={...emptyFiles(),status:'denied'};emit();return;}
  busy=true;files={...files,status:'loading',path:'',content:''};const mine=++generation,id=selectedId;controller=new AbortController();emit();
  try{let result;if(kind!=='file')result=await request(`/api/sessions/${id}/directory?path=${encodeURIComponent(path)}`);if(mine!==generation)return;
   if(result?.success){if(!Array.isArray(result.entries))throw Error();const entries=result.entries.map(e=>{if(typeof e.name!=='string'||!e.name||e.name==='.'||e.name==='..'||/[\\/\0]/.test(e.name))throw Error();return {name:e.name,type:['file','directory'].includes(e.type)?e.type:'link'};});files={status:'ready',directory:path,path:'',content:'',entries};}
   else{if(kind==='directory')throw Error();const file=await request(`/api/sessions/${id}/file?path=${encodeURIComponent(path)}`);if(mine!==generation)return;if(!file.success||typeof file.content!=='string'||file.content.length>1400000)throw Error();files={...files,status:'ready',path,content:new TextDecoder().decode(Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)))};}
  }catch(e){if(mine!==generation)return;files={...emptyFiles(),status:e.status===403?'denied':'failed'};if(e.status===401){stopLive();status='expired';token='';session=null;messages=[];catalog=[];selectedId='';sessions=0;drafts.clear();}}
  finally{if(mine===generation){busy=false;emit();}}
 }
 function stopLive(){liveWanted=false;live?.stop();live=null;liveStatus='off';emit();}
 function startLive(){
  if(live||status!=='connected'||!session)return;liveWanted=true;
  const id=selectedId,auth=token;
  live=createSessionStream({origin,id,token:auth,fetcher,onState:value=>{liveStatus=value;emit();},onFailure:code=>{liveWanted=false;live=null;status=code===401?'expired':'denied';session=null;messages=[];files=emptyFiles();if(code===401){token='';catalog=[];selectedId='';sessions=0;drafts.clear();}emit();},read:async signal=>{
   if(busy)return false;busy=true;const mine=generation;emit();
   try{const snapshot=await request(`/api/sessions/${id}`,undefined,signal);const page=await request(`/api/sessions/${id}/messages?limit=50`,undefined,signal);
    if(signal.aborted||mine!==generation||token!==auth||id!==selectedId)return true;
    if(snapshot.session?.id!==id||!Array.isArray(page.messages))throw Error('Invalid response');
    reconcilePermissions(snapshot.session);session={permissions:permissionViews(snapshot.session),id,active:typeof snapshot.session.active==='boolean'?snapshot.session.active:null,thinking:typeof snapshot.session.thinking==='boolean'?snapshot.session.thinking:null};
    if(storage){const box=outbox(id),attempt=box.pending;box.reconcile(page.messages,false);if(attempt&&!box.pending){if(confirmedDraft(page.messages,attempt,(drafts.get(id)??'').trim()))drafts.delete(id);sendStatus='confirmed';}}
    messages=page.messages.slice(-50).map(messageView).filter(m=>m&&typeof m.text==='string');hasOlder=page.page?.hasMore===true;historyStatus='ready';return true;
   }finally{if(mine===generation){busy=false;emit();}}
  }});live.start();
 }
 return {state,decide,openPath,loadHistory,send:()=>send(),retry:()=>send(true),startLive,stopLive,setDraft(text){if(!busy&&selectedId){drafts.set(selectedId,String(text));}},login:credential=>run(credential),refresh:()=>run(),selectSession:id=>catalog.some(s=>s.id===id)?run(undefined,id):Promise.resolve(),disconnect(){stopLive();generation++;controller?.abort();token='';permissionStatus='idle';fileRead=false;files=emptyFiles();drafts.clear();sendStatus='idle';busy=false;sessions=0;catalog=[];selectedId='';session=null;messages=[];hasOlder=false;historyStatus='idle';status='signed-out';emit();}};
}
