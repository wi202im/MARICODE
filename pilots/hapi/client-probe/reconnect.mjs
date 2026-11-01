export function connectionFailure(error){return error?.status===426?'outdated':error?.status===401?'expired':[403,404].includes(error?.status)?'denied':'unavailable';}
// This scheduler is only for restoring configuration/session reads, never mutations.
export function createReadRecovery({read,onState,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}){
 let generation=0,timer=null,running=false,finished=false,attempt=0;
 async function start(){
  if(running||finished)return;
  if(timer!==null){cancel(timer);timer=null;}
  const mine=++generation;running=true;onState('restoring');
  try{await read();if(mine!==generation)return;finished=true;attempt=0;onState('ready');}
  catch(error){if(mine!==generation)return;const state=connectionFailure(error);onState(state);
   if(state==='unavailable'){const delay=Math.min(2000*2**attempt++,15000);timer=schedule(()=>{if(mine===generation&&!finished)return start();},delay);}
  }finally{if(mine===generation)running=false;}
 }
 return {start,stop(){generation++;running=false;finished=true;if(timer!==null)cancel(timer);timer=null;}};
}
