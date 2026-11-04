import {icon} from './vendor/lucide.mjs';
import {chatTimeline,describeTool,editPreview,formatDuration} from './chat-presentation.mjs';
import {renderMarkdown,copyButton} from './markdown.mjs';
import {formatSize} from './attachments.mjs';
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const readable=v=>typeof v==='string'?v:JSON.stringify(v??null,null,2);
const rendered=new WeakMap();
export function renderEdit(input){
 const value=editPreview(input);if(!value)return null;
 const box=node('div','edit-preview');
 for(const [key,label] of [['before','변경 전'],['after','변경 후'],['patch','변경 내용']])if(typeof value[key]==='string'){
  const section=node('section',key);section.append(node('small','',label),node('pre','',value[key].slice(0,12000)+(value[key].length>12000?'\n… 표시 생략':'')));box.append(section);
 }
 return box;
}
export function renderTool(tool,open=false,root=null){
 const v=describeTool(tool),detail=node('details','activity-tool');detail.dataset.callId=tool.id;detail.open=open;
 // Project paths read better relative; the full value stays in the tooltip.
 const target=root&&v.summary.startsWith(root+'/')?v.summary.slice(root.length+1):v.summary,description=node('span','tool-description',target);description.title=v.summary;
 const summary=node('summary');summary.append(node('span','tool-kind',v.label),description,node('span','tool-state '+tool.state,v.status),node('time','',formatDuration(tool.duration)));detail.append(summary);
 if(tool.parent)detail.append(node('p','nested-label','하위 에이전트의 작업'));
 const plan=tool.input?.todos??tool.input?.plan;
 if(v.plan&&Array.isArray(plan)){
  const list=node('ul','plan-list');for(const p of plan){const item=node('li',p.status,` ${p.content??p.step??''}`);item.prepend(icon(p.status==='completed'?'circle-check':p.status==='in_progress'?'circle-dot':'circle'));list.append(item);}detail.append(list);
 }
 const edit=v.edit?renderEdit(tool.input):null;if(edit)detail.append(edit);
 const raw=node('details','activity-raw');raw.append(node('summary','','입력·결과 원문'),node('pre','',`입력\n${readable(tool.input).slice(0,12000)}\n\n결과\n${tool.state==='waiting'?'아직 결과가 전달되지 않았습니다.':readable(tool.output).slice(0,16000)}`));detail.append(raw);
 return detail;
}
// Two-step confirm survives re-renders: the first click arms one message, the second forks.
let armedFork=null,armedTimer=null;
function forkButton(localId,onFork){
 const b=document.createElement('button');b.type='button';b.className='copy-button fork-button';const armed=armedFork===localId;
 b.textContent=armed?'새 대화로 분기 확인 · 원래 대화·파일은 그대로':'여기서 분기';
 b.title='이 메시지 직전까지의 대화로 새 세션을 만듭니다. 파일 변경은 되돌리지 않습니다.';
 b.onclick=()=>{if(armedFork!==localId){armedFork=localId;clearTimeout(armedTimer);armedTimer=setTimeout(()=>{armedFork=null;},8000);b.textContent='새 대화로 분기 확인 · 원래 대화·파일은 그대로';return;}armedFork=null;onFork(localId);};
 return b;
}
export function renderConversation(container,messages,{engine,session,onFork}={}){
 const signature=JSON.stringify([session?.id,engine,messages,session?.agentState?.completedRequests,!!onFork,armedFork]);
 if(rendered.get(container)===signature)return;rendered.set(container,signature);
 const opened=new Set([...container.querySelectorAll('details[open]')].map(e=>e.dataset.key??e.dataset.callId));
 const nodes=chatTimeline(messages).map(row=>{
  if(row.kind==='command'){const box=node('section','cli-output'+(row.error?' error':''));box.append(node('small','',row.error?'Claude Code 명령 오류':'Claude Code 명령 결과'),node('pre','',row.text),copyButton(row.text,'명령 결과 복사'));return box;}
  if(row.kind==='duration')return node('p','turn-duration',row.text);
  if(row.kind==='notice'){return node('p','session-notice'+(row.error?' error':''),row.text);}
  if(row.kind==='activity'){
   const group=node('details','activity-group');group.dataset.key=row.key;group.open=opened.has(row.key);
   const failed=row.tools.filter(t=>t.state==='error').length,waiting=row.tools.filter(t=>t.state==='waiting').length;
   const labels=[...new Set(row.tools.map(t=>describeTool(t).label))];
   const heading=node('summary');heading.append(node('span','activity-dot '+(waiting?'waiting':failed?'error':'result')),node('span','',`${row.parent?'하위 작업 · ':''}${labels.join(' · ')} ${row.tools.length}건`),node('span','activity-summary',waiting?`${waiting}건 결과 대기`:failed?`${failed}건 실패`:'결과 수신'));group.append(heading);
   for(const tool of row.tools)group.append(renderTool(tool,opened.has(tool.id),session?.metadata?.path));return group;
  }
  const el=node('div',`bubble ${row.view.role}${row.parent?' child-message':''}`),label=node('small','message-byline',row.view.role==='user'?'나':row.parent?'하위 에이전트':engine??'에이전트');
  if(Number.isFinite(row.at)){const time=node('time','',new Date(row.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));time.title=new Date(row.at).toLocaleString('ko-KR');label.append(time);}
  el.append(label,row.view.role==='agent'?renderMarkdown(row.view.text):node('span','',row.view.text));
  if(Array.isArray(row.attachments))for(const a of row.attachments)el.append(node('span','sent-attachment',`▧ ${a.filename??'첨부파일'}${a.size?` · ${formatSize(a.size)}`:''}`));
  if(row.view.text)el.append(copyButton(row.view.text,row.view.role==='user'?'메시지 복사':'답변 복사'));
  if(onFork&&row.view.role==='user'&&row.localId&&!row.parent)el.append(forkButton(row.localId,onFork));return el;
 });
 const done=Object.values(session?.agentState?.completedRequests??{}).sort((a,b)=>(a.completedAt??0)-(b.completedAt??0)).slice(-3);
 if(done.length){const receipt=node('details','approval-receipts');receipt.append(node('summary','',`최근 확인 내역 ${done.length}건`));for(const r of done)receipt.append(node('p','',`${r.status==='denied'?'거절':r.status==='canceled'?'취소':r.status==='resolved'?'답변 처리':'허용'} · ${r.tool}${r.decision==='approved_for_session'||r.allowTools?.length?' · 세션 범위':''}`));nodes.push(receipt);}
 container.replaceChildren(...nodes);
}
