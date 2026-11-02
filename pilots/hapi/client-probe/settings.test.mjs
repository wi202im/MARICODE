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
