import {createClaudeImportPanel,createImportedHistory} from './claude-import-ui.mjs';
import {createQuitFlow} from './quit-flow.mjs';
import {requestQuestions,questionDecision} from './questions.mjs';
import {questionForm} from './question-form.mjs';
import {createAttachmentComposer} from './attachment-composer.mjs';
import {renderConversation,renderTool,renderEdit} from './chat-render.mjs';
import {formatDuration,describeTool} from './chat-presentation.mjs';
import {saveDeviceLogin,clearDeviceLogin,restoreDeviceLogin,validServerId,deviceLoginKey} from './device-login.mjs';
import {renderMarkdown,copyButton} from './markdown.mjs';
import {recentWorkspaceSession,workspaceSelection,sessionProject,draftProjectSelection,displayPreferences,createChatDrafts} from './workspace-entry.mjs';
import {createReadRecovery,connectionFailure} from './reconnect.mjs';
import {sessionPresentation,workspaceHierarchy,workspaceChrome,inlineDefaultWorkspace} from './workspace.mjs';
import {createHistory} from './history.mjs';
import {toolViews,requestSnapshot,createPermissionActions,permissionChoices} from './workflow.mjs';
import {archiveSnapshot,archiveMatches,createActions,messageView,relativePath,createSSEDecoder,buildHandoff,confirmedDraft,handoffExcerpt,readTabToken,saveTabToken} from './core.mjs';
const deviceStorage=(()=>{try{return window.localStorage;}catch{return null;}})();
const $=id=>document.getElementById(id);
function navigationIcon(name){
 const paths={plus:'M12 5v14M5 12h14',folder:'M3 7V5h6l3 3h9v12H3Z',workspace:'M4 4h16v16H4ZM4 9h16M9 9v11',down:'m6 9 6 6 6-6',right:'m9 6 6 6-6 6',more:'M5 12h.01M12 12h.01M19 12h.01'};
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','glyph');svg.setAttribute('aria-hidden','true');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]);svg.append(path);return svg;
}
const workspaceLayout=document.body.dataset.layout==='workspace';
const chatDrafts=createChatDrafts(),questionDrafts=new Map();let permissionRenderKey='';
function rememberChat(){chatDrafts.save(sessionId,{text:$('prompt').value,note:$('handoff-note').textContent});}
const sessionCards=new Map();let catalogSerial=0,catalogBusy=false,catalogChecked=null,cardSignature='';
const collapsedProjects=new Set();
let sidebarDisplay=displayPreferences();try{sidebarDisplay=displayPreferences(JSON.parse(localStorage.getItem('maricode-display-preferences')));}catch{}
let navigationEnabled=false,allSessionEntries=[],navigationTarget=null,navigationPending=false;
let gitView={owner:'',data:null,loading:false,checked:0};
let settingsData=null,settingsOwner='',settingsLoading=false,settingsSerial=0;
let deviceServerId='';
let token='',sessionId='',session=null,messages=[],actions,streamController,connected=false,paused=false,epoch=0,refreshSerial=0,fileSerial=0,refreshTimer,directory='',selectedFile='',fileLoaded=false,lastFileRequest=null,busy=false,trialSessions=[],permissionActions,history=createHistory(),loadingHistory=false,handoffEnabled=false,handoffState=null;
let recovery=null,workspaceOpened=false,connectionState='login-needed';
const connectionLabels={empty:'연결됨 · 작업 세션 없음','login-needed':'로그인 필요',restoring:'저장된 연결 복원 중',connecting:'서버 상태·이력 확인 중',live:'실시간 연결됨',unavailable:'서버 연결 실패 · 조회 재시도 중',expired:'인증 만료 · 다시 로그인 필요',outdated:'화면 업데이트 필요 · 입력을 보관한 뒤 새로고침',denied:'접근 불가 · 권한 또는 세션 확인 필요',paused:'연결 시험 중지'};
const connectionBanner=document.createElement('section');connectionBanner.className='connection-banner';
const serverLabel=document.createElement('span'),connectionLabel=document.createElement('strong'),reconnectButton=document.createElement('button');
serverLabel.textContent=location.origin;connectionLabel.setAttribute('role','status');reconnectButton.textContent='연결 상태 다시 조회';reconnectButton.type='button';
connectionBanner.append(serverLabel,connectionLabel,reconnectButton);if(workspaceLayout)document.querySelector('.connection-panel').append(connectionBanner);else document.body.prepend(connectionBanner);
function showConnection(state){connectionState=state;connectionLabel.textContent=connectionLabels[state]??state;if($('connection')){$('connection').textContent=connectionLabel.textContent;$('connection').dataset.connectionState=state;}reconnectButton.disabled=!token||['restoring','connecting'].includes(state);}
const pendingKey=()=>`hapi-d1-pending:${sessionId}`;
const notice=text=>{$('notice').textContent=text;};
function storedPending(){try{return JSON.parse(sessionStorage.getItem(pendingKey()));}catch{return null;}}
async function api(path,{method='GET',body,signal}={}){
  const usedToken=token;
  const r=await fetch(path,{method,headers:{'X-Merry-Protocol':'1',...(token?{Authorization:`Bearer ${token}`} : {}),...(deviceServerId?{'X-Merry-Server-Id':deviceServerId}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:signal??AbortSignal.timeout(path.endsWith('/upload')?65000:path==='/api/tasks'||path.endsWith('/resume')?120000:15000)});
  if(r.status===426)throw Object.assign(Error('서버와 화면 버전이 맞지 않습니다. 입력 내용을 보관한 뒤 새로고침해 주세요. 이 요청은 실행되지 않았습니다.'),{status:426,rejected:true});
  if(r.status===401){if(usedToken&&usedToken===token)clearLogin('로그인이 만료됐습니다. 다시 연결해 주세요.','expired');throw Object.assign(Error('로그인 정보를 확인하고 다시 연결해 주세요.'),{status:401});}
  if(!r.ok){const error=Object.assign(Error(`요청 실패 (${r.status}). 상태를 다시 확인해 주세요.`),{status:r.status});if(path.startsWith('/api/tasks')||path.startsWith('/api/claude-import')||path.includes('/permissions/')||/\/(file|directory|resume)$/.test(path.split('?')[0])||path==='/api/navigation'||path.endsWith('/settings')||path.endsWith('/archive')){try{const detail=await r.json();error.rejected=detail.rejected===true;error.reason=detail.reason;if((error.rejected||detail.reason==='RUNNER_SETUP')&&typeof detail.error==='string')error.message=detail.error;}catch{}}throw error;}
  return r.json();
}
const attachmentComposer=workspaceLayout?createAttachmentComposer({form:$('send-form'),prompt:$('prompt'),context:()=>({id:sessionId,active:session?.active,connected,busy,pending:actions?.pending}),upload:(id,body)=>api(`/api/sessions/${id}/upload`,{method:'POST',body}),changed:()=>render(),notice}):null;
const base=()=>`/api/sessions/${sessionId}`;
function render(){
  $('session-select').disabled=busy;
  const relation=trialSessions.find(s=>s.id===sessionId),nextAgent=session?.metadata?.flavor==='codex'?'Claude':'Codex';
  $('new-handoff').textContent=handoffState==='created'?'기존 인계 세션 열기':`새 ${nextAgent} 세션으로 인계 준비`;
  $('handoff-state').textContent=!handoffEnabled?'':handoffState==='pending'?'생성 응답을 기다리거나 결과 ID를 받지 못한 상태입니다. 결과 확인만 하며 새로 만들지 않습니다. 계속 이 상태면 서버 확인이 필요합니다.':handoffState==='verifying'?'생성된 세션 ID를 보관했습니다. 결과 확인으로 같은 세션을 재조회할 수 있습니다.':handoffState==='created'?'이 출처의 인계 세션이 있습니다. 다시 만들지 않고 기존 세션을 엽니다.':'';
  $('check-handoff').hidden=!handoffEnabled||!['pending','verifying'].includes(handoffState);
  $('check-handoff').disabled=busy||!connected;
  $('new-handoff').disabled=!!session?.resumeUnconfirmed||handoffEnabled&&!['none','created'].includes(handoffState)||busy||!connected||!session||session.thinking||!!actions?.pending||Object.keys(session?.agentState?.requests??{}).length>0;
  $('parent-session').hidden=!relation?.parentId;$('parent-session').disabled=busy;
  $('lineage').textContent=relation?.parentId?`별도 인계 세션 · 출처: ${trialSessions.find(s=>s.id===relation.parentId)?.label??relation.parentId}. 원래 native 세션을 이어가는 것이 아닙니다. 맥락 전송은 별도입니다.`:'';
  $('older').disabled=loadingHistory||!connected||!history.hasMore||history.limited||messages.length>=1000;
  $('history-status').textContent=`불러온 기록 ${messages.length}개 · 텍스트 ${messages.filter(m=>messageView(m)?.text).length}개 · ${history.limited||messages.length>=1000?'표시 상한 1,000개':history.hasMore?'이전 이력 있음':'처음까지 조회함'}`;
  $('handoff').disabled=!!session?.resumeUnconfirmed||busy||!connected||!session||session.thinking||!!actions?.pending;
  $('title').textContent=session?.metadata?.name??'시험 세션';
  const waiting=Object.keys(session?.agentState?.requests??{}).length;
  $('session-state').textContent=!session?'상태 확인 중':!connected?'연결 끊김 · 표시된 내용은 마지막 확인 상태':!session.active?'실행 종료 · 대화 기록은 남아 있습니다':waiting?'승인 대기 · 아래 요청 내용을 확인해 주세요':session.thinking?'답변 작성 중':'실행 중 · 입력 대기';
  $('send').disabled=!!attachmentComposer?.uncertain||!!session?.resumeUnconfirmed||!!settingsPending()||busy||!connected||!session?.active||session.thinking||waiting>0||!!actions?.pending;
  $('retry-message').hidden=actions?.pending?.kind!=='send';
  $('retry-message').disabled=!!session?.resumeUnconfirmed||busy||!connected||!session?.active||session.thinking||waiting>0;
  $('retry-help').hidden=$('retry-message').hidden;
  $('archive').hidden=!session?.active;
  $('archive').disabled=!!session?.resumeUnconfirmed||busy||!connected||session?.thinking||session?.agentState?.controlledByUser!==false||waiting>0||!!actions?.pending||!!permissionActions?.pending||!!settingsPending();
  if(actions?.pending?.kind==='archive')$('session-state').textContent='종료 결과 확인 필요 · 상태 다시 확인을 눌러 주세요. 자동 재전송하지 않습니다.';
  if(session?.resumeUnconfirmed||actions?.pending?.kind==='resume')$('session-state').textContent=busy?'실행 환경을 준비하고 같은 세션을 다시 열고 있습니다…':'재개 결과 확인 필요 · 상태 다시 확인을 눌러 주세요. 자동 재전송하지 않습니다.';
  $('resume').hidden=!session||session.active;
  $('resume').disabled=!!session?.resumeUnconfirmed||busy||!connected||!!actions?.pending;
  if(workspaceLayout){
    const chrome=workspaceChrome({session,connected,history,loadingHistory,messageCount:messages.length,pendingKind:session?.resumeUnconfirmed?'resume':actions?.pending?.kind});
    $('composer-activity').hidden=!chrome.activity||connected&&session?.active&&(waiting>0||session.thinking&&!session.resumeUnconfirmed&&!actions?.pending);
    $('history-bar').hidden=!chrome.older;
    $('older').textContent=loadingHistory?'이전 대화 불러오는 중…':'이전 대화 더 보기';
  }
  $('connection').textContent=connectionLabels[connectionState];
  attachmentComposer?.render();renderProgress();
  renderWorkflow();
  const nearBottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<90;
  renderConversation($('messages'),messages,{engine:session?.metadata?.flavor==='claude'?'Claude':'Codex',session});
  if(nearBottom)$('messages').scrollTop=$('messages').scrollHeight;
  if(workspaceLayout){renderWorkspace();renderSettings();}
}
const workProgress=workspaceLayout?document.createElement('div'):null;
if(workProgress){workProgress.className='work-progress';workProgress.hidden=true;document.querySelector('.composer-wrap').prepend(workProgress);}
function renderProgress(){
 if(!workProgress)return;workProgress.hidden=!connected||!session?.active||!session?.thinking&&!Object.keys(session?.agentState?.requests??{}).length;
 if(workProgress.hidden)return;
 const start=messages.findLast(m=>m.content?.role==='user')?.createdAt;
 const latest=toolViews(messages.slice(Math.max(0,messages.findLastIndex(m=>m.content?.role==='user')))).findLast(t=>t.state==='waiting');
 const label=document.createElement('span'),time=document.createElement('time');
 label.textContent=Object.keys(session?.agentState?.requests??{}).length?'\uD655\uC778 \uB300\uAE30':latest?describeTool(latest).label+' \u00b7 '+describeTool(latest).summary:'\uC791\uC5C5 \uC911';
 time.textContent=Number.isFinite(start)?formatDuration(Math.max(0,Date.now()-start)):'';time.title='\uC694\uCCAD \uD6C4 \uACBD\uACFC \uC2DC\uAC04 (\uD655\uC778 \uB300\uAE30 \uD3EC\uD568)';workProgress.replaceChildren(label,time);
}
setInterval(renderProgress,1000);
function readable(value){return typeof value==='string'?value:JSON.stringify(value??null,null,2);}
function renderWorkflow(){
  const requests=session?.agentState?.requests??{};
  $('permissions').hidden=!Object.keys(requests).length;
  const permissionKey=JSON.stringify([sessionId,requests,busy,connected,session?.active,session?.resumeUnconfirmed,permissionActions?.pending]);
  if(permissionKey!==permissionRenderKey){permissionRenderKey=permissionKey;
  const expanded=new Set([...$('permission-list').querySelectorAll('details[open]')].map(x=>x.dataset.requestId));
  const nodes=Object.entries(requests).map(([id,request])=>{
    const card=document.createElement('article');card.className='permission-card';
    const title=document.createElement('h3');title.textContent=`${request.tool} 실행 허용`;
    const summary=document.createElement('p');summary.className='permission-summary';
    summary.textContent=String(request.arguments?.command??request.arguments?.file_path??request.arguments?.path??request.arguments?.message??'AI가 다음 작업의 허용을 요청했습니다.');
    const detail=document.createElement('details');detail.dataset.requestId=id;detail.open=expanded.has(id);
    const heading=document.createElement('summary');heading.textContent='요청 상세';const raw=document.createElement('pre');raw.textContent=readable(request.arguments);detail.append(heading,raw);
    const buttons=document.createElement('div');buttons.className='buttons';
    const questions=requestQuestions(session?.metadata?.flavor,request),isQuestion=['AskUserQuestion','request_user_input'].includes(request.tool);
    const unsupported=isQuestion&&!questions||new TextEncoder().encode(readable(request)).length>48000;
    for(const choice of (questions?permissionChoices(session?.metadata?.flavor,request).filter(c=>c.action==='deny'):permissionChoices(session?.metadata?.flavor,request))){
      const button=document.createElement('button');button.textContent=choice.label;button.title=choice.detail??choice.label;
      button.disabled=!!session?.resumeUnconfirmed||busy||!connected||!session?.active||!!permissionActions?.pending||unsupported;
      button.onclick=()=>decidePermission(id,request,choice.action,choice.scope);buttons.append(button);
      if(choice.scope==='session'&&request.tool!=='Bash'){const scope=document.createElement('p');scope.className='permission-scope';scope.textContent=choice.detail;card.append(scope);}
    }
    const note=document.createElement('p');note.className='permission-note';note.textContent=questions?'답변은 현재 질문에만 전달되며 도구 실행 권한을 변경하지 않습니다.':unsupported?'이 질문 유형은 아직 이 화면에서 처리할 수 없습니다.':permissionActions?.pending?'결과 확인 중 · 다시 보내지 않습니다.':permissionChoices(session?.metadata?.flavor,request).some(c=>c.scope==='session')?'세션 허용은 표시된 범위에만 적용됩니다. 다른 세션에는 적용되지 않습니다.':'표시된 요청 한 건에만 적용됩니다. 이 요청은 세션 허용을 제공하지 않습니다.';
    if(isQuestion)title.textContent='답변이 필요합니다';
    card.append(title);if(questions){const key=sessionId+':'+id+':'+requestSnapshot(request);if(!questionDrafts.has(key))questionDrafts.set(key,{});card.append(questionForm(questions,questionDrafts.get(key),!!session?.resumeUnconfirmed||busy||!connected||!session?.active||!!permissionActions?.pending,answers=>{questionDecision(session.metadata.flavor,request,answers);void decidePermission(id,request,'approve','once',answers);},notice));}else card.append(summary);const preview=renderEdit(request.arguments);if(preview)card.append(preview);card.append(detail,buttons,note);return card;
  });
  $('permission-list').replaceChildren(...nodes);
  }
  const opened=new Set([...$('tools').querySelectorAll('details[open]')].map(x=>x.dataset.callId));
  const tools=toolViews(messages).map(tool=>renderTool(tool,opened.has(tool.id)));
  $('tools').replaceChildren(...tools);$('tools-empty').hidden=tools.length>0;
}
async function decidePermission(id,request,action,scope,answers){
  if(busy||!connected||permissionActions?.pending)return;
  const mine=epoch,expected=requestSnapshot(request);busy=true;render();
  try{
    await refresh();if(mine!==epoch||!connected)return;
    const current=session?.agentState?.requests?.[id];
    if(!current||requestSnapshot(current)!==expected)throw Error('요청이 바뀌었습니다. 새 내용을 확인해 주세요.');
    const pending=permissionActions.decide(id,request,action,scope,session?.metadata?.flavor,answers);render();const result=await pending;if(result?.ok===false||result?.success===false)throw Error('승인 결과를 확인하지 못했습니다.');await refresh();notice(answers?'질문에 답변을 전달했습니다.':action==='deny'?'거절을 전달했습니다. 요청 상태를 다시 확인했습니다.':scope==='session'?'표시된 범위의 세션 허용을 전달했습니다.':'이번 요청의 허용을 전달했습니다.');
  }catch(e){if(mine===epoch)notice(e.message+' 결과를 다시 확인하며 자동 재시도하지 않습니다.');}finally{busy=false;render();}
}
async function refresh(){
  if(!token||!sessionId||!actions)return false;
  const mine=++refreshSerial,authEpoch=epoch;
  const [s,m,h]=await Promise.all([api(base()),api(base()+'/messages?limit=50'),handoffEnabled?api(base()+'/handoff'):null]);
  if(mine!==refreshSerial||authEpoch!==epoch)return false;
  handoffState=h?.state??null;session=s.session;sessionCards.set(sessionId,{snapshot:session,stale:false});const historyReset=history.latest(m);messages=history.messages;
  if(confirmedDraft(messages,actions.pending,$('prompt').value.trim())){$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();}
  const previousPending=actions.pending;actions.reconcile(messages,session.active,session.resumeUnconfirmed);
  permissionActions?.reconcile(session?.agentState?.requests??{});
  if(actions.pending)notice('이전 요청의 접수 여부를 확인 중입니다. 자동으로 다시 보내지 않습니다.');
  else if(previousPending)notice(previousPending.kind==='resume'?'같은 세션을 다시 열었습니다. 대화를 이어가세요.':previousPending.kind==='archive'?'실행을 종료했습니다. 대화 기록과 파일은 보존됩니다.':'메시지 접수를 확인했습니다.');
  else if(historyReset)notice('이력이 변경되거나 연결 공백이 있어 최근 이력부터 다시 불러왔습니다.');
  render();if(workspaceLayout)loadGit();return true;
}
function scheduleRefresh(){if(refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;refresh().catch(e=>notice(e.message));},300);}
async function stream(authEpoch){
  while(token&&!paused&&authEpoch===epoch){
    const controller=streamController=new AbortController();let watchdog,blocked=false;
    showConnection('connecting');
    const touch=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>controller.abort(),60000);};
    touch();
    try{
      const r=await fetch('/api/events?sessionId='+encodeURIComponent(sessionId),{headers:{'X-Merry-Protocol':'1',Authorization:`Bearer ${token}`,...(deviceServerId?{'X-Merry-Server-Id':deviceServerId}:{})},signal:controller.signal});
      if(r.status===401&&authEpoch===epoch){clearLogin('로그인이 만료됐습니다. 다시 연결해 주세요.','expired');return;}
      if(!r.ok||!r.body)throw Object.assign(Error('실시간 연결 실패'),{status:r.status});
      if(authEpoch!==epoch)return;
      if(!await refresh()||authEpoch!==epoch)return;connected=true;showConnection('live');if($('notice').textContent==='연결이 끊겼습니다. 재연결 후 서버 상태와 이력을 다시 확인합니다.')notice('다시 연결했습니다. 서버 상태와 대화 이력을 확인했습니다.');render();touch();
      const decode=new TextDecoder();const parse=createSSEDecoder(event=>{
        if(authEpoch!==epoch)return;
        if(event.sessionId&&event.sessionId!==sessionId)return;
        if(event.type==='message-received'&&event.message){
          history.event(event.message);messages=history.messages;render();
        }
        if(event.type!=='heartbeat')scheduleRefresh();
      });
      const reader=r.body.getReader();
      while(true){const {value,done}=await reader.read();if(done)break;touch();parse(decode.decode(value,{stream:true}));}
    }catch(error){if(authEpoch===epoch&&!paused){const failure=connectionFailure(error);blocked=['denied','expired','outdated'].includes(failure);showConnection(failure);notice(failure==='outdated'?'서버와 화면 버전이 맞지 않습니다. 입력을 보관한 뒤 새로고침해 주세요.':blocked?'접근 권한 또는 세션을 확인해 주세요. 자동 재시도를 멈췄습니다.':'연결이 끊겼습니다. 재연결 후 서버 상태와 이력을 다시 확인합니다.');}}
    finally{clearTimeout(watchdog);controller.abort();if(authEpoch===epoch){connected=false;if(connectionState==='live')showConnection('unavailable');render();}}
    if(blocked)return;
    if(!paused&&token&&authEpoch===epoch)await new Promise(r=>setTimeout(r,2000));
  }
}
async function openWorkspace(){
 const auth=token;const config=await api('/config');if(!auth||token!==auth)return;importHistorySupported=config.claudeImport===true;allSessionEntries=config.sessions;trialSessions=config.sessions.filter(s=>!s.hidden);navigationEnabled=!!config.navigation;if($('restore-navigation'))$('restore-navigation').hidden=!navigationEnabled;handoffEnabled=!!config.newHandoff;$('new-handoff').hidden=!handoffEnabled;
 $('session-select').replaceChildren(...trialSessions.map(s=>{const option=document.createElement('option');option.value=s.id;option.textContent=s.label;return option;}));
 if(!trialSessions.length){
  rememberChat();$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();
  epoch++;streamController?.abort();connected=false;sessionId='';session=null;messages=[];actions=null;permissionActions=null;
  $('login').hidden=true;$('workspace').hidden=false;showConnection('empty');render();
  notice(config.newTask?.generalChat?'프로젝트 작업 또는 일반 대화를 선택하고 AI와 대화를 시작하세요.':'프로젝트를 선택하고 새 세션에서 사용할 AI를 고르세요.');
  if(workspaceLayout){await configureTasks(config);renderWorkspace();}workspaceOpened=true;return;
 }
 let last;try{last=sessionStorage.getItem('hapi-trial-selected-session');}catch{}
 let restored;try{restored=workspaceSelection(trialSessions,location.hash,last);}catch(error){notice(error.message);throw error;}
 $('login').hidden=true;$('workspace').hidden=false;
 if(restored===sessionId&&actions){$('session-select').value=sessionId;const mine=++epoch;streamController?.abort();await refresh();if(mine===epoch&&token===auth)stream(mine);}else await selectSession(restored);
 if(location.hash)window.history.replaceState(null,'',location.pathname+location.search);
 if(workspaceLayout){await configureTasks(config);refreshCatalog();}workspaceOpened=true;
}
$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();recovery?.stop();epoch++;streamController?.abort();token='';deviceServerId='';clearDeviceLogin(deviceStorage);saveTabToken(sessionStorage,'',false);const button=e.submitter;button.disabled=true;const credential=$('token').value;$('token').value='';const attempt=epoch;
 try{
  if($('remember-device').checked){
   const identity=await fetch('/api/server-identity',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!identity.ok)throw Error('서버 신원을 확인할 수 없어 로그인하지 않았습니다.');
   const id=(await identity.json()).serverId;if(attempt!==epoch)return;if(!validServerId(id))throw Error('서버 신원을 확인할 수 없습니다.');
   deviceServerId=id;
  }
  const result=await api('/api/auth',{method:'POST',body:{accessToken:credential}});
  if(attempt!==epoch)return;
  if(typeof result.token!=='string'||!result.token)throw Error('로그인 응답을 확인하지 못했습니다.');
  token=result.token;
  const saved=$('remember-device').checked?saveDeviceLogin(deviceStorage,token,deviceServerId):saveTabToken(sessionStorage,token,$('remember-login').checked);
  beginRecovery();if(!saved)notice('로그인 정보를 보관할 수 없어 다시 열면 재로그인이 필요합니다.');
 }catch(e){if(attempt===epoch)notice(e.message);}finally{button.disabled=false;}
});
async function selectSession(id){
  rememberChat();importedHistory?.load(id,importHistorySupported);
  if(workspaceLayout&&!taskCreating){$('new-task-panel').hidden=true;document.body.classList.remove('creating-workspace');}
  try{sessionStorage.setItem('hapi-trial-selected-session',id);}catch{}
  epoch++;refreshSerial++;fileSerial++;streamController?.abort();clearTimeout(refreshTimer);refreshTimer=null;
  settingsSerial++;settingsData=null;settingsOwner='';settingsLoading=false;
  if(workspaceLayout){$('composer-settings').hidden=true;for(const id of ['model-chip','effort-chip'])$(id).setAttribute('aria-expanded','false');$('setting-model').replaceChildren();$('setting-effort').replaceChildren();$('settings-source').textContent='';$('settings-status').textContent='이 세션의 설정을 조회해 주세요.';}
  sessionId=id;if(workspaceLayout){selectedProject=sessionProject(projectCatalog,trialSessions.find(s=>s.id===id),selectedProject);renderProjects();}session=null;messages=[];history=createHistory();loadingHistory=false;handoffState=null;connected=false;paused=false;directory='';selectedFile='';fileLoaded=false;lastFileRequest=null;fileFeedback('');
  const draft=chatDrafts.read(id);$('handoff-note').textContent=draft.note;$('prompt').value=draft.text;$('prompt').style.height='auto';$('entries').replaceChildren();$('file-content').textContent='';$('file-title').textContent='';
  $('stream-toggle').textContent='실시간 연결 끊기';$('session-select').value=id;
  const permissionKey=`hapi-permission-pending:${id}`;
  permissionActions=createPermissionActions({pending:sessionStorage.getItem(permissionKey),save:p=>{if(p)sessionStorage.setItem(permissionKey,p);else sessionStorage.removeItem(permissionKey);},post:(requestId,action,body)=>api(`/api/sessions/${id}/permissions/${encodeURIComponent(requestId)}/${action}`,{method:'POST',body})});
  const key=`hapi-d1-pending:${id}`;
  actions=createActions({pending:storedPending(),save:p=>{if(p)sessionStorage.setItem(key,JSON.stringify(p));else sessionStorage.removeItem(key);},post:async(kind,body)=>{
    const r=await api(`/api/sessions/${id}`+(kind==='send'?'/messages':kind==='state'?'/messages/queued-state':kind==='archive'?'/archive':'/resume'),{method:'POST',body});
    if(r.type==='error'||r.ok===false)throw Error('요청을 완료하지 못했습니다. 상태를 다시 확인해 주세요.');
    if(r.sessionId&&r.sessionId!==id)throw Error('재개된 세션 식별자가 바뀌었습니다. 자동 전환하지 않습니다.');
    return r;
  }});
  const selectedEpoch=epoch;tab(false);render();await refresh();if(selectedEpoch===epoch)stream(selectedEpoch);
}
$('session-select').onchange=()=>selectSession($('session-select').value).catch(e=>notice(e.message));
function clearLogin(message,state='login-needed'){
  attachmentComposer?.clearAll();questionDrafts.clear();chatDrafts.clear();if($('navigation-dialog'))closeNavigation();
  recovery?.stop();
  saveTabToken(sessionStorage,'',false);clearDeviceLogin(deviceStorage);deviceServerId='';
  catalogSerial++;sessionCards.clear();catalogChecked=null;cardSignature='';
  epoch++;refreshSerial++;fileSerial++;streamController?.abort();clearTimeout(refreshTimer);refreshTimer=null;token='';session=null;messages=[];connected=false;permissionActions=null;
  if(workspaceLayout){$('account-list').replaceChildren();$('account-host').textContent='연결 상태를 조회해 주세요.';$('account-notice').textContent='';}
  $('workspace').hidden=true;$('login').hidden=false;$('messages').replaceChildren();$('file-content').textContent='';$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();showConnection(state);render();notice(message);
}
$('logout').onclick=()=>clearLogin('로그아웃했습니다. 보관한 인증 토큰을 삭제했습니다. 불확실한 전송의 식별자는 재로그인 후 확인합니다.');
$('older').onclick=async()=>{
  if($('older').disabled)return;
  const mine=epoch,held=history,cursor=history.cursor;loadingHistory=true;render();
  try{
    if(cursor?.at==null||cursor?.seq==null)throw Error('이전 이력 위치를 확인하지 못했습니다.');
    const page=await api(base()+`/messages?limit=50&beforeAt=${cursor.at}&beforeSeq=${cursor.seq}`);
    if(mine!==epoch||held!==history||cursor!==history.cursor)return;
    if(!history.older(page)){await refresh();notice('이력이 변경돼 최근 내용부터 다시 확인했습니다.');return;}
    const panel=$('messages'),height=panel.scrollHeight,top=panel.scrollTop;
    messages=history.messages;render();panel.scrollTop=top+(panel.scrollHeight-height);
    notice('이전 이력을 추가로 불러왔습니다.');
  }catch(e){if(mine===epoch)notice(e.message);}finally{if(mine===epoch){loadingHistory=false;render();}}
};
$('sync').onclick=()=>refresh().catch(e=>notice(e.message));
$('stream-toggle').onclick=()=>{
  paused=!paused;epoch++;streamController?.abort();connected=false;
  $('stream-toggle').textContent=paused?'다시 연결':'실시간 연결 끊기';showConnection(paused?'paused':'connecting');render();
  if(!paused)stream(epoch);
};
$('send-form').addEventListener('submit',async e=>{
  e.preventDefault();if($('send').disabled)return;
  const text=$('prompt').value.trim();if(!text&&!attachmentComposer?.count)return;const mine=epoch;let submitted=false;busy=true;render();
  try{
    await refresh();if(mine!==epoch||!connected||!session.active||session.thinking||Object.keys(session.agentState?.requests??{}).length||actions.pending)return;
    const attachments=await attachmentComposer?.prepare()??[];if(mine!==epoch)return;submitted=true;const result=actions.send(text,attachments);render();await result;if(mine!==epoch)return;if($('prompt').value.trim()===text){$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();}await refresh();
  }catch(e){if(mine===epoch)notice(submitted&&!actions.pending?'서버 이력에서 전송을 확인했습니다.':e.message+' 전송은 자동 재시도하지 않습니다.');}finally{busy=false;render();}
});
$('retry-message').onclick=async()=>{
  if($('retry-message').disabled)return;
  const mine=epoch,text=$('prompt').value.trim();busy=true;render();
  try{
    await refresh();if(mine!==epoch||!connected||!session?.active||session.thinking||Object.keys(session.agentState?.requests??{}).length)return;
    if(!actions.pending){notice('서버 이력에서 접수를 확인했습니다. 다시 보내지 않았습니다.');return;}
    await actions.retry(text,attachmentComposer?.metadata()??[]);if(mine!==epoch)return;
    if($('prompt').value.trim()===text){$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();}
    await refresh();
  }catch(e){if(mine===epoch)notice(e.message+' 자동 재전송하지 않습니다.');}finally{busy=false;render();}
};
$('handoff').onclick=async()=>{
  if($('handoff').disabled)return;
  if($('prompt').value.trim()){notice('입력 중인 메시지를 먼저 보내거나 지워 주세요.');return;}
  const mine=epoch,source=trialSessions.find(s=>s.id===sessionId),target=trialSessions.find(s=>s.id!==sessionId);
  busy=true;render();
  try{
    if(!target)throw Error('전달할 다른 시험 세션이 없습니다.');
    await refresh();if(mine!==epoch)return;
    if(session.thinking||actions.pending)throw Error('현재 요청이 끝난 뒤 맥락을 준비해 주세요.');
    const report=handoffExcerpt(messages),hasOlder=history.hasMore||history.limited;
    const text=buildHandoff(source,target,messages,{hasOlder,limited:history.limited});
    await selectSession(target.id);
    if(sessionId!==target.id||!token)return;
    $('prompt').value=text;
    $('handoff-note').textContent=`${source.label} → ${target.label} · 불러온 텍스트 ${report.loaded}개 중 ${report.included}개 포함, ${report.omitted}개 생략, ${report.truncated}개 일부 잘림. ${hasOlder?'아직 포함하지 않은 이전 이력도 있습니다.':'처음까지 조회한 이력에서 발췌했습니다.'} 내용을 확인·수정한 뒤 보내기를 누르세요. 아직 전송하지 않았습니다.`;
    notice('전달 초안을 준비했습니다. 세션을 바꾸거나 새로고침하면 초안은 지워집니다.');
    $('prompt').focus();
  }catch(e){notice(e.message);}finally{busy=false;render();}
};
function confirmArchive(label,id){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='archive-dialog';
    dialog.setAttribute('aria-labelledby','archive-heading');dialog.setAttribute('aria-describedby','archive-explanation');
    const heading=document.createElement('h2');heading.id='archive-heading';heading.textContent='세션 실행을 종료할까요?';
    const target=document.createElement('p');target.className='archive-target';target.textContent=label;
    const identity=document.createElement('small');identity.textContent=`세션 ${id}`;
    const detail=document.createElement('p');detail.id='archive-explanation';detail.textContent='대화 기록과 파일은 그대로 보존됩니다. 이후 같은 세션을 재개할 수 있습니다. 다른 세션은 종료하지 않습니다.';
    const buttons=document.createElement('div');buttons.className='archive-buttons';
    const cancel=document.createElement('button');cancel.textContent='취소';cancel.autofocus=true;cancel.onclick=()=>dialog.close('cancel');
    const end=document.createElement('button');end.textContent='실행 종료';end.className='archive-confirm';end.onclick=()=>dialog.close('end');
    buttons.append(cancel,end);dialog.append(heading,target,identity,detail,buttons);document.body.append(dialog);
    dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='end';dialog.remove();resolve(accepted);},{once:true});
    dialog.showModal();
  });
}
$('archive').onclick=async()=>{
  if($('archive').disabled)return;
  const mine=epoch,id=sessionId,label=$('title').textContent;
  let approval;try{approval=archiveSnapshot(id,session);}catch(error){notice(error.message);return;}
  if(!await confirmArchive(label,id))return;
  if(mine!==epoch||id!==sessionId)return;
  busy=true;render();
  try{
    await refresh();
    if(mine!==epoch||id!==sessionId||!connected||!session?.active||session.thinking||Object.keys(session.agentState?.requests??{}).length||actions.pending||permissionActions?.pending||settingsPending())return;
    if(!archiveMatches(approval,sessionId,session))throw Error('확인하는 동안 세션 상태가 바뀌었습니다. 내용을 확인한 뒤 다시 종료해 주세요.');
    const request=actions.archive(approval.expected);render();await request;await refresh();
    notice(session?.active?'종료 요청을 보냈습니다. 상태 다시 확인으로 종료 여부를 확인해 주세요.':'세션 실행을 종료했습니다. 대화 기록은 보존됩니다. 다른 활성 세션도 종료한 뒤 앱을 닫을 수 있습니다.');
  }catch(error){notice(error.message);}finally{busy=false;render();}
};
$('resume').onclick=async()=>{
  if($('resume').disabled)return;const mine=epoch;busy=true;render();
  try{await refresh();if(mine!==epoch||!connected||session.active||actions.pending)return;const request=actions.resume();render();await request;await refresh();}catch(e){if(mine===epoch){notice(e.message);await refresh().catch(()=>{});}}finally{busy=false;render();}
};
function tab(files){if(workspaceLayout){workspacePanel(files?'files':'chat');if(files&&!fileLoaded)openPath(directory,'directory');return;}$('files').hidden=!files;$('chat').hidden=files;$('files-tab').setAttribute('aria-pressed',String(files));$('chat-tab').setAttribute('aria-pressed',String(!files));if(files&&!fileLoaded)openPath(directory,'directory');}
if($('chat-tab'))$('chat-tab').onclick=()=>tab(false);$('files-tab').onclick=()=>tab(true);
async function openPath(path,kind){
  const serial=++fileSerial,authEpoch=epoch;path=relativePath(path);lastFileRequest={path,kind};fileLoaded=true;fileFeedback('불러오는 중…');
  try{
    let d;
    if(kind!=='file')d=await api(base()+'/directory?path='+encodeURIComponent(path));
    if(serial!==fileSerial||authEpoch!==epoch)return;
    if(d?.success){
      directory=path;selectedFile='';$('file-title').textContent='';$('file-content').textContent='';fileFeedback('');$('path').textContent=path||'프로젝트 폴더';$('up').disabled=!path;
      const nodes=d.entries.map(entry=>{const li=document.createElement('li'),btn=document.createElement('button');btn.textContent=entry.name;btn.dataset.kind=entry.type;btn.title=entry.type==='directory'?'폴더':entry.type==='file'?'파일':'링크·기타';btn.onclick=()=>openPath([path,entry.name].filter(Boolean).join('/'),entry.type);li.append(btn);return li;});
      $('entries').replaceChildren(...nodes);notice('폴더 목록을 서버에서 읽었습니다.');
    }else{
      if(kind==='directory')throw Error('폴더를 열 수 없습니다.');
      const f=await api(base()+'/file?path='+encodeURIComponent(path));
      if(serial!==fileSerial||authEpoch!==epoch)return;
      if(!f.success||typeof f.content!=='string')throw Error('파일을 열 수 없습니다.');
      const bytes=Uint8Array.from(atob(f.content),c=>c.charCodeAt(0));
      selectedFile=path;fileFeedback('');$('file-title').textContent=path;$('file-content').textContent=new TextDecoder().decode(bytes);notice('읽기 전용 파일 보기');
    }
  }catch(e){if(serial===fileSerial&&authEpoch===epoch){fileFeedback(e.message.includes('(403)')?'프로젝트 밖의 링크이거나 접근할 수 없는 경로입니다.':e.message,true,e.reason==='RUNNER_OFFLINE');}}
}
const fileStatus=document.createElement('div');fileStatus.className='file-feedback';fileStatus.setAttribute('role','status');$('entries').before(fileStatus);
function fileFeedback(message,retry=false,offline=false){
 fileStatus.replaceChildren();if(!message)return;const text=document.createElement('p');text.textContent=message;fileStatus.append(text);
 if(retry){const button=document.createElement('button');button.textContent='다시 읽기';button.onclick=()=>lastFileRequest&&openPath(lastFileRequest.path,lastFileRequest.kind);fileStatus.append(button);}
 if(offline){if(document.querySelector('a[href="/setup"]')){const setup=document.createElement('a');setup.href='/setup';setup.textContent='컴퓨터 설정에서 실행 환경 시작';fileStatus.append(setup);}else{const guide=document.createElement('p');guide.textContent='실행 서버에서 실행 환경을 시작한 뒤 다시 읽어 주세요.';fileStatus.append(guide);}}
}
$('up').onclick=()=>openPath(directory.split('/').slice(0,-1).join('/'),'directory');
$('files-refresh').onclick=()=>openPath(selectedFile||directory,selectedFile?'file':'directory');
window.addEventListener('online',()=>{if(token&&!paused&&connectionState!=='denied')reconnect();});
window.addEventListener('offline',()=>{if(token&&!paused){connected=false;showConnection('unavailable');streamController?.abort();render();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token&&!paused&&connectionState!=='denied')refresh().catch(e=>notice(e.message));});

$('parent-session').onclick=()=>{const parent=trialSessions.find(s=>s.id===sessionId)?.parentId;if(parent)selectSession(parent).catch(e=>notice(e.message));};
async function prepareNewHandoff(checkOnly=false){
 if($(checkOnly?'check-handoff':'new-handoff').disabled)return;
 if($('prompt').value.trim()){notice('작성 중인 메시지를 먼저 보내거나 비워 주세요.');return;}
 const mine=epoch,source=trialSessions.find(s=>s.id===sessionId);busy=true;render();
 try{
  await refresh();if(mine!==epoch)return;
  if(session.thinking||actions.pending||Object.keys(session.agentState?.requests??{}).length)throw Error('현재 작업이 끝난 뒤 인계해 주세요.');
  const original=messages.slice(),hasOlder=history.hasMore||history.limited,limited=history.limited;
  if(!handoffExcerpt(original).included)throw Error('전달할 대화가 없습니다.');
  const result=await api(`/api/sessions/${source.id}/handoff${checkOnly?'/check':''}`,{method:'POST',body:{}});
  if(mine!==epoch)return;
  handoffState=result.state;
  if(result.state!=='created'){notice('생성 결과 ID를 아직 확인할 수 없습니다. 새 세션을 만들지 않았습니다.');return;}
  if(mine!==epoch)return;
  const config=await api('/config');if(mine!==epoch)return;allSessionEntries=config.sessions;trialSessions=config.sessions.filter(s=>!s.hidden);
  $('session-select').replaceChildren(...trialSessions.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.label;return o;}));
  const target=result.session,text=buildHandoff(source,target,original,{hasOlder,limited});
  await selectSession(target.id);if(sessionId!==target.id||!token)return;
  $('prompt').value=text;
  const report=handoffExcerpt(original);
  $('handoff-note').textContent=`새 인계 세션 · ${source.label} → ${target.label} · 텍스트 ${report.included}개 포함, ${report.omitted}개 생략, ${report.truncated}개 일부 잘림. 아직 전송하지 않았습니다. 내용을 검토하고 보내기를 누르세요.`;
  notice('출처별 인계 세션은 하나만 만듭니다. 같은 요청은 기존 인계 세션을 엽니다.');
 }catch(e){if(mine===epoch){await refresh().catch(()=>{});notice(e.message+' 인계 생성 결과 확인으로 조회할 수 있습니다.');}}finally{busy=false;render();}
}
$('new-handoff').onclick=()=>prepareNewHandoff();
$('check-handoff').onclick=()=>prepareNewHandoff(true);

function renderGit(){
 if(!workspaceLayout)return;
 const current=gitView.owner===`${epoch}:${sessionId}`?gitView:null,data=current?.data;
 const worktree=sessionPresentation(trialSessions.find(s=>s.id===sessionId)??{id:sessionId,label:''},session?.id===sessionId?session:null).worktree;
 const name=worktree?`워크트리 ${worktree.name}`:'';
 $('git-refresh').disabled=!token||!sessionId||!!current?.loading||paused;
 $('git-summary').disabled=!sessionId;
 $('git-commit').textContent=data?.state==='ready'&&data.commit?data.commit.slice(0,7):'';
 const suffix=data?.state==='ready'?`${data.branch} · ${data.changed?'변경 '+data.changed:'변경 없음'}`:current?.loading?'Git 확인 중…':'Git 미확인';
 $('git-label').textContent=!sessionId?'세션 선택':`${name?name+' · ':''}${suffix}${data?.state==='ready'&&!connected?' · 이전 조회':''}`;
 $('git-summary').title=`${$('git-label').textContent} · 상세 보기`;
 $('info-worktree').textContent=worktree?`워크트리: ${worktree.name}\n기준 프로젝트: ${worktree.base}\n실행 폴더: ${worktree.path}\n생성 시 브랜치: ${worktree.branch||'미제공'}`:'워크트리: 별도 정보 없음 · 위 작업 폴더에서 실행';
 $('info-git').textContent=!sessionId?'세션을 선택하면 Git 상태를 조회합니다.':data?.state==='ready'?`브랜치: ${data.branch}\n현재 커밋: ${data.commit??'아직 커밋 없음'}\n변경 파일 ${data.changed}개 · 스테이징 ${data.staged} · 작업본 ${data.unstaged} · 새 파일 ${data.untracked} · 충돌 ${data.conflicts}\n${data.ahead===null?'추적 브랜치 없음':`추적 브랜치 대비 +${data.ahead} / −${data.behind} (fetch하지 않은 로컬 정보)`}\n조회: ${new Date(current.checked).toLocaleTimeString()}${!connected?' · 연결 끊김, 이전 조회 결과':''}\n읽기 전용 조회이며 커밋·브랜치 전환은 실행하지 않습니다.`:current?.loading?'Git 상태를 확인하고 있습니다.':'Git 정보를 가져오지 못했습니다. 실행기 연결과 Git 저장소 여부를 확인해 주세요.';
}
async function loadGit(force=false){
 if(!workspaceLayout||!token||!sessionId||paused)return;
 const owner=`${epoch}:${sessionId}`;
 if(gitView.owner===owner&&(gitView.loading||!force&&Date.now()-gitView.checked<30000))return;
 gitView={owner,data:gitView.owner===owner?gitView.data:null,loading:true,checked:Date.now()};renderGit();
 try{const data=await api(base()+'/git-status');if(owner!==`${epoch}:${sessionId}`||!token)return;gitView={owner,data,loading:false,checked:Date.now()};}
 catch{if(owner!==`${epoch}:${sessionId}`||!token)return;gitView={owner,data:{state:'unavailable'},loading:false,checked:Date.now()};}
 finally{if(owner===`${epoch}:${sessionId}`)renderGit();}
}
function renderWorkspace(){
 document.body.classList.toggle('creating-workspace',!$('new-task-panel').hidden);
 document.body.classList.toggle('compact-workspaces',sidebarDisplay.compact);document.body.classList.toggle('hide-workspace-details',!sidebarDisplay.details);
 renderGit();
 const empty=!sessionId;document.body.classList.toggle('without-session',empty);
 if($('empty-workspace')){$('empty-workspace').hidden=!empty;$('empty-description').textContent=projectCatalog.length?'새 작업에서 프로젝트와 작업공간을 고른 뒤 AI와 대화를 시작하세요.':draftGeneralSupported?'프로젝트 없이 일반 대화를 시작하거나, 작업할 프로젝트 폴더를 추가하세요.':'프로젝트 폴더를 추가하면 이곳에서 AI와 작업할 수 있습니다.';$('empty-action').textContent=projectCatalog.length?'새 작업 시작':'프로젝트 폴더 추가';$('empty-action').hidden=!projectCatalog.length&&!window.webkit?.messageHandlers?.maricode;}

 const config=trialSessions.find(s=>s.id===sessionId)??{id:sessionId,label:'작업 세션'};
 const current=sessionPresentation(config,session,{stale:!!session&&!connected});
 $('title').textContent=sessionId?current.title:'새 작업을 시작하세요';$('session-status').textContent=actions?.pending?.kind==='archive'?'종료 결과 확인 필요':current.state;
 $('project-name').textContent=current.project;$('model-name').textContent=current.engine;
 $('selected-short-id').textContent=current.shortId;
 $('info-workspace').textContent=current.workspace;$('info-workspace').title=current.workspaceId??'';$('info-engine').textContent=current.engine;$('info-state').textContent=current.state;
 $('info-id').textContent=sessionId||'확인 중';$('info-path').textContent=session?.metadata?.path??'확인 중';
 $('info-host').textContent=session?.metadata?.host??'확인 중';$('host-name').textContent=session?.metadata?.host??'서버 확인 중';
 $('execution-target').textContent=`실행 서버 · ${current.host||'확인 중'}`;
 $('send-target').textContent=`${current.host||'확인 중'} / ${current.project} / ${current.workspace}에 전송`;
 $('file-server').textContent=`파일 위치 · ${current.host||'확인 중'}`;
 $('new-task-server').textContent=`생성 서버 · ${sessionCards.get(trialSessions[0]?.id)?.snapshot?.metadata?.host||'현재 연결 서버'}`;
 $('approval-guidance').textContent=`${current.host||'확인 중'} / ${current.project}의 요청입니다. 표시된 한 건만 허용하거나 거절합니다.`;
 $('approval-guidance').hidden=true;
 if(empty){$('session-status').textContent='세션 없음';$('host-name').textContent=window.webkit?.messageHandlers?.maricode?'이 Mac':'연결된 컴퓨터';$('execution-target').textContent=$('host-name').textContent;$('project-name').textContent=projectCatalog.find(p=>p.key===selectedProject)?.label??'프로젝트를 추가하세요';}

 const query=$('search').value.trim().toLowerCase();
 const cards=trialSessions.map(c=>({config:c,...sessionPresentation(c,sessionCards.get(c.id)?.snapshot,{stale:sessionCards.get(c.id)?.stale}),selected:c.id===sessionId}));

 const groups=workspaceHierarchy(projectCatalog,cards);groups.sort((a,b)=>a.label.localeCompare(b.label));
 $('server-summary').textContent='프로젝트 '+groups.length+' · 작업공간 '+projectCatalog.length+' · 세션 '+trialSessions.length;
 $('project-empty').hidden=groups.length>0;
 const signature=JSON.stringify([cards,projectCatalog,selectedProject,query,busy,taskCreating,sidebarDisplay,[...collapsedProjects],!$('new-task-panel').hidden]);
 if(signature!==cardSignature){
  cardSignature=signature;const nodes=[];
  function header(key,label,path,count,selected,onselect,onadd,addLabel,kind,management){
   const section=document.createElement('section');section.className=kind+'-group';
   const expanded=!!query||!collapsedProjects.has(key),row=document.createElement('div');row.className='project-row';
   const toggle=document.createElement('button');toggle.className='project-disclosure';toggle.append(navigationIcon(expanded?'down':'right'));toggle.setAttribute('aria-label',label+' '+(expanded?'접기':'펼치기'));toggle.setAttribute('aria-expanded',String(expanded));
   toggle.onclick=()=>{if(expanded)collapsedProjects.add(key);else collapsedProjects.delete(key);renderWorkspace();};
   const choice=document.createElement('button');choice.className='project-choice';choice.title=path;choice.setAttribute('aria-pressed',String(selected));choice.disabled=busy||taskCreating;
   const name=document.createElement('span');name.textContent=label;const number=document.createElement('small');number.textContent=String(count);choice.append(navigationIcon(kind==='project'?'folder':'workspace'),name,number);choice.onclick=onselect;row.append(toggle,choice);
   if(onadd&&!$('new-task-toggle').hidden){const add=document.createElement('button');add.className='project-new-session';add.append(navigationIcon('plus'));add.title=addLabel;add.setAttribute('aria-label',addLabel);add.disabled=busy||taskCreating;add.onclick=onadd;row.append(add);}
   if(management&&navigationEnabled)row.append(navigationMenu(management));
   const children=document.createElement('div');children.className=kind==='project'?'project-workspaces':'project-sessions';children.hidden=!expanded;section.append(row,children);return {section,children};
  }
  for(const project of groups){
   const inline=inlineDefaultWorkspace(project);
   const projectMatch=(project.label+' '+project.path).toLowerCase().includes(query),workspaceNodes=[];
   for(const w of project.workspaces){
    const workspaceMatch=projectMatch||(w.label+' '+w.path+' '+w.host).toLowerCase().includes(query);
    const matches=w.cards.filter(c=>(sidebarDisplay.ended||c.selected||c.active!==false)&&(workspaceMatch||(c.title+' '+c.engine+' '+c.config.id).toLowerCase().includes(query)));
    matches.sort((a,b)=>sidebarDisplay.sort==='active'?(b.priority-a.priority||a.title.localeCompare(b.title)):a.title.localeCompare(b.title));
    if(query&&!workspaceMatch&&!matches.length)continue;
    const label=(sidebarDisplay.group==='flat'?project.label+' / ':'')+w.label+(w.project?.available===false?' · 폴더 확인 필요':'')+(w.kind==='worktree'?' · 워크트리':'')+(w.host?' · '+w.host:'');
    const onselect=async()=>{try{if(w.project)await chooseProject(w.project);else if(w.cards.length)await selectSession(w.cards[0].config.id);}catch(e){notice(e.message);}};
    const content=inline?document.createElement('div'):null;
    const {section,children}=inline?{section:content,children:content}:header(w.key,label,w.path,w.cards.length,w.project?.key===selectedProject,onselect,w.project?()=>openNewWorkspace(w.project.key):null,w.label+'에 세션 추가','workspace',w.project?.workspaceId?{kind:'workspace',id:w.project.workspaceId,name:w.label,path:w.path,default:!w.project.parentKey}:null);
    for(const c of matches){
     const button=document.createElement('button');button.className='task';button.dataset.sessionId=c.config.id;button.title=c.engine+' · '+c.state+' · '+c.config.id;button.setAttribute('aria-current',String(c.selected));button.disabled=busy||taskCreating;
     const dot=document.createElement('span');dot.className='task-dot'+(c.state==='승인 필요'?' amber':c.state==='작업 중'?' green':'');
     const text=document.createElement('span'),title=document.createElement('strong'),state=document.createElement('small');title.textContent=c.title;state.textContent=c.engine+' · '+c.state;text.append(title,state);button.append(dot,text);
     button.onclick=()=>{workspaceDrawer(false);selectSession(c.config.id).catch(e=>notice(e.message));};const row=document.createElement('div');row.className='session-row';row.append(button);if(navigationEnabled)row.append(navigationMenu({kind:'session',id:c.config.id,name:c.title,path:w.path}));children.append(row);
    }
    if(!matches.length){const empty=document.createElement('p');empty.className='project-no-sessions';empty.textContent=query?'일치하는 세션 없음':w.cards.length?'보기 설정으로 세션이 숨겨져 있습니다':'세션을 추가해 대화를 시작하세요';children.append(empty);}
    workspaceNodes.push(section);
   }
   if(!workspaceNodes.length)continue;
   if(sidebarDisplay.group==='flat'&&!inline){nodes.push(...workspaceNodes);continue;}
   const projectLabel=project.label+(inline&&project.workspaces[0].project.available===false?' · 폴더 확인 필요':'');
   const {section,children}=header(project.key,projectLabel,project.path,inline?project.workspaces[0].cards.length:project.workspaces.length,project.workspaces.some(w=>w.project?.key===selectedProject),()=>{if(collapsedProjects.has(project.key))collapsedProjects.delete(project.key);else collapsedProjects.add(project.key);renderWorkspace();},project.project?()=>openNewWorkspace(project.project.key):null,project.label+'에서 새 작업','project',project.project?.projectId?{kind:'project',id:project.project.projectId,name:project.label,path:project.path}:null);
   if(inline){children.className='project-sessions';children.append(...workspaceNodes[0].childNodes);}else children.append(...workspaceNodes);
   nodes.push(section);
  }
  if(!nodes.length&&query){const empty=document.createElement('p');empty.className='list-state';empty.textContent='검색 결과가 없습니다.';nodes.push(empty);}
  $('project-list').replaceChildren(...nodes);
 }
 $('session-count').textContent=String(groups.length);$('refresh-list').disabled=catalogBusy||busy||!token;
 $('list-state').textContent=!token?'로그인 필요':catalogBusy?'목록 상태 확인 중…':catalogChecked?`목록 조회 ${catalogChecked} · 선택한 대화는 실시간 갱신`:'목록 상태를 확인해 주세요.';
}
async function refreshCatalog(){
 if(!workspaceLayout||!token||catalogBusy)return;
 const mine=++catalogSerial,usedToken=token;catalogBusy=true;renderWorkspace();
 try{
  const config=await api('/config');
  const results=await Promise.allSettled(config.sessions.map(c=>api(`/api/sessions/${c.id}`)));
  if(mine!==catalogSerial||usedToken!==token)return;
  allSessionEntries=config.sessions;trialSessions=config.sessions.filter(s=>!s.hidden);
  results.forEach((r,i)=>{const id=config.sessions[i].id;if(id===sessionId&&session&&connected)return;sessionCards.set(id,r.status==='fulfilled'?{snapshot:r.value.session,stale:false}:{...sessionCards.get(id),stale:true});});
  $('session-select').replaceChildren(...trialSessions.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.label;return o;}));$('session-select').value=sessionId;
  catalogChecked=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
 }catch(e){if(mine===catalogSerial&&usedToken===token){sessionCards.forEach(c=>c.stale=true);notice(e.message);}}
 finally{catalogBusy=false;renderWorkspace();}
}
let workspaceView='chat',lastInspector='info';
function workspacePanel(view){
 if(!workspaceLayout)return;
 workspaceView=view;if(view!=='chat')lastInspector=view;
 const panel=view==='chat'?lastInspector:view;
 const label=view==='chat'?'상세 사이드바 보이기':'상세 사이드바 숨기기';
 $('info-tab').setAttribute('aria-expanded',String(view!=='chat'));$('info-tab').setAttribute('aria-label',label);$('info-tab').title=label;
 $('files').hidden=panel!=='files';$('tool-panel').hidden=panel!=='tools';$('session-info').hidden=panel!=='info';
 $('inspector-title').textContent=panel==='files'?'프로젝트 파일':panel==='tools'?'도구 실행 상세':'세션 정보';
 document.querySelector('.workspace').classList.toggle('inspector-visible',view!=='chat');
 $('chat').hidden=false;
 for(const [id,type] of [['session-info-tab','info'],['files-tab','files'],['tools-tab','tools']])$(id).setAttribute('aria-pressed',String(panel===type));
}
function workspaceDrawer(open){if(!workspaceLayout)return;$('sidebar').classList.toggle('open',open);$('scrim').hidden=!open;updateSidebarToggle();}
const compactSidebar=window.matchMedia('(max-width:760px)');
let sidebarCollapsed=false;
try{sidebarCollapsed=sessionStorage.getItem('maricode-sidebar-collapsed')==='true';}catch{}
function updateSidebarToggle(){
 if(!workspaceLayout)return;
 document.body.classList.toggle('sidebar-collapsed',sidebarCollapsed);
 const visible=compactSidebar.matches?$('sidebar').classList.contains('open'):!sidebarCollapsed;
 const label=visible?'프로젝트 사이드바 숨기기':'프로젝트 사이드바 보이기';
 $('open-nav').setAttribute('aria-expanded',String(visible));$('open-nav').setAttribute('aria-label',label);$('open-nav').title=label;
}

if(workspaceLayout){
 $('git-summary').onclick=()=>workspacePanel('info');$('git-refresh').onclick=()=>loadGit(true);
 $('tools-tab').onclick=()=>workspacePanel('tools');$('session-info-tab').onclick=()=>workspacePanel('info');$('info-tab').onclick=()=>workspacePanel(workspaceView==='chat'?lastInspector:'chat');$('back-chat').onclick=()=>workspacePanel('chat');
 updateSidebarToggle();
 compactSidebar.addEventListener('change',()=>workspaceDrawer(false));
 $('open-nav').onclick=()=>{if(compactSidebar.matches){workspaceDrawer(!$('sidebar').classList.contains('open'));return;}sidebarCollapsed=!sidebarCollapsed;try{sessionStorage.setItem('maricode-sidebar-collapsed',String(sidebarCollapsed));}catch{}updateSidebarToggle();};$('close-nav').onclick=()=>workspaceDrawer(false);$('scrim').onclick=()=>workspaceDrawer(false);
 $('search').oninput=renderWorkspace;$('refresh-list').onclick=refreshCatalog;
 setInterval(()=>{if(token&&!document.hidden&&!paused&&connectionState!=='denied'){refreshCatalog();loadGit();}},30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&connectionState!=='denied')refreshCatalog();});
}

function beginRecovery(){
 recovery?.stop();connected=false;workspaceOpened=false;
 recovery=createReadRecovery({read:openWorkspace,onState:state=>{if(state==='ready')return;showConnection(state);if(state==='expired'&&token)clearLogin('인증이 만료됐습니다. 다시 로그인해 주세요.','expired');}});
 recovery.start();
}
function reconnect(){
 if(!token)return;
 recovery?.stop();epoch++;streamController?.abort();connected=false;paused=false;$('stream-toggle').textContent='실시간 연결 끊기';
 if(workspaceOpened&&sessionId&&actions){showConnection('connecting');stream(epoch);}else beginRecovery();
}
reconnectButton.onclick=reconnect;
async function restoreLogin(){
 const attempt=epoch;
 const localCredential=document.getElementById('desktop-credential');
 let localToken='';if(localCredential){try{localToken=JSON.parse(localCredential.textContent);}catch{}localCredential.remove();window.history.replaceState(null,'','/workspace');}
 let device;
 try{if(!localToken)device=await restoreDeviceLogin(deviceStorage,fetch);}catch(e){showConnection('login-needed');notice(e.message);return;}
 if(attempt!==epoch)return;
 const saved=localToken||device?.token||readTabToken(sessionStorage);if(!saved){showConnection('login-needed');return;}
 deviceServerId=device?.serverId??'';token=saved;$('remember-login').checked=!localToken&&!device;$('remember-device').checked=!!device;beginRecovery();
}
$('remember-device').onchange=()=>{if($('remember-device').checked)$('remember-login').checked=false;};
$('remember-login').onchange=()=>{if($('remember-login').checked)$('remember-device').checked=false;};
window.addEventListener('storage',e=>{if(e.key===deviceLoginKey&&e.newValue===null&&deviceServerId)clearLogin('다른 창에서 로그아웃했습니다.');});
restoreLogin();


// Creation has its own project target, separate from the selected conversation.
const taskPendingKey='hapi-trial-new-task';
let taskCreating=false,taskProjectsReady=false,projectCatalog=[],selectedProject='';
let importHistorySupported=false;
const importedHistory=workspaceLayout?createImportedHistory({element:$('imported-history'),api}):null;
let draftProject=null,draftOptions=null,draftLoading=false,draftSerial=0,draftMessage='',draftContinue=false,draftSupportsGit=false,draftAccountSerial=0,draftGeneralSupported=false,draftDefaultsSerial=0,draftDefaultsLoading=false;
try{selectedProject=sessionStorage.getItem('maricode-project')||'';}catch{}
const claudeImportPanel=workspaceLayout?createClaudeImportPanel({element:$('claude-import-panel'),api,
 context:()=>({agent:$('task-agent').value,project:draftProject,path:projectCatalog.find(p=>p.key===draftProject)?.path,general:projectCatalog.find(p=>p.key===draftProject)?.general,projectAvailable:taskProjectsReady&&projectCatalog.some(p=>p.key===draftProject),busy:busy||taskCreating}),
 changed:value=>{taskCreating=value;busy=value;render();renderTaskCreation();},
 opened:async id=>{await openWorkspace();await selectSession(id);$('new-task-panel').hidden=true;workspaceDrawer(false);notice('기존 Claude 기록을 가져왔습니다. 실행 재개를 누르면 복사한 기록으로 이어갑니다. 이전 대화는 ‘가져온 이전 기록’에서 볼 수 있습니다.');}
}):null;

function taskPending(){try{return JSON.parse(sessionStorage.getItem(taskPendingKey)||'null');}catch{return null;}}
async function configureTasks(config){
 $('new-task-toggle').hidden=!config.newTask;draftGeneralSupported=config.newTask?.generalChat===true;$('draft-general-mode').hidden=!draftGeneralSupported;$('empty-general').hidden=!draftGeneralSupported;draftSupportsGit=!!config.newTask?.workspaceChoices;claudeImportPanel?.configure(config.claudeImport===true);
 if(config.newTask)await loadTaskProjects(true);
}
async function loadTaskProjects(followSession=false){
 taskProjectsReady=false;renderTaskCreation();
 try{
  const result=await api('/api/projects');projectCatalog=result.projects;
  if(followSession&&$('new-task-panel').hidden)selectedProject=sessionProject(projectCatalog,trialSessions.find(s=>s.id===sessionId),selectedProject);
  const chosen=draftProjectSelection(projectCatalog,taskPending()?.project??draftProject,selectedProject);
  taskProjectsReady=chosen!==null;
  if(draftProject===null&&chosen!==null)draftProject=chosen;
  renderDraftLocations();
  renderProjects();
 }catch(e){draftMessage='프로젝트 목록을 불러오지 못했습니다. '+e.message;}finally{renderTaskCreation();}
}
function renderDraftLocations(){
 const chosen=projectCatalog.find(p=>p.key===draftProject),rootId=p=>p.projectId??p.parentKey??p.key;
 const roots=projectCatalog.filter(p=>!p.parentKey&&!p.general);
 const options=roots.map(p=>{const o=document.createElement('option');o.value=rootId(p);o.textContent=p.projectLabel??p.label;return o;});
 if(!chosen){const o=document.createElement('option');o.value='';o.disabled=true;o.textContent='프로젝트를 선택하세요';options.unshift(o);}
 $('task-project-select').replaceChildren(...options);$('task-project-select').value=chosen?rootId(chosen):'';
 const workspaces=chosen?projectCatalog.filter(p=>rootId(p)===rootId(chosen)):[];
 $('task-workspace-select').replaceChildren(...workspaces.map(p=>{const o=document.createElement('option');o.value=p.key;o.textContent=p.workspaceLabel??(p.parentKey?p.label:'기본 작업공간');return o;}));
 $('task-workspace-select').value=chosen?.key??'';
}
async function openNewWorkspace(project=selectedProject){
 if(taskCreating||busy)return;
 rememberChat();notice('');
 draftProject=taskPending()?.project??(projectCatalog.some(p=>p.key===project)?project:draftProject);draftMessage='';draftContinue=false;draftOptions=null;
 $('new-task-panel').hidden=false;$('draft-git-options').open=false;workspacePanel('chat');workspaceDrawer(false);renderWorkspace();
 await loadTaskProjects();await inheritDraftDefaults();await loadWorkspaceChoices();refreshDraftAccount();
}
async function loadWorkspaceChoices(){
 const owner=++draftSerial,project=draftProject,auth=token;const previous=draftOptions?.owner===project?{mode:$('task-mode').value,branch:$('task-branch').value,key:$('task-worktree').value,name:$('task-worktree-name').value}:null;draftLoading=true;draftOptions=null;draftMessage='';renderTaskCreation();
 try{
  if(!taskProjectsReady)throw Error('프로젝트 폴더를 먼저 추가하거나 선택하세요.');
  const data=draftSupportsGit?await api('/api/workspace-choices?project='+encodeURIComponent(project)):{kind:'folder',branches:[],worktrees:[]};
  if(owner!==draftSerial||auth!==token||project!==draftProject)return;
  draftOptions={...data,owner:project};
  const pending=taskPending()?.workspace??previous;
  $('task-mode').value=pending?.mode==='branch'?'current':pending?.mode??'current';
  const branchOptions=data.branches.map(branch=>{const o=document.createElement('option');o.value=branch;o.textContent=branch+(branch===data.branch?' · 현재':'');return o;});
  if(!branchOptions.length){const o=document.createElement('option');o.value='';o.textContent=data.kind==='git'?'커밋 전 또는 분리된 HEAD':'Git 브랜치 없음';branchOptions.push(o);}
  $('task-branch').replaceChildren(...branchOptions);$('task-branch').value=pending?.branch??data.branch??'';
  $('task-worktree').replaceChildren(...data.worktrees.map(w=>{const o=document.createElement('option');o.value=w.key;o.textContent=w.label+' · '+w.path.split('/').at(-1);return o;}));
  if(pending?.key)$('task-worktree').value=pending.key;
  $('task-worktree-name').value=pending?.name??'';
 }catch(error){if(owner===draftSerial&&auth===token)draftMessage=error.message;}
 finally{if(owner===draftSerial){draftLoading=false;renderTaskCreation();}}
}
function draftWorkspace(){
 const mode=$('task-mode').value;
 if(mode==='existing')return {mode,key:$('task-worktree').value};
 if(mode==='new')return {mode,branch:$('task-branch').value,name:$('task-worktree-name').value.trim()};
 return draftOptions?.kind==='git'&&$('task-branch').value&&$('task-branch').value!==draftOptions.branch?{mode:'branch',branch:$('task-branch').value}:{mode:'current'};
}
async function inheritDraftDefaults(){
 if(taskPending())return;
 const project=projectCatalog.find(p=>p.key===draftProject),owner=draftProject,auth=token,ticket=++draftDefaultsSerial;
 const recent=recentWorkspaceSession(trialSessions.map(c=>{const s=sessionCards.get(c.id)?.snapshot;return {...c,agent:s?.metadata?.flavor??c.agent,updatedAt:s?.updatedAt??c.updatedAt};}),project?.path);
 draftInherited=null;draftDefaultsLoading=false;
 if(!recent){$('draft-defaults').textContent='최근 세션 없음 · 사용할 AI를 선택하세요.';return;}
 draftDefaultsLoading=true;$('task-agent').value=recent.agent;$('draft-defaults').textContent='이 작업공간의 최근 세션에서 '+(recent.agent==='claude'?'Claude':'Codex')+' 선택을 가져왔습니다.';renderTaskCreation();
 try{const data=await api('/api/sessions/'+encodeURIComponent(recent.id));if(ticket!==draftDefaultsSerial||owner!==draftProject||auth!==token||$('task-agent').value!==recent.agent)return;const s=data.session;
  if(s?.metadata?.path!==project.path||s.metadata.flavor!==recent.agent)return;
  draftInherited={agent:recent.agent,model:s.model??null,effort:(recent.agent==='codex'?s.modelReasoningEffort:s.effort)??null};
  $('draft-defaults').textContent+=' 모델 '+(draftInherited.model??'자동')+' / 추론 '+(draftInherited.effort??'자동')+'. 새 세션에서 지원하는 값만 적용합니다. 승인·접근 권한은 가져오지 않습니다.';
 }catch{if(ticket===draftDefaultsSerial&&owner===draftProject)$('draft-defaults').textContent+=' 모델·추론은 조회하지 못해 기본값을 사용합니다.';}
 finally{if(ticket===draftDefaultsSerial){draftDefaultsLoading=false;renderTaskCreation();}}
}
let draftInherited=null;
function renderTaskCreation(){
 if(!workspaceLayout)return;claudeImportPanel?.render();
 const pending=taskPending();if(pending)$('task-agent').value=pending.agent;
 const project=projectCatalog.find(p=>p.key===draftProject),mode=$('task-mode').value,git=!project?.general&&draftOptions?.kind==='git';
 $('draft-project-fields').hidden=!!project?.general;$('draft-general-note').hidden=!project?.general;
 $('draft-general-mode').setAttribute('aria-pressed',String(!!project?.general));$('draft-project-mode').setAttribute('aria-pressed',String(!project?.general));
 $('draft-general-mode').disabled=$('draft-project-mode').disabled=taskCreating||!!pending;
 $('task-project').textContent=project?.path??'프로젝트 폴더를 선택하세요.';
 $('task-project-select').disabled=taskCreating||!!pending;$('task-workspace-select').disabled=taskCreating||!!pending;
 $('check-task').hidden=!pending;$('check-task').disabled=taskCreating;
 $('park-task').hidden=!pending;$('park-task').disabled=taskCreating;
 for(const id of ['task-agent','task-mode','task-branch','task-worktree','task-worktree-name'])$(id).disabled=taskCreating||!!pending||id!=='task-agent'&&(!draftOptions||!git);
 for(const option of $('task-mode').options)option.disabled=option.value!=='current'&&(!git||!draftOptions?.head);
 $('draft-git-options').hidden=!git;$('draft-git-summary').textContent='브랜치·워크트리 선택'+(draftOptions?.branch?' · '+draftOptions.branch:'');
 $('draft-branch-field').hidden=!git||mode==='existing';$('draft-worktree-field').hidden=mode!=='existing';$('draft-name-field').hidden=mode!=='new';
 const valid=mode==='new'?!!$('task-worktree-name').value.trim()&&!!$('task-branch').value:mode==='existing'?!!$('task-worktree').value:!git||!!$('task-branch').value||!draftOptions?.branches.length;
 $('create-task').disabled=draftDefaultsLoading||taskCreating||!!pending&&!draftContinue||!taskProjectsReady||draftLoading||!draftOptions||!valid;
 $('create-task').textContent=draftContinue?'준비된 작업에서 세션 만들기':project?.general?'대화 시작':'세션 만들고 채팅 시작';
 document.querySelector('.task-create-heading h2').textContent=project?.general?'무엇을 이야기할까요?':'어디에서 작업할까요?';
 $('draft-workspace-refresh').disabled=taskCreating||draftLoading||!!pending;
 $('draft-add-project').disabled=taskCreating||!!pending;
 $('task-status').textContent=taskCreating?'작업 공간과 세션을 준비하고 있습니다…':pending?(draftContinue?'작업 공간은 준비됐고 세션 생성은 아직 시작되지 않았습니다. 같은 요청으로 계속할 수 있습니다.':'이전 요청의 결과 확인이 필요합니다. 작업 대상은 고정해 두었습니다.')+(draftMessage?'\n'+draftMessage:''):draftMessage;
 $('draft-workspace-note').textContent=draftLoading?'브랜치와 워크트리를 확인하고 있습니다…':mode==='new'?'선택한 브랜치의 커밋에서 새 작업 폴더를 만듭니다. 미커밋 변경은 옮기지 않습니다.':mode==='existing'?'기존 작업 폴더와 브랜치를 그대로 사용합니다. 기존 세션은 왼쪽 목록에서 이어갈 수 있습니다.':git&&$('task-branch').value!==draftOptions.branch?'선택한 브랜치로 현재 폴더를 전환합니다. 실행 중인 작업이나 미커밋 변경이 있으면 중단합니다.':draftOptions?.note??'현재 폴더의 파일과 작업 상태를 그대로 사용합니다.';
 const target=mode==='existing'?draftOptions?.worktrees.find(w=>w.key===$('task-worktree').value)?.path:mode==='new'?'앱 전용 폴더에 새 워크트리':project?.path;
 $('draft-target').hidden=!!project?.general;
 $('draft-target').textContent=(project?.projectLabel??project?.label??'프로젝트 미선택')+' → '+(mode==='new'?'새 작업공간':mode==='existing'?'기존 워크트리':project?.workspaceLabel??'기본 작업공간')+' → '+($('task-agent').value==='claude'?'Claude':'Codex')+'\n'+(target??'작업 위치 확인 중')+(git?'\n브랜치: '+(mode==='new'?$('task-worktree-name').value.trim()||'이름 입력':mode==='existing'?draftOptions?.worktrees.find(w=>w.key===$('task-worktree').value)?.branch:$('task-branch').value||'분리된 HEAD'):'');
}
async function createTask(checkOnly){
 if(taskCreating||busy||!token)return;
 let request=taskPending();
 if(!checkOnly&&request&&!draftContinue||checkOnly&&!request)return;
 if(!request){
  if($('create-task').disabled)return;
  request={requestId:crypto.randomUUID(),agent:$('task-agent').value,project:draftProject,...(draftSupportsGit?{workspace:draftWorkspace()}:{})};
  try{sessionStorage.setItem(taskPendingKey,JSON.stringify(request));sessionStorage.setItem('maricode-task-defaults:'+request.requestId,JSON.stringify(draftInherited));}catch{draftMessage='요청을 보관하지 못해 시작하지 않았습니다.';renderTaskCreation();return;}
 }
 draftContinue=false;taskCreating=true;busy=true;$('prompt').disabled=true;$('logout').disabled=true;render();renderTaskCreation();
 try{
  const result=await api('/api/tasks'+(checkOnly?'/check':''),{method:'POST',body:request});
  if(result.state==='prepared'||result.state==='none'){draftContinue=true;return;}
  if(result.state!=='created')return;
  await openWorkspace();await selectSession(result.session.id);
  sessionStorage.removeItem(taskPendingKey);$('new-task-panel').hidden=true;workspaceDrawer(false);
  let inherited;try{inherited=JSON.parse(sessionStorage.getItem('maricode-task-defaults:'+request.requestId));sessionStorage.removeItem('maricode-task-defaults:'+request.requestId);}catch{}
  let settingsNote='';
  if(inherited?.agent===request.agent){
   for(const field of ['model','effort']){
    await loadSettings();
    if(settingsPending()){settingsNote='설정 변경 결과 확인이 필요합니다.';break;}
    const options=settingsData?.[field==='model'?'models':'efforts'];
    if(settingsOwner!==sessionId||!settingsData?.editable||!options?.some(o=>o.value===inherited[field])){settingsNote='일부 이전 설정은 지원 여부를 확인하지 못해 적용하지 않았습니다.';continue;}
    if(settingsData.current[field]===inherited[field])continue;
    $(`setting-${field}`).value=inherited[field]??'';
    // Keep the creation UI locked while using the existing confirmed setting flow.
    await applySetting(field,true);
    if(settingsPending()){settingsNote='설정 변경 결과 확인이 필요합니다.';break;}
    if(settingsData?.current?.[field]!==inherited[field]){settingsNote='이전 설정을 적용하지 못했습니다. 채팅의 모델·추론 설정에서 확인하세요.';break;}
   }
  }
  notice('세션을 열었습니다. '+settingsNote);$('prompt').focus();
 }catch(error){
  if(error.rejected)sessionStorage.removeItem(taskPendingKey);
  draftMessage=error.message;if(error.reason==='AI_SETUP')await refreshDraftAccount();
 }finally{taskCreating=false;busy=false;$('prompt').disabled=false;$('logout').disabled=false;render();renderTaskCreation();}
}
async function refreshDraftAccount(){
 const serial=++draftAccountSerial,agent=$('task-agent').value,auth=token;
 $('draft-account-state').textContent='AI 로그인 상태 확인 중…';$('draft-account-login').hidden=true;
 try{const data=await api('/api/accounts');if(serial!==draftAccountSerial||auth!==token||agent!==$('task-agent').value)return;
  const provider=data.providers.find(p=>p.agent===agent);
  $('draft-account-state').textContent=({connected:'구독 로그인 연결됨','signed-out':'공식 로그인이 필요합니다.','not-configured':'AI 실행 파일을 먼저 연결하세요.','not-installed':'AI 실행 파일을 찾지 못했습니다.'})[provider?.state]??'로그인 상태를 확인하지 못했습니다.';
  $('draft-account-login').hidden=!(data.localLogin&&provider?.state==='signed-out'&&!provider.loginPending);
 }catch{if(serial===draftAccountSerial)$('draft-account-state').textContent='계정 상태를 확인하지 못했습니다. 이 화면에서 다시 확인할 수 있습니다.';}
}
if(workspaceLayout){
 $('draft-general-mode').onclick=$('empty-general').onclick=async()=>{
 if(busy||taskCreating||taskPending())return;busy=true;render();
 try{const r=await api('/api/conversations/prepare',{method:'POST',body:{}});await loadTaskProjects();busy=false;await openNewWorkspace(r.project);}
 catch(error){notice(error.message);}finally{busy=false;render();}
 };
 $('draft-project-mode').onclick=()=>{if(taskPending()||busy||taskCreating)return;draftProject=projectCatalog.find(p=>!p.general)?.key??null;taskProjectsReady=draftProject!==null;renderDraftLocations();loadWorkspaceChoices();inheritDraftDefaults().then(refreshDraftAccount);};
 $('close-new-task').onclick=()=>{$('new-task-panel').hidden=true;draftSerial++;renderWorkspace();};
 $('new-task-toggle').onclick=()=>openNewWorkspace();
 $('park-task').onclick=()=>{
  const request=taskPending();if(!request||taskCreating)return;
  if(!confirm('생성 결과가 미확인입니다. 기록을 보존하고 별도 요청을 준비할까요? 이미 생성된 작업은 삭제하지 않습니다.'))return;
  try{sessionStorage.setItem('hapi-trial-held-task:'+request.requestId,JSON.stringify(request));sessionStorage.removeItem(taskPendingKey);draftMessage='기존 기록은 보존했습니다.';renderTaskCreation();}catch{draftMessage='보관하지 못했습니다.';renderTaskCreation();}
 };
 $('create-task').onclick=()=>createTask(false);$('check-task').onclick=()=>createTask(true);
 for(const id of ['task-mode','task-branch','task-worktree','task-worktree-name'])$(id).addEventListener(id==='task-worktree-name'?'input':'change',renderTaskCreation);
 $('draft-workspace-refresh').onclick=loadWorkspaceChoices;$('draft-account-check').onclick=refreshDraftAccount;
 $('task-agent').onchange=()=>{draftDefaultsSerial++;draftDefaultsLoading=false;draftInherited=null;$('draft-defaults').textContent='선택한 AI로 새 세션을 만듭니다.';renderTaskCreation();refreshDraftAccount();};
 $('draft-account-login').onclick=async()=>{const agent=$('task-agent').value;$('draft-account-login').disabled=true;try{await api('/api/accounts/'+agent+'/login',{method:'POST',body:{}});$('draft-account-state').textContent='공식 로그인 창에서 완료한 뒤 로그인 상태 확인을 눌러 주세요.';}catch{$('draft-account-state').textContent='로그인 시작 상태를 확인하세요. 자동으로 다시 실행하지 않습니다.';}finally{$('draft-account-login').disabled=false;}};
 for(const field of ['group','sort','ended','details','compact']){
  const el=$('display-'+field);if(el.type==='checkbox')el.checked=sidebarDisplay[field];else el.value=sidebarDisplay[field];
  el.onchange=()=>{sidebarDisplay=displayPreferences({...sidebarDisplay,[field]:el.type==='checkbox'?el.checked:el.value});try{localStorage.setItem('maricode-display-preferences',JSON.stringify(sidebarDisplay));}catch{}renderWorkspace();};
 }
}
function settingsPending(){try{return JSON.parse(sessionStorage.getItem(`hapi-settings-pending:${sessionId}`));}catch{return null;}}
function settingsCurrent(){return {model:session?.model??null,effort:(session?.metadata?.flavor==='codex'?session?.modelReasoningEffort:session?.effort)??null};}
function renderSettings(){
 if(!workspaceLayout)return;
 const current=settingsCurrent(),pending=settingsPending(),label=v=>v??'자동 (실제 값 미확정)';
 $('model-name').textContent=({claude:'Claude',codex:'Codex'})[session?.metadata?.flavor]??'에이전트';
 $('model-chip').textContent=`모델: ${current.model??'자동'} ▾`;$('effort-chip').textContent=`추론: ${current.effort??'자동'} ▾`;
 $('model-chip').title=$('effort-chip').title='자동 값은 실제 실행값을 확정하지 않습니다.';
 $('settings-current').textContent=`서버 보고값: 모델 ${label(current.model)} / 추론 ${label(current.effort)}`;
 const allowed=settingsOwner===sessionId&&settingsData?.editable&&session?.active&&!session?.thinking&&session?.agentState?.controlledByUser===false&&!Object.keys(session?.agentState?.requests??{}).length&&!busy&&!settingsLoading&&connected&&!pending&&!actions?.pending;
 for(const field of ['model','effort']){$(`setting-${field}`).disabled=!allowed;$(`apply-${field}`).disabled=!allowed||!settingsData?.[field==='model'?'models':'efforts']?.length;}
 $('load-settings').disabled=busy||settingsLoading||!connected;
 if(pending)$('settings-status').textContent=`${pending.field==='model'?'모델':'추론'} 변경 결과 확인 필요 · 요청값 ${label(pending.value)}. 자동 재전송하지 않습니다. 결과 확인 전 대화 전송을 잠급니다.`;
}
async function loadSettings(){
 const id=sessionId,mine=++settingsSerial;settingsLoading=true;renderSettings();
 try{
  const result=await api(`/api/sessions/${id}/settings`);
  if(id!==sessionId||mine!==settingsSerial)return;
  settingsData=result;settingsOwner=id;
  for(const field of ['model','effort']){
   const select=$(`setting-${field}`),options=result[field==='model'?'models':'efforts'];
   select.replaceChildren(...options.map(item=>{const o=document.createElement('option');o.value=item.value??'';o.textContent=item.label;return o;}));
   if(!options.some(o=>o.value===result.current[field])){const o=document.createElement('option');o.value=result.current[field]??'';o.textContent=`현재: ${result.current[field]??'자동'} (목록 밖)`;o.disabled=true;select.prepend(o);}
   select.value=result.current[field]??'';
  }
  $('settings-source').textContent=result.source;
  const pending=settingsPending();
  if(pending&&result.current[pending.field]===pending.value)sessionStorage.removeItem(`hapi-settings-pending:${id}`);
  $('settings-status').textContent= result.editable?'서버 설정을 조회했습니다. 한 항목씩 적용하세요.':'입력 대기 중인 원격 세션에서만 변경할 수 있습니다.';
  await refresh();
 }catch(e){if(id===sessionId)$('settings-status').textContent=e.message;}
 finally{if(mine===settingsSerial){settingsLoading=false;render();}}
}
async function applySetting(field,fromCreation=false){
 if($(`apply-${field}`).disabled&&!(fromCreation&&taskCreating&&settingsOwner===sessionId&&settingsData?.editable))return;
 const id=sessionId,value=$(`setting-${field}`).value||null,expected={...settingsData.current};
 if(value===expected[field]){$('settings-status').textContent='이미 같은 값입니다.';return;}
 const key=`hapi-settings-pending:${id}`;
 try{sessionStorage.setItem(key,JSON.stringify({field,value}));}catch{$('settings-status').textContent='변경 요청 상태를 보관할 수 없어 실행하지 않았습니다.';return;}
 busy=true;render();
 try{
  await api(`/api/sessions/${id}/settings`,{method:'POST',body:{field,value,expected}});
 }catch(error){if(error.rejected)sessionStorage.removeItem(key);if(id===sessionId)$('settings-status').textContent=error.rejected?'전송 전에 거부됐습니다. 최신 설정을 확인해 주세요.':'설정 변경 결과가 불확실합니다. 결과 확인으로 조회해 주세요.';}
 finally{busy=fromCreation;if(id===sessionId){await loadSettings();render();}}
}
if(workspaceLayout){$('load-settings').onclick=loadSettings;$('apply-model').onclick=()=>applySetting('model');$('apply-effort').onclick=()=>applySetting('effort');}

let accountsBusy=false;
async function refreshAccounts(){
 if(accountsBusy||!token)return;
 const auth=token;accountsBusy=true;$('refresh-accounts').disabled=true;$('account-notice').textContent='실행 머신의 로그인 상태를 확인 중입니다.';
 try{
  const data=await api('/api/accounts');if(auth!==token)return;
  $('account-host').textContent=`확인 대상: ${data.host}`;
  const labels={connected:'구독 로그인 확인', 'signed-out':'로그인 필요', 'not-installed':'설치 경로에서 CLI를 찾지 못함','other-auth':'다른 인증 방식 사용 중 · 자동 변경 안 함','not-configured':'아직 연결하지 않은 AI',unknown:'상태 확인 실패 · 기존 인증을 변경하지 않음'};
  $('account-list').replaceChildren(...data.providers.map(p=>{
   const card=document.createElement('article'),h=document.createElement('h3'),status=document.createElement('p'),button=document.createElement('button');h.textContent=p.agent==='claude'?'Claude Code':'Codex';status.textContent=labels[p.state]??labels.unknown;
   const note=document.createElement('small');note.textContent=p.loginPending?'로그인 창 실행/진행 중입니다. Mac에서 완료한 뒤 상태를 다시 확인하세요.':data.localLogin?'계정 식별 정보는 공식 CLI에서 확인하세요.':'새 로그인은 해당 서버 Mac에서 진행해 주세요.';
   button.textContent='Mac에서 공식 로그인 시작';button.disabled=!data.localLogin||p.state!=='signed-out'||p.loginPending;button.onclick=()=>startAccountLogin(p.agent);card.append(h,status,note,button);return card;
  }));$('account-notice').textContent='상태 확인 완료. 기존 로그인은 그대로 사용합니다.';
 }catch{if(auth===token)$('account-notice').textContent='계정 상태를 확인하지 못했습니다. 연결과 서버 설정을 확인해 주세요.';}
 finally{accountsBusy=false;$('refresh-accounts').disabled=false;}
}
async function startAccountLogin(agent){
 if(accountsBusy)return;accountsBusy=true;for(const b of $('account-list').querySelectorAll('button'))b.disabled=true;
 try{await api(`/api/accounts/${agent}/login`,{method:'POST',body:{}});$('account-notice').textContent='Mac의 공식 로그인 창을 확인하세요. 완료 후 상태 확인을 누르세요.';}
 catch{$('account-notice').textContent='로그인 시작 결과를 확인하지 못했습니다. Mac 화면과 연결 상태를 먼저 확인하세요. 자동으로 다시 실행하지 않습니다.';}
 finally{accountsBusy=false;}
}
if(workspaceLayout){$('accounts-tab').onclick=()=>{workspacePanel('info');$('accounts-panel').open=true;refreshAccounts();};$('refresh-accounts').onclick=refreshAccounts;}

if(workspaceLayout){
 const panel=$('composer-settings');
 function closeSettings(){panel.hidden=true;for(const id of ['model-chip','effort-chip'])$(id).setAttribute('aria-expanded','false');}
 for(const field of ['model','effort'])$(field+'-chip').onclick=()=>{
  const opening=panel.hidden||panel.dataset.field!==field;closeSettings();if(!opening)return;
  panel.dataset.field=field;panel.hidden=false;$(field+'-chip').setAttribute('aria-expanded','true');
  $('settings-title').textContent=field==='model'?'모델 선택':'추론 수준';
  for(const f of ['model','effort'])$(f+'-field').hidden=f!==field;
  if(!settingsLoading&&!busy&&connected)loadSettings();
 };
 $('close-settings').onclick=closeSettings;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSettings();workspacePanel('chat');workspaceDrawer(false);}});
 document.addEventListener('click',e=>{if(!e.target.closest('.composer-wrap'))closeSettings();});
 $('prompt').addEventListener('input',()=>{const input=$('prompt');input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';});
}

async function chooseProject(project){
 if(busy||taskCreating)return false;
 rememberChat();
 if(project.key!==selectedProject){
  selectedProject=project.key;try{sessionStorage.setItem('maricode-project',selectedProject);}catch{}
  const first=trialSessions.find(s=>s.project===(project.path??project.label));
  if(first)await selectSession(first.id);else{epoch++;streamController?.abort();sessionId='';$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();session=null;messages=[];actions=null;permissionActions=null;connected=false;render();}
 }
 renderWorkspace();return true;
}
function renderProjects(){if(workspaceLayout&&$('project-list')){cardSignature='';renderWorkspace();}}

if(workspaceLayout){
 const bridge=window.webkit?.messageHandlers?.maricode;
 try{const agent=sessionStorage.getItem('maricode-new-session-agent');if(['codex','claude'].includes(agent))$('task-agent').value=agent;}catch{}
 if(bridge){$('add-project').hidden=false;$('add-project').onclick=()=>bridge.postMessage('add-project');
  $('prepare-task-agent').hidden=false;$('prepare-task-agent').onclick=()=>{try{sessionStorage.setItem('maricode-new-session-agent',$('task-agent').value);}catch{}bridge.postMessage($('task-agent').value);};
 }
 window.addEventListener('maricode-projects-changed',async event=>{await loadTaskProjects();const added=projectCatalog.find(p=>p.path===event.detail?.path);if(added)await openNewWorkspace(added.key);else renderWorkspace();});
 $('empty-action').onclick=()=>openNewWorkspace();
 $('task-project-select').onchange=()=>{const root=$('task-project-select').value;draftProject=projectCatalog.find(p=>!p.parentKey&&(p.projectId??p.key)===root)?.key??null;taskProjectsReady=draftProject!==null;renderDraftLocations();inheritDraftDefaults().then(()=>{renderTaskCreation();refreshDraftAccount();});loadWorkspaceChoices();};
 $('task-workspace-select').onchange=()=>{draftProject=$('task-workspace-select').value;taskProjectsReady=projectCatalog.some(p=>p.key===draftProject);inheritDraftDefaults().then(()=>{renderTaskCreation();refreshDraftAccount();});loadWorkspaceChoices();};
 if(bridge){$('draft-add-project').hidden=false;$('draft-add-project').onclick=()=>bridge.postMessage('add-project');}
}

function navigationMenu(target){
 const button=document.createElement('button');button.type='button';button.className='navigation-menu';button.append(navigationIcon('more'));button.title=target.name+' 관리';button.setAttribute('aria-label',button.title);button.disabled=busy||taskCreating;
 button.onclick=()=>openNavigation(target);return button;
}
function closeNavigation(){const dialog=$('navigation-dialog');dialog.close();dialog.hidden=true;}
function showNavigation(){const dialog=$('navigation-dialog');dialog.hidden=false;if(!dialog.open)dialog.showModal();}
function openNavigation(target){
 if(navigationPending||busy||taskCreating)return;navigationTarget={...target};
 showNavigation();$('navigation-edit').hidden=false;$('navigation-restores').hidden=true;$('navigation-confirm').hidden=true;
 $('navigation-title').textContent=({project:'프로젝트',workspace:'작업공간',session:'세션'})[target.kind]+' 관리';
 $('navigation-context').textContent=target.name+' · '+target.path;$('navigation-name').value=target.name;$('navigation-status').textContent='';
 $('navigation-remove').hidden=target.default===true;$('navigation-remove').textContent=target.kind==='session'?'목록에서 숨기기':'등록 해제';
 $('navigation-remove-help').textContent=target.default?'기본 작업공간은 프로젝트와 함께 등록 해제합니다.':target.kind==='session'?'실행이 끝난 세션을 목록에서 숨깁니다. 대화 기록은 삭제하지 않습니다.':target.kind==='project'?'하위 작업공간과 세션도 목록에서 제외합니다. 소스·Git·대화 기록은 그대로 남습니다.':'이 작업공간과 세션을 목록에서 제외합니다. 실제 폴더와 Git 워크트리는 삭제하지 않습니다.';
 $('navigation-name').focus();
}
async function changeNavigation(input){
 if(navigationPending)return;navigationPending=true;for(const b of $('navigation-dialog').querySelectorAll('button,input'))b.disabled=true;$('navigation-status').textContent='변경 중…';
 try{await api('/api/navigation',{method:'POST',body:input});await openWorkspace();closeNavigation();notice(input.action==='rename'?'표시 이름을 변경했습니다.':input.action==='restore'?'목록에 복원했습니다.':'목록에서 정리했습니다. 보기 설정에서 복원할 수 있습니다.');}
 catch(error){$('navigation-status').textContent=error.message+' 응답이 끊긴 경우 목록을 새로고침해 결과부터 확인하세요.';}
 finally{navigationPending=false;for(const b of $('navigation-dialog').querySelectorAll('button,input'))b.disabled=false;}
}
async function restoreNavigation(){
 if(navigationPending)return;$('display-preferences').open=false;navigationTarget=null;showNavigation();$('navigation-edit').hidden=true;$('navigation-restores').hidden=false;$('navigation-restores').replaceChildren();$('navigation-title').textContent='등록 해제·숨긴 항목';$('navigation-context').textContent='같은 항목으로 복원합니다. 세션을 새로 만들거나 실행하지 않습니다.';$('navigation-status').textContent='조회 중…';
 try{const data=await api('/api/navigation');if($('navigation-dialog').hidden||navigationTarget)return;
  const items=[...data.removed,...allSessionEntries.filter(s=>s.hidden).map(s=>({kind:'session',id:s.id,name:s.displayName??s.label}))];
  for(const item of items){const row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');label.textContent=({project:'프로젝트',workspace:'작업공간',session:'세션'})[item.kind]+' · '+item.name;button.textContent='복원';button.setAttribute('aria-label',item.name+' 복원');button.onclick=()=>changeNavigation({kind:item.kind,id:item.id,action:'restore'});row.append(label,button);$('navigation-restores').append(row);}
  $('navigation-status').textContent=items.length?'프로젝트를 복원하면 그 안의 숨긴 세션도 관리할 수 있습니다.':'복원할 항목이 없습니다.';
 }catch(e){$('navigation-status').textContent=e.message;}
}
if(workspaceLayout){
 $('navigation-dialog').addEventListener('cancel',e=>{e.preventDefault();if(!navigationPending)closeNavigation();});
 $('navigation-close').onclick=()=>{if(!navigationPending)closeNavigation();};
 $('navigation-rename').onclick=()=>{if(navigationTarget)changeNavigation({kind:navigationTarget.kind,id:navigationTarget.id,action:'rename',name:$('navigation-name').value});};
 $('navigation-remove').onclick=()=>{$('navigation-confirm').hidden=false;$('navigation-confirm-remove').textContent=navigationTarget.kind==='session'?'숨기기 확인':'등록 해제 확인';};
 $('navigation-cancel-remove').onclick=()=>{$('navigation-confirm').hidden=true;};
 $('navigation-confirm-remove').onclick=()=>{if(navigationTarget)changeNavigation({kind:navigationTarget.kind,id:navigationTarget.id,action:'remove'});};
 $('restore-navigation').onclick=restoreNavigation;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!navigationPending)closeNavigation();});
}

// Native close recovery uses this local workspace's existing authenticated API.
let quitDialogOpen=false;
const quitFlow=createQuitFlow({
 list:async()=>{const c=await api('/config');if(!Array.isArray(c.sessions))throw Error('세션 목록을 확인하지 못했습니다.');return c.sessions.map(s=>s.id);},
 read:async id=>(await api('/api/sessions/'+encodeURIComponent(id))).session,
 archive:(id,body)=>api('/api/sessions/'+encodeURIComponent(id)+'/archive',{method:'POST',body}),
 finish:()=>{const bridge=window.webkit?.messageHandlers?.maricode;if(bridge&&quitNonce){const nonce=quitNonce;quitNonce=null;bridge.postMessage('quit-ready:'+nonce);}}
});
let quitNonce=null;
window.addEventListener('pagehide',()=>{if(quitNonce)window.webkit?.messageHandlers?.maricode?.postMessage('quit-cancelled:'+quitNonce);quitNonce=null;});
window.addEventListener('maricode-close-request',async event=>{
 if(!workspaceLayout||!window.webkit?.messageHandlers?.maricode)return;
 const nonce=event.detail;if(typeof nonce!=='string'||!/^[-a-f0-9]{36}$/i.test(nonce))return;
 if(quitDialogOpen){quitNonce=nonce;const message=document.getElementById('quit-close-status');if(message)message.textContent='서버 종료가 아직 차단되어 있습니다. 돌아가기로 작업·연결·미확인 상태를 확인해 주세요.';return;}
 quitNonce=nonce;quitDialogOpen=true;
 const dialog=document.createElement('dialog');dialog.className='archive-dialog';dialog.setAttribute('aria-label','실행 종료 후 앱 닫기');
 const heading=document.createElement('h2');heading.textContent='앱을 닫기 전에 실행을 종료할까요?';
 const details=document.createElement('p');details.textContent='이 Mac의 실행 상태를 확인 중입니다…';
 const rows=document.createElement('ul'),status=document.createElement('p');status.id='quit-close-status';status.setAttribute('role','status');
 const buttons=document.createElement('div');buttons.className='archive-buttons';
 const cancel=document.createElement('button');cancel.textContent='돌아가기';cancel.autofocus=true;
 const confirm=document.createElement('button');confirm.textContent='실행 종료 후 앱 닫기';confirm.className='archive-confirm';confirm.disabled=true;
 cancel.onclick=()=>dialog.close();buttons.append(cancel,confirm);dialog.append(heading,details,rows,status,buttons);document.body.append(dialog);dialog.showModal();
 dialog.addEventListener('close',()=>{quitDialogOpen=false;if(quitNonce)window.webkit.messageHandlers.maricode.postMessage('quit-cancelled:'+quitNonce);quitNonce=null;dialog.remove();},{once:true});
 let approved;
 try{
  if(!token||busy||actions?.pending||permissionActions?.pending||settingsPending())throw Error('로그인·진행 중 요청·미확인 결과를 먼저 확인한 뒤 닫아 주세요.');
  approved=await quitFlow.review();if(!dialog.open)return;
  for(const p of approved.sessions){const li=document.createElement('li');li.textContent=p.label+' · '+p.agent;rows.append(li);}
  details.textContent=approved.sessions.length?'표시된 이 Mac 세션의 실행을 종료하고 앱을 닫습니다. 대화·파일·설정은 보존됩니다. 모든 창의 미전송 입력·첨부는 먼저 보관하세요. 원격 서버의 작업은 종료하지 않습니다.':'종료할 실행 세션이 없습니다. 미확인 작업이나 서버 상태 때문에 닫기가 막혔을 수 있습니다. 상태를 확인한 뒤 다시 닫아 주세요.';
  confirm.disabled=approved.sessions.length===0;
 }catch(e){status.textContent=e.message;}
 confirm.onclick=async()=>{
  confirm.disabled=true;cancel.disabled=true;busy=true;render();status.textContent='실행 종료 확인 중…';
  const prevent=e=>e.preventDefault();dialog.addEventListener('cancel',prevent);
  try{await quitFlow.confirm(approved);status.textContent='실행 종료 확인 완료 · 앱을 닫는 중…';}
  catch(e){status.textContent=e.message+' 앱은 열어 두었습니다.';}
  finally{busy=false;render();cancel.disabled=false;dialog.removeEventListener('cancel',prevent);}
 };
});
