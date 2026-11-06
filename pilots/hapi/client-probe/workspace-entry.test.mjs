import {test} from 'node:test';import assert from 'node:assert/strict';
import {workspaceSelection} from './workspace-entry.mjs';
test('an explicit workspace session overrides saved choice only within the destination catalog',()=>{
 const sessions=[{id:'one'},{id:'two'}];assert.equal(workspaceSelection(sessions,'#session=two','one'),'two');assert.equal(workspaceSelection(sessions,'','one'),'one');
 for(const hash of ['#session=missing','#session=two&token=secret','#session=one&session=two','#session=..%2Fescape','#other=two','#session='])assert.throws(()=>workspaceSelection(sessions,hash,'one'),e=>e.status===403);
});
test('restored session selects its exact registered project even when a legacy project was selected',async()=>{
 const {sessionProject}=await import('./workspace-entry.mjs');
 const projects=[{key:'',path:'/legacy'},{key:'beta',path:'/b/work'},{key:'alpha',path:'/a/work'}];
 assert.equal(sessionProject(projects,{project:'/b/work'},''),'beta');
 assert.equal(sessionProject(projects,{project:'/a/work'},'beta'),'alpha');
 assert.equal(sessionProject(projects,{project:'/unknown'},'beta'),'beta');
});

test('a new workspace target survives active-session changes and never falls back when removed',async()=>{
 const {draftProjectSelection,displayPreferences}=await import('./workspace-entry.mjs');
 const projects=[{key:'a'},{key:'b'}];
 assert.equal(draftProjectSelection(projects,'b','a'),'b');
 assert.equal(draftProjectSelection(projects,'removed','a'),null);
 assert.equal(draftProjectSelection(projects,null,'a'),'a');
 assert.equal(draftProjectSelection([],null,'a'),null);
 assert.deepEqual(displayPreferences({compact:true,ended:false,sort:'bad',group:'flat',extra:'ignored'}),{compact:true,ended:false,details:true,group:'flat',sort:'recent'});assert.equal(displayPreferences({sort:'name'}).sort,'name');
});

test('chat drafts stay with their session when a new workspace or another conversation opens',async()=>{
 const {createChatDrafts}=await import('./workspace-entry.mjs');const drafts=createChatDrafts();
 drafts.save('old',{text:'미전송 문장',note:'인계 초안'});
 assert.deepEqual(drafts.read('new'),{text:'',note:''});
 assert.deepEqual(drafts.read('old'),{text:'미전송 문장',note:'인계 초안'});
 drafts.save('new',{text:'다른 초안',note:''});drafts.save('old',{text:'',note:''});
 assert.equal(drafts.read('old').text,'');assert.equal(drafts.read('new').text,'다른 초안');
 drafts.clear();assert.equal(drafts.read('new').text,'');
});

test('new sessions inherit the newest supported AI only from the exact workspace',async()=>{
 const {recentWorkspaceSession}=await import('./workspace-entry.mjs');
 const rows=[{id:'old',project:'/a',agent:'codex',updatedAt:10},{id:'latest',project:'/a',agent:'claude',updatedAt:20},{id:'other',project:'/a/sub',agent:'codex',updatedAt:30}];
 assert.equal(recentWorkspaceSession(rows,'/a').id,'latest');
 assert.equal(recentWorkspaceSession(rows,'/empty'),null);
 assert.equal(recentWorkspaceSession([...rows,{id:'unsupported',project:'/a',agent:'other',updatedAt:40}],'/a').id,'latest');
});

test('connected AI hides setup actions; missing, signed-out and unknown remain actionable without assuming access',async()=>{
 const {draftAccountView}=await import('./workspace-entry.mjs');
 assert.deepEqual(draftAccountView({state:'connected'},{local:true}),{setup:false,connect:false,login:false,check:true,label:'CLI 구독 로그인 확인됨'});
 assert.equal(draftAccountView({state:'not-installed'},{local:true}).setup,true);
 assert.equal(draftAccountView({state:'not-installed'},{local:false}).setup,false);
 assert.equal(draftAccountView({state:'signed-out'},{local:true,localLogin:true}).login,true);
 assert.equal(draftAccountView({state:'signed-out',loginPending:true},{local:true,localLogin:true}).login,false);
 assert.equal(draftAccountView({state:'unknown'},{local:true}).check,true);
 assert.equal(draftAccountView({state:'unknown'},{local:true}).setup,true);
 assert.equal(draftAccountView({state:'unknown'},{local:false}).setup,false);
 assert.equal(draftAccountView({state:'other-auth'},{local:true}).login,false);
 // A discovered CLI folder turns setup into one in-place connect click.
 const found=draftAccountView({state:'connection-required'},{local:true,found:'/u/.claude-global'});
 assert.equal(found.connect,true);assert.equal(found.label,"터미널 설정 찾음: .claude-global");
 assert.equal(draftAccountView({state:'connection-required'},{local:false,found:'/u/x'}).connect,false);
});


test('runner labels do not equate login with a running AI session',async()=>{
 const {draftRunnerLabel}=await import('./workspace-entry.mjs');
 assert.match(draftRunnerLabel({phase:'unprepared',hub:'not-checked'},'claude'),/실행 전/);
 assert.match(draftRunnerLabel({phase:'running',hub:'connected',agents:['claude']},'claude'),/서버 연결 확인/);
 assert.match(draftRunnerLabel({phase:'running',hub:'connected',agents:['codex']},'claude'),/Claude.*준비되지/);
 assert.match(draftRunnerLabel({phase:'unknown',hub:'connected',agents:['claude']},'claude'),/미확인/);
});
test('the latest-content cue appears only when the conversation is scrolled away from the bottom',async()=>{
 const {moreBelow}=await import('./workspace-entry.mjs');
 assert.equal(moreBelow({scrollHeight:1000,scrollTop:500,clientHeight:500}),false);
 assert.equal(moreBelow({scrollHeight:1000,scrollTop:420,clientHeight:500}),false);
 assert.equal(moreBelow({scrollHeight:1000,scrollTop:300,clientHeight:500}),true);
});

test('device selection survives a new app window, remains server scoped, and preserves each open tab',async()=>{
 const {readWorkspaceSession,saveWorkspaceSession}=await import('./workspace-entry.mjs');
 const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
 const disk=storage(),tab=storage(),other=storage();
 saveWorkspaceSession(tab,disk,'server-a','two');
 assert.equal(readWorkspaceSession(storage(),disk,'server-a'),'two');
 assert.equal(readWorkspaceSession(storage(),disk,'server-b'),null);
 saveWorkspaceSession(other,disk,'server-a','one');
 assert.equal(readWorkspaceSession(tab,disk,'server-a'),'two');
 assert.equal(readWorkspaceSession(storage(),disk,'server-a'),'one');
 saveWorkspaceSession(tab,disk,'','local');
 assert.equal(readWorkspaceSession(tab,disk,''),'local');
 assert.equal(readWorkspaceSession(storage(),disk,''),null);
 const denied={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
 assert.doesNotThrow(()=>saveWorkspaceSession(denied,denied,'server-a','two'));
 assert.equal(readWorkspaceSession(denied,disk,'server-a'),'one');
 assert.equal(readWorkspaceSession(denied,denied,'server-a'),null);
 assert.equal(workspaceSelection([{id:'one'},{id:'two'}],'#session=two',readWorkspaceSession(storage(),disk,'server-a')),'two');
});
