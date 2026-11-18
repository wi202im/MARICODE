// In-app alerts from consecutive session snapshots: foreground and background work finished, or a
// new approval/question arrived. Only for conversations the user is not looking at. No message text.
const requests=s=>Object.keys(s?.agentState?.requests??{}).length;
export const sessionWorking=s=>s?.active===true&&(s.thinking===true||s.backgroundTaskCount>0);
export function turnAlerts(previous,next,{selectedId,visible}){
 const out=[];
 for(const [id,now] of next){
  const before=previous.get(id);if(!before||!now||id===selectedId&&visible)continue;
  if(requests(now)>requests(before))out.push({id,kind:'approval'});
  else if(sessionWorking(before)){
   if(now.active===false)out.push({id,kind:'stopped'});
   else if(now.active===true&&now.thinking===false&&!sessionWorking(now)&&!requests(now)
    &&(!(before.backgroundTaskCount>0)||now.backgroundTaskCount===0))out.push({id,kind:'done'});
  }
 }
 return out;
}
export const alertText={done:'작업 완료',approval:'승인·답변 대기',stopped:'작업 중 실행 종료'};
