// In-app turn alerts from consecutive session snapshots: a turn finished (thinking → idle) or a
// new approval/question arrived. Only for conversations the user is not looking at. No message text.
const requests=s=>Object.keys(s?.agentState?.requests??{}).length;
export function turnAlerts(previous,next,{selectedId,visible}){
 const out=[];
 for(const [id,now] of next){
  const before=previous.get(id);if(!before||!now||id===selectedId&&visible)continue;
  if(requests(now)>requests(before))out.push({id,kind:'approval'});
  else if(before.thinking===true&&now.thinking===false&&now.active!==false)out.push({id,kind:'done'});
  else if(before.active===true&&now.active===false&&before.thinking===true)out.push({id,kind:'stopped'});
 }
 return out;
}
export const alertText={done:'작업 완료',approval:'승인·답변 대기',stopped:'작업 중 실행 종료'};
