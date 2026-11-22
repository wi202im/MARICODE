// The bottom notice line. Plain notices stay until replaced (errors, checks, unconfirmed results);
// { fade: true } is for simple confirmations and clears itself so it does not keep covering the screen.
export function createNotice(el,{delay=6000,setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout}={}){
 let timer=null;
 return function notice(text,{fade=false}={}){
  clearTimer(timer);timer=null;el.textContent=text;
  if(fade&&text)timer=setTimer(()=>{timer=null;if(el.textContent===text)el.textContent='';},delay);
 };
}
