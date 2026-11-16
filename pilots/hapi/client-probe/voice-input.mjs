// Recognition produces a draft only. It never owns a chat-send capability.
export function createVoiceDraft({context,read,write,state,adapter}){
 let current=null;
 const finish=(run,message)=>{
  if(current!==run)return;
  current=null;
  if(!message&&run.text.trim()&&context()===run.session&&read()===run.draft)write(run.draft+(run.draft.trim()?'\n':'')+run.text.trim());
  else if(!message&&run.text.trim())message='입력 대상이 바뀌었습니다. 음성 입력을 다시 시작해 주세요.';
  state({active:false,message:message??(run.text.trim()?'음성을 초안에 추가했습니다. 내용을 확인한 뒤 보내세요.':'음성을 인식하지 못했습니다.')});
 };
 return {
  get active(){return !!current;},
  start(){
   if(current||!context())return;
   const run={session:context(),draft:read(),text:''};current=run;state({active:true,text:'',message:'마이크 준비 중…'});
   try{run.adapter=adapter(event=>{
    if(current!==run)return;
    if(event.type==='result'){run.text=String(event.text??'').slice(0,20000);state({active:true,text:run.text,message:'듣는 중 · 마이크를 다시 누르면 초안에 추가합니다.'});}
    if(event.type==='ready')state({active:true,text:run.text,message:'듣는 중 · 마이크를 다시 누르면 초안에 추가합니다.'});
    if(event.type==='error'){finish(run,event.message??'음성 인식에 실패했습니다.');run.adapter?.abort();}
    if(event.type==='end')finish(run);
   });run.adapter.start();}catch{finish(run,'음성 입력을 시작하지 못했습니다. 마이크 권한과 지원 여부를 확인하세요.');run.adapter?.abort();}
  },
  stop(){const run=current;if(!run||run.stopping)return;run.stopping=true;try{run.adapter.stop();}catch{finish(run,'음성 입력을 종료하지 못했습니다.');run.adapter?.abort();}},
  cancel(){const run=current;if(!run)return;current=null;run.adapter?.abort();state({active:false,message:'음성 입력을 취소했습니다. 기존 입력은 유지됩니다.'});}
 };
}
const errors={'aborted':'브라우저가 음성 인식을 취소했습니다 (aborted). 마이크를 사용하는 다른 앱을 닫고 이 화면에서 다시 시작하세요. 계속되면 기기 키보드의 받아쓰기를 이용하세요.','not-allowed':'마이크 또는 음성 인식 권한이 거부됐습니다. 기기 설정에서 확인하세요.','audio-capture':'사용할 수 있는 마이크가 없습니다.','network':'음성 인식 연결이 끊겼습니다. 다시 시작해 주세요.','no-speech':'음성이 들리지 않았습니다.','language-not-supported':'한국어 음성 인식을 지원하지 않습니다.','service-not-allowed':'이 브라우저에서는 음성 인식을 사용할 수 없습니다.'};
export function browserVoiceAdapter(Recognition,emit){
 const r=new Recognition();r.lang='ko-KR';r.continuous=true;r.interimResults=true;let ended=false,stopping=false,timer;
 const end=()=>{if(ended)return;ended=true;clearTimeout(timer);emit({type:'end'});};
 r.onstart=()=>{if(!ended)emit({type:'ready'});};
 r.onresult=e=>{if(!ended)emit({type:'result',text:Array.from(e.results).map(x=>x[0]?.transcript??'').join(' ')});};
 r.onerror=e=>{if(ended)return;if(stopping&&e.error==='aborted'){end();return;}ended=true;clearTimeout(timer);emit({type:'error',message:errors[e.error]??'브라우저 음성 인식에서 알 수 없는 오류가 발생했습니다. 기기 키보드의 받아쓰기를 이용하세요.'});};r.onend=end;
 return {start:()=>r.start(),stop(){if(ended||stopping)return;stopping=true;r.stop();if(!ended)timer=setTimeout(()=>{ended=true;try{r.abort();}catch{}clearTimeout(timer);emit({type:'end'});},2000);},abort(){ended=true;clearTimeout(timer);r.abort();}};
}
export function setupVoiceInput({form,prompt,context,changed,window:win=window,document:doc=document}){
 const bridge=win.webkit?.messageHandlers?.maricode,Recognition=win.SpeechRecognition??win.webkitSpeechRecognition;
 const button=doc.createElement('button');button.type='button';button.id='voice-input';button.title='음성 입력';button.setAttribute('aria-label','음성 입력 시작');button.setAttribute('aria-pressed','false');
 button.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
 const status=doc.createElement('div');status.className='voice-status';status.hidden=true;status.setAttribute('role','status');
 const label=doc.createElement('span'),preview=doc.createElement('span'),cancel=doc.createElement('button');cancel.type='button';cancel.textContent='취소';status.append(label,preview,cancel);form.before(status);
 form.querySelector('.composer-footer').insertBefore(button,form.querySelector('.composer-options'));
 let native=null,deadline=null;
 const adapter=emit=>{
  if(!bridge)return browserVoiceAdapter(Recognition,emit);
  const id=win.crypto.randomUUID();native={id,emit};
  return {start:()=>bridge.postMessage('voice-start:'+id),stop:()=>bridge.postMessage('voice-stop:'+id),abort(){if(native?.id===id)native=null;bridge.postMessage('voice-cancel:'+id);}};
 };
 const voice=createVoiceDraft({context,read:()=>prompt.value,write:value=>{prompt.value=value;prompt.dispatchEvent(new Event('input',{bubbles:true}));},adapter,state:s=>{
  status.hidden=false;label.textContent=s.message;preview.textContent=s.text??'';cancel.hidden=!s.active;button.setAttribute('aria-pressed',String(s.active));button.setAttribute('aria-label',s.active?'음성 입력 마치기':'음성 입력 시작');prompt.readOnly=s.active;
  if(s.active&&!deadline)deadline=setTimeout(()=>voice.stop(),60000);else if(!s.active){clearTimeout(deadline);deadline=null;native=null;}changed();
 }});
 win.maricodeVoiceEvent=e=>{if(native?.id===e?.id)native.emit(e);};
 button.onclick=()=>{
  if(voice.active){voice.stop();return;}
  if(!context()){status.hidden=false;label.textContent='대화를 선택한 뒤 음성 입력을 시작하세요.';return;}
  if(!bridge&&(!Recognition||!win.isSecureContext)){status.hidden=false;label.textContent='이 환경은 음성 입력을 지원하지 않습니다. 기기 키보드의 받아쓰기를 이용하세요.';return;}
  if(!bridge&&!win.confirm('브라우저 음성 인식은 음성을 외부 인식 서비스로 보낼 수 있습니다. 회사·민감한 내용에는 사용하지 마세요. 한국어 음성 입력을 시작할까요?'))return;
  voice.start();
 };
 cancel.onclick=()=>voice.cancel();
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)voice.cancel();});win.addEventListener('pagehide',()=>voice.cancel());
 form.addEventListener('submit',e=>{if(voice.active){e.preventDefault();e.stopImmediatePropagation();label.textContent='음성 입력을 먼저 마친 뒤 내용을 확인하고 보내세요.';}},true);
 return voice;
}
