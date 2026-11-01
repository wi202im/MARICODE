import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toolViews,requestSnapshot,createPermissionActions} from './workflow.mjs';
test('both providers pair tool results by ID and leave unknown events hidden',()=>{
 const wrap=data=>({content:{role:'agent',content:{type:'codex',data}}});
 const cards=toolViews([wrap({type:'tool-call',callId:'a',name:'shell',input:{command:'echo trial'}}),wrap({type:'tool-call-result',callId:'a',output:'done'}),wrap({type:'token_count',secret:'hidden'})]);
 assert.equal(cards.length,1);assert.equal(cards[0].state,'result');assert.equal(cards[0].output,'done');
 const claude=toolViews([{content:{role:'agent',content:{type:'output',data:{message:{content:[{type:'tool_use',id:'b',name:'Bash',input:{command:'false'}}]}}}}},{content:{role:'agent',content:{type:'output',data:{message:{content:[{type:'tool_result',tool_use_id:'b',content:'failed',is_error:true}]}}}}}]);
 assert.equal(claude[0].state,'error');assert.equal(claude[0].output,'failed');
});
test('request identity includes exact arguments independent of property ordering',()=>{
 assert.equal(requestSnapshot({tool:'Bash',arguments:{b:2,a:1}}),requestSnapshot({arguments:{a:1,b:2},tool:'Bash'}));
 assert.notEqual(requestSnapshot({tool:'Bash',arguments:{command:'read'}}),requestSnapshot({tool:'Bash',arguments:{command:'write'}}));
});
test('lost permission response is not repeated and only disappearance reconciles it',async()=>{
 let count=0,saved;const a=createPermissionActions({post:async()=>{count++;throw Error('lost');},save:x=>saved=x});
 await assert.rejects(a.decide('one',{tool:'Bash',arguments:{}},'approve'));
 await assert.rejects(a.decide('one',{tool:'Bash',arguments:{}},'deny'));assert.equal(count,1);
 const restored=createPermissionActions({pending:saved,post:async()=>{count++;},save:()=>{}});
 restored.reconcile({one:{}});assert.equal(restored.pending,'one');restored.reconcile({});assert.equal(restored.pending,null);
});

test('Codex failed process and nonzero exit are errors, while zero exit remains a result',()=>{
 const result=output=>({content:{role:'agent',content:{data:{type:'tool-call-result',callId:'c',output}}}});
 assert.equal(toolViews([result({status:'failed',exit_code:-1})])[0].state,'error');
 assert.equal(toolViews([result({exit_code:1})])[0].state,'error');
 assert.equal(toolViews([result({status:'completed',exit_code:0})])[0].state,'result');
});

test('definitive pre-forward rejection unlocks decisions but ambiguous failure does not',async()=>{
 const a=createPermissionActions({post:async()=>{throw Object.assign(Error('changed'),{rejected:true});},save:()=>{}});
 await assert.rejects(a.decide('one',{tool:'Bash',arguments:{}},'approve'));assert.equal(a.pending,null);
});
test('session approval is derived from provider and exact advertised scope',async()=>{
 const {permissionChoices,permissionDecision}=await import('./workflow.mjs');
 const bash={tool:'Bash',arguments:{command:'printf trial'}};
 assert.equal(permissionChoices('claude',bash).length,3);
 assert.deepEqual(permissionDecision('claude',bash,'approve','session'),{decision:'approved',allowTools:['Bash(printf trial)']});
 for(const command of ['printf a\nprintf b','echo:*','echo hi)'])assert.equal(permissionChoices('claude',{...bash,arguments:{command}}).length,2);
 assert.throws(()=>permissionDecision('codex',bash,'approve','session'));
 assert.throws(()=>permissionDecision('codex',{tool:'CodexBash',arguments:{}},'approve','session'));
 assert.deepEqual(permissionDecision('codex',{tool:'CodexPermission',arguments:{permissions:{network:{enabled:true}}}},'approve','session'),{decision:'approved_for_session'});
 assert.throws(()=>permissionDecision('claude',bash,'deny','session'));
});
