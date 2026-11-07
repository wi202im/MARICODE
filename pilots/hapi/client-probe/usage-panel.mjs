import {formatReset,formatMoment,windowLabel,latestClaudeLimit} from './usage-limits.mjs';
// Session-info view of subscription limits. Claude: only what HAPI forwarded in this conversation.
// Codex: the server's normalized read of this Mac's latest Codex record. Unknown is never shown as 0%.
export function usageLines({claude=null,codex=null,now=Date.now(),timeZone}={}){
 const o={timeZone},when=at=>formatMoment(at,now,o);
 const c=claude?{lines:[{text:claude.state==='reached'?`${claude.label}에 도달했습니다 · 초기화 ${formatReset(claude.resetsAt,now,o)}`:`${claude.label} ${claude.percent}% 사용 · 초기화 ${formatReset(claude.resetsAt,now,o)}`,tone:claude.resetsAt<=now?'stale':claude.state==='reached'?'reached':claude.percent>=80?'high':''}],note:`이 대화의 마지막 Claude 한도 알림${Number.isFinite(claude.at)?` · 받은 시각 ${when(claude.at)}`:''}`}
  :{lines:[],note:'Claude는 한도에 가까워지거나 도달했을 때만 알려 줍니다. 이 대화에서 받은 한도 알림이 없습니다.'};
 let x;
 if(codex?.state==='ok')x={lines:codex.windows.map(w=>w.resetsAt<=now?{text:`${windowLabel(w.windowMinutes)} · 기록 이후 초기화 시각이 지나 지금 사용량은 확인 안 됨`,tone:'stale'}:{text:`${windowLabel(w.windowMinutes)} ${Math.round(w.usedPercent)}% 사용 · 초기화 ${formatReset(w.resetsAt,now,o)}`,tone:w.usedPercent>=100?'reached':w.usedPercent>=80?'high':''}),
  note:`이 Mac의 최근 Codex 기록 기준${codex.plan?` · 요금제 ${codex.plan}`:''}${Number.isFinite(codex.observedAt)?` · 기록 시각 ${when(codex.observedAt)}`:''}`};
 else x={lines:[],note:{'no-records':'Codex 기록에서 한도 정보를 찾지 못했습니다. Codex로 대화하면 기록됩니다.','connection-required':'Codex CLI 연결을 확인한 뒤 표시합니다.'}[codex?.state]??'Codex 한도를 불러오지 못했습니다 · 확인 안 함'};
 return {claude:c,codex:x};
}
export function createUsagePanel({root,api,messages}){
 if(!root)return null;
 const list=document.createElement('div'),refresh=document.createElement('button');let codex=null,loadedAt=0,loading=null,owner=null;
 refresh.type='button';refresh.textContent='Codex 한도 다시 확인';refresh.className='usage-refresh';root.append(list,refresh);
 function render(){
  const view=usageLines({claude:latestClaudeLimit(messages()),codex});list.replaceChildren();
  for(const [name,part] of [['Claude',view.claude],['Codex',view.codex]]){
   const box=document.createElement('div');box.className='usage-agent';const title=document.createElement('strong');title.textContent=name;box.append(title);
   for(const line of part.lines){const p=document.createElement('p');p.className='usage-line'+(line.tone?' '+line.tone:'');p.textContent=line.text;box.append(p);}
   const note=document.createElement('small');note.textContent=part.note;box.append(note);list.append(box);
  }
  refresh.disabled=!!loading;
 }
 async function load(force=false,token){
  if(loading||!force&&owner===token&&Date.now()-loadedAt<60000)return render();
  const mine=loading=api('/api/usage-limits').then(r=>{if(loading===mine){codex=r?.codex??null;loadedAt=Date.now();owner=token;}},()=>{if(loading===mine)codex=null;}).finally(()=>{if(loading===mine)loading=null;render();});
  render();return mine;
 }
 refresh.onclick=()=>load(true,owner);
 return {render,load,clear(){codex=null;loadedAt=0;owner=null;loading=null;render();}};
}
