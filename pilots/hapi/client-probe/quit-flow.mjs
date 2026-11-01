import {archiveSnapshot,archiveMatches} from './core.mjs';
const idle=s=>s.active===true&&s.thinking===false&&s.agentState?.controlledByUser===false&&!Object.keys(s.agentState?.requests??{}).length;
export function createQuitFlow({list,read,archive,finish,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let busy=false,plan=null,uncertain=false;
 async function active(){const ids=await list();if(!Array.isArray(ids)||ids.length>500)throw Error('세션 목록을 확인하지 못했습니다.');const rows=await Promise.all([...new Set(ids)].map(read));if(rows.some(s=>!s||typeof s.active!=='boolean'))throw Error('세션 상태를 확인하지 못했습니다.');return rows.filter(s=>s.active);}
 return {async review(){
  if(busy||uncertain)throw Error('이전 종료 결과를 먼저 확인하세요. 종료 요청은 반복하지 않습니다.');
  const rows=await active();if(rows.some(s=>!idle(s)))throw Error('답변 작성·승인 대기·직접 제어 중인 세션을 먼저 정리한 뒤 닫아 주세요.');
  plan={sessions:rows.map(s=>({...archiveSnapshot(s.id,s),label:s.metadata?.summary?.text??s.metadata?.name??s.id,agent:s.metadata?.flavor??'AI'}))};return plan;
 },async confirm(approved){
  if(busy||uncertain||!plan||approved!==plan)throw Error('종료 대상을 다시 확인하세요.');
  busy=true;plan=null;
  try{
   const rows=await active();
   if(rows.length!==approved.sessions.length||rows.some(s=>!idle(s)||!approved.sessions.some(p=>archiveMatches(p,s.id,s))))throw Error('확인하는 동안 세션 상태가 바뀌었습니다. 다시 확인해 주세요.');
   for(const p of approved.sessions){
    const state=await read(p.id);if(!idle(state)||!archiveMatches(p,p.id,state))throw Error('세션 상태가 바뀌어 종료를 중단했습니다.');
    uncertain=true;await archive(p.id,{requestId:crypto.randomUUID(),expected:p.expected});
    let ended=false;for(let i=0;i<20;i++){const s=await read(p.id);if(s.active===false){ended=true;break;}await wait(500);}
    if(!ended)throw Error('종료 요청 후 실행 종료를 확인하지 못했습니다. 상태를 확인해 주세요.');uncertain=false;
   }
   if((await active()).length)throw Error('새 활성 세션이 있어 앱을 닫지 않았습니다.');
   await finish();
  }finally{busy=false;}
 }};
}
