import test from 'node:test';import assert from 'node:assert/strict';import {requestQuestions,questionDecision} from './questions.mjs';
test('questions retain provider keys and never broaden answers to tool/session grants',()=>{
 const c={tool:'AskUserQuestion',arguments:{questions:[{question:'Which?',options:[{label:'A'}]}]}};
 assert.deepEqual(questionDecision('claude',c,{'0':['A']}),{decision:'approved',answers:{'0':['A']}});
 const x={tool:'request_user_input',arguments:{questions:[{id:'choice',question:'Which?',options:[{label:'A'}]}]}};
 assert.deepEqual(questionDecision('codex',x,{choice:['custom']}),{decision:'approved',answers:{choice:{answers:['user_note: custom']}}});
 assert.throws(()=>questionDecision('codex',x,{other:['A']}));assert.throws(()=>questionDecision('codex',x,{choice:['A','B']}));assert.equal(requestQuestions('codex',c),null);
 x.arguments.questions[0].isSecret=true;assert.equal(requestQuestions('codex',x),null);assert.throws(()=>questionDecision('codex',x,{choice:['secret']}));
});
