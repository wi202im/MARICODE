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

test('Claude local command stdout and stderr stay visible as CLI results, not user chat',()=>{
 const output=(id,content,extra={})=>({id,content:{role:'agent',content:{type:'output',data:{type:'user',message:{content},...extra}}}});
 const rows=chatTimeline([
  output('command','<command-name>/mcp</command-name><command-args></command-args>'),
  output('out','<local-command-stdout>Server A: connected\nServer B: needs authentication</local-command-stdout>'),
  output('err',[{type:'text',text:'<local-command-stderr>Interactive terminal required</local-command-stderr>'}]),
  output('hidden','<local-command-stdout>internal context</local-command-stdout>',{isMeta:true}),
  output('ordinary','normal echoed user text'),
  output('summary','<local-command-stdout>internal summary</local-command-stdout>',{isCompactSummary:true})
 ]);
 assert.deepEqual(rows.map(r=>r.kind),['command','command','command']);
 assert.equal(rows[0].text,'/mcp');assert.equal(rows[1].text,'Server A: connected\nServer B: needs authentication');assert.equal(rows[1].error,false);assert.equal(rows[2].error,true);
});
test('CLI output requires the engine envelope and complete tags; terminal controls are not rendered',()=>{
 const output=content=>({content:{role:'agent',content:{type:'output',data:{type:'user',message:{content}}}}});
 const rows=chatTimeline([output('<local-command-stdout>\u001b[31mFailed\u001b[0m <script>literal</script></local-command-stdout>')]);
 assert.equal(rows[0]?.kind,'command');assert.equal(rows[0].text,'Failed <script>literal</script>');
 assert.deepEqual(chatTimeline([output('look <local-command-stdout>example</local-command-stdout> here'),output('<local-command-stdout>incomplete')]),[]);
 const user={content:{role:'user',content:'<local-command-stdout>quoted by a person</local-command-stdout>'}};
 assert.equal(chatTimeline([user])[0].kind,'message');
});

test('CLI-tagged echo is distinguished from assistant prose quoting the same syntax',()=>{
 const echo={id:'echo',content:{role:'user',meta:{sentFrom:'cli'},content:{type:'text',text:'<command-name>/context</command-name><command-args>report</command-args>'}}};
 assert.equal(chatTimeline([echo])[0].kind,'command');assert.equal(chatTimeline([echo])[0].text,'/context report');
 const quote={content:{role:'agent',content:{type:'output',data:{type:'assistant',message:{content:'<local-command-stdout>quoted syntax</local-command-stdout>'}}}}};
 assert.equal(chatTimeline([quote])[0].kind,'message');
});
test('model reasoning becomes its own row, merged when consecutive; empty or redacted thinking is dropped',async()=>{
 const {reasoningText}=await import('./chat-presentation.mjs');
 const claude=(blocks,id)=>({id,content:{role:'agent',content:{type:'output',data:{type:'assistant',message:{content:blocks}}}}});
 const codex=(text,id)=>({id,content:{role:'agent',content:{type:'codex',data:{type:'reasoning',message:text}}}});
 assert.equal(reasoningText(claude([{type:'thinking',thinking:'  파일 구조를 먼저 본다 '},{type:'text',text:'답'}])),'파일 구조를 먼저 본다');
 assert.equal(reasoningText(claude([{type:'thinking',thinking:'',signature:'x'}])),null);
 const rows=chatTimeline([codex('**계획** 세우기','a'),codex('검사 실행','b'),claude([{type:'thinking',thinking:'확인'},{type:'text',text:'완료했습니다'}],'c')]);
 assert.deepEqual(rows.map(r=>[r.kind,r.text??r.view?.text]),[['reasoning','**계획** 세우기\n\n검사 실행\n\n확인'],['message','완료했습니다']]);
});
test('a finished turn lists the files its edits changed, with line counts and a diff per file',async()=>{
 const {lineDiff,editChanges}=await import('./chat-presentation.mjs');
 assert.deepEqual(lineDiff('a\nb\nc','a\nB\nc\nd'),[' a','-b','+B',' c','+d']);
 const use=(id,name,input)=>({id:'u'+id,content:{role:'agent',content:{type:'output',data:{type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}}}}});
 const done=(id,err=false)=>({id:'r'+id,content:{role:'agent',content:{type:'output',data:{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:'ok',is_error:err}]}}}}});
 const ready=id=>({id,content:{role:'agent',content:{type:'event',data:{type:'ready'}}}});
 const user=(id,text)=>({id,content:{role:'user',content:{type:'text',text}}});
 const rows=chatTimeline([user('q1','고쳐줘'),use('e1','Edit',{file_path:'/p/a.mjs',old_string:'x=1',new_string:'x=2'}),done('e1'),use('e2','Edit',{file_path:'/p/a.mjs',old_string:'y',new_string:'y\nz'}),done('e2'),
  use('e3','Write',{file_path:'/p/new.md',content:'# 제목\n본문'}),done('e3'),use('e4','Edit',{file_path:'/p/fail.mjs',old_string:'a',new_string:'b'}),done('e4',true),ready('d1'),user('q2','다음')]);
 const card=rows.find(r=>r.kind==='changes');
 assert.deepEqual(card.files.map(f=>[f.path,f.kind,f.added,f.removed]),[['/p/a.mjs','update',2,1],['/p/new.md','write',2,0]]);
 assert.match(card.files[0].diff,/-x=1\n\+x=2/);
 assert.equal(rows.filter(r=>r.kind==='changes').length,1);assert.equal(rows.at(-1).kind,'message');
 assert.deepEqual(editChanges({name:'CodexPatch',state:'result',input:{changes:{'src/b.ts':{type:'update',unified_diff:'@@ -1 +1 @@\n-a\n+b'},'n.txt':{type:'add',content:'hi'}}}}).map(f=>[f.path,f.kind,f.added,f.removed]),[['src/b.ts','update',1,1],['n.txt','add',1,0]]);
});
