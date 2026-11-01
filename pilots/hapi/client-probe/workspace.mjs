import {worktreePresentation} from './git-status.mjs';
export function sessionPresentation(config,snapshot,{stale=false}={}){
 const m=snapshot?.metadata??{},title=config.displayName|| (typeof m.name==='string'&&m.name.trim()?m.name:typeof m.summary?.text==='string'&&m.summary.text.trim()?m.summary.text:config.label);
 const worktree=worktreePresentation({...m,worktree:m.worktree??config.worktree});
 if(worktree&&config.worktree?.worktreePath===m.path&&config.workspaceLabel)worktree.name=config.workspaceLabel;
 const state=stale?'상태 확인 필요':!snapshot?'확인 중':!snapshot.active?'실행 종료':Object.keys(snapshot.agentState?.requests??{}).length?'승인 필요':snapshot.thinking?'작업 중':'입력 대기';
 return {active:snapshot?.active,priority:!snapshot?.active?0:Object.keys(snapshot.agentState?.requests??{}).length?3:snapshot.thinking?2:1,title,workspace:config.workspaceLabel??'기본 작업공간',workspaceId:config.workspaceId??null,worktree,machineId:typeof m.machineId==='string'?m.machineId:'',host:typeof m.host==='string'?m.host:'',projectPath:typeof m.path==='string'?m.path:'',engine:m.flavor==='claude'?'Claude':m.flavor==='codex'?'Codex':config.agent==='claude'?'Claude':config.agent==='codex'?'Codex':'에이전트',shortId:config.id.slice(0,8),project:config.projectLabel??(typeof m.path==='string'?m.path.split('/').filter(Boolean).at(-1):'작업 폴더'),state};
}

export function groupSessions(cards){
 const servers=new Map();
 for(const card of cards){
  const key=card.machineId||'unresolved';
  if(!servers.has(key))servers.set(key,{key,name:card.host||'서버 확인 중',projects:[],running:0,approvals:0,count:0});
  const server=servers.get(key);server.count++;server.running+=Number(card.state==='작업 중');server.approvals+=Number(card.state==='승인 필요');
  const path=card.projectPath||'';let project=server.projects.find(p=>p.path===path);
  if(!project){project={path,name:path.split('/').filter(Boolean).at(-1)||'프로젝트 확인 중',cards:[]};server.projects.push(project);}
  project.cards.push(card);
 }
 return [...servers.values()];
}

// Match exact folders, never a display name; a machine owns its own sessions.
export function projectTree(projects,cards){
 const groups=[],remaining=new Set(cards);
 for(const project of projects){
  const matches=cards.filter(c=>(c.projectPath||c.config.project)===(project.path??project.label));
  const machines=new Map();
  for(const c of matches){const machine=c.machineId||'unresolved';if(!machines.has(machine))machines.set(machine,[]);machines.get(machine).push(c);remaining.delete(c);}
  if(!machines.size)machines.set('',[]);
  for(const [machine,items] of machines)groups.push({key:JSON.stringify(['registered',project.key,machine]),project,path:project.path??project.label,label:project.label,host:machines.size>1?items[0]?.host||machine:'',cards:items});
 }
 for(const server of groupSessions([...remaining]))for(const project of server.projects)groups.push({key:JSON.stringify(['observed',server.key,project.path]),project:null,path:project.path,label:project.name,host:server.name,cards:project.cards});
 return groups;
}
export function workspaceChrome({session,connected,history,loadingHistory=false,messageCount=0,pendingKind}){
 return {
  activity:!!session&&(!connected||!session.active||!!session.thinking||Object.keys(session.agentState?.requests??{}).length>0||['archive','resume'].includes(pendingKind)),
  older:loadingHistory||!!history?.hasMore&&!history.limited&&messageCount<1000
 };
}
// Project = source collection; workspace = an exact execution folder; session = an AI conversation.
// Legacy rows keep a default workspace and observed sessions remain separated by machine/path.
export function workspaceHierarchy(projects,cards){
 const result=new Map();
 for(const group of projectTree(projects,cards)){
  const row=group.project,root=row?projects.find(p=>p.key===(row.projectId??row.parentKey??row.key)):null;
  const key=row?'project:'+(row.projectId??row.parentKey??row.key):'observed:'+group.key;
  if(!result.has(key))result.set(key,{key,label:row?.projectLabel??root?.label??group.label,path:root?.path??group.path,project:root??row,workspaces:[]});
  result.get(key).workspaces.push({...group,label:row?.workspaceLabel??(row?.parentKey?row.label:'기본 작업공간'),kind:row?.worktree?'worktree':'directory'});
 }
 return [...result.values()];
}
