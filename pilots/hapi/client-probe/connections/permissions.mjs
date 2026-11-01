import {createPermissionActions} from '../workflow.mjs';
export function createPermissionBox(origin,sessionId,storage,post){
 const key=`mari-server-permissions:${origin}:${sessionId}`,raw=storage.getItem(key);
 let record=raw===null?{pending:null,attempted:[]}:JSON.parse(raw);
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_:-]+$/.test(id);
 if(!record||!Array.isArray(record.attempted)||record.attempted.length>500||!record.attempted.every(valid)||(record.pending!==null&&(!valid(record.pending)||!record.attempted.includes(record.pending))))throw Error('Invalid permission record');
 const actions=createPermissionActions({pending:record.pending,post,save:pending=>{
  const next={pending,attempted:pending?[...new Set([...record.attempted,pending])]:record.attempted};
  if(next.attempted.length>500)throw Error('Permission record full');
  storage.setItem(key,JSON.stringify(next));record=next;
 }});
 return {get pending(){return actions.pending;},blocked:id=>record.attempted.includes(id),reconcile:requests=>{
  // Missing/invalid state is not proof that the request disappeared.
  if(requests&&typeof requests==='object'&&!Array.isArray(requests))actions.reconcile(requests);
 },decide:(id,request,action)=>{
  if(!valid(id)||record.attempted.includes(id))throw Error('Decision already attempted');
  return actions.decide(id,request,action);
 }};
}
