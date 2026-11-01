import {createHandoffs} from './handoff.mjs';
// Reuse the durable creation ledger in a separate directory. Its internal
// parent key is a request UUID, never a real session relationship.
export function createTasks(config){
 const ledger=createHandoffs(config);
 function source(request){
  if(!request||Object.keys(request).some(k=>!['requestId','agent'].includes(k))||!['codex','claude'].includes(request.agent)||!/^[a-f0-9-]{36}$/.test(request.requestId??''))throw Error('Invalid task request');
  return {id:request.requestId,active:true,metadata:{machineId:config.machineId,path:config.project,flavor:request.agent==='codex'?'claude':'codex'}};
 }
 const present=r=>{const {parentId,...rest}=r;return {...rest,requestId:parentId,label:`${r.agent==='codex'?'Codex':'Claude'} 작업`};};
 async function checked(request){const s=source(request),r=await ledger.status(s);if(r.state!=='none'&&(r.agent!==request.agent||(r.project??config.legacyProject??config.project)!==config.project))throw Error('Request agent changed');return s;}
 return {
  list:async()=> (await ledger.list()).map(present),
  create:async(request,spawn,lookup)=>present(await ledger.create(await checked(request),spawn,lookup)),
  check:async(request,lookup)=>present(await ledger.check(await checked(request),lookup))
 };
}
