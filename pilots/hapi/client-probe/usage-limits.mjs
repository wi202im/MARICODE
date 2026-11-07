// Subscription usage limits as the official CLIs report them. Values are shown with their source and
// observation time; an unknown limit stays unknown (never 0%).
// Claude: HAPI 0.33.3 forwards rate_limit_event only for warning/reached, as assistant text
//   `Claude AI usage limit warning|<unix seconds>|<percent>|<type>` / `... reached|<unix seconds>|<type>`.
// Codex: the CLI's own rollout token_count `rate_limits` (read on the server, see codex-limits.mjs).
const labels={five_hour:'5시간 한도',seven_day:'주간 한도',seven_day_opus:'주간 Opus 한도',seven_day_sonnet:'주간 Sonnet 한도',overage:'추가 사용량 한도'};
export const limitLabel=type=>labels[type]??'사용량 한도';
export function windowLabel(minutes){
 if(!Number.isFinite(minutes)||minutes<=0)return '사용량 한도';
 if(minutes===10080)return '주간 한도';
 if(minutes%1440===0)return `${minutes/1440}일 한도`;
 return minutes%60===0?`${minutes/60}시간 한도`:`${minutes}분 한도`;
}
export function claudeLimitEvent(text){
 if(typeof text!=='string')return null;
 let m=/^Claude AI usage limit warning\|(\d{1,12})\|(\d{1,3})\|([\w-]*)$/.exec(text);
 if(m)return {agent:'claude',state:'warning',percent:Number(m[2]),resetsAt:Number(m[1])*1000,limitType:m[3],label:limitLabel(m[3])};
 m=/^Claude AI usage limit reached\|(\d{1,12})(?:\|([\w-]*))?$/.exec(text);
 if(m)return {agent:'claude',state:'reached',percent:null,resetsAt:Number(m[1])*1000,limitType:m[2]??'',label:limitLabel(m[2])};
 return null;
}
const agentText=m=>{const p=m?.content?.content;if(m?.content?.role!=='agent'||p?.type!=='output'||p.data?.type!=='assistant')return null;const c=p.data.message?.content;return Array.isArray(c)&&c.length===1&&c[0].type==='text'?c[0].text:typeof c==='string'?c:null;};
export const messageLimit=m=>claudeLimitEvent(agentText(m));
export function latestClaudeLimit(messages){
 for(let i=(messages?.length??0)-1;i>=0;i--){const e=messageLimit(messages[i]);if(e)return {...e,at:messages[i].createdAt??null};}
 return null;
}
function span(ms){
 const minutes=Math.max(1,Math.round(ms/60000)),d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60),m=minutes%60;
 return d?`${d}일${h?` ${h}시간`:''}`:h?`${h}시간${m?` ${m}분`:''}`:`${m}분`;
}
export function formatReset(at,now=Date.now(),{timeZone}={}){
 if(!Number.isFinite(at))return '확인 안 됨';
 if(at<=now)return '이미 지났습니다 · 다시 확인 필요';
 return `${formatMoment(at,now,{timeZone})} (약 ${span(at-now)} 후)`;
}
export function formatMoment(at,now=Date.now(),{timeZone}={}){
 if(!Number.isFinite(at))return '확인 안 됨';
 const o={timeZone},day=v=>new Date(v).toLocaleDateString('en-CA',o),time=new Date(at).toLocaleTimeString('ko-KR',{...o,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 return `${day(at)===day(now)?'오늘':new Date(at).toLocaleDateString('ko-KR',{...o,month:'long',day:'numeric',weekday:'short'})} ${time}`;
}
export function limitText(e,now=Date.now(),options){
 const reset=`초기화 ${formatReset(e.resetsAt,now,options)}`;
 return e.state==='reached'?`Claude ${e.label}에 도달했습니다 · ${reset}`:`Claude ${e.label} ${e.percent}% 사용 · ${reset}`;
}
