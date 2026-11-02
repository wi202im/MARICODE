import {open,mkdir,readdir,lstat,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,relative,dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {claudeSourcePath as sourcePath} from './claude-import.mjs';
import {transcriptLimit as limit} from './claude-session-catalog.mjs';

// Compatibility boundary: Codex CLI rollout files (CODEX_HOME/sessions/**/rollout-*-<thread id>.jsonl).
// Only the selected rollout file is copied into Maricode's own CODEX_HOME; auth, config, MCP and
// sqlite state are never copied. HAPI's /api/codex/sync-session then registers it (codexDesktop.ts).
const file=/^rollout-.+-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const headBytes=2*1024*1024,page=50;
const reject=message=>{throw Object.assign(Error(message),{rejected:true,userMessage:'가져오기를 시작하지 않았습니다. '+message});};
async function rollouts(root,found=[]){
 let entries;try{entries=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return found;throw e;}
 for(const e of entries){const path=join(root,e.name);if(e.isDirectory())await rollouts(path,found);else if(e.isFile()&&file.test(e.name))found.push({path,id:file.exec(e.name)[1]});}
 return found;
}
async function read(path,max){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await fd.stat();if(!stat.isFile())reject('기록 파일이 아닙니다.');const size=max??stat.size;const buffer=Buffer.alloc(Math.min(size,stat.size));const {bytesRead}=await fd.read(buffer,0,buffer.length,0);
  const after=await fd.stat();if(max==null&&(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs))reject('원본 기록이 읽는 중에 바뀌었습니다. 원본 작업을 마친 뒤 다시 시도하세요.');
  return {data:buffer.subarray(0,bytesRead),stat};}
 finally{await fd.close();}
}
export function codexSessionHead(text,id){
 const lines=text.split('\n');let meta;try{meta=JSON.parse(lines[0]);}catch{return null;}
 const p=meta?.type==='session_meta'?meta.payload:null;
 if(!p||p.id!==id||typeof p.cwd!=='string'||!isAbsolute(p.cwd))return null;
 let first=null;for(const line of lines.slice(1)){if(first)break;try{const row=JSON.parse(line),p=row?.type==='event_msg'?row.payload:null;
  // Older CLIs emit user_message; 0.166 emits item_completed with a UserMessage item.
  const text=p?.type==='user_message'?p.message:p?.type==='item_completed'&&p.item?.type==='UserMessage'&&Array.isArray(p.item.content)?p.item.content.filter(c=>c?.type==='text').map(c=>c.text).join(' '):null;
  if(typeof text==='string'&&text.trim())first=text.trim();}catch{}}
 // Subagent threads belong to their parent conversation (HAPI isSubagentSource).
 return {cwd:p.cwd,subagent:p.source!==null&&typeof p.source==='object',first};
}
async function titles(source){
 const map=new Map();let text='';try{text=await readFile(join(source,'session_index.jsonl'),'utf8');}catch{return map;}
 for(const line of text.split('\n')){try{const r=JSON.parse(line);if(uuid.test(r?.id)&&typeof r.thread_name==='string'&&r.thread_name.trim())map.set(r.id,r.thread_name.trim());}catch{}}
 return map;
}
const fingerprint=stat=>`${stat.size}:${stat.mtimeMs}`;
export function codexImports({project,destination}){
 project=resolve(project);
 // Threads started in a subfolder belong to the project too; they are registered and resumed at the project root.
 const inside=cwd=>{const rel=relative(project,resolve(cwd));return rel===''||!rel.startsWith('..')&&!isAbsolute(rel)?rel:null;};
 const mine=head=>head&&!head.subagent&&inside(head.cwd)!==null;
 async function list(source,offset=0){
  source=sourcePath(source);
  if(destination&&resolve(destination)===source)reject('Maricode 전용 Codex 프로필이 아닌 원래 Codex 기록 폴더를 선택하세요.');
  const searched={source,project,records:join(source,'sessions')};
  try{if(!(await lstat(source)).isDirectory())return {sessions:[],status:'profile-missing',searched};}catch(e){if(e.code==='ENOENT')return {sessions:[],status:'profile-missing',searched};throw e;}
  try{await lstat(searched.records);}catch(e){if(e.code==='ENOENT')return {sessions:[],status:'store-missing',searched};throw e;}
  const names=await titles(source),rows=[];
  for(const r of await rollouts(searched.records)){
   const {data,stat}=await read(r.path,headBytes),head=codexSessionHead(data.toString('utf8'),r.id);if(!mine(head))continue;
   rows.push({id:r.id,title:(names.get(r.id)??head.first??'제목 없는 Codex 대화').replace(/\s+/g,' ').slice(0,80),modifiedAt:stat.mtimeMs,size:stat.size,fingerprint:fingerprint(stat),...(stat.size>limit?{importable:false,warning:'가져오기 한도(256MiB)를 넘습니다'}:inside(head.cwd)?{warning:`하위 폴더 ${inside(head.cwd)}에서 시작 · 프로젝트 폴더에서 이어갑니다`}:{})});
  }
  rows.sort((a,b)=>b.modifiedAt-a.modifiedAt);
  const start=Math.max(0,Number.isInteger(offset)?offset:0),sessions=rows.slice(start,start+page);
  return {sessions,total:rows.length,nextOffset:start+page<rows.length?start+page:null,status:rows.length?'ok':'empty',searched};
 }
 async function copy(source,id,expected){
  if(!uuid.test(id??''))reject('세션 ID 형식을 확인하세요.');
  source=sourcePath(source);if(!destination||!isAbsolute(destination))reject('Maricode 전용 Codex 프로필을 확인하지 못했습니다.');
  if(resolve(destination)===source)reject('Maricode 전용 Codex 프로필이 아닌 원래 Codex 기록 폴더를 선택하세요.');
  const root=join(source,'sessions'),match=(await rollouts(root)).filter(r=>r.id===id);
  if(match.length!==1)reject('선택한 기록을 찾지 못했습니다. 목록을 새로고침하세요.');
  const {data,stat}=await read(match[0].path);
  if(stat.size>limit)reject('가져오기 한도(256MiB)를 넘는 기록입니다.');
  if(fingerprint(stat)!==expected)reject('목록 확인 뒤 원본 기록이 바뀌었습니다. 원본 작업을 마친 뒤 목록을 새로고침하세요.');
  if(!mine(codexSessionHead(data.toString('utf8'),id)))reject('선택한 프로젝트에서 시작한 Codex 기록이 아닙니다.');
  const target=join(destination,'sessions',relative(root,match[0].path));
  const head=codexSessionHead(data.toString('utf8'),id),title=(head.first??'제목 없는 Codex 대화').replace(/\s+/g,' ').slice(0,80);
  try{const existing=await readFile(target);if(existing.equals(data))return {copied:false,title};reject('같은 ID의 다른 기록이 이미 있습니다. 기존 기록을 덮어쓰지 않습니다.');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  const temp=target+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,data,{flag:'wx',mode:0o600});await rename(temp,target);}finally{await rm(temp,{force:true});}
  return {copied:true,title};
 }
 return {list,copy};
}
