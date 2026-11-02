import test from 'node:test';
import assert from 'node:assert/strict';
import {chatTimeline,describeTool,formatDuration,editPreview} from './chat-presentation.mjs';
const event=(id,data,at)=>({id,createdAt:at,content:{role:'agent',content:{type:'codex',data}}});
test('tool activity keeps its place and pairs results without duplicating a card',()=>{
 const rows=chatTimeline([event('1',{type:'message',message:'먼저 확인합니다.'},1000),event('2',{type:'tool-call',callId:'a',name:'Edit',input:{file_path:'src/a.js',old_string:'old',new_string:'new'}},2000),event('3',{type:'tool-call-result',callId:'a',output:'ok'},5000),event('4',{type:'message',message:'수정했습니다.'},6000)]);
 assert.deepEqual(rows.map(r=>r.kind),['message','activity','message']);assert.equal(rows[1].tools.length,1);assert.equal(rows[1].tools[0].duration,3000);
 assert.equal(describeTool(rows[1].tools[0]).label,'파일 수정');assert.equal(editPreview(rows[1].tools[0].input).after,'new');
});
test('subagent dispatch acknowledgement is distinct from its completion',()=>{
 assert.equal(describeTool({name:'spawn_agent',state:'result',input:{message:'검사'},output:{agent_id:'a'}}).status,'시작 요청 처리됨');
 assert.equal(describeTool({name:'Agent',state:'waiting',input:{description:'검토'}}).label,'하위 에이전트');
 assert.equal(describeTool({name:'Bash',state:'error',input:{command:'false'}}).status,'실패');
 assert.equal(formatDuration(undefined),'');assert.equal(formatDuration(65000),'1분 5초');
});
test('nested assistant output remains attributed to its subagent and truncated calls stay unknown',()=>{
 const rows=chatTimeline([{id:'nested',content:{role:'agent',content:{type:'output',data:{parent_tool_use_id:'a',type:'assistant',message:{content:[{type:'text',text:'검토 결과'}]}}}}}]);
 assert.equal(rows[0].parent,'a');
 const result=chatTimeline([event('r',{type:'tool-call-result',callId:'missing',output:'ok'},3000)]);
 assert.equal(result[0].tools[0].duration,undefined);
});
test('engine session events surface as notices so silent launch failures are visible',()=>{
 const ev=(id,data)=>({id,content:{role:'agent',content:{type:'event',data}}});
 const rows=chatTimeline([ev('1',{type:'message',message:'Process exited unexpectedly: Not logged in'}),ev('2',{type:'message',message:'Process exited unexpectedly: Not logged in'}),ev('3',{type:'error',message:'boom'}),ev('4',{type:'ready'}),ev('5',{type:'message',message:'Process exited unexpectedly 3 times in a row: x. Dropping the queued message; resolve the issue and resend it.'})]);
 assert.deepEqual(rows.map(r=>[r.kind,r.error]),[['notice',true],['notice',true],['notice',true]]);
 assert.match(rows[0].text,/엔진 실행 실패.*Not logged in/);assert.match(rows[1].text,/^엔진 오류: boom/);assert.match(rows[2].text,/다시 보내/);
});
test('context usage comes from the latest parent-context engine report and stays unknown otherwise',async()=>{
 const {contextUsage}=await import('./chat-presentation.mjs');
 const claude=(usage,parent=null)=>({content:{role:'agent',content:{type:'output',data:{type:'assistant',parent_tool_use_id:parent,message:{usage}}}}});
 assert.deepEqual(contextUsage([claude({input_tokens:2,cache_creation_input_tokens:2337,cache_read_input_tokens:28353,output_tokens:4,context_window:1000000})]),{used:30696,window:1000000});
 assert.deepEqual(contextUsage([claude({input_tokens:10,output_tokens:1,context_window:200000}),claude({input_tokens:99999,output_tokens:1},'child')]),{used:11,window:200000});
 const codex={content:{role:'agent',content:{type:'codex',data:{type:'token_count',info:{total:{totalTokens:31556},last:{totalTokens:16499,inputTokens:16492,outputTokens:7},modelContextWindow:475000}}}}};
 assert.deepEqual(contextUsage([codex]),{used:16499,window:475000});
 assert.deepEqual(contextUsage([claude({input_tokens:5,output_tokens:1})]),{used:6,window:null});
 const compacted={content:{role:'agent',content:{type:'codex',data:{type:'token_count',info:{total:{inputTokens:0,outputTokens:0},contextTokens:4958,modelContextWindow:1000000}}}}};
 assert.deepEqual(contextUsage([claude({input_tokens:30000,output_tokens:1,context_window:1000000}),compacted]),{used:4958,window:1000000});
 assert.equal(chatTimeline([{id:'c',content:{role:'agent',content:{type:'event',data:{type:'compact-summary',summary:'x'}}}}])[0].kind,'notice');
 assert.equal(contextUsage([]),null);
});
