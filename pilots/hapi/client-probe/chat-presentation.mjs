import {messageView} from './core.mjs';
import {toolViews} from './workflow.mjs';
export function formatDuration(ms){if(!Number.isFinite(ms)||ms<0)return '';const s=Math.floor(ms/1000);return s<60?`${s}초`:`${Math.floor(s/60)}분 ${s%60}초`;}
export function editPreview(input){
 if(typeof input?.old_string==='string'&&typeof input?.new_string==='string')return {before:input.old_string,after:input.new_string};
 if(typeof input?.content==='string')return {after:input.content};
 const patch=typeof input==='string'?input:input?.patch??input?.diff;
 return typeof patch==='string'?{patch}:null;
}
export function describeTool(tool){
 const name=(tool.name??'').split(/[.:/]/).at(-1),input=tool.input??{};
 const agent=/^(Agent|Task|spawn_agent|wait_agent|send_message|close_agent)$/i.test(name);
 const edit=/^(Edit|Write|MultiEdit|apply_patch|file_change|CodexPatch)$/i.test(name);
 const plan=/^(TodoWrite|update_plan)$/i.test(name);
 const label=agent?'하위 에이전트':edit?'파일 수정':plan?'작업 계획':/read|glob|grep|search/i.test(name)?'파일·자료 확인':/bash|shell|exec_command|terminal/i.test(name)?'명령 실행':tool.name??'도구';
 const dispatch=agent&&(name==='spawn_agent'||input.run_in_background===true);
 const status=tool.state==='error'?'실패':tool.state==='waiting'?'결과 대기':dispatch?'시작 요청 처리됨':'결과 수신';
 const summary=input.description??input.file_path??input.path??input.command??input.cmd??input.message??input.prompt??(plan?'작업 항목 갱신':tool.name??'도구');
 return {label,status,agent,edit,plan,summary:typeof summary==='string'?summary.slice(0,240):JSON.stringify(summary).slice(0,240)};
}
// HAPI reports engine launch failures only as session events (claudeRemoteLauncher); dropping them hid retries behind '접수 확인'.
function noticeText({type,message}){
 const m=message.trim(),dropped=/^Process exited unexpectedly \d+ times in a row: ([\s\S]*?)\. Dropping the queued message/.exec(m),failed=/^Process exited unexpectedly: ([\s\S]*)/.exec(m);
 if(dropped)return {error:true,text:`엔진 실행이 연속으로 실패해 대기 중인 메시지를 보내지 못했습니다(${dropped[1]}). 로그인·설치 상태를 확인한 뒤 다시 보내 주세요.`};
 if(failed)return {error:true,text:`엔진 실행 실패 — 다시 시도합니다(${failed[1]}).`};
 if(type==='error')return {error:true,text:`엔진 오류: ${m}`};
 return {error:false,text:m==='Aborted by user'?'사용자가 중단했습니다.':m};
}
// Claude emits local command results on the user-shaped engine channel. These
// are CLI output, not another human prompt; never render the tags as HTML.
function commandOutput(message){
 const e=message?.content,p=e?.content,d=p?.data;
 let content;
 if(e?.role==='agent'&&p?.type==='output'&&(d?.type==='user'||d?.type==='assistant'&&e.meta?.sentFrom==='cli')){
  if(d.isMeta||d.isSynthetic||d.isCompactSummary)return null;
  content=d.message?.content;
 }else if(e?.role==='user'&&e.meta?.sentFrom==='cli')content=typeof p==='string'?p:p?.type==='text'?p.text:null;
 else return null;
 const text=typeof content==='string'?content:Array.isArray(content)&&content.every(b=>b.type==='text'&&typeof b.text==='string')?content.map(b=>b.text).join('\n'):'';
 const tag=/<(local-command-stdout|local-command-stderr|command-name|local-command-name|command-args|command-message)>([\s\S]*?)<\/\1>/g;
 const parts=[...text.matchAll(tag)];if(!parts.length||text.replace(tag,'').trim())return null;
 const clean=value=>value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
 const output=parts.filter(p=>p[1]==='local-command-stdout'||p[1]==='local-command-stderr');
 const chosen=output.length?output:parts.filter(p=>p[1]!=='command-message');
 const rendered=chosen.map(p=>clean(p[2]).trim()).filter(Boolean).join(output.length?'\n':' ');
 return rendered?{text:rendered,error:output.some(p=>p[1]==='local-command-stderr')}:null;
}
// Keep activity at the original call position, even when its result arrives
// after other messages. Never infer child-agent completion from spawn success.
export function chatTimeline(messages){
 const tools=new Map(toolViews(messages).map(t=>[t.id,{...t}])),seen=new Set(),rows=[];
 for(const m of messages){
  const d=m.content?.content?.data,parent=d?.parent_tool_use_id??d?.parentToolUseId??null;
  const ids=[];
  if(d?.type==='tool-call'||d?.type==='tool-call-result')ids.push({id:d.callId,result:d.type==='tool-call-result'});
  if(m.content?.content?.type==='output'&&Array.isArray(d?.message?.content))for(const b of d.message.content){if(b.type==='tool_use')ids.push({id:b.id});if(b.type==='tool_result')ids.push({id:b.tool_use_id,result:true});}
  const command=commandOutput(m);if(command)rows.push({kind:'command',key:m.id??m.seq,parent,at:m.createdAt,...command});
  const view=command?null:messageView(m);if(view)rows.push({kind:'message',key:m.id??m.seq,localId:typeof m.localId==='string'?m.localId:null,view,parent,at:m.createdAt,attachments:m.content?.content?.attachments??m.content?.meta?.attachments??[]});
  for(const ref of ids){
   const tool=tools.get(ref.id);if(!tool)continue;
   if(ref.result)tool.end=m.createdAt;else tool.start=m.createdAt;
   if(Number.isFinite(tool.start)&&Number.isFinite(tool.end)&&tool.end>=tool.start)tool.duration=tool.end-tool.start;
   if(seen.has(ref.id))continue;seen.add(ref.id);tool.parent=parent;
   const last=rows.at(-1);if(last?.kind==='activity'&&last.parent===parent)last.tools.push(tool);else rows.push({kind:'activity',key:'tool-'+ref.id,parent,tools:[tool]});
  }
  const event=m.content?.content?.type==='event',note=event&&d?.type==='compact-summary'?{error:false,text:'대화를 요약해 컨텍스트를 줄였습니다. 이후 대화는 요약을 바탕으로 이어집니다.'}:event&&['message','error'].includes(d?.type)&&typeof d.message==='string'?noticeText(d):null;
  if(note&&!(rows.at(-1)?.kind==='notice'&&rows.at(-1).text===note.text))rows.push({kind:'notice',key:m.id??m.seq,...note});
  const duration=d?.duration_ms??d?.durationMs;
  if((d?.subtype==='turn_duration'||d?.type==='turn_duration')&&Number.isFinite(duration))rows.push({kind:'duration',key:m.id,text:`작업 시간 ${formatDuration(duration)}`});
 }
 return rows;
}
// Latest engine-reported context size for the parent conversation (sub-agent usage excluded).
// Claude: last assistant usage (input + cache + output; context_window when HAPI reports it).
// Codex: token_count `last` turn total with modelContextWindow. Unknown stays null, never 0.
export function contextUsage(messages){
 const n=v=>Number.isFinite(v)?v:0;
 for(let i=(messages?.length??0)-1;i>=0;i--){
  const c=messages[i]?.content?.content,d=c?.data;
  // hapi.usage.v1 token_count is also emitted for Claude (e.g. after /compact) with contextTokens.
  const used=c?.type==='codex'&&d?.type==='token_count'?d.info?.contextTokens??d.info?.last?.totalTokens:undefined;
  if(Number.isFinite(used))return {used,window:Number.isFinite(d.info.modelContextWindow)?d.info.modelContextWindow:null};
  const u=c?.type==='output'&&d?.type==='assistant'&&!d.parent_tool_use_id&&!d.isSidechain?d.message?.usage:null;
  if(u&&Number.isFinite(u.input_tokens))return {used:n(u.input_tokens)+n(u.cache_creation_input_tokens)+n(u.cache_read_input_tokens)+n(u.output_tokens),window:Number.isFinite(u.context_window)?u.context_window:null};
 }
 return null;
}
