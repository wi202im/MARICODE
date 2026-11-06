import {setupProgress} from './progress.mjs';
const $=id=>document.getElementById(id);let state=null,busy=false,checkedProviders=null,checkedRunner=null;
function progress(){const view=setupProgress(state,checkedProviders,checkedRunner);$('setup-steps').replaceChildren(...view.steps.map(step=>{const li=document.createElement('li');li.textContent=step.label;li.className=step.done?'complete':'pending';li.setAttribute('aria-label',step.label+(step.done?' · 확인됨':' · 확인 필요'));return li;}));$('setup-guidance').textContent=view.note;$('setup-next').textContent=view.next.label;$('setup-next').href=view.next.href;}
function cleanStartNotice(){const notice=$('clean-start-notice');notice.hidden=state?.cleanStart!==true;notice.textContent='1.1.0 새 시작: 이전 Maricode의 프로젝트 등록·앱 대화·연결 설정을 초기화했습니다. 실제 작업 소스와 외부 Claude/Codex 설정·원본 세션은 그대로입니다. 작업 방식부터 다시 저장하세요.';}
const chosen=()=>({local:true,server:$('server').checked,remote:false});
function impact(){$('save').disabled=busy||!state;$('impact').textContent=$('server').checked?'다른 기기 접속 허용: 등록한 Tailscale 주소와 연결 코드 로그인을 거친 기기만 이 Mac의 작업에 들어옵니다.':'이 Mac 전용: 다른 기기에서 들어오는 작업 요청을 차단합니다.';}
async function load(){const r=await fetch('/api/environment');if(!r.ok)throw Error('설정을 읽지 못했습니다. 저장된 파일을 임의로 초기화하지 않습니다.');state=await r.json();cleanStartNotice();renderReset();checkedProviders=null;checkedRunner=null;progress();$('server').checked=state.roles.server;impact();$('title').textContent=state.configured?'이 컴퓨터의 작업 방식':'처음 시작하는 Maricode';$('saved').hidden=!state.configured;$('ai').hidden=!state.roles.local;$('runner').hidden=!state.roles.local||!state.runnerSetupAvailable;$('runner-prepare').disabled=true;$('runner-start').disabled=true;$('runner-stop').disabled=true;$('runner-reprepare').disabled=true;$('ai-list').replaceChildren();$('registration').hidden=state.aiRegistrationAvailable!==true;$('path-list').replaceChildren();$('check-ai').disabled=state.aiConfigurationRegistered!==true;$('ai-configuration').textContent=state.aiConfigurationRegistered===true?'이 머신의 기존 AI 실행 환경이 등록돼 있습니다. 아래에서 실제 설치·로그인 상태를 확인하세요. 등록만으로 실행 준비가 완료된 것은 아닙니다.':'이 머신의 AI 실행 환경이 아직 등록되지 않았습니다. 새 Mac의 CLI 설치·실행 경로 등록은 현재 자동 지원하지 않습니다. 역할 저장이나 계정 로그인만으로 준비가 완료되지 않습니다.';
 for(const link of document.querySelectorAll('.page-nav a')){link.hidden=link.getAttribute('href')==='/workspace'&&!state.roles.local;}
 $('summary').textContent=`이 Mac에서 작업${state.roles.server?' · 다른 기기 접속 허용':''} · 설정 버전 ${state.revision}`;
 $('continue').hidden=!state.roles.local;$('next').textContent=state.roles.server&&!state.remoteEndpointConfigured?'아직 접속 주소가 없습니다. 이 설정만으로 포트나 서비스를 공개하지 않습니다. 작업 공간 왼쪽 아래 메뉴의 ‘다른 기기 연결’에서 주소를 등록하세요.':'';
}
async function action(fn){if(busy)return;busy=true;$('save').disabled=true;$('reload').disabled=true;$('server').disabled=true;try{await fn();}catch(e){$('status').textContent=e.message;}finally{busy=false;$('server').disabled=false;impact();$('reload').disabled=false;$('save').disabled=!state;}}
$('server').onchange=impact;
$('roles').onsubmit=e=>{e.preventDefault();const roles=chosen();action(async()=>{if(!state)throw Error('현재 설정을 먼저 조회하세요.');const r=await fetch('/api/environment',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Nonce':state.nonce},body:JSON.stringify({revision:state.revision,roles})});if(!r.ok)throw Error('저장 결과를 확정하지 못했습니다. 재전송하지 말고 저장 상태를 다시 확인하세요.');await load();$('status').textContent='설정을 저장했습니다.';if(window.webkit?.messageHandlers?.maricode)window.webkit.messageHandlers.maricode.postMessage('connect');});};
$('reload').onclick=()=>action(async()=>{await load();$('status').textContent='서버에 저장된 설정을 불러왔습니다.';});
action(load);

let accountBusy=false;
async function accounts(){
 if(accountBusy||!state?.roles.local)return;accountBusy=true;checkedProviders=null;progress();$('check-ai').disabled=true;$('ai-status').textContent='현재 실행 머신에서 확인 중…';
 try{const r=await fetch('/api/environment/accounts',{headers:{'X-Setup-Nonce':state.nonce}});if(!r.ok)throw Error('AI 상태를 확인하지 못했습니다. 환경 설정과 CLI 등록을 확인하세요.');const result=await r.json();checkedProviders=result.providers;progress();
 const labels={'not-configured':'이 AI의 실행 경로 미등록 · 사용하려는 AI만 등록하세요','configuration-error':'실행 환경 설정 오류 · 경로와 작업 폴더를 확인하세요',connected:'구독 로그인 확인', 'signed-out':'로그인 필요','not-installed':'설치된 CLI를 찾지 못함','other-auth':'다른 인증 방식 · 자동 변경 안 함',unknown:'확인 실패 · 기존 인증 유지'};
 $('ai-list').replaceChildren(...result.providers.map(p=>{const card=document.createElement('article'),title=document.createElement('h3'),status=document.createElement('p'),button=document.createElement('button');title.textContent=p.agent==='claude'?'Claude Code':'Codex';status.textContent=labels[p.state]??labels.unknown;button.textContent=p.loginPending?'로그인 진행 상태 확인 필요':'공식 로그인 시작';button.disabled=p.state!=='signed-out'||p.loginPending;button.onclick=async()=>{if(accountBusy)return;accountBusy=true;for(const b of $('ai-list').querySelectorAll('button'))b.disabled=true;
 try{const r=await fetch(`/api/environment/accounts/${p.agent}/login`,{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Nonce':state.nonce},body:'{}'});if(!r.ok)throw Error();$('ai-status').textContent='Mac 공식 로그인 창에서 완료한 뒤 상태를 다시 확인하세요.';}
 catch{$('ai-status').textContent='시작 결과를 확인하지 못했습니다. 재시도 전에 상태를 확인하세요.';}finally{accountBusy=false;}};card.append(title,status,button);return card;}));$('ai-status').textContent='확인 완료. 기존 인증은 변경하지 않았습니다.';
 }catch(e){$('ai-status').textContent=e.message;}finally{accountBusy=false;$('check-ai').disabled=false;}
}
$('check-ai').onclick=accounts;

let registrationBusy=false;
async function paths(){
 if(registrationBusy||!state?.roles.local)return;
 registrationBusy=true;$('check-paths').disabled=true;$('path-list').replaceChildren();
 try{
  const r=await fetch('/api/environment/accounts/registration',{headers:{'X-Setup-Nonce':state.nonce}});
  if(!r.ok)throw Error();const result=await r.json();
  for(const p of result.providers){
   const card=document.createElement('article'),title=document.createElement('h4'),info=document.createElement('p');
   title.textContent=p.agent==='claude'?'Claude Code':'Codex';card.append(title,info);
   if(p.registered)info.textContent='등록됨: '+p.path;
   else if(!p.candidates.length)info.textContent='허용된 실행 파일이 없습니다. 실행 프로그램의 후보 경로 설정이 필요합니다. 자동 설치하지 않습니다.';
   else{
    info.textContent='아래 경로를 저장한 뒤 AI 연결 상태를 별도로 확인하세요.';
    const select=document.createElement('select'),button=document.createElement('button');
    select.setAttribute('aria-label',title.textContent+' 실행 경로');
    for(const path of p.candidates){const option=document.createElement('option');option.value=path;option.textContent=path;select.append(option);}
    button.textContent='이 경로 등록';button.type='button';
    button.onclick=async()=>{
     if(registrationBusy)return;registrationBusy=true;$('check-paths').disabled=true;
     for(const control of $('path-list').querySelectorAll('button,select'))control.disabled=true;
     try{
      const saved=await fetch('/api/environment/accounts/registration',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Nonce':state.nonce},body:JSON.stringify({agent:p.agent,path:select.value})});
      if(!saved.ok)throw Error();
      $('path-status').textContent='경로를 등록했습니다. 목록 확인 후 AI 연결 상태를 확인하세요.';
     }catch{$('path-status').textContent='등록 결과를 확정하지 못했습니다. 다시 등록하지 말고 실행 경로를 조회하세요.';}
     finally{registrationBusy=false;$('check-paths').disabled=false;}
    };
    card.append(select,button);
   }
   $('path-list').append(card);
  }
  $('path-status').textContent='현재 저장된 경로입니다. 설치·로그인 완료 여부는 별도로 확인하세요.';
 }catch{$('path-status').textContent='경로를 확인하지 못했습니다. 실행 환경 설정을 확인하세요.';}
 finally{registrationBusy=false;$('check-paths').disabled=false;}
}
$('check-paths').onclick=paths;

let runnerBusy=false;
async function runnerAction(action){
 if(runnerBusy||!state?.roles.local)return;runnerBusy=true;checkedRunner=null;progress();$('runner-workspace').hidden=true;
 for(const id of ['runner-check','runner-prepare','runner-start','runner-stop','runner-reprepare'])$(id).disabled=true;
 try{
  const r=await fetch('/api/environment/runner',{method:action?'POST':'GET',headers:{'X-Setup-Nonce':state.nonce,...(action?{'Content-Type':'application/json'}:{})},...(action?{body:JSON.stringify({action})}:{})});
  if(!r.ok)throw Error();const result=await r.json();checkedRunner=result;progress();
  const phases={unprepared:'환경 준비 전',preparing:'환경 준비 중',prepared:'환경 준비됨 · 아직 실행하지 않음',starting:'시작 결과 확인 중',stopping:'종료 확인 중',running:'프로세스 실행 중',exited:'프로세스 종료 확인 · 새 실행 환경 필요',unknown:'실행 결과 확인 필요 · 자동 재시작하지 않음'};
  const hubs={'not-checked':'Hub 연결 확인 전',connected:'이 Runner의 Hub 연결 확인',disconnected:'이 Runner가 Hub 목록에 없음',unknown:'Hub 연결 확인 실패'};
  $('runner-status').textContent=(result.observed?'기존 Runner 상태 조회 · 이 실행기에서는 종료·재준비·세션 재개 불가':phases[result.phase]??phases.unknown)+' / '+(hubs[result.hub]??hubs.unknown);
  $('runner-target').textContent='연결 대상 Hub: '+result.hubUrl;
  $('runner-prepare').disabled=result.phase!=='unprepared';$('runner-start').disabled=result.phase!=='prepared'||result.configuration!=='matched';
  $('runner-snapshot').textContent=({matched:'현재 등록값과 일치',changed:'등록값이 변경됨 · 새 실행 환경 필요',unknown:'준비된 환경과 현재 등록값 비교 불가'}[result.configuration]??'비교 전')+(result.project?' · 작업 폴더: '+result.project:'')+(result.binaries?' · 준비된 AI: '+Object.entries(result.binaries).map(([a,p])=>a+' — '+p).join(', '):'');
  $('runner-workspace').hidden=!result.workspaceAvailable;$('runner-stop').disabled=result.phase!=='running';$('runner-reprepare').disabled=!['prepared','exited'].includes(result.phase);
 }catch{$('runner-status').textContent='결과를 확인하지 못했습니다. 다시 실행하지 말고 Runner 상태를 조회하세요.';}
 finally{runnerBusy=false;$('runner-check').disabled=false;}
}
$('runner-check').onclick=()=>runnerAction();
$('runner-prepare').onclick=()=>runnerAction('prepare');
$('runner-start').onclick=()=>runnerAction('start');

$('runner-stop').onclick=()=>runnerAction('stop');
$('runner-reprepare').onclick=()=>runnerAction('reprepare');

const nativeSetup=window.webkit?.messageHandlers?.maricode;
if(nativeSetup){document.body.classList.add('native-desktop');$('desktop-configure').hidden=true;$('setup-guidance').textContent='역할을 저장하면 빈 작업 공간이 열립니다. 프로젝트와 AI는 작업 공간에서 추가하세요.';}

function renderReset(){const box=$('app-reset');box.hidden=!state?.resetAvailable;const pending=state?.resetRequested===true;
 $('app-reset-request').hidden=pending;$('app-reset-cancel').hidden=!pending;$('app-reset-confirm').disabled=pending;$('app-reset-request').disabled=busy||$('app-reset-confirm').value.trim()!=='초기화';
 if(pending){box.open=true;$('app-reset-status').textContent='초기화가 예약됐습니다. 앱을 종료(⌘Q)하고 다시 열면 실행됩니다.';}
 else if(state?.appReset)$('app-reset-status').textContent='앱 데이터를 초기화했습니다. 처음 설정부터 다시 진행하세요.';}
async function resetRequest(body){const r=await fetch('/api/environment/reset',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Nonce':state.nonce},body:JSON.stringify(body)});if(!r.ok)throw Error('초기화 예약 결과를 확인하지 못했습니다. 설정을 다시 불러오세요.');state.resetRequested=(await r.json()).resetRequested;}
$('app-reset-confirm').oninput=renderReset;
$('app-reset-request').onclick=()=>action(async()=>{await resetRequest({confirm:$('app-reset-confirm').value.trim()});$('app-reset-confirm').value='';renderReset();});
$('app-reset-cancel').onclick=()=>action(async()=>{await resetRequest({cancel:true});$('app-reset-status').textContent='초기화 예약을 취소했습니다.';renderReset();});
