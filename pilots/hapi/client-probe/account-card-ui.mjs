// Authentication stays in the official CLI/browser. This card stores only an uncertain-start marker.
export function createAccountCardControls({agent,api,storage,valid=()=>true,settings,back,changed=()=>{},document:doc=globalThis.document}){
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
 const element=el('section'),status=el('p'),login=el('button','공식 로그인 시작'),check=el('button','로그인 완료 확인'),configure=el('button','CLI 연결 설정'),returnButton=el('button','대화로 돌아가기');
 element.className='chat-account-controls';status.setAttribute('role','status');
 for(const b of [login,check,configure,returnButton])b.type='button';
 element.append(status,el('small','공식 로그인 화면에서만 인증하세요. 암호·코드는 채팅에 넣지 마세요. 로그인 확인은 현재 대화의 MCP 연결 확인과 별개입니다.'),login,check,configure,returnButton);
 const key=`maricode-chat-login:${agent}`;let uncertain=false;try{uncertain=storage?.getItem(key)==='pending';}catch{}
 let busy=false,provider=null,local=false;
 function mark(value){uncertain=value;try{if(value)storage?.setItem(key,'pending');else storage?.removeItem(key);}catch{}}
 function sync(){login.hidden=provider?.state==='connected';login.disabled=busy||!valid()||!local||provider?.state!=='signed-out'||!!provider?.loginPending||uncertain;check.disabled=busy;configure.disabled=busy||!!provider?.loginPending||uncertain;returnButton.disabled=busy;changed();}
 function show(){const labels={connected:'구독 로그인 확인. 대화로 돌아가 이어서 작업할 수 있습니다.','signed-out':'로그인이 필요합니다.','other-auth':'다른 인증 방식을 사용 중입니다. 기존 인증을 자동으로 바꾸지 않습니다.','connection-required':'기존 CLI 설정을 먼저 연결하세요.','not-installed':'CLI 실행 파일을 찾지 못했습니다.','not-configured':'CLI 연결 설정이 필요합니다.'};status.textContent=uncertain?'로그인 시작 결과가 미확인입니다. 공식 창을 확인한 뒤 완료 상태만 다시 조회하세요.':provider?.loginPending?'공식 로그인 진행 중입니다. 창에서 인증을 마친 뒤 로그인 완료 확인을 누르세요.':labels[provider?.state]??'로그인 상태를 확인하지 못했습니다.';}
 async function load(){if(busy||!valid())return;busy=true;sync();status.textContent='공식 CLI 로그인 상태 확인 중…';try{const data=await api('/api/accounts');if(!valid())return;local=data.localLogin===true;provider=data.providers?.find(p=>p.agent===agent)??null;if(provider?.state==='connected'||provider?.loginPending||provider?.loginPhase==='finished')mark(false);show();}catch{if(valid()){provider=null;status.textContent='로그인 상태를 확인하지 못했습니다. 다시 조회하세요.';}}finally{busy=false;sync();}}
 login.onclick=async()=>{if(login.disabled||!valid())return;busy=true;mark(true);sync();status.textContent='공식 로그인 창을 여는 중…';try{const result=await api(`/api/accounts/${agent}/login`,{method:'POST',body:{}});if(!valid())return;provider=result;mark(false);show();}catch(e){if(valid()){if(e.rejected){mark(false);provider=null;status.textContent=e.message;}else show();}}finally{busy=false;sync();}};
 check.onclick=load;configure.onclick=()=>{if(!configure.disabled&&valid())settings?.();};returnButton.onclick=()=>{if(!returnButton.disabled&&valid())back?.();};
 sync();return {element,load,get busy(){return busy;}};
}
