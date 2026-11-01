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
// Keep activity at the original call position, even when its result arrives
// after other messages. Never infer child-agent completion from spawn success.
export function chatTimeline(messages){
 const tools=new Map(toolViews(messages).map(t=>[t.id,{...t}])),seen=new Set(),rows=[];
 for(const m of messages){
  const d=m.content?.content?.data,parent=d?.parent_tool_use_id??d?.parentToolUseId??null;
  const ids=[];
  if(d?.type==='tool-call'||d?.type==='tool-call-result')ids.push({id:d.callId,result:d.type==='tool-call-result'});
  if(m.content?.content?.type==='output'&&Array.isArray(d?.message?.content))for(const b of d.message.content){if(b.type==='tool_use')ids.push({id:b.id});if(b.type==='tool_result')ids.push({id:b.tool_use_id,result:true});}
  const view=messageView(m);if(view)rows.push({kind:'message',key:m.id??m.seq,view,parent,at:m.createdAt,attachments:m.content?.content?.attachments??m.content?.meta?.attachments??[]});
  for(const ref of ids){
   const tool=tools.get(ref.id);if(!tool)continue;
   if(ref.result)tool.end=m.createdAt;else tool.start=m.createdAt;
   if(Number.isFinite(tool.start)&&Number.isFinite(tool.end)&&tool.end>=tool.start)tool.duration=tool.end-tool.start;
   if(seen.has(ref.id))continue;seen.add(ref.id);tool.parent=parent;
   const last=rows.at(-1);if(last?.kind==='activity'&&last.parent===parent)last.tools.push(tool);else rows.push({kind:'activity',key:'tool-'+ref.id,parent,tools:[tool]});
  }
  const duration=d?.duration_ms??d?.durationMs;
  if((d?.subtype==='turn_duration'||d?.type==='turn_duration')&&Number.isFinite(duration))rows.push({kind:'duration',key:m.id,text:`작업 시간 ${formatDuration(duration)}`});
 }
 return rows;
}
