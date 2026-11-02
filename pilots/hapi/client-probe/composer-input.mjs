// Keep keyboard sends on the same submit path as the send button.
export function bindComposerEnter({input,form,button,now=()=>performance.now()}){
 let composing=false,endedAt=-Infinity;
 input.addEventListener('compositionstart',()=>{composing=true;});
 input.addEventListener('compositionend',()=>{composing=false;endedAt=now();});
 input.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.shiftKey||event.altKey||event.repeat||event.defaultPrevented)return;
  // WebKit can report compositionend before the Enter key that confirmed it.
  if(composing||event.isComposing||event.keyCode===229||now()-endedAt<100)return;
  if(input.disabled||button.disabled||!input.value.trim())return;
  event.preventDefault();form.requestSubmit(button);
 });
}
