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
 return {compact:value?.compact===true,ended:value?.ended!==false,details:value?.details!==false,group:value?.group==='flat'?'flat':'project',sort:value?.sort==='active'?'active':'name'};
}

// Window-memory only; never persist conversation drafts or transfer them to a new session.
export function createChatDrafts(){
 const drafts=new Map();
 return {save(id,{text='',note=''}={}){if(!id)return;if(text||note)drafts.set(id,{text,note});else drafts.delete(id);},read(id){return {...(drafts.get(id)??{text:'',note:''})};},clear(){drafts.clear();}};
}
