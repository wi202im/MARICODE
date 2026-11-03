import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settingsView,settingChange,permissionLabel} from './settings.mjs';
const session={active:true,thinking:false,metadata:{flavor:'codex'},agentState:{controlledByUser:false,requests:{}},model:'m1',modelReasoningEffort:'high'};
const catalog={success:true,models:[{id:'m1',displayName:'Model 1',isDefault:true,supportedReasoningEfforts:['low','high']},{id:'m2',displayName:'Model 2',supportedReasoningEfforts:['medium']}]};
test('settings use per-model advertised efforts and do not invent missing capabilities',()=>{
 const v=settingsView(session,catalog);assert.deepEqual(v.efforts.map(o=>o.value),[null,'low','high']);assert.equal(v.current.effort,'high');
 assert.deepEqual(settingsView(session,{success:false}).models,[]);
 assert.deepEqual(settingsView({...session,model:'unknown'},catalog).efforts,[]);
 assert.equal(settingsView({...session,thinking:true},catalog).editable,false);
 assert.equal(settingsView({...session,agentState:{controlledByUser:true}},catalog).editable,false);
 const c=settingsView({...session,metadata:{flavor:'claude'},effort:'medium'});assert.equal(c.current.effort,'medium');assert.match(c.source,/프리셋/);
});
test('setting changes reject stale state, mixed changes, unsupported values and busy sessions',()=>{
 const expected={model:'m1',effort:'high'},input={field:'effort',value:'low',expected};
 assert.deepEqual(settingChange(session,catalog,input),{route:'model-reasoning-effort',body:{modelReasoningEffort:'low'}});
 for(const body of [{...input,value:'max'},{...input,expected:{model:'m2',effort:'high'}},{...input,yolo:true},{...input,value:'high'}])assert.throws(()=>settingChange(session,catalog,body));
 assert.throws(()=>settingChange({...session,thinking:true},catalog,input));
 assert.throws(()=>settingChange({...session,agentState:{requests:{a:{}}}},catalog,input));
 assert.deepEqual(settingChange({...session,metadata:{flavor:'claude'},effort:'high'},null,input),{route:'effort',body:{effort:'low'}});
});
test('Claude 0.33.3 presets include haiku and preserve a legacy current selection without offering other legacy aliases',()=>{
 const c={...session,metadata:{flavor:'claude'},model:'opus[1m]'};
 const values=settingsView(c).models.map(o=>o.value);
 assert.ok(values.includes('haiku'));assert.ok(values.includes('opus[1m]'));assert.ok(!values.includes('sonnet[1m]'));
 assert.match(settingsView(c).source,/0\.33\.3/);
});

test('access modes are provider specific and require the current provider and permission snapshot',()=>{
 const c={...session,metadata:{flavor:'claude'},permissionMode:'default',effort:'high'};
 const view=settingsView(c),expected={...view.current,flavor:'claude'};
 assert.deepEqual(view.permissionModes.map(o=>o.value),['default','acceptEdits','auto','bypassPermissions','plan']);
 assert.deepEqual(settingsView(session,catalog).permissionModes.map(o=>o.value),['default','read-only','autoReview','yolo']);
 assert.deepEqual(settingChange(c,null,{field:'permissionMode',value:'bypassPermissions',expected}),{route:'permission-mode',body:{mode:'bypassPermissions'}});
 for(const bad of [{...expected,permissionMode:'plan'},{model:'m1',effort:'high'},{...expected,flavor:'codex'}])assert.throws(()=>settingChange(c,null,{field:'permissionMode',value:'bypassPermissions',expected:bad}));
 assert.throws(()=>settingChange(c,null,{field:'permissionMode',value:'yolo',expected}));
 assert.throws(()=>settingChange({...c,thinking:true},null,{field:'permissionMode',value:'bypassPermissions',expected}));
 assert.throws(()=>settingChange({...c,agentState:{controlledByUser:false,requests:{pending:{}}}},null,{field:'permissionMode',value:'bypassPermissions',expected}));
 assert.deepEqual(settingsView({...c,metadata:{flavor:'other'}}).permissionModes,[]);
});

test('access chip labels come from the provider presets without a settings fetch',()=>{
 assert.equal(permissionLabel('claude','bypassPermissions'),'Bypass · 승인 생략');
 assert.equal(permissionLabel('codex','yolo'),'전체 접근 · 승인 생략');
 assert.equal(permissionLabel('claude','unknown-mode'),'unknown-mode');
 assert.equal(permissionLabel('codex',null),null);
});

test('Claude uses the account model list with per-model effort levels when the runner reports one',()=>{
 const c={...session,metadata:{flavor:'claude'},model:'sonnet',effort:null,permissionMode:'default'};
 const list={success:true,availableModels:[{value:'default',displayName:'Default (recommended)',effortLevels:['low']},{value:'opus',displayName:'Opus 5.5',effortLevels:['low','max']},{value:'sonnet',displayName:'Sonnet 5.5',effortLevels:['low','high']},{value:'claude-haiku-4-5',displayName:'Haiku 4.5',effortLevels:[]}]};
 const v=settingsView(c,list);
 assert.deepEqual(v.models.map(o=>o.value),[null,'opus','sonnet','claude-haiku-4-5']);assert.equal(v.models[1].label,'Opus 5.5');
 assert.deepEqual(v.efforts.map(o=>o.value),[null,'low','high']);assert.doesNotMatch(v.source,/프리셋/);
 assert.deepEqual(settingsView({...c,model:'claude-haiku-4-5'},list).efforts,[]);
 assert.deepEqual(settingsView({...c,model:'retired'},list).models.map(o=>o.value)[1],'retired');
 assert.deepEqual(settingChange(c,list,{field:'model',value:'opus',expected:{...v.current}}),{route:'model',body:{model:'opus'}});
});
test('Codex Fast and plan mode are explicit, model-gated choices',()=>{
 const s={...session,permissionMode:'default',serviceTier:'standard',collaborationMode:'default'},fast={success:true,models:[{...catalog.models[0],serviceTiers:['priority','fast']},catalog.models[1]]};
 const v=settingsView(s,fast),expected={...v.current,flavor:'codex'};
 assert.deepEqual(v.extras.map(e=>[e.field,e.current,e.options.map(o=>o.value)]),[['serviceTier','standard',['standard','fast']],['collaborationMode','default',['default','plan']]]);
 assert.deepEqual(settingsView(s,catalog).extras.map(e=>e.field),['collaborationMode']);
 assert.deepEqual(settingChange(s,fast,{field:'serviceTier',value:'fast',expected}),{route:'service-tier',body:{serviceTier:'fast'}});
 assert.deepEqual(settingChange(s,fast,{field:'collaborationMode',value:'plan',expected}),{route:'collaboration-mode',body:{mode:'plan'}});
 assert.throws(()=>settingChange(s,catalog,{field:'serviceTier',value:'fast',expected}));
 assert.throws(()=>settingChange(s,fast,{field:'serviceTier',value:'standard',expected}));
 assert.throws(()=>settingChange({...s,metadata:{flavor:'claude'}},null,{field:'collaborationMode',value:'plan',expected:{...expected,flavor:'claude'}}));
});

test('ended Claude sessions keep all access choices browsable, but require resume before applying',async()=>{
 const {settingsControls}=await import('./settings.mjs');const stopped={...session,active:false,metadata:{flavor:'claude'},permissionMode:'default'};
 const view=settingsView(stopped);assert.equal(view.permissionModes.length,5);assert.equal(view.editable,false);
 const ui=settingsControls(stopped,{loaded:true,connected:true});assert.equal(ui.browse,true);assert.equal(ui.apply,false);assert.equal(ui.resume,true);assert.match(ui.reason,/종료/);
 assert.throws(()=>settingChange(stopped,null,{field:'permissionMode',value:'bypassPermissions',expected:{...view.current,flavor:'claude'}}));
 for(const state of [{pending:true},{actionPending:true},{permissionPending:true},{busy:true}]){const locked=settingsControls(stopped,{loaded:true,connected:true,...state});assert.equal(locked.apply,false);assert.equal(locked.resume,false);}
 assert.equal(settingsControls(stopped,{loaded:true,connected:false}).resume,false);
 assert.equal(settingsControls({...session,agentState:{controlledByUser:true}},{loaded:true,connected:true}).apply,false);
 assert.equal(settingsControls(session,{loaded:true,connected:true}).apply,true);
});
test('exact model IDs come only from parent engine reports; aliases, choices and last responses remain distinct',async()=>{
 const {modelReadout}=await import('./settings.mjs');const c={...session,metadata:{flavor:'claude'},model:'opus'};
 const msg=(model,extras={},role='agent')=>({content:{role,content:{type:'output',data:{type:'assistant',message:{model},...extras}}}});
 const one=msg('claude-opus-4-7'),nested=msg('claude-haiku-4-5',{parent_tool_use_id:'task'});
 const v=modelReadout(c,null,[one,nested,msg('claude-fake-9',{},'user')]);assert.match(v.chip,/claude-opus-4-7/);assert.match(v.chip,/최근 응답/);assert.match(v.detail,/선택: opus/);assert.doesNotMatch(v.detail,/haiku|fake/);
 assert.match(modelReadout(c,null,[]).chip,/버전 미확인/);
 assert.match(modelReadout(c,{models:[{value:'opus',label:'Opus fixture version'}]},[]).chip,/Opus fixture version/);
 const changed=modelReadout({...c,model:'sonnet'},null,[one]);assert.doesNotMatch(changed.chip,/opus/);assert.match(changed.detail,/최근 응답: claude-opus-4-7/);
 const init={content:{role:'agent',content:{type:'output',data:{type:'system',subtype:'init',model:'claude-opus-4-8'}}}};
 assert.match(modelReadout(c,null,[one,init]).chip,/claude-opus-4-8.*실행 보고/);
 assert.match(modelReadout({...session,model:'gpt-fixture-v1'},null,[]).chip,/gpt-fixture-v1/);
});
test('resume preserves only still-supported draft choices and never changes the applied state',async()=>{
 const {settingsDraft}=await import('./settings.mjs');const c={...session,metadata:{flavor:'claude'},permissionMode:'default'};const view=settingsView(c);
 assert.deepEqual(settingsDraft({permissionMode:'bypassPermissions',model:'unsupported',effort:'high'},view),{permissionMode:'bypassPermissions',effort:'high'});
 assert.equal(view.current.permissionMode,'default');
 assert.deepEqual(settingsDraft({permissionMode:'yolo'},view),{});
});
