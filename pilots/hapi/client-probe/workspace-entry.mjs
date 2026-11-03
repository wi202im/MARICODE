import {restoredSession} from './core.mjs';
// The fragment is a navigation hint, never authentication or permission.
export function workspaceSelection(sessions,hash,last){
 if(!hash)return restoredSession(sessions,last);
 const match=/^#session=([A-Za-z0-9-]+)$/.exec(hash);
 if(!match||!sessions.some(s=>s.id===match[1]))throw Object.assign(Error('지정한 세션을 이 서버에서 찾을 수 없습니다. 서버 목록에서 대상을 다시 선택해 주세요.'),{status:403});
 return match[1];
}

export function sessionProject(projects,session,fallback){
 return projects.find(p=>p.path===session?.project)?.key??fallback;
}

// A draft has its own target; catalog refresh and active conversation never retarget it.
export function draftProjectSelection(projects,draft,current){
 if(draft!==null&&draft!==undefined)return projects.some(p=>p.key===draft)?draft:null;
 return projects.some(p=>p.key===current)?current:projects[0]?.key??null;
}
export function displayPreferences(value={}){
 return {compact:value?.compact===true,ended:value?.ended!==false,details:value?.details!==false,group:value?.group==='flat'?'flat':'project',sort:['active','name'].includes(value?.sort)?value.sort:'recent'};
}

// Window-memory only; never persist conversation drafts or transfer them to a new session.
export function createChatDrafts(){
 const drafts=new Map();
 return {save(id,{text='',note=''}={}){if(!id)return;if(text||note)drafts.set(id,{text,note});else drafts.delete(id);},read(id){return {...(drafts.get(id)??{text:'',note:''})};},clear(){drafts.clear();}};
}

// Same workspace only; caller supplies the current server's catalog.
export function recentWorkspaceSession(sessions,path){
 return sessions.filter(s=>s.project===path&&['claude','codex'].includes(s.agent)).sort((a,b)=>(b.updatedAt??b.createdAt??0)-(a.updatedAt??a.createdAt??0))[0]??null;
}


export function draftAccountView(provider,{local=false,localLogin=false,found=null}={}){
 const state=provider?.state??'unknown',pending=!!provider?.loginPending;
 if(local&&found&&state==='connection-required')return {setup:true,connect:true,login:false,check:true,label:`터미널 설정 찾음: ${found.split("/").pop()}`};
 const missing=['not-configured','not-installed'].includes(state);
 return {setup:local&&(missing||state==='unknown'||state==='connection-required'),connect:false,login:localLogin&&state==='signed-out'&&!pending,check:true,
  label:pending?'로그인 완료 대기':({'connection-required':'AI 연결에서 기존 CLI 설정 위치를 연결하세요.',connected:'CLI 구독 로그인 확인됨','signed-out':localLogin?'로그인이 필요합니다.':'실행 컴퓨터에서 로그인해 주세요.','not-configured':local?'AI 연결이 필요합니다.':'실행 컴퓨터에서 AI를 연결해 주세요.','not-installed':local?'실행 파일을 찾지 못했습니다.':'실행 컴퓨터의 AI 설치를 확인해 주세요.','other-auth':'구독 외 인증이 설정돼 있습니다. 계정 설정을 확인해 주세요.'})[state]??'연결 상태를 확인하지 못했습니다.'};
}

export function draftRunnerLabel(runner,agent){
 if(!runner)return '실행기 상태 미확인 · 로그인 확인은 실제 AI 응답 확인과 다릅니다.';
 if(['unprepared','prepared','exited'].includes(runner.phase))return '실행 전 · 대화 시작/가져오기 시 실행기를 준비합니다.';
 if(runner.phase==='unknown')return '실행 상태 미확인 · 컴퓨터 설정에서 상태를 확인하세요.';
 if(runner.hub==='connected'&&runner.phase==='running')return runner.agents?.includes(agent)?'실행기 → 서버 연결 확인 · 실제 AI 응답은 대화 시작 후 확인합니다.':`${agent==='claude'?'Claude':'Codex'}가 실행기에 준비되지 않았습니다. 대화 시작 시 설정을 확인합니다.`;
 return '실행기 → 서버 연결 미확인 · 컴퓨터 설정에서 상태를 확인하세요.';
}

// Within 90px of the end counts as reading the latest output.
export const moreBelow=s=>s.scrollHeight-s.scrollTop-s.clientHeight>=90;
