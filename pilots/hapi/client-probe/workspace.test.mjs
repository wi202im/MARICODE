import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionPresentation} from './workspace.mjs';
test('only a sole default workspace is flattened, without merging folders or machines',async()=>{
 const {workspaceHierarchy,inlineDefaultWorkspace}=await import('./workspace.mjs');
 const base={key:'p',projectId:'p',label:'shop',path:'/shop',workspaceId:'default',workspaceLabel:'renamed default'};
 const child={key:'wt',projectId:'p',parentKey:'p',label:'feature',path:'/wt',worktree:true};
 const card=(id,machineId)=>({config:{id,project:'/shop'},projectPath:'/shop',machineId,host:machineId});
 assert.equal(inlineDefaultWorkspace(workspaceHierarchy([base],[])[0]),true);
 assert.equal(inlineDefaultWorkspace(workspaceHierarchy([base],[card('one','mac'),card('two','mac')])[0]),true);
 assert.equal(inlineDefaultWorkspace(workspaceHierarchy([base,child],[])[0]),false);
 assert.equal(inlineDefaultWorkspace(workspaceHierarchy([child],[])[0]),false);
 assert.equal(inlineDefaultWorkspace(workspaceHierarchy([base],[card('one','mac'),card('two','linux')])[0]),false);
 assert.equal(inlineDefaultWorkspace(workspaceHierarchy([], [card('unknown','mac')])[0]),false);
 assert.equal(inlineDefaultWorkspace({path:'/elsewhere',workspaces:[{project:base,path:'/shop',kind:'directory'}]}),false);
});
test('compact chrome keeps actionable state and hides exhausted history controls',async()=>{
 const {workspaceChrome}=await import('./workspace.mjs');
 const base={session:{active:true},connected:true,history:{hasMore:false},messageCount:4};
 assert.deepEqual(workspaceChrome(base),{activity:false,older:false});
 for(const change of [{connected:false},{session:{active:false}},{session:{active:true,thinking:true}},{session:{active:true,agentState:{requests:{one:{}}}}},{pendingKind:'archive'},{pendingKind:'resume'}])assert.equal(workspaceChrome({...base,...change}).activity,true);
 assert.equal(workspaceChrome({...base,session:null}).activity,false);
 assert.equal(workspaceChrome({...base,history:{hasMore:true}}).older,true);
 assert.equal(workspaceChrome({...base,loadingHistory:true}).older,true);
 assert.equal(workspaceChrome({...base,history:{hasMore:true,limited:true}}).older,false);
 assert.equal(workspaceChrome({...base,history:{hasMore:true},messageCount:1000}).older,false);
});
test('session state distinguishes waiting, running, ended and unknown without inventing completion',()=>{
 const c={id:'12345678-1234-1234-1234-123456789012',label:'Claude 인계'};
 assert.equal(sessionPresentation(c,null).state,'확인 중');
 assert.equal(sessionPresentation(c,{active:true,thinking:false}).state,'입력 대기');
 assert.equal(sessionPresentation(c,{active:true,thinking:true}).state,'작업 중');
 assert.equal(sessionPresentation(c,{active:true,agentState:{requests:{r:{}}}}).state,'승인 필요');
 assert.equal(sessionPresentation(c,{active:false}).state,'실행 종료');
 assert.equal(sessionPresentation(c,{active:true},{stale:true}).state,'상태 확인 필요');
});
test('session cards use current title and engine but retain identity when labels collide',()=>{
 const c={id:'12345678-1234-1234-1234-123456789012',label:'Claude 인계'};
 const p=sessionPresentation(c,{active:true,metadata:{name:'용량 개선',flavor:'claude',path:'/trial/daily-demo'}});
 assert.equal(p.title,'용량 개선');assert.equal(p.engine,'Claude');assert.equal(p.shortId,'12345678');assert.equal(p.project,'daily-demo');
 assert.equal(sessionPresentation(c,{metadata:{name:{unexpected:true}}}).title,c.label);
});

test('server and project grouping never merges equal host names or equal project basenames',async()=>{
 const {groupSessions}=await import('./workspace.mjs');
 const cards=[
  {config:{id:'a'},machineId:'m1',host:'Mac',projectPath:'/one/app',state:'작업 중'},
  {config:{id:'b'},machineId:'m1',host:'Mac',projectPath:'/two/app',state:'승인 필요'},
  {config:{id:'c'},machineId:'m2',host:'Mac',projectPath:'/one/app',state:'상태 확인 필요'},
  {config:{id:'d'},machineId:'',host:'',projectPath:'',state:'확인 중'}
 ];
 const groups=groupSessions(cards);assert.equal(groups.length,3);
 assert.equal(groups[0].projects.length,2);assert.equal(groups[0].running,1);assert.equal(groups[0].approvals,1);
 assert.equal(groups[1].key,'m2');assert.equal(groups[2].name,'서버 확인 중');
});

test('project tree includes empty projects and keeps equal names and execution machines separate',async()=>{
 const {projectTree}=await import('./workspace.mjs');
 const projects=[{key:'a',label:'work',path:'/a/work'},{key:'b',label:'work',path:'/b/work'},{key:'empty',label:'empty',path:'/empty'}];
 const card=(id,path,machineId)=>({config:{id,project:path},projectPath:path,machineId,host:machineId,title:id,engine:'Codex'});
 const groups=projectTree(projects,[card('one','/a/work','mac'),card('two','/b/work','mac'),card('three','/a/work','linux'),card('old','/legacy','mac')]);
 assert.deepEqual(groups.filter(g=>g.project?.key==='a').map(g=>g.cards.map(c=>c.config.id)),[['one'],['three']]);
 assert.deepEqual(groups.find(g=>g.project?.key==='b').cards.map(c=>c.config.id),['two']);
 assert.equal(groups.find(g=>g.project?.key==='empty').cards.length,0);
 assert.equal(groups.find(g=>g.path==='/legacy').project,null);
 assert.equal(new Set(groups.map(g=>g.key)).size,groups.length);
 assert.equal(projectTree(projects,[card('wrong','/unknown/work','mac')]).find(g=>g.project?.key==='a').cards.length,0);
});
test('project workspace session hierarchy retains empty workspaces and shares a workspace across AI sessions',async()=>{
 const {workspaceHierarchy}=await import('./workspace.mjs');
 const rows=[{key:'p',projectId:'p',label:'shop',projectLabel:'shop',workspaceId:'w1',workspaceLabel:'기본 작업공간',path:'/shop'},
 {key:'wt',projectId:'p',parentKey:'p',label:'feature',projectLabel:'shop',workspaceId:'w2',workspaceLabel:'feature',worktree:true,path:'/wt'},
 {key:'other',projectId:'other',label:'shop',projectLabel:'shop',workspaceId:'w3',workspaceLabel:'기본 작업공간',path:'/other'}];
 const card=(id,path,machineId)=>({config:{id,project:path},projectPath:path,machineId,host:machineId,title:id});
 const result=workspaceHierarchy(rows,[card('codex','/wt','mac'),card('claude','/wt','mac')]);
 assert.equal(result.length,2);assert.equal(result[0].workspaces.length,2);assert.equal(result[0].workspaces[0].cards.length,0);
 assert.deepEqual(result[0].workspaces[1].cards.map(c=>c.config.id),['codex','claude']);
 assert.equal(result[1].workspaces.length,1);assert.notEqual(result[0].key,result[1].key);
 assert.equal(workspaceHierarchy(rows,[card('a','/wt','one'),card('b','/wt','two')])[0].workspaces.length,3);
});
test('registered workspace name replaces opaque HAPI folder name without changing Git placement',()=>{
 const config={id:'session',label:'Codex',workspaceLabel:'feature/payment',workspaceId:'workspace',worktree:{name:'feature/payment',basePath:'/base',worktreePath:'/wt'}};
 const p=sessionPresentation(config,{metadata:{path:'/wt',worktree:{name:'opaque-directory',basePath:'/base',worktreePath:'/wt',branch:'feature/payment'}}});
 assert.equal(p.worktree.name,'feature/payment');assert.equal(p.worktree.branch,'feature/payment');assert.equal(p.workspaceId,'workspace');
});

test('sidebar retains lifecycle facts when stale and puts approvals before idle sessions',()=>{
 const pending=sessionPresentation({id:'one',label:'Approval'},{active:true,agentState:{requests:{r:{}}}},{stale:true});
 const ended=sessionPresentation({id:'two',label:'Ended'},{active:false},{stale:true});
 const idle=sessionPresentation({id:'three',label:'Idle'},{active:true});
 assert.equal(ended.active,false);assert.equal(pending.active,true);assert.ok(pending.priority>idle.priority);assert.ok(idle.priority>ended.priority);
});
