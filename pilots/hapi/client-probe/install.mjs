import {saveDeviceLogin,validServerId,deviceLabel} from './device-login.mjs';
// The QR link opens this page with a one-time pairing code in the fragment (never sent to the server).
// Chrome-family installs share the browser's storage, so we log in here and the installed app opens signed in.
// Apple WebKit (iPhone/iPad, Mac Safari) keeps installed apps' storage apart: keep the code for the installed app.
const $=id=>document.getElementById(id),code=/^#code=([A-Z0-9]{4}-[A-Z0-9]{4})$/.exec(location.hash)?.[1];
let installPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;if(code)$('pair-install').hidden=false;});
window.addEventListener('appinstalled',()=>{$('pair-install').hidden=true;$('pair-status').textContent='설치했습니다. 홈 화면이나 앱 목록의 Maricode를 열면 로그인된 상태로 시작합니다.';});
$('pair-install').onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();const {outcome}=await installPrompt.userChoice;installPrompt=null;$('pair-install').hidden=true;
 if(outcome!=='accepted')$('pair-status').textContent='설치를 취소했습니다. 브라우저 메뉴의 ‘앱 설치’로 다시 설치하거나 작업 화면을 바로 여세요.';};
const ua=navigator.userAgent,appleWebKit=/iPhone|iPad|iPod/.test(ua)||/Macintosh/.test(ua)&&navigator.maxTouchPoints>1||/Safari/.test(ua)&&!/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/.test(ua);
async function login(){
 const identity=await fetch('/api/server-identity',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
 const serverId=identity.ok?(await identity.json()).serverId:null;if(!validServerId(serverId))throw Error('서버 신원을 확인하지 못했습니다.');
 const r=await fetch('/api/pair',{method:'POST',headers:{'X-Merry-Protocol':'1','Content-Type':'application/json'},body:JSON.stringify({code,device:deviceLabel()}),signal:AbortSignal.timeout(15000)});
 const body=await r.json().catch(()=>({}));if(!r.ok||typeof body.token!=='string')throw Error(body.error??'로그인하지 못했습니다.');
 if(!saveDeviceLogin(localStorage,body.token,serverId,undefined,body.device))throw Error('이 브라우저에 로그인을 보관하지 못했습니다.');
}
if(code){
 window.history.replaceState(null,'',location.pathname);
 $('pair-code').textContent=code;$('pair').hidden=false;
 if(appleWebKit){
  $('pair-status').textContent='공유 → ‘홈 화면에 추가’(Mac은 파일 → ‘Dock에 추가’)로 설치한 뒤, 설치한 앱의 로그인 칸에 위 코드를 입력하세요. 설치하지 않으려면 아래에서 바로 여세요.';
  $('pair-open').href='/workspace#code='+code;$('pair-open').textContent='설치하지 않고 이 브라우저에서 로그인 →';
 }else{
  $('pair-status').textContent='로그인하는 중…';
  login().then(()=>{$('pair-code-line').hidden=true;$('pair-status').textContent='이 기기에 로그인했습니다. ‘앱 설치’를 누르거나 브라우저 메뉴의 ‘앱 설치’로 설치하면 설치한 앱도 로그인된 상태로 열립니다.';},
   e=>{$('pair-status').textContent=e.message+' 로그인 화면에 위 코드를 직접 입력하세요.';$('pair-open').href='/workspace#code='+code;});
 }
}
