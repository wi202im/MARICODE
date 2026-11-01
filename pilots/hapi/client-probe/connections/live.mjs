import {createSSEDecoder} from '../core.mjs';
export function createSessionStream({origin,id,token,fetcher=fetch,read,onState=()=>{},onFailure=()=>{},schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout}){
 let stopped=false,started=false,controller,reader,timer,watchdog,attempt=0;
 const touch=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>controller?.abort(),60000);};
 async function sync(){while(!stopped){if(await read(controller.signal))return;await new Promise(resolve=>{const done=()=>{clearTimeout(t);controller.signal.removeEventListener('abort',done);resolve();};const t=setTimeout(done,100);controller.signal.addEventListener('abort',done,{once:true});});if(controller.signal.aborted)throw Error('Disconnected');}}
 async function connect(){
  if(stopped)return;controller=new AbortController();onState('connecting');touch();
  try{
   const response=await fetcher(`${origin}/api/events?sessionId=${encodeURIComponent(id)}`,{method:'GET',credentials:'omit',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
   if(stopped){await response.body?.cancel();return;}
   if(!response.ok||!response.body)throw Object.assign(Error('Stream unavailable'),{status:response.status});
   reader=response.body.getReader();await sync();if(stopped)return;onState('live');attempt=0;touch();
   let changed=false;const decoder=new TextDecoder(),parse=createSSEDecoder(event=>{if(event.type!=='heartbeat'&&event.sessionId===id)changed=true;});
   while(!stopped){const {done,value}=await reader.read();if(done)break;touch();parse(decoder.decode(value,{stream:true}));if(changed){changed=false;await sync();if(stopped)return;onState('live');}}
   if(!stopped)throw Error('Stream ended');
  }catch(error){if(stopped)return;if([401,403,404].includes(error.status)){stopped=true;onState(error.status===401?'expired':'denied');onFailure(error.status);return;}onState('reconnecting');timer=schedule(connect,Math.min(2000*2**attempt++,15000));}
  finally{clearTimeout(watchdog);controller?.abort();try{await reader?.cancel();}catch{}reader=null;}
 }
 return {start(){if(!started){started=true;void connect();}},stop(){stopped=true;cancel(timer);clearTimeout(watchdog);controller?.abort();void reader?.cancel().catch(()=>{});}};
}
