import {mkdir,open,readFile,readdir,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
const valid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
export function createHandoffs({directory,machineId,project}){
 const read=async file=>JSON.parse(await readFile(file,'utf8'));
 function validateSource(source){
  const m=source?.metadata;
  if(!valid(source?.id)||m?.machineId!==machineId||m?.path!==project||!['codex','claude'].includes(m?.flavor))throw Error('허용된 시험 세션이 아닙니다.');
 }
 async function write(record){
  const file=join(directory,record.parentId+'.json'),temp=file+'.'+randomUUID()+'.tmp';
  const handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
  await rename(temp,file);
 }
 const api={
 async list(){
  await mkdir(directory,{recursive:true,mode:0o700});
  const records=await Promise.all((await readdir(directory)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>read(join(directory,n))));
  return records.filter(r=>r.state==='created'&&valid(r.id)&&valid(r.parentId)&&['codex','claude'].includes(r.agent));
 },
 async status(source){
  validateSource(source);
  try{return await read(join(directory,source.id+'.json'));}catch(e){if(e.code==='ENOENT')return {state:'none'};throw e;}
 },
 async check(source,lookup){
  const record=await api.status(source);
  if(record.state!=='verifying')return record;
  if(!valid(record.id)||record.id===source.id)throw Error('기록된 생성 결과가 올바르지 않습니다.');
  const child=await lookup(record.id);
  if(child?.id!==record.id||child.metadata?.machineId!==machineId||child.metadata?.path!==project||child.metadata?.flavor!==record.agent)throw Error('생성 대상이 일치하지 않습니다.');
  const result={...record,state:'created',label:`${record.agent==='codex'?'Codex':'Claude'} 인계 세션`};
  await write(result);return result;
 },
 async create(source,spawn,lookup){
  const existing=await api.status(source);
  if(existing.state==='created')return existing;
  if(existing.state!=='none')throw Error('이 세션의 생성 결과를 확인해 주세요. 다시 생성하지 않습니다.');
  if(!source.active||source.thinking||Object.keys(source.agentState?.requests??{}).length)throw Error('현재 작업과 승인 요청이 끝난 뒤 생성해 주세요.');
  await mkdir(directory,{recursive:true,mode:0o700});
  const agent=source.metadata.flavor==='codex'?'claude':'codex',record={state:'pending',parentId:source.id,agent,project};
  const handle=await open(join(directory,source.id+'.json'),'wx',0o600);
  try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
  // Persist the exact returned ID before readback. Unknown outcomes never spawn again.
  const id=await spawn(agent);
  if(!valid(id)||id===source.id)throw Error('생성 결과 ID를 확인하지 못했습니다.');
  await write({...record,state:'verifying',id});
  return api.check(source,lookup);
 }
 };
 return api;
}
