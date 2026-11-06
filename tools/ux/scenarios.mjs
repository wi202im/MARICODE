// User tasks, written the way a person would try them. Each step names what the person wants;
// the runner records clicks, whether the screen visibly reacted, errors and a screenshot.
import {ids} from './fake-hub.mjs';
export const scenarios=[
 {name:'연결하고 대화 열기',goal:'처음 화면에서 로그인하고 원하는 대화를 연다',steps:[
  ['토큰 입력칸 찾기',ui=>ui.click('#token')],['토큰 입력',ui=>ui.type('ux')],['연결 누르기',ui=>ui.click('연결')],
  ['목록에서 “파일 뷰어 탭 만들기” 열기',ui=>ui.click('파일 뷰어 탭 만들기')]]},
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
  ['QR 링크 열기',async ui=>{await ui.evaluate("location.href='/install#code=ABCD-EF23';true");await ui.wait(800);return {changes:1};}],
  ['설치 안내에 연결 코드가 보이고 주소에서는 빠짐',async ui=>{const r=await ui.evaluate("JSON.stringify([document.getElementById('pair-code')?.textContent,location.hash,!document.getElementById('pair').hidden])");if(r!=='["ABCD-EF23","",true]')throw Error('상태: '+r);return {changes:1};}],
  ['이 브라우저에서 바로 로그인',ui=>ui.click('#pair-open')],
  ['로그인 칸에 코드가 채워짐',async ui=>{await ui.wait(800);const r=await ui.evaluate("JSON.stringify([document.getElementById('token')?.value,location.hash])");if(r!=='["ABCD-EF23",""]')throw Error('상태: '+r);return {changes:1};}]]},
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
