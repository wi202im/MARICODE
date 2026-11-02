import {open,lstat,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const transcriptLimit=256*1024*1024, importLimit=512*1024*1024;
const windowSize=64*1024;
const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f]/g,' ').trim().slice(0,512):'';
function prompt(value){
 let text=typeof value==='string'?value:Array.isArray(value)?value.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n'):'';
 const command=/<command-name>([^<]+)<\/command-name>/.exec(text)?.[1]??'';
 text=text.replace(/<(local-command-caveat|local-command-stdout|system-reminder|session-start-hook|ide_opened_file|ide_selection|command-name|command-message|command-args|tick|goal)\b[^>]*>[\s\S]*?<\/\1>/g,'').trim();
 if(/^<|^\[Request interrupted by user/.test(text))text='';
 return {text:clean(text),command:clean(command)};
}
// Compatibility reference: Anthropic Agent SDK listSessions/SDKSessionInfo.
// Custom name > AI name > last prompt > summary > meaningful first prompt.
// Parse top-level records, never string-search tool inputs for title fields.
export function nativeSessionTitle(id,index={}){
 let custom='',ai='',last='',summary='',first='',command='',cwd=null,sidechain=false,count=0;
 return {
  consume(row){
   if(!row||typeof row!=='object'||row.sessionId&&row.sessionId!==id)return;
   if(row.type==='custom-title')custom=clean(row.customTitle)||custom;
   if(row.type==='ai-title')ai=clean(row.aiTitle)||ai;
   if(!['user','assistant'].includes(row.type)){
    last=prompt(row.lastPrompt).text||last;summary=clean(row.summary)||summary;
   }
   if(['user','assistant'].includes(row.type)){
    count++;if(!cwd&&typeof row.cwd==='string')cwd=row.cwd;
    if(row.isSidechain===true)sidechain=true;
    if(row.type==='user'&&!row.isMeta&&!row.isCompactSummary){const p=prompt(row.message?.content);first=first||p.text;command=command||p.command;}
   }
  },
  result(){return {title:custom||clean(index.customTitle)||ai||clean(index.aiTitle)||last||prompt(index.lastPrompt).text||summary||clean(index.summary)||first||prompt(index.firstPrompt).text||command||'Claude '+id.slice(0,8),cwd,sidechain,count};}
 };
}
export function transcriptFingerprint(source,project,id,files){
 return createHash('sha256').update(JSON.stringify([source,project,id,files.map(({name,stat:s})=>[name,s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs])])).digest('hex');
}
export async function subagentFiles(base,id){
 const sub=join(base,id);let info;try{info=await lstat(sub);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 if(!info.isDirectory())throw Error('하위 에이전트 기록 폴더가 심볼릭 링크이거나 폴더가 아닙니다.');
 const agents=join(sub,'subagents');try{info=await lstat(agents);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 if(!info.isDirectory())throw Error('하위 에이전트 기록 폴더를 확인해야 합니다.');
 const files=[];
 for(const entry of (await readdir(agents,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(!/^agent-[a-zA-Z0-9_-]+\.jsonl$/.test(entry.name))continue;
  const name=join(id,'subagents',entry.name),stat=await lstat(join(base,name));
  if(!stat.isFile())throw Error('하위 에이전트 기록에 심볼릭 링크 또는 일반 파일이 아닌 항목이 있습니다.');
  files.push({name,stat});
 }
 return files;
}
export async function catalogIndex(base,project){
 let fd;try{
  fd=await open(join(base,'sessions-index.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
  const s=await fd.stat();if(!s.isFile()||s.size>8*1024*1024)return new Map();
  const data=JSON.parse(await fd.readFile('utf8'));
  return new Map((Array.isArray(data.entries)?data.entries:[]).filter(e=>e&&typeof e.sessionId==='string'&&(!e.projectPath||resolve(e.projectPath)===resolve(project))).map(e=>[e.sessionId,e]));
 }catch{return new Map();}finally{await fd?.close();}
}
export async function catalogRow({base,source,project,id,stat,index}){
 const fallback={id,title:'Claude '+id.slice(0,8),modifiedAt:stat?.mtimeMs??0,messageCount:null,size:stat?.size??0,importable:false,fingerprint:null};
 if(!stat?.isFile())return {...fallback,warning:'심볼릭 링크 또는 읽을 수 없는 기록입니다.'};
 let fd;
 try{
  fd=await open(join(base,id+'.jsonl'),constants.O_RDONLY|constants.O_NOFOLLOW);const before=await fd.stat();
  if(!before.isFile())throw Error('일반 기록 파일이 아닙니다.');
  const title=nativeSessionTitle(id,index),samples=[];let malformed=false;
  if(before.size<=2*windowSize){const b=Buffer.alloc(before.size);await fd.read(b,0,b.length,0);samples.push(b.toString('utf8'));}
  else{
   const head=Buffer.alloc(windowSize),tail=Buffer.alloc(windowSize);await fd.read(head,0,head.length,0);await fd.read(tail,0,tail.length,before.size-tail.length);
   samples.push(head.lastIndexOf(10)<0?'':head.subarray(0,head.lastIndexOf(10)).toString('utf8'),tail.indexOf(10)<0?'':tail.subarray(tail.indexOf(10)+1).toString('utf8'));
  }
  for(const text of samples)for(const line of text.split('\n')){
   if(!line.trim())continue;try{title.consume(JSON.parse(line));}catch{malformed=true;}
  }
  const after=await fd.stat(),v=title.result();
  let warning=malformed?'일부 기록 형식은 가져오기 전에 추가 확인합니다.':'';
  let importable=true,files=[{name:id+'.jsonl',stat:after}];
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs){importable=false;warning='기록이 작성 중입니다. 원본 작업을 마친 뒤 다시 찾으세요.';}
  if(v.cwd&&resolve(v.cwd)!==resolve(project)){importable=false;warning='기록의 실행 폴더가 선택한 작업 폴더와 다릅니다.';}
  if(v.sidechain){importable=false;warning='하위 에이전트 기록입니다. 원래 상위 세션을 선택하세요.';}
  try{files.push(...await subagentFiles(base,id));}catch(error){importable=false;warning=error.message;}
  const totalSize=files.reduce((n,f)=>n+f.stat.size,0);
  if(files.some(f=>f.stat.size>transcriptLimit)||totalSize>importLimit){importable=false;warning='목록에는 표시했지만 현재 가져오기 한도(파일당256MiB·합계512MiB)를 넘습니다.';}
  return {...fallback,title:v.title,modifiedAt:after.mtimeMs,size:after.size,totalSize,
   messageCount:before.size<=2*windowSize&&!malformed?v.count:null,importable,warning,
   fingerprint:importable?transcriptFingerprint(source,project,id,files):null};
 }catch{return {...fallback,warning:'파일을 읽을 수 없습니다. 접근 권한과 파일 상태를 확인하세요.'};}
 finally{await fd?.close();}
}
