import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,realpath,open} from 'node:fs/promises';import {join,resolve} from 'node:path';
const exec=promisify(execFile),key=path=>createHash('sha256').update(path).digest('hex');
const gitEnvironment={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
for(const name of Object.keys(gitEnvironment))if(name.startsWith('GIT_')&&!['GIT_TERMINAL_PROMPT','GIT_OPTIONAL_LOCKS'].includes(name))delete gitEnvironment[name];
const git=async(path,...args)=>(await exec('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',path,...args],{timeout:15000,maxBuffer:2*1024*1024,env:gitEnvironment})).stdout;
const reject=message=>Object.assign(Error(message),{status:409,rejected:true});
export async function workspaceChoices(path){
 let top;try{top=(await git(path,'rev-parse','--show-toplevel')).trim();}catch(e){if(e.code===128)return {kind:'folder',path,branches:[],worktrees:[]};throw reject('Git 정보를 읽지 못했습니다. 폴더 접근 상태를 확인하세요.');}
 // A registered parent folder or nested source directory is not permission to switch an outer repository.
 if(await realpath(top)!==await realpath(path))return {kind:'folder',path,branches:[],worktrees:[],note:'Git 저장소의 최상위 폴더를 등록하면 브랜치·워크트리를 선택할 수 있습니다.'};
 const branch=(await git(path,'branch','--show-current')).trim();let head=null;try{head=(await git(path,'rev-parse','--verify','HEAD')).trim();}catch{}
 const branches=(await git(path,'for-each-ref','--format=%(refname:short)','refs/heads')).trim().split('\n').filter(Boolean).sort();
 const worktrees=[];const raw=await git(path,'worktree','list','--porcelain','-z');
 for(const record of raw.split('\0\0')){const fields=record.split('\0'),first=fields.find(x=>x.startsWith('worktree '));if(!first||fields.some(x=>/^(bare|prunable|locked)( |$)/.test(x)))continue;
  const p=first.slice(9);try{if(await realpath(p)!==p)continue;}catch{continue;}
  const b=fields.find(x=>x.startsWith('branch refs/heads/'))?.slice(18)??'';worktrees.push({key:key(p),path:p,branch:b,label:b||'분리된 HEAD'});
 }
 return {kind:'git',path,branch,head,branches,worktrees};
}
export function workspaceRequest(input){
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['requestId','agent','project','workspace','handoffFrom'].includes(k))||!/^[a-f0-9-]{36}$/.test(input.requestId??'')||input.handoffFrom!==undefined&&!/^[a-f0-9-]{36}$/.test(input.handoffFrom)||!['codex','claude'].includes(input.agent)||typeof input.project!=='string')throw reject('새 작업의 프로젝트와 AI를 확인하세요.');
 const w=input.workspace??{mode:'current'};const fields={current:['mode'],branch:['mode','branch'],existing:['mode','key'],new:['mode','branch','name']}[w.mode];
 if(!fields||Object.keys(w).some(k=>!fields.includes(k))||fields.some(k=>typeof w[k]!=='string'||!w[k]||w[k].length>200||/[\u0000-\u001f]/.test(w[k])))throw reject('작업 공간 선택을 다시 확인하세요.');
 return {...input,workspace:Object.fromEntries(fields.map(k=>[k,w[k]]))};
}
export function createWorkspacePlans({directory,worktreeDirectory,registry}){
 async function durable(file,data){const h=await open(file,'wx',0o600);try{await h.writeFile(JSON.stringify(data));await h.sync();}finally{await h.close();}}
 async function save(file,data){const tmp=file+'.'+randomUUID()+'.tmp';await durable(tmp,data);await rename(tmp,file);}
 return {async prepare(raw,project,guard,{check=false}={}){
  const input=workspaceRequest(raw),signature=JSON.stringify({requestId:input.requestId,agent:input.agent,project:input.project,workspace:input.workspace});
  if(input.project!==project.id)throw reject('프로젝트가 바뀌었습니다. 다시 선택하세요.');
  const file=join(directory,input.requestId+'.json');let previous;
  try{previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(previous){if(previous.signature!==signature)throw reject('같은 요청의 작업 대상은 변경할 수 없습니다.');if(previous.state!=='ready')throw Error('작업 공간 준비 결과를 확인하지 못했습니다. 자동으로 반복하지 않습니다.');if(previous.result.project)await registry.get(previous.result.project);else if(previous.result.path!==project.path)throw Error('작업 경로가 바뀌었습니다.');return previous.result;}
  if(check)return null;
  const w=input.workspace;
  if(w.mode==='current'){const result={project:project.id,path:project.path};await mkdir(directory,{recursive:true,mode:0o700});await durable(file,{state:'ready',signature,result});return result;}
  const choices=await workspaceChoices(project.path);if(choices.kind!=='git')throw reject('Git 저장소의 최상위 폴더에서만 이 작업을 할 수 있습니다.');
  let selected;
  if(w.mode==='existing'){selected=choices.worktrees.find(x=>x.key===w.key);if(!selected)throw reject('선택한 워크트리가 없어졌습니다. 목록을 다시 확인하세요.');}
  else if(!choices.branches.includes(w.branch))throw reject('선택한 브랜치가 없어졌습니다. 목록을 다시 확인하세요.');
  if(w.mode==='branch'&&w.branch!==choices.branch){if((await git(project.path,'status','--porcelain')).trim())throw reject('미커밋 변경이 있어 브랜치를 바꾸지 않았습니다. 변경을 정리하거나 새 워크트리를 선택하세요.');if(choices.worktrees.some(x=>x.path!==project.path&&x.branch===w.branch))throw reject('그 브랜치는 다른 워크트리에서 사용 중입니다. 기존 워크트리로 열어 주세요.');}
  if(w.mode==='new'){try{await git(project.path,'check-ref-format','--branch',w.name);}catch{throw reject('새 브랜치 이름을 확인하세요.');}if(w.name.startsWith('-')||choices.branches.includes(w.name)||!choices.head)throw reject('이미 있는 브랜치이거나 기준 커밋이 없습니다. 기존 워크트리 또는 다른 이름을 선택하세요.');}
  // No active AI may lose its working directory/branch or Runner while preparing a new workspace.
  if(w.mode==='new'||w.mode==='branch'&&w.branch!==choices.branch||w.mode==='existing'&&!(await registry.list()).some(p=>p.path===selected.path))await guard();await mkdir(directory,{recursive:true,mode:0o700});const record={state:'pending',signature};await durable(file,record);
  let path=project.path,branch=choices.branch;
  if(w.mode==='branch'){if(w.branch!==choices.branch)await git(path,'switch','--no-guess',w.branch);branch=w.branch;}
  if(w.mode==='new'){await mkdir(worktreeDirectory,{recursive:true,mode:0o700});path=join(await realpath(worktreeDirectory),input.requestId);await git(project.path,'worktree','add','-b',w.name,'--',path,'refs/heads/'+w.branch);branch=w.name;}
  if(w.mode==='existing'){path=selected.path;branch=selected.branch;const common=async cwd=>realpath(resolve(cwd,(await git(cwd,'rev-parse','--git-common-dir')).trim()));if(await common(path)!==await common(project.path))throw Error('워크트리의 저장소가 바뀌었습니다.');}
  const registered=path===project.path?project:await registry.add(path,{parentId:project.parentId??project.id,name:branch||path.split('/').at(-1),worktree:true});
  const result={project:registered.id,path,branch};await save(file,{...record,state:'ready',result});return result;
 }};
}
