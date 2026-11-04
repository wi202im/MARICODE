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
  ['Git 전체 변경 보기',ui=>ui.click('Git 전체 변경')],['변경 내용 검토가 화면에 보임',ui=>ui.expectVisible('#git-review')]]},
 {name:'프로젝트 파일 열어 보기',goal:'오른쪽 파일에서 폴더를 펼쳐 코드와 문서를 열어 본다',session:ids.claude,steps:[
  ['오른쪽 패널 열기',ui=>ui.click('#info-tab')],['파일 탭',ui=>ui.click('#files-tab')],['src 폴더 펼치기',ui=>ui.click('vscode-tree-item[data-name="src"]')],
  ['app.mjs 열기',ui=>ui.click('vscode-tree-item[data-name="app.mjs"]')],['가운데에 파일 탭이 열림',ui=>ui.expectVisible('.center-tab.active')],['README.md 열기',ui=>ui.click('vscode-tree-item[data-name="README.md"]')],
  ['마크다운 원본 보기',ui=>ui.click('원본')],['탭 닫기',ui=>ui.click('.center-tab.active .center-tab-close')]]},
 {name:'작업 중인 AI 다루기',goal:'작업 중인 대화에서 대기 메시지를 취소하고 작업을 중지한다',session:ids.busy,steps:[
  ['대기 메시지 취소',ui=>ui.click('.queue-bar button')],['중지 버튼',ui=>ui.click('#stop')]]},
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
  ['세션 동작 메뉴 열기',ui=>ui.click('세션 동작')],['AI 계정 연결',ui=>ui.click('#accounts-tab')],['계정 영역이 화면에 보임',ui=>ui.expectVisible('#accounts-panel')],['메뉴가 닫혀 결과를 가리지 않음',async ui=>{if(await ui.evaluate("document.querySelector('details.connection-menu')?.open"))throw Error('세션 동작 메뉴가 열린 채 남음');return {changes:1};}]]},
 // Needs the Runner's project registry: run at L3 (isolated real instance).
 {name:'새 대화 시작 화면',goal:'새 대화를 시작하는 화면을 열고 닫는다',session:ids.claude,needs:'프로젝트 목록(L3)',steps:[
  ['대화 추가',ui=>ui.click('#new-task-toggle')],['닫기',ui=>ui.click('#close-new-task')]]}
];
