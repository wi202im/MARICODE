// User tasks, written the way a person would try them. Each step names what the person wants;
// the runner records clicks, whether the screen visibly reacted, errors and a screenshot.
import {ids} from './fake-hub.mjs';
// The pinned summary is a non-interactive visual copy; elementFromPoint intentionally sees through it.
async function expectPinnedPrompt(ui){
 const visible=await ui.evaluate("(()=>{const e=document.querySelector('.pinned-prompt'),s=document.getElementById('conversation-history');if(!e||e.hidden)return false;const r=e.getBoundingClientRect(),b=s.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.width>20&&r.height>20&&r.height<140&&Math.abs(r.top-b.top)<2;})()");
 if(!visible)throw Error('상단 요약이 보이는 위치에 없음');return {changes:1};
}
export const scenarios=[
 {name:'공통 레이아웃과 패널 너비 조절',goal:'데스크톱 패널을 조절하고 모바일에서도 같은 제목과 패널 탐색을 유지한다',session:ids.claude,steps:[
  ['양쪽 패널을 열고 왼쪽 경계 드래그',async ui=>{await ui.click('#info-tab');const p=JSON.parse(await ui.evaluate("(()=>{const r=document.querySelector('.panel-resizer-left').getBoundingClientRect();return JSON.stringify({x:r.x+3,y:r.y+100});})()"));await ui.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await ui.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+60,y:p.y,button:'left',buttons:1});await ui.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+60,y:p.y,button:'left',clickCount:1});if(!await ui.evaluate("document.getElementById('sidebar').getBoundingClientRect().width>=310"))throw Error('왼쪽 너비 변경 실패');return {changes:1};}],
  ['오른쪽 경계 키보드 조절',async ui=>{await ui.evaluate("document.querySelector('.panel-resizer-right').focus();true");await ui.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft'});await ui.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft'});if(!await ui.evaluate("document.getElementById('inspector').getBoundingClientRect().width>=330"))throw Error('오른쪽 너비 변경 실패');return {changes:1};}],
  ['오른쪽 경계 드래그',async ui=>{const p=JSON.parse(await ui.evaluate("(()=>{const r=document.querySelector('.panel-resizer-right').getBoundingClientRect();return JSON.stringify({x:r.x+3,y:r.y+140});})()"));await ui.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await ui.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x-30,y:p.y,button:'left',buttons:1});await ui.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x-30,y:p.y,button:'left',clickCount:1});if(!await ui.evaluate("document.getElementById('inspector').getBoundingClientRect().width>=360"))throw Error('오른쪽 드래그 실패');return {changes:1};}],
  ['다시 열어 너비 복원',async ui=>{await ui.evaluate("location.reload();true");await ui.wait(800);await ui.login();await ui.wait(1200);await ui.click('#info-tab');if(!await ui.evaluate("document.getElementById('sidebar').getBoundingClientRect().width>=310&&document.getElementById('inspector').getBoundingClientRect().width>=330"))throw Error('너비 복원 실패');return {changes:1};}],
  ['좁은 데스크톱에서 대화 너비 확보',async ui=>{await ui.send('Emulation.setDeviceMetricsOverride',{width:800,height:880,deviceScaleFactor:1,mobile:false});await ui.wait(300);if(!await ui.evaluate("document.querySelector('.conversation').getBoundingClientRect().width>=319"))throw Error('대화 영역이 너무 좁음');return {changes:1};}],
  ['모바일 상세에서도 제목과 탐색 유지',async ui=>{await ui.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await ui.wait(300);await ui.expectVisible('#open-nav');await ui.expectVisible('#info-tab');await ui.expectVisible('#back-chat');if(!await ui.evaluate("document.documentElement.scrollWidth<=innerWidth&&document.getElementById('inspector').getBoundingClientRect().width<=innerWidth"))throw Error('모바일 가로 넘침');return {changes:1};}],
  ['모바일 프로젝트와 대화로 돌아가기',async ui=>{await ui.click('#back-chat');await ui.click('#open-nav');await ui.expectVisible('#search');await ui.click('#close-nav');await ui.expectVisible('#prompt');return {changes:1};}],
  ['로컬 창에서도 조절 경계 유지',async ui=>{await ui.send('Emulation.setDeviceMetricsOverride',{width:1400,height:880,deviceScaleFactor:1,mobile:false});await ui.evaluate("document.body.classList.add('maricode-desktop');true");await ui.wait(300);await ui.expectVisible('.panel-resizer-left');return {changes:1};}]]},
 {name:'원격 앱을 다시 열어 같은 대화 읽기',goal:'기기 로그인을 유지한 새 창에서도 마지막 선택한 대화로 돌아온다',steps:[
  ['기기 로그인으로 작업 화면 열기',async ui=>{const {code}=globalThis.uxPairing.issue();await ui.evaluate(`location.href='/install#code=${code}';true`);await ui.wait(1500);await ui.click('#pair-open');await ui.wait(1500);if(!await ui.evaluate("document.getElementById('login').hidden&&!!localStorage.getItem('merry-device-login-v1')"))throw Error('기기 로그인 실패');return {changes:1};}],
  ['첫 번째가 아닌 대화 선택',async ui=>{await ui.evaluate(`(()=>{const s=document.getElementById('session-select');s.value=${JSON.stringify(ids.codex)};s.dispatchEvent(new Event('change'));return true;})()`);await ui.wait(1200);if(!await ui.evaluate(`document.getElementById('session-select').value===${JSON.stringify(ids.codex)}`))throw Error('대화 선택 실패');return {changes:1};}],
  ['앱 창이 사라진 상태로 다시 열기',async ui=>{await ui.evaluate("sessionStorage.clear();location.replace('/workspace');true");await ui.wait(2000);if(!await ui.evaluate(`document.getElementById('login').hidden&&document.getElementById('session-select').value===${JSON.stringify(ids.codex)}`))throw Error('다시 열 때 대상 대화가 변경됨');return {changes:1};}],
  ['재연결 후에도 같은 대화 유지',async ui=>{await ui.evaluate("document.dispatchEvent(new Event('visibilitychange'));true");await ui.wait(1200);if(!await ui.evaluate(`document.getElementById('session-select').value===${JSON.stringify(ids.codex)}`))throw Error('복귀 시 대상 변경');return {changes:1};}]]},
 {name:'연결하고 대화 열기',goal:'처음 화면에서 로그인하고 원하는 대화를 연다',steps:[
  ['토큰 입력칸 찾기',ui=>ui.click('#token')],['토큰 입력',ui=>ui.type('ux')],['연결 누르기',ui=>ui.click('연결')],
  ['목록에서 “파일 뷰어 탭 만들기” 열기',ui=>ui.click('파일 뷰어 탭 만들기')]]},
 {name:'긴 요청을 위에 고정해 읽기',goal:'긴 사용자 요청이 대화 위에 걸려도 스크롤 위치와 메시지 높이가 흔들리지 않는다',session:ids.claude,steps:[
  ['좁은 화면에서 긴 요청 읽기',async ui=>{await ui.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});const touch=await ui.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});if(touch.error)throw Error('터치 에뮬레이션 실패');const version=await ui.send('Browser.getVersion');await ui.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Test Device) AppleWebKit/537.36 (KHTML, like Gecko) '+version.result.product.replace('HeadlessChrome/','Chrome/')+' Mobile Safari/537.36',platform:'Android'});await ui.evaluate("(()=>{const s=document.getElementById('conversation-history'),b=s.querySelector('.bubble.user');b.querySelector(':scope > span').textContent=Array.from({length:24},(_,i)=>'긴 요청 '+i+' — 이 대화의 스크롤 위치가 유지되는지 확인합니다.').join('\\n');const tail=document.createElement('div');tail.style.height='2000px';document.getElementById('messages').append(tail);s.scrollTop=0;return true;})()");await ui.wait(300);return {changes:1};}],
  ['요청이 위에 걸리는 위치로 스크롤',async ui=>{await ui.evaluate("(()=>{const s=document.getElementById('conversation-history'),b=s.querySelector('.bubble.user');window.__stickyHeight=b.getBoundingClientRect().height;s.scrollTop+=b.getBoundingClientRect().top-s.getBoundingClientRect().top+2;return true;})()");return {changes:1};}],
  ['손을 떼면 대화가 안정적으로 유지됨',async ui=>{const result=await ui.evaluate("(async()=>{const s=document.getElementById('conversation-history'),b=s.querySelector('.bubble.user'),samples=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);samples.push({top:s.scrollTop,height:b.getBoundingClientRect().height,stuck:b.classList.contains('stuck')});}return JSON.stringify(samples);})()");const rows=JSON.parse(result).slice(10);const before=await ui.evaluate('window.__stickyHeight');if(Math.abs(rows.at(-1).height-before)>1)throw Error('고정할 때 원본 메시지 높이가 변경됨: '+before+' → '+rows.at(-1).height);const range=k=>Math.max(...rows.map(r=>r[k]))-Math.min(...rows.map(r=>r[k]));if(range('top')>1||range('height')>1)throw Error('스크롤/높이 흔들림: '+JSON.stringify({top:range('top'),height:range('height')}));return expectPinnedPrompt(ui);}],
  ['터치 관성 스크롤 뒤에도 고정 영역이 안정적',async ui=>{
   const point=JSON.parse(await ui.evaluate("(()=>{const s=document.getElementById('conversation-history'),r=s.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+Math.min(r.height/2,220),before:s.scrollTop});})()"));
   const gesture=await ui.send('Input.synthesizeScrollGesture',{x:point.x,y:point.y,yDistance:-180,gestureSourceType:'touch',preventFling:false,speed:600});if(gesture.error)throw Error('터치 스크롤 실패');await ui.wait(1500);
   const positions=JSON.parse(await ui.evaluate("(async()=>{const s=document.getElementById('conversation-history'),a=[];for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);a.push(s.scrollTop);}return JSON.stringify(a);})()"));
   if(Math.abs(positions[0]-point.before)<10)throw Error('터치 스크롤이 실제 이동하지 않음');if(Math.max(...positions)-Math.min(...positions)>1)throw Error('관성 종료 후 스크롤 흔들림');return expectPinnedPrompt(ui);
  }],
  ['위로 돌아가면 원본만 표시',async ui=>{await ui.evaluate("document.getElementById('conversation-history').scrollTop=0;true");await ui.wait(300);if(!await ui.evaluate("document.querySelector('.pinned-prompt').hidden"))throw Error('상단에서 요약이 남음');return {changes:1};}],
  ['넓은 화면에서도 원본 높이를 유지',async ui=>{await ui.send('Emulation.setDeviceMetricsOverride',{width:1400,height:880,deviceScaleFactor:1,mobile:false});await ui.wait(300);const before=await ui.evaluate("document.querySelector('#messages .bubble.user').getBoundingClientRect().height");await ui.evaluate("(()=>{const s=document.getElementById('conversation-history'),b=s.querySelector('.bubble.user');s.scrollTop+=b.getBoundingClientRect().top-s.getBoundingClientRect().top+2;return true;})()");await ui.wait(500);if(Math.abs(before-await ui.evaluate("document.querySelector('#messages .bubble.user').getBoundingClientRect().height"))>1)throw Error('넓은 화면 높이 변경');return expectPinnedPrompt(ui);}]]},
 {name:'AI가 한 일 읽기',goal:'답변·생각·도구 활동을 펼쳐 무엇을 했는지 본다',session:ids.claude,steps:[
  ['“생각” 펼치기',ui=>ui.click('.reasoning-block summary')],['도구 활동 펼치기',ui=>ui.click('.activity-group summary')]]},
 {name:'바뀐 파일 확인',goal:'이번 작업에서 바뀐 파일의 diff를 보고 대화로 돌아온다',session:ids.claude,steps:[
  ['변경된 파일 카드에서 파일 누르기',ui=>ui.click('.changes-file')],['대화 탭으로 돌아가기',ui=>ui.click('.center-tab-main')],
  ['Git 전체 변경 보기',ui=>ui.click('Git 전체 변경')],['변경 내용 검토가 화면에 보임',ui=>ui.expectVisible('#git-review')],['Git 변경 파일 누르기',ui=>ui.click('.git-review-file')],['가운데 Git diff 탭이 열림',ui=>ui.expectVisible('.center-tab.active')]]},
 {name:'프로젝트 파일 열어 보기',goal:'오른쪽 파일에서 폴더를 펼쳐 코드와 문서를 열어 본다',session:ids.claude,steps:[
  ['오른쪽 패널 열기',ui=>ui.click('#info-tab')],['파일 탭',ui=>ui.click('#files-tab')],['src 폴더 펼치기',ui=>ui.click('vscode-tree-item[data-name="src"]')],
  ['app.mjs 열기',ui=>ui.click('vscode-tree-item[data-name="app.mjs"]')],['가운데에 파일 탭이 열림',ui=>ui.expectVisible('.center-tab.active')],['README.md 열기',ui=>ui.click('vscode-tree-item[data-name="README.md"]')],
  ['마크다운 원본 보기',ui=>ui.click('원본')],['탭 닫기',ui=>ui.click('.center-tab.active .center-tab-close')]]},
 {name:'답변 속 경로 열기',goal:'AI 답변에 적힌 파일과 폴더를 눌러 바로 연다',session:ids.claude,steps:[
  ['답변의 파일 경로 누르기',ui=>ui.click('a[data-path="src/file-viewer.mjs"]')],['가운데에 파일 탭이 열림',ui=>ui.expectVisible('.center-tab.active')],
  ['대화 탭으로 돌아가기',ui=>ui.click('.center-tab-main')],['답변의 폴더 경로 누르기',ui=>ui.click('a[data-path="docs/"]')],['파일 트리에서 폴더가 펼쳐짐',ui=>ui.expectVisible('vscode-tree-item[data-name="viewer.md"]')]]},
 {name:'작업 중에 끼어들기',goal:'작업 중인 Claude를 멈추고 대기 메시지를 바로 보낸다',session:ids.busy,steps:[
  ['중지하고 바로 보내기',ui=>ui.click('중지하고 바로 보내기')]]},
 {name:'작업 중인 AI 다루기',goal:'작업 중인 대화에서 대기 메시지를 취소하고 작업을 중지한다',session:ids.busy,steps:[
  ['대기 메시지 취소',ui=>ui.click('.queue-bar button')],['중지 버튼',ui=>ui.click('#stop')]]},
 {name:'QR 링크로 설치하고 로그인',goal:'휴대폰으로 QR을 찍어 설치 안내를 보고, 코드가 채워진 로그인 화면으로 간다',steps:[
  ['QR 링크 열기',async ui=>{const {code}=globalThis.uxPairing.issue();await ui.evaluate(`location.href='/install#code=${code}';true`);await ui.wait(1500);return {changes:1};}],
  ['Chrome에서는 바로 로그인되고 코드는 주소에서 빠짐',async ui=>{const r=JSON.parse(await ui.evaluate("JSON.stringify([document.getElementById('pair-status')?.textContent,location.hash,!!localStorage.getItem('merry-device-login-v1')])"));if(!r[0].includes('로그인했습니다')||r[1]!==''||!r[2])throw Error('상태: '+JSON.stringify(r));return {changes:1};}],
  ['작업 화면 열기',ui=>ui.click('#pair-open')],
  ['로그인된 작업 화면',async ui=>{await ui.wait(1500);if(!await ui.evaluate("document.getElementById('login')?.hidden===true"))throw Error('로그인 화면이 남음');return {changes:1};}],
  ['4시간이 다 되어 가면 다시 열 때 자동 갱신',async ui=>{const before=await ui.evaluate("(()=>{const k='merry-device-login-v1',s=JSON.parse(localStorage.getItem(k));s.expires=Math.floor(Date.now()/1000)+60;localStorage.setItem(k,JSON.stringify(s));return s.refresh.secret;})()");
   await ui.evaluate("location.reload();true");await ui.wait(2500);
   const r=JSON.parse(await ui.evaluate("JSON.stringify([JSON.parse(localStorage.getItem('merry-device-login-v1'))?.refresh?.secret,document.getElementById('login')?.hidden])"));
   if(!r[0]||r[0]===before||r[1]!==true)throw Error('갱신 안 됨: '+JSON.stringify(r));return {changes:1};}]]},
 {name:'iPhone에서 QR 열기',goal:'iPhone은 설치 앱이 저장소를 따로 쓰므로 코드를 아껴 두고 홈 화면 추가를 안내한다',steps:[
  ['iPhone Safari로 QR 링크 열기',async ui=>{await ui.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
   const {code}=globalThis.uxPairing.issue();globalThis.uxIphoneCode=code;await ui.evaluate(`location.href='/install#code=${code}';true`);await ui.wait(1500);return {changes:1};}],
  ['홈 화면 추가 안내, 코드는 쓰지 않음',async ui=>{const r=JSON.parse(await ui.evaluate("JSON.stringify([document.getElementById('pair-status')?.textContent,document.getElementById('pair-open')?.getAttribute('href'),location.hash])"));
   if(!r[0].includes('홈 화면에 추가')||r[1]!=='/workspace#code='+globalThis.uxIphoneCode||r[2]!==''||!globalThis.uxPairing.status.active)throw Error('상태: '+JSON.stringify(r));return {changes:1};}]]},
 {name:'로그인 유지 기기 끊기',goal:'서버 Mac에서 로그인 유지 중인 기기를 보고 끊는다',session:ids.claude,steps:[
  ['다른 기기 연결 코드 열기',ui=>ui.click('#pairing-open')],['기기 목록에 휴대폰이 보임',ui=>ui.expectVisible('#pairing-devices button')],
  ['끊기',ui=>ui.click('#pairing-devices button')],['목록이 비어 있음',async ui=>{await ui.wait(800);const t=await ui.evaluate("document.getElementById('pairing-devices').textContent");if(t!=='없음')throw Error('남은 목록: '+t);return {changes:1};}]]},
 {name:'컴퓨터 설정 보기',goal:'이 Mac 설정에서 작업 방식을 보고 다른 기기 접속을 켤 곳을 찾는다',steps:[
  ['설정 화면 열기',async ui=>{await ui.evaluate("location.href='/setup';true");await ui.wait(1500);return {changes:1};}],
  ['역할 선택 없이 다른 기기 접속 체크만 보임',async ui=>{const r=JSON.parse(await ui.evaluate("JSON.stringify([!!document.getElementById('server'),!!document.getElementById('local'),!!document.getElementById('remote'),[...document.querySelectorAll('a')].some(a=>a.getAttribute('href')==='/connections')])"));
   if(JSON.stringify(r)!=='[true,false,false,false]')throw Error('상태: '+JSON.stringify(r));return {changes:1};}],
  ['다른 기기 접속 허용 바꾸기',async ui=>{globalThis.uxServerBefore=await ui.evaluate("document.getElementById('server').checked");return ui.click('#server');}],
  ['상태가 바뀌고 안내가 따라감',async ui=>{const r=JSON.parse(await ui.evaluate("JSON.stringify([document.getElementById('server').checked,document.getElementById('impact').textContent])"));
   if(r[0]===globalThis.uxServerBefore||r[1].includes('접속 허용')!==r[0])throw Error('상태: '+JSON.stringify(r));return {changes:1};}]]},
 {name:'Mac 앱에서 다른 기기 연결',goal:'다른 기기 연결 창 한 곳에서 주소·HTTPS 전달·QR을 진행한다',session:ids.claude,steps:[
  ['Mac 앱 연결 통로로 다시 열기',async ui=>{await ui.send('Page.addScriptToEvaluateOnNewDocument',{source:"window.webkit={messageHandlers:{maricode:{postMessage:m=>{(window.__posted??=[]).push(m)}}}};"});await ui.evaluate("location.reload();true");await ui.wait(1500);await ui.login();await ui.wait(1500);return {changes:1};}],
  ['접속 허용을 끈 상태로 작업 화면 열기',async ui=>{await ui.evaluate("(async()=>{const s=await(await fetch('/api/environment')).json();const r=await fetch('/api/environment',{method:'POST',headers:{'content-type':'application/json','x-setup-nonce':s.nonce},body:JSON.stringify({revision:s.revision,roles:{local:true,server:false,remote:false}})});if(!r.ok)throw Error('설정 저장 실패');location.reload();})()");await ui.wait(1500);await ui.login();await ui.wait(1500);if(!await ui.evaluate("document.getElementById('pairing-open').hidden"))throw Error('접속 꺼짐 미반영');return {changes:1};}],
  ['설정에서 접속 허용 후 기존 작업 화면 유지',async ui=>{await ui.evaluate("(async()=>{const s=await(await fetch('/api/environment')).json();const r=await fetch('/api/environment',{method:'POST',headers:{'content-type':'application/json','x-setup-nonce':s.nonce},body:JSON.stringify({revision:s.revision,roles:{local:true,server:true,remote:false}})});if(!r.ok)throw Error('설정 저장 실패');})()");return {changes:1};}],
  ['메뉴의 다른 기기 연결 (앱이 창을 엶)',async ui=>{await ui.evaluate("window.maricodeOpenPairing();true");await ui.wait(1500);if(!await ui.evaluate("document.getElementById('pairing-dialog').open&&(window.__posted??[]).includes('remote-state')"))throw Error('창이 열리지 않았거나 상태 요청 없음');return {changes:1};}],
  ['전달 준비 전에는 QR을 보내지 않음',async ui=>{const posted=await ui.evaluate("JSON.stringify(window.__posted)");if(!posted.includes('pairing-prepare:')||posted.includes('pairing-qr:'))throw Error('준비 전 QR 또는 준비 요청 없음');return {changes:1};}],
  ['준비 실패는 안내하고 QR은 보내지 않음',async ui=>{await ui.evaluate("window.maricodePairingReady(window.__posted.filter(x=>x.startsWith('pairing-prepare:')).at(-1).slice(16),false);true");if(!await ui.evaluate("document.getElementById('pairing-expiry').textContent.includes('준비하지 못했습니다')"))throw Error('실패 안내 없음');return {changes:1};}],
  ['QR 준비 다시 요청',ui=>ui.click('#pairing-qr')],
  ['이전 요청의 늦은 성공은 무시',async ui=>{await ui.evaluate("window.maricodePairingReady(window.__posted.filter(x=>x.startsWith('pairing-prepare:'))[0].slice(16),true);true");if(await ui.evaluate("window.__posted.some(x=>x.startsWith('pairing-qr:'))"))throw Error('이전 요청으로 QR 표시');return {changes:1};}],
  ['앱이 주소·전달 완료를 알려 줌',async ui=>{await ui.evaluate("window.maricodeRemoteState({address:'https://mini.tail1a2b.ts.net',forwarding:true,canStart:false});window.maricodePairingReady(window.__posted.filter(x=>x.startsWith('pairing-prepare:')).at(-1).slice(16),true);true");await ui.wait(1000);const posted=await ui.evaluate("JSON.stringify(window.__posted)");if(!/pairing-qr:[A-Z0-9]{4}-[A-Z0-9]{4}/.test(posted))throw Error('준비 후 QR 요청 없음');return {changes:1};}],
  ['닫힌 창에는 늦은 성공으로 QR을 열지 않음',async ui=>{await ui.click('#pairing-qr');await ui.click('#pairing-close');const before=await ui.evaluate("window.__posted.filter(x=>x.startsWith('pairing-qr:')).length");await ui.evaluate("window.maricodePairingReady(window.__posted.filter(x=>x.startsWith('pairing-prepare:')).at(-1).slice(16),true);true");await ui.wait(300);if(before!==await ui.evaluate("window.__posted.filter(x=>x.startsWith('pairing-qr:')).length"))throw Error('닫은 뒤 QR 요청');return {changes:1};}]]},
 {name:'AI 질문에 답하기',goal:'AI가 물은 질문에 답하지 않고 거절을 제출한다',session:ids.question,steps:[
  ['질문 카드의 버튼은 제출 하나',async ui=>{const b=await ui.evaluate("[...document.querySelectorAll('.permission-card button')].filter(e=>e.offsetParent).map(e=>e.textContent.trim()).join(',')");if(b!=='제출')throw Error('보이는 버튼: '+b);return {changes:1};}],
  ['답하지 않고 거절 고르기',ui=>ui.click('답하지 않고 거절')],['제출',ui=>ui.click('.question-submit')],
  ['거절이 전달됨',async ui=>{for(let t=0;t<20;t++){if(await ui.evaluate("document.body.innerText.includes('거절을 전달했습니다')"))return {changes:1};await ui.wait(200);}throw Error('거절 전달 안내가 보이지 않음');}]]},
 {name:'파일을 지정해 요청하기',goal:'입력창에서 @로 파일을 골라 요청에 넣는다',session:ids.claude,steps:[
  ['입력창 누르기',ui=>ui.click('#prompt')],['“@app” 입력',ui=>ui.type('이 파일 봐줘 @app')],['Enter로 후보 고르기',ui=>ui.key('Enter')]]},
 {name:'CLI 명령 쓰기',goal:'/config 같은 명령을 쓰려 한다',session:ids.claude,steps:[
  ['입력창 누르기',ui=>ui.click('#prompt')],['“/config” 입력',ui=>ui.type('/config')],['보내기',ui=>ui.click('#send')]]},
 {name:'명령 팔레트로 기능 찾기',goal:'⌘K로 터미널 이어가기를 찾는다',session:ids.claude,steps:[
  ['⌘K',ui=>ui.key('k',4)],['“터미널” 검색',ui=>ui.type('터미널')],['Esc로 닫기',ui=>ui.key('Escape')]]},
 {name:'대화 안에서 찾기',goal:'⌘F로 대화 속 단어를 찾는다',session:ids.claude,steps:[
  ['⌘F',ui=>ui.key('f',4)],['“탭” 입력',ui=>ui.type('탭')],['Esc로 닫기',ui=>ui.key('Escape')]]},
 {name:'모델·권한 바꾸기',goal:'입력창 아래에서 모델과 액세스 설정을 연다',session:ids.claude,steps:[
  ['모델 칩 누르기',ui=>ui.click('#model-chip')],['모델 선택칸이 화면에 보임',ui=>ui.expectVisible('#setting-model')],['설정 닫기',ui=>ui.click('#close-settings')],['액세스 칩 누르기',ui=>ui.click('#permissionMode-chip')]]},
 {name:'AI 계정 상태 보기',goal:'AI 로그인 상태가 어디 있는지 찾아 확인한다',session:ids.claude,steps:[
  ['왼쪽 아래 계정 아이콘',ui=>ui.click('#open-accounts')],['AI 계정 창이 보임',ui=>ui.expectVisible('#accounts-dialog')],['창 닫기',ui=>ui.click('#accounts-close')]]},
 {name:'세션 동작 메뉴',goal:'세션에 대한 동작만 모여 있고 상태를 다시 확인한다',session:ids.claude,steps:[
  ['세션 동작 메뉴 열기',ui=>ui.click('세션 동작')],
  ['세션과 무관한 항목이 없음',async ui=>{const extra=await ui.evaluate("[...document.querySelectorAll('.connection-panel button,.connection-panel span')].filter(e=>!e.hidden&&e.offsetParent).map(e=>e.textContent.trim()).filter(t=>/AI 계정|AI 연결|실시간 연결 끊기|http|기기 연결/.test(t)).join(', ')");if(extra)throw Error('남은 항목: '+extra);return {changes:1};}],
  ['상태 다시 확인',ui=>ui.click('#sync')],['메뉴가 닫힘',async ui=>{if(await ui.evaluate("document.querySelector('details.connection-menu')?.open"))throw Error('메뉴가 열린 채 남음');return {changes:1};}]]},
 // Needs the Runner's project registry: run at L3 (isolated real instance).
 {name:'새 대화 시작 화면',goal:'새 대화를 시작하는 화면을 열고 닫는다',session:ids.claude,needs:'프로젝트 목록(L3)',steps:[
  ['대화 추가',ui=>ui.click('#new-task-toggle')],['닫기',ui=>ui.click('#close-new-task')]]}
];
