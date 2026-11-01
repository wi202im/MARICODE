import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settingsView,settingChange} from './settings.mjs';
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
