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
 assert.deepEqual(displayPreferences({compact:true,ended:false,sort:'bad',group:'flat',extra:'ignored'}),{compact:true,ended:false,details:true,group:'flat',sort:'name'});
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
