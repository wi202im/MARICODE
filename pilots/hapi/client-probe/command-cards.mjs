import {execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,rm,stat,access} from 'node:fs/promises';
import {constants} from 'node:fs';import {join,isAbsolute} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {accountProfiles} from './account-profiles.mjs';import {accountRevision} from './machine-setup.mjs';import {accountStatus} from './accounts.mjs';
const agents=['claude','codex'],uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const rejected=message=>Object.assign(Error(message),{rejected:true});
const names=s=>typeof s==='string'&&/^[a-zA-Z0-9][\w.-]{0,63}$/.test(s);
const existingName=s=>typeof s==='string'&&/^[\p{L}\p{N}][\p{L}\p{N}_.:@ -]{0,127}$/u.test(s);
const clean=s=>typeof s==='string'?s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x1f\x7f]/g,'').slice(0,120):'';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const commandContextKey=s=>hash([s.sessionId,s.agent,s.cwd,s.accountId,s.revision]);
const mutation=a=>['mcp-add','mcp-remove','mcp-login'].includes(a);
const allowed={ 'mcp-list':[], 'mcp-login':['name'], 'mcp-add':['name','url','scope'], 'mcp-remove':['name','scope'], 'plugins-list':[],account:[],doctor:[] };
export function commandArgs(agent,action,params={}){
 if(!agents.includes(agent)||!allowed[action]||!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!allowed[action].includes(k)))throw rejected('지원하는 명령과 입력 항목을 확인하세요.');
 if(action==='mcp-list')return ['mcp','list',...(agent==='codex'?['--json']:[])];
 if(action==='plugins-list')return ['plugin','list','--json'];
 if(action==='account')return agent==='claude'?['auth','status','--json']:['login','status'];
 if(action==='doctor'){if(agent!=='codex')throw rejected('이 AI의 진단 카드는 아직 지원하지 않습니다.');return ['doctor','--json'];}
 if(!(action==='mcp-add'?names(params.name):existingName(params.name)))throw rejected('서버 이름은 영문·숫자로 시작하는 64자 이내 이름을 사용하세요.');
 if(action==='mcp-login')return ['mcp','login',params.name];
 if(agent==='claude'&&!['local','project','user'].includes(params.scope))throw rejected('Claude 설정 범위를 선택하세요.');
 if(agent==='codex'&&params.scope!==undefined)throw rejected('Codex 설정은 현재 계정 프로필에 저장합니다.');
 if(action==='mcp-remove')return ['mcp','remove',...(agent==='claude'?['--scope',params.scope]:[]),params.name];
 let url;try{if(typeof params.url!=='string')throw Error();url=new URL(params.url);}catch{throw rejected('HTTP MCP 주소를 확인하세요.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||params.url.length>2048||/[\x00-\x20]/.test(params.url))throw rejected('인증정보·쿼리·공백 없는 HTTP(S) 주소를 입력하세요. 비밀값은 채팅 카드에 입력하지 마세요.');
 return agent==='claude'?['mcp','add-json','--scope',params.scope,params.name,JSON.stringify({type:'http',url:url.href})]:['mcp','add',params.name,'--url',url.href];
}
export function commandResult(agent,action,r){
 if(action==='account'){const labels={connected:'구독 로그인 확인', 'signed-out':'로그인 필요','other-auth':'다른 인증 방식 사용 중','not-installed':'CLI를 찾지 못함',unknown:'로그인 상태 미확인'};return {summary:labels[accountStatus(agent,r).state],rows:[]};}
 if(action==='doctor'){
  const d=JSON.parse(r.stdout);if(!d.checks||typeof d.checks!=='object')throw Error('Unsupported report');
  const labels={ok:'정상',warning:'확인 필요',fail:'실패',skipped:'생략'};
  return {summary:'설치·설정 진단 (자동 복구 없음)',rows:Object.entries(d.checks).filter(([k,v])=>/^[a-z_.-]{1,80}$/.test(k)&&labels[v?.status]).slice(0,100).map(([name,v])=>({name,status:labels[v.status]}))};
 }
 if(action==='mcp-login')return {summary:r.code===0?'공식 CLI가 인증 완료를 보고했습니다. 목록을 새로 확인하고 같은 세션을 재개하세요.':'인증을 완료하지 못했습니다. 브라우저에서 승인했는지와 서버의 인증 방식을 확인하세요.',rows:[],...(r.code!==0?{failed:true}:{})};
 if(r.code!==0)return {summary:'CLI 조회에 실패했습니다. 계정·설치·네트워크 상태를 확인하세요.',rows:[],failed:true};
 if(mutation(action))return {summary:'설정을 저장했습니다. 현재 실행에 적용하려면 같은 세션을 재개하세요.',rows:[]};
 if(action==='mcp-list'&&agent==='claude'){
  const text=r.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');if(/No MCP servers configured/i.test(text))return {summary:'등록된 MCP 서버가 없습니다.',rows:[]};
  const rows=text.split('\n').flatMap(line=>{const m=/^(.{1,128}?):\s/.exec(line);if(!m||!existingName(m[1]))return [];const status=/Needs authentication|needs auth/i.test(line)?'인증 필요':/Failed|Disconnected/i.test(line)?'연결 실패':/Pending approval/i.test(line)?'프로젝트 승인 필요':/Connected/.test(line)?'CLI 연결 확인':'설정 확인 · 연결 미확인';return [{name:m[1],status}];});
  if(!rows.length)throw Error('Unsupported MCP report');return {summary:'CLI 조회 결과 · 현재 대화의 MCP 연결 상태와 별개입니다.',rows};
 }
 const d=JSON.parse(r.stdout);const data=Array.isArray(d)?d:action==='plugins-list'?d.installed:null;if(!Array.isArray(data))throw Error('Unsupported CLI report');
 return {summary:action==='mcp-list'?'등록된 MCP 설정 · 현재 대화의 연결 상태는 확인하지 않습니다.':'설치된 플러그인 목록',rows:data.slice(0,200).flatMap(v=>{const name=clean(v?.name??v?.id);if(!name)throw Error('Unsupported CLI row');return [{name,status:action==='mcp-list'?(v.enabled===false?'비활성':'등록됨'):(v.enabled===false?'비활성':'설치됨')}];})};
}
export const runCommand=(binary,args,options)=>new Promise(resolve=>execFile(binary,args,{...options,timeout:options.timeout??45000,maxBuffer:1024*1024},(e,stdout,stderr)=>resolve({code:e?e.code:0,missing:e?.code==='ENOENT',uncertain:!!e&&(e.killed||!!e.signal||typeof e.code!=='number'),stdout,stderr})));
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function save(path,data){const tmp=path+'.'+randomUUID();await writeFile(tmp,JSON.stringify(data),{mode:0o600,flag:'wx',flush:true});await rename(tmp,path);}
export function createCommandCards(configPath,directory,{run=runCommand}={}){
 let busy=false;const cache=new Map();
 async function environment(scope){
  if(!agents.includes(scope.agent)||!uuid.test(scope.sessionId)||!isAbsolute(scope.cwd)||scope.revision!==await accountRevision(configPath))throw rejected('실행 대상이 바뀌었습니다. 명령 카드를 다시 여세요.');
  const profiles=await accountProfiles(configPath).list();if(profiles[scope.agent]?.active!==scope.accountId)throw rejected('현재 계정이 바뀌었습니다. 명령 카드를 다시 여세요.');
  const c=await json(configPath);if(c.cliConnectionRequired&&!profiles[scope.agent]?.confirmed)throw rejected('기존 CLI 설정을 먼저 연결하세요.');const env=await json(c.environment),binary=c.binaries?.[scope.agent];
  if(!binary||!isAbsolute(binary)||!(await stat(scope.cwd)).isDirectory())throw rejected('실행 파일 또는 폴더를 확인하세요.');await access(binary,constants.X_OK);
  return {binary,env,cwd:scope.cwd};
 }
 async function capabilities(scope){
  const e=await environment(scope),st=await stat(e.binary),key=hash([scope.agent,scope.revision,e.binary,st.mtimeMs]),cached=cache.get(key);let actions=cached;
  if(!actions){actions=[];for(const action of Object.keys(allowed)){
    if(action==='doctor'&&scope.agent!=='codex')continue;
    const args=action==='mcp-login'?['mcp','login']:action==='mcp-add'?['mcp',scope.agent==='claude'?'add-json':'add']:action==='mcp-remove'?['mcp','remove']:commandArgs(scope.agent,action).filter(x=>x!=='--json');
    const r=await run(e.binary,[...args,'--help'],{cwd:e.cwd,env:e.env,timeout:5000});
    if(r.code===0&&/Usage:/i.test(r.stdout)&&(!(['plugins-list','doctor'].includes(action)||action==='mcp-list'&&scope.agent==='codex')||r.stdout.includes('--json'))&&(!['mcp-add','mcp-remove'].includes(action)||scope.agent!=='claude'||r.stdout.includes('--scope')))actions.push(action);
   }cache.set(key,actions);}
  return {contextKey:commandContextKey(scope),agent:scope.agent,accountId:scope.accountId,alias:scope.alias,cwd:scope.cwd,actions};
 }
 async function pending(agent){let p;try{p=await json(join(directory,agent+'.pending.json'));}catch(e){return e.code!=='ENOENT';}try{const s=await json(join(directory,p.id+'.json'));return !['succeeded','failed'].includes(s.state);}catch{return true;}}

 async function result(scope,id){if(!uuid.test(id))throw rejected('요청 ID를 확인하세요.');const r=await json(join(directory,id+'.json'));if(r.sessionId!==scope.sessionId||r.agent!==scope.agent||r.accountId!==scope.accountId)throw rejected('이 세션의 요청이 아닙니다.');const {fingerprint,...view}=r;return view;}
 async function execute(scope,input){
  if(!input||Object.keys(input).some(k=>!['requestId','action','params','confirm'].includes(k))||!uuid.test(input.requestId))throw rejected('명령 요청을 확인하세요.');
  const args=commandArgs(scope.agent,input.action,input.params),write=mutation(input.action),fingerprint=hash([commandContextKey(scope),input.action,input.params]);
  if(write&&input.confirm!==true)throw rejected('대상과 변경 범위를 확인한 뒤 적용하세요.');
  try{const r=await json(join(directory,input.requestId+'.json'));if(r.fingerprint!==fingerprint)throw rejected('기존 요청과 입력이 다릅니다. 다시 실행하지 않았습니다.');return result(scope,input.requestId);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(busy)throw rejected('다른 명령을 처리 중입니다. 결과를 먼저 확인하세요.');busy=true;let lock=false,recorded=false,background=false;
  try{
   await mkdir(directory,{recursive:true,mode:0o700});try{await mkdir(configPath+'.register-lock',{mode:0o700});lock=true;}catch{throw rejected('다른 설정 작업이 진행 중입니다.');}
   const e=await environment(scope),cap=await capabilities(scope);if(!cap.actions.includes(input.action))throw rejected('설치된 CLI가 이 명령을 지원하지 않습니다.');
   if(write&&await pending(scope.agent))throw rejected('앞선 설정 변경 결과가 미확인입니다. 자동으로 재실행하지 않습니다.');
   if(write){
    if(!cap.actions.includes('mcp-list'))throw rejected('MCP 목록 명령 지원을 확인하지 못해 변경하지 않았습니다.');
    let listed;try{listed=commandResult(scope.agent,'mcp-list',await run(e.binary,commandArgs(scope.agent,'mcp-list'),{cwd:e.cwd,env:e.env}));}catch{throw rejected('기존 MCP 설정을 확인하지 못해 변경하지 않았습니다.');}
    if(listed.failed)throw rejected('기존 MCP 설정을 확인하지 못해 변경하지 않았습니다.');
    const exists=listed.rows.some(r=>r.name===input.params.name);
    if(input.action==='mcp-add'&&exists)throw rejected('같은 이름의 서버가 있습니다. 덮어쓰지 않았습니다.');
    if(['mcp-remove','mcp-login'].includes(input.action)&&!exists)throw rejected('목록에서 확인된 서버만 변경하거나 인증할 수 있습니다. 먼저 새로고침하세요.');
   }
   const path=join(directory,input.requestId+'.json'),record={id:input.requestId,sessionId:scope.sessionId,agent:scope.agent,accountId:scope.accountId,action:input.action,fingerprint,state:'running',needsReconnect:false};
   await writeFile(path,JSON.stringify(record),{flag:'wx',mode:0o600,flush:true});recorded=true;if(write)await save(join(directory,scope.agent+'.pending.json'),{id:input.requestId});
   const login=input.action==='mcp-login';
   const complete=async()=>{
    try{const r=await run(e.binary,args,{cwd:e.cwd,env:e.env,...(login?{timeout:300000}:{})});
     if(write&&(r.uncertain||r.code!==0&&!login))throw Error('Mutation uncertain');
     const parsed=commandResult(scope.agent,input.action,r);Object.assign(record,parsed,{state:parsed.failed?'failed':'succeeded',needsReconnect:write&&!parsed.failed});
    }catch{Object.assign(record,{state:write?'unknown':'failed',summary:login?'인증 결과가 미확인입니다. 자동으로 다시 인증하지 않습니다. 공식 CLI의 인증 상태를 확인하세요.':write?'설정 변경 결과가 미확인입니다. MCP 목록으로 확인하세요. 자동 재실행하지 않습니다.':'명령 결과를 읽지 못했습니다. CLI 버전·연결 상태를 확인하세요.',rows:[]});}
    await save(path,record);
   };
   if(login){
    record.summary='이 컴퓨터의 브라우저에서 MCP 인증을 완료한 뒤 인증 결과 확인을 누르세요. 최대 5분 동안 기다립니다. 암호·코드는 채팅에 입력하지 마세요.';await save(path,record);
    const started=await result(scope,input.requestId);background=true;
    // Keep the account/config lock until the CLI exits. Persist status; never return its OAuth URLs or output.
    void complete().catch(()=>{}).finally(async()=>{try{if(lock)await rm(configPath+'.register-lock',{recursive:true});}finally{busy=false;}}).catch(()=>{});
    return started;
   }
   await complete();return result(scope,input.requestId);
  }catch(error){if(!recorded&&!error.rejected)throw rejected('명령 실행 준비를 확인하지 못해 시작하지 않았습니다. 계정·폴더·CLI 설정을 확인하세요.');throw error;}finally{if(!background){if(lock)await rm(configPath+'.register-lock',{recursive:true});busy=false;}}
 }
 return {capabilities,execute,result,pending,running:()=>busy};
}
