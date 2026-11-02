import {open,mkdir,readdir,lstat,readFile,writeFile,rename,rm,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const limit=64*1024*1024;
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=()=>{throw Error('기록 형식·폴더·크기를 확인할 수 없습니다. 원본은 변경하지 않았습니다.');};
async function folder(path,{create=false}={}){
 if(create)await mkdir(path,{recursive:true,mode:0o700});
 if(!(await lstat(path)).isDirectory())fail();return path;
}
async function bytes(path){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await fd.stat();if(!before.isFile()||before.size>limit)fail();
  const data=await fd.readFile();const after=await fd.stat();
  if(data.length>limit||before.size!==after.size||before.mtimeMs!==after.mtimeMs)fail();return {data,mtime:after.mtimeMs};
 }finally{await fd.close();}
}
async function absent(path){try{await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('같은 ID의 기록이 이미 있습니다. 기존 기록을 덮어쓰지 않습니다.');}
export function claudeSourcePath(source,home=homedir()){
 if(typeof source!=='string'||/[\x00-\x1f]/.test(source))fail();
 source=source.trim();if(source.startsWith('~/'))source=join(home,source.slice(2));
 if(!isAbsolute(source))throw Error('Claude 기록 폴더의 절대 경로 또는 ~/ 경로를 선택하세요.');
 return resolve(source);
}
const configRoot=claudeSourcePath;

// Compatibility boundary: Claude's project transcript layout and HAPI 0.33.3
// CLI session registration. No credentials, settings, hooks or MCP are copied.
export function claudeImports({directory,destination,project,machineId}){
 const encoded=resolve(project).replace(/[^a-zA-Z0-9]/g,'-');
 async function snapshot(source,id){
  if(!uuid.test(id??''))fail();source=configRoot(source);
  await folder(source);const projects=await folder(join(source,'projects')),base=await folder(join(projects,encoded));
  const main=await bytes(join(base,id+'.jsonl'));let count=0,title='',firstPrompt='';
  for(const line of main.data.toString('utf8').split('\n')){if(!line.trim())continue;let row;try{row=JSON.parse(line);}catch{fail();}
   if(row.isSidechain===true)fail();
   if(row.type==='custom-title'&&typeof row.customTitle==='string')title=row.customTitle.replace(/[\x00-\x1f]/g,' ').slice(0,120);
   if(['user','assistant'].includes(row.type)){
    if(row.sessionId!==id||typeof row.cwd!=='string'||resolve(row.cwd)!==resolve(project)||!uuid.test(row.uuid??''))fail();count++;
    if(!firstPrompt&&row.type==='user'&&typeof row.message?.content==='string')firstPrompt=row.message.content.replace(/[\x00-\x1f]/g,' ').slice(0,80);
   }
  }
  if(!count)fail();
  const files=[{name:id+'.jsonl',data:main.data}],sub=join(base,id);let size=main.data.length;
  try{await folder(sub);
   const agents=await folder(join(sub,'subagents'));
   const entries=await readdir(agents,{withFileTypes:true});if(entries.length>256)fail();
   for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(!/^agent-[a-zA-Z0-9_-]+\.jsonl$/.test(entry.name))continue;
    if(!entry.isFile())fail();const {data}=await bytes(join(agents,entry.name));size+=data.length;if(size>limit)fail();
    files.push({name:join(id,'subagents',entry.name),data});
   }
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const hash=createHash('sha256');for(const file of files)hash.update(file.name+'\0').update(file.data);
  return {id,title:title||firstPrompt||'Claude '+id.slice(0,8),modifiedAt:main.mtime,messageCount:count,fingerprint:hash.digest('hex'),files};
 }
 async function save(path,record){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(record),{flag:'wx',mode:0o600,flush:true});await rename(temp,path);}
 async function observe(record,path,lookup){
  const s=await lookup(record.hubId);
  if(!s)return {state:record.state,id:record.hubId};
  const m=s.metadata;if(s.id!==record.hubId||m?.machineId!==machineId||m?.path!==project||m?.flavor!=='claude'||m?.claudeSessionId!==record.nativeId)throw Error('가져온 세션의 대상이 일치하지 않습니다.');
  if(record.state!=='registered')await save(path,{...record,state:'registered'});
  return {state:'registered',id:record.hubId};
 }
 return {
  async history(hubId,before){
   if(!uuid.test(hubId??'')||(before!==undefined&&(!Number.isSafeInteger(before)||before<0)))fail();
   let entries;try{entries=await readdir(directory);}catch(e){if(e.code==='ENOENT')return {imported:false};throw e;}
   for(const name of entries.filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
    const record=JSON.parse(await readFile(join(directory,name),'utf8'));
    if(record.hubId!==hubId||record.project!==project||record.machineId!==machineId||record.state!=='registered')continue;
    const {data}=await bytes(join(directory,name+'.transcript'));const rows=[];
    for(const line of data.toString('utf8').split('\n')){if(!line.trim())continue;const r=JSON.parse(line);if(!['user','assistant'].includes(r.type))continue;
     const c=r.message?.content;const text=typeof c==='string'?c:Array.isArray(c)?c.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n'):'';
     rows.push({role:r.type,text:text.slice(0,12000)||'[도구·첨부 이벤트 — 텍스트 없음]',truncated:text.length>12000,timestamp:typeof r.timestamp==='string'?r.timestamp:null});
    }
    const end=Math.min(before??rows.length,rows.length),start=Math.max(0,end-50);
    return {imported:true,total:rows.length,messages:rows.slice(start,end),before:start,hasMore:start>0};
   }
   return {imported:false};
  },
  async list(source){
   source=configRoot(source);let entries;
   const searched={project,source,records:join(source,'projects',encoded)};
   for(const [path,status] of [[source,'profile-missing'],[join(source,'projects'),'store-missing'],[searched.records,'project-missing']]){
    try{await folder(path);}catch(e){if(e.code==='ENOENT')return {sessions:[],skipped:0,status,searched};throw e;}
   }
   entries=await readdir(searched.records,{withFileTypes:true});
   const candidates=entries.filter(e=>e.isFile()&&uuid.test(e.name.replace(/\.jsonl$/,''))&&e.name.endsWith('.jsonl'));
   if(candidates.length>500)throw Error('이 폴더의 기록이 500개를 넘습니다. 필요한 기록만 담은 별도 Claude 설정 폴더를 선택하세요.');
   const sessions=[];let skipped=0,scanned=0;
   for(const entry of candidates){
    if(scanned>128*1024*1024){skipped++;continue;}
    try{
     const size=(await lstat(join(source,'projects',encoded,entry.name))).size;scanned+=size;
     if(scanned>128*1024*1024){skipped++;continue;}
     const {files,...row}=await snapshot(source,entry.name.slice(0,-6));scanned+=files.slice(1).reduce((n,f)=>n+f.data.length,0);sessions.push(row);
    }catch{skipped++;}
   }
   return {sessions:sessions.sort((a,b)=>b.modifiedAt-a.modifiedAt),skipped,status:sessions.length?'found':skipped?'excluded':'empty',searched};
  },
  async import(input,{register,lookup},check=false){
   if(!input||!uuid.test(input.id??'')||!/^[a-f0-9]{64}$/.test(input.fingerprint??''))fail();
   const source=configRoot(input.source),key=digest(project+'\0'+input.id),path=join(directory,key+'.json');
   await mkdir(directory,{recursive:true,mode:0o700});const lock=path+'.lock';await mkdir(lock,{mode:0o700});let admitted=false;
   try{
    let existing;try{existing=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(existing){admitted=true;
     if(existing.source!==source||existing.fingerprint!==input.fingerprint||existing.project!==project||existing.machineId!==machineId)throw Error('이미 가져온 기록과 선택이 다릅니다. 기존 세션을 확인하세요.');
     // Never re-POST an uncertain registration, including after web restart.
     return await observe(existing,path,lookup);
    }
    if(check)return {state:'none'};
    const current=await snapshot(source,input.id);
    if(current.fingerprint!==input.fingerprint)throw Error('선택 후 원본 기록이 바뀌었습니다. 원본 Claude 작업을 마친 뒤 다시 찾으세요.');
    await folder(destination);if(await realpath(destination)===await realpath(source))throw Error('MARICODE 전용 프로필은 가져오기 원본으로 사용할 수 없습니다.');
    const destProjects=await folder(join(destination,'projects'),{create:true}),base=await folder(join(destProjects,encoded),{create:true});
    await absent(join(base,input.id+'.jsonl'));await absent(join(base,input.id));
    const record={state:'copying',hubId:randomUUID(),nativeId:input.id,source,fingerprint:input.fingerprint,project,machineId,
     metadata:{path:project,machineId,flavor:'claude',claudeSessionId:input.id,name:current.title+' · 가져옴',host:'이 컴퓨터'}};
    await writeFile(path,JSON.stringify(record),{flag:'wx',mode:0o600,flush:true});
    admitted=true;
    // Immutable display snapshot: later native writes must not duplicate the
    // live HAPI conversation or turn old tool events into actionable approvals.
    await writeFile(path+'.transcript',current.files[0].data,{flag:'wx',mode:0o600,flush:true});
    if(current.files.length>1){await mkdir(join(base,input.id),{mode:0o700});await mkdir(join(base,input.id,'subagents'),{mode:0o700});}
    for(const file of current.files)await writeFile(join(base,file.name),file.data,{flag:'wx',mode:0o600,flush:true});
    record.state='registering';await save(path,record);
    await register(record);
    return await observe(record,path,lookup);
   }catch(error){if(!admitted){error.rejected=true;error.userMessage='가져오기를 시작하지 않았습니다. 원본 기록 변경·같은 ID의 기존 기록·폴더 접근 권한을 확인한 뒤 다시 찾으세요.';}throw error;}
   finally{await rm(lock,{recursive:true});}
  }
 };
}
