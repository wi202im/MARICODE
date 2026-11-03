import {readFile,writeFile,mkdir,rm,rename,realpath,stat} from 'node:fs/promises';
import {dirname,basename,isAbsolute} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
// Stable migration IDs: a read never writes the registry or changes an existing execution key.
function migratedWorkspaceId(id){const s=createHash('sha256').update('maricode-workspace:'+id).digest('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-5${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20,32)}`;}
export function legacyProjectId(path){return migratedWorkspaceId('legacy-project:'+path);}
export function projectRegistry(file){
 async function read(){
  let data;try{data=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {version:2,projects:[],workspaces:[]};throw e;}
  if(data.version===1&&Array.isArray(data.projects)){
   if(data.projects.some(p=>!uuid(p.id)||!isAbsolute(p.path??'')||typeof p.name!=='string'))throw Error('Invalid project registry');
   const old=data.projects;
   data={version:2,projects:old.filter(p=>!p.parentId).map(p=>({id:p.id,name:p.name,path:p.path})),workspaces:old.map(p=>({id:migratedWorkspaceId(p.id),executionKey:p.id,projectId:p.parentId??p.id,path:p.path,name:p.parentId?p.name:'기본 작업공간',kind:p.worktree?'worktree':'directory'}))};
  }
  if(data.version!==2||!Array.isArray(data.projects)||!Array.isArray(data.workspaces)||data.projects.some(p=>!uuid(p.id)||typeof p.name!=='string'||!isAbsolute(p.path??''))||data.workspaces.some(w=>!uuid(w.id)||!uuid(w.executionKey)||!data.projects.some(p=>p.id===w.projectId)||!isAbsolute(w.path??'')||typeof w.name!=='string'||!['directory','worktree'].includes(w.kind)))throw Error('Invalid project registry');
  for(const [rows,key] of [[data.projects,'id'],[data.workspaces,'id'],[data.workspaces,'executionKey'],[data.workspaces,'path']])if(new Set(rows.map(r=>r[key])).size!==rows.length)throw Error('Duplicate registry identity');
  if(data.projects.some(p=>!data.workspaces.some(w=>w.projectId===p.id&&w.executionKey===p.id&&w.path===p.path)))throw Error('Default workspace missing');
  if(data.sessionViews!==undefined&&(!data.sessionViews||Array.isArray(data.sessionViews)||typeof data.sessionViews!=='object'||Object.entries(data.sessionViews).some(([id,v])=>!uuid(id)||!v||typeof v!=='object'||v.name!==undefined&&typeof v.name!=='string'||v.removed!==undefined&&typeof v.removed!=='boolean')))throw Error('Invalid session display settings');
  return data;
 }
 function flatten(data,includeRemoved=false){return data.workspaces.filter(w=>includeRemoved||!w.removed&&!data.projects.find(p=>p.id===w.projectId).removed).map(w=>{const p=data.projects.find(p=>p.id===w.projectId);return {id:w.executionKey,name:w.executionKey===p.id?p.name:w.name,path:w.path,projectId:p.id,projectLabel:p.name,workspaceId:w.id,workspaceLabel:w.name,kind:w.kind,...(w.executionKey!==p.id?{parentId:p.id,worktree:w.kind==='worktree'}:{})};});}
 async function list({includeRemoved=false}={}){return flatten(await read(),includeRemoved);}
 async function navigation(){const data=await read();return {sessions:data.sessionViews??{},removed:[...data.projects.filter(p=>p.removed).map(p=>({kind:'project',id:p.id,name:p.name,path:p.path})),...data.workspaces.filter(w=>w.removed&&!data.projects.find(p=>p.id===w.projectId).removed).map(w=>({kind:'workspace',id:w.id,name:w.name,path:w.path}))]};}
 async function edit(input,{legacyPath}={}){
  if(!input||Object.keys(input).some(k=>!['kind','id','action','name'].includes(k))||!['project','workspace','session'].includes(input.kind)||!uuid(input.id)||!['rename','remove','restore','delete'].includes(input.action)||input.action==='delete'&&input.kind!=='session')throw Error('목록 변경 대상을 확인하세요.');
  if(input.action==='rename'&&(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>120||/[\u0000-\u001f\u007f]/.test(input.name)))throw Error('이름은 줄바꿈 없이 1~120자로 입력하세요.');
  await mkdir(dirname(file),{recursive:true,mode:0o700});const lock=file+'.lock';await mkdir(lock,{mode:0o700});let temp;
  try{const data=await read();let row;
   if(input.kind==='session'){data.sessionViews??={};row=data.sessionViews[input.id]??={};}
   else{
    row=(input.kind==='project'?data.projects:data.workspaces).find(r=>r.id===input.id);
    // Only an explicit edit can adopt the configured legacy root. Never accept a client path.
    if(!row&&input.kind==='project'&&isAbsolute(legacyPath??'')&&input.id===legacyProjectId(legacyPath)&&!data.workspaces.some(w=>w.path===legacyPath)){
     row={id:input.id,name:basename(legacyPath),path:legacyPath};data.projects.push(row);
     data.workspaces.push({id:migratedWorkspaceId(row.id),executionKey:row.id,projectId:row.id,path:legacyPath,name:'기본 작업공간',kind:'directory'});
    }
    if(!row)throw Error('등록된 항목이 아닙니다.');
   }
   if(input.kind==='workspace'&&input.action==='remove'&&row.executionKey===row.projectId)throw Error('기본 작업공간은 프로젝트와 함께 등록 해제하세요.');
   if(input.action==='restore'&&input.kind!=='session'){
    const paths=input.kind==='project'?data.workspaces.filter(w=>w.projectId===row.id&&!w.removed).map(w=>w.path):[row.path];
    for(const path of paths)if(await realpath(path)!==path||!(await stat(path)).isDirectory())throw Error('원래 폴더를 확인할 수 없습니다.');
   }
   if(input.action==='delete')delete data.sessionViews[input.id];
   else if(input.action==='rename')row.name=input.name.trim();else row.removed=input.action==='remove';
   temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);temp=null;
  }finally{if(temp)await rm(temp,{force:true});await rm(lock,{recursive:true});}
 }

 return {list,navigation,edit,async get(id){const p=(await list()).find(p=>p.id===id);if(!p)throw Error('Project not registered');if(await realpath(p.path)!==p.path||!(await stat(p.path)).isDirectory())throw Error('Project folder changed');return p;},async add(path,options={}){
  if(typeof path!=='string'||!isAbsolute(path)||/[\u0000-\u001f]/.test(path))throw Error('Absolute folder required');
  const canonical=await realpath(path);if(!(await stat(canonical)).isDirectory())throw Error('Folder required');
  await mkdir(dirname(file),{recursive:true,mode:0o700});const lock=file+'.lock';await mkdir(lock,{mode:0o700});let temp;
  try{const data=await read(),rows=flatten(data,true),existing=rows.find(p=>p.path===canonical);
   const parent=options.parentId?data.projects.find(p=>p.id===options.parentId):null;
   if(options.parentId&&!parent)throw Error('Parent project not registered');
   if(existing){if(parent&&existing.projectId!==parent.id)throw Error('Folder already belongs to another project');
    const p=data.projects.find(p=>p.id===existing.projectId),w=data.workspaces.find(w=>w.id===existing.workspaceId);
    if(p.removed||w.removed){p.removed=false;w.removed=false;temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);temp=null;}
    return existing;}
   const project=parent??{id:randomUUID(),name:basename(canonical),path:canonical};
   if(!parent)data.projects.push(project);
   const id=randomUUID(),workspace={id,executionKey:parent?id:project.id,projectId:project.id,path:canonical,name:parent?(options.name??basename(canonical)):'기본 작업공간',kind:parent&&options.worktree===true?'worktree':'directory'};
   data.workspaces.push(workspace);temp=file+'.'+randomUUID()+'.tmp';
   await writeFile(temp,JSON.stringify(data)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);temp=null;return flatten(data).find(w=>w.workspaceId===id);
  }finally{if(temp)await rm(temp,{force:true});await rm(lock,{recursive:true});}
 }};
}
