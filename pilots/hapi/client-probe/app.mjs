import {cliProfileControls} from './cli-profile-ui.mjs';
import {supportedChatCommands,chatCommandName,chatCommandSupported} from './command-support.mjs';
import {bindComposerEnter} from './composer-input.mjs';
import {createClaudeImportPanel,createImportedHistory} from './claude-import-ui.mjs';
import {createQuitFlow} from './quit-flow.mjs';
import {requestQuestions,questionDecision} from './questions.mjs';
import {questionForm} from './question-form.mjs';
import {createAttachmentComposer} from './attachment-composer.mjs';
import {renderConversation,renderTool,renderEdit} from './chat-render.mjs';
import {formatDuration,describeTool,contextUsage} from './chat-presentation.mjs';
import {createCommandSuggest} from './composer-commands.mjs';
import {createFileMentions} from './file-mentions.mjs';
import {turnAlerts,alertText} from './turn-alerts.mjs';
import {createBranchPin} from './branch-pin-ui.mjs';
import {createFileTabs} from './file-viewer.mjs';
import {createFileTree} from './file-tree.mjs';
import {icon} from './icons.mjs';
import './vendor/vscode-elements/bundled.js';
import {pinSummary} from './branch-rules.mjs';
import {createPalette,createFind} from './palette.mjs';
import {permissionLabel,modelReadout,settingsControls,settingsDraft} from './settings.mjs';
import {saveDeviceLogin,clearDeviceLogin,restoreDeviceLogin,validServerId,deviceLoginKey} from './device-login.mjs';
import {renderMarkdown,copyButton} from './markdown.mjs';
import {draftRunnerLabel,draftAccountView,recentWorkspaceSession,workspaceSelection,sessionProject,draftProjectSelection,displayPreferences,createChatDrafts,moreBelow} from './workspace-entry.mjs';
import {createReadRecovery,connectionFailure} from './reconnect.mjs';
import {sessionPresentation,workspaceHierarchy,workspaceChrome,inlineDefaultWorkspace} from './workspace.mjs';
import {createHistory} from './history.mjs';
import {createGitReview} from './git-review.mjs';
import {toolViews,requestSnapshot,createPermissionActions,permissionChoices} from './workflow.mjs';
import {archiveSnapshot,archiveMatches,createActions,messageView,relativePath,createSSEDecoder,buildHandoff,confirmedDraft,handoffExcerpt,readTabToken,saveTabToken} from './core.mjs';
const deviceStorage=(()=>{try{return window.localStorage;}catch{return null;}})();
const $=id=>document.getElementById(id);
const navigationBranch=()=>icon('git-branch');
const navigationIcon=name=>icon({plus:'add',folder:'folder',workspace:'git-branch',down:'chevron-down',right:'chevron-right',more:'ellipsis'}[name]);
const workspaceLayout=document.body.dataset.layout==='workspace';
const chatDrafts=createChatDrafts(),questionDrafts=new Map();let permissionRenderKey='';
function rememberChat(){chatDrafts.save(sessionId,{text:$('prompt').value,note:$('handoff-note').textContent});}
const sessionCards=new Map(),firstPrompts=new Map();let catalogSerial=0,catalogBusy=false,catalogChecked=null,cardSignature='';
const collapsedProjects=new Set();
let sidebarDisplay=displayPreferences();try{sidebarDisplay=displayPreferences(JSON.parse(localStorage.getItem('maricode-display-preferences')));}catch{}
let navigationEnabled=false,allSessionEntries=[],navigationTarget=null,navigationPending=false;
let gitView={owner:'',data:null,loading:false,checked:0};
let alertSnapshots=new Map(),unseenAlerts=0,runnerHandoff=false,finder=null,palette=null,pairingEnabled=false;
let sessionTerminalEnabled=false,terminalBusy=false;
let commandSuggest=null,fileMentions=null,settingsData=null,settingsOwner='',settingsLoading=false,settingsSerial=0;
let deviceServerId='';
let token='',sessionId='',session=null,messages=[],actions,streamController,connected=false,paused=false,epoch=0,refreshSerial=0,fileSerial=0,refreshTimer,directory='',selectedFile='',fileLoaded=false,lastFileRequest=null,busy=false,trialSessions=[],permissionActions,history=createHistory(),loadingHistory=false,handoffEnabled=false,handoffState=null;
let recovery=null,workspaceOpened=false,connectionState='login-needed';
const connectionLabels={empty:'연결됨 · 작업 세션 없음','login-needed':'로그인 필요',restoring:'저장된 연결 복원 중',connecting:'서버 상태·이력 확인 중',live:'실시간 연결됨',unavailable:'서버 연결 실패 · 조회 재시도 중',expired:'인증 만료 · 다시 로그인 필요',outdated:'화면 업데이트 필요 · 입력을 보관한 뒤 새로고침',denied:'접근 불가 · 권한 또는 세션 확인 필요',paused:'연결 시험 중지'};
const connectionBanner=document.createElement('section');connectionBanner.className='connection-banner';
const serverLabel=document.createElement('span'),connectionLabel=document.createElement('strong'),reconnectButton=document.createElement('button');
serverLabel.textContent=location.origin;connectionLabel.setAttribute('role','status');reconnectButton.textContent='연결 상태 다시 조회';reconnectButton.type='button';
connectionBanner.append(serverLabel,connectionLabel,reconnectButton);if(!workspaceLayout)document.body.prepend(connectionBanner);
function showConnection(state){connectionState=state;const dot=document.querySelector('.host .dot');if(dot){dot.dataset.state=state;dot.title=connectionLabels[state]??state;}connectionLabel.textContent=connectionLabels[state]??state;if($('connection')){$('connection').textContent=connectionLabel.textContent;$('connection').dataset.connectionState=state;}reconnectButton.disabled=!token||['restoring','connecting'].includes(state);}
const pendingKey=()=>`hapi-d1-pending:${sessionId}`;
const notice=text=>{$('notice').textContent=text;};
// Success confirmations would otherwise sit in the status strip long after the reply arrives.
const briefNotice=text=>{notice(text);setTimeout(()=>{if($('notice').textContent===text)notice('');},5000);};
function renderHistorySummary(){
 const imported=importedHistory?.status;
 $('history-status').textContent=(imported?.imported?'이 앱에서 이어간 기록 ':'현재 대화 기록 ')+messages.length+'개'+(history.limited||messages.length>=1000?' · 표시 상한 1,000개':history.hasMore?' · 이전 기록 더 있음':'');
 if(!workspaceLayout)return;
 const label=$('imported-history-status');label.hidden=!imported?.imported&&!imported?.loading&&!imported?.error;
 label.textContent=imported?.error?'가져온 이전 기록: 조회 실패':imported?.loading?'가져온 이전 기록 확인 중…':`가져온 이전 기록 ${imported?.shown??0}/${imported?.total??0}개 표시`;
}
function storedPending(){try{return JSON.parse(sessionStorage.getItem(pendingKey()));}catch{return null;}}
async function api(path,{method='GET',body,signal}={}){
  const usedToken=token;
  const r=await fetch(path,{method,headers:{'X-Merry-Protocol':'1',...(token?{Authorization:`Bearer ${token}`} : {}),...(deviceServerId?{'X-Merry-Server-Id':deviceServerId}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:signal??AbortSignal.timeout(path.endsWith('/upload')?65000:path==='/api/tasks'||path==='/api/claude-import'||path.endsWith('/resume')||path.includes('/command-cards')?120000:15000)});
  if(r.status===426)throw Object.assign(Error('서버와 화면 버전이 맞지 않습니다. 입력 내용을 보관한 뒤 새로고침해 주세요. 이 요청은 실행되지 않았습니다.'),{status:426,rejected:true});
  if(r.status===401&&path!=='/api/pair'){if(usedToken&&usedToken===token)clearLogin('로그인이 만료됐습니다. 다시 연결해 주세요.','expired');throw Object.assign(Error('로그인 정보를 확인하고 다시 연결해 주세요.'),{status:401});}
  if(!r.ok){const error=Object.assign(Error(`요청 실패 (${r.status}). 상태를 다시 확인해 주세요.`),{status:r.status});if(path==='/api/session-terminal'||path.startsWith('/api/tasks')||path.startsWith('/api/claude-import')||path.startsWith('/api/codex-import')||path==='/api/account-profiles'||path==='/api/pair'||path.includes('/permissions/')||/\/(file|directory|resume)$/.test(path.split('?')[0])||path==='/api/navigation'||path.startsWith('/api/branch')||path.endsWith('/settings')||path.endsWith('/archive')){try{const detail=await r.json();error.rejected=detail.rejected===true;error.reason=detail.reason;if((error.rejected||detail.reason==='RUNNER_SETUP')&&typeof detail.error==='string')error.message=detail.error;}catch{}}throw error;}
  return r.json();
}
const attachmentComposer=workspaceLayout?createAttachmentComposer({form:$('send-form'),prompt:$('prompt'),context:()=>({id:sessionId,active:session?.active,connected,busy,pending:actions?.pending}),upload:(id,body)=>api(`/api/sessions/${id}/upload`,{method:'POST',body}),changed:()=>render(),notice}):null;
const base=()=>`/api/sessions/${sessionId}`;
// Pinned sessions: branchTurn marks a sent turn whose end (HAPI 'ready' event after seq) triggers the branch check.
const branchPin=workspaceLayout&&$('branch-pin')?createBranchPin({api,section:$('branch-pin'),banner:$('branch-banner'),changed:()=>refreshCatalog().catch(()=>{}),shown:()=>renderProjects()}):null;let branchTurn=null;
const fileTabs=workspaceLayout&&$('center-tabs')?createFileTabs({api,base,strip:$('center-tabs'),view:$('file-view'),host:document.querySelector('.conversation'),notice}):null;
const fileTree=fileTabs?createFileTree({api,base,list:$('entries'),open:(path,size)=>openFile(path,size),error:e=>fileError(e),active:()=>fileTabs.active}):null;
if(fileTree)$('up').hidden=true;
// Commands the chat cannot carry run in the official CLI on the same session (HAPI `resume`): Claude moves there until
// the app sends again; Codex shares the running session. The typed command is copied for pasting.
async function openSessionTerminal(command=''){
 if(terminalBusy||!sessionId||!sessionTerminalEnabled)return;
 let copied=false;if(command)try{navigator.clipboard.writeText(command).catch(()=>{});copied=true;}catch{}
 terminalBusy=true;render();const owner=sessionId;
 try{const r=await api('/api/session-terminal',{method:'POST',body:{id:owner}});if(owner!==sessionId)return;
  $('terminal-offer')?.remove();
  notice(`터미널에서 같은 세션을 열었습니다.${copied?` ${command}를 복사해 두었으니 터미널에 붙여넣으세요.`:''} ${r?.agent==='codex'?'Codex는 앱과 함께 쓸 수 있습니다.':'앱에서 메시지를 보내면 세션이 앱으로 돌아옵니다.'}`);
 }catch(e){if(owner===sessionId)notice(e.message+' 자동으로 다시 열지 않습니다.');}
 finally{terminalBusy=false;render();}
}
function offerTerminal(command){
 let box=$('terminal-offer');if(!box){box=document.createElement('div');box.id='terminal-offer';box.className='terminal-offer';box.setAttribute('role','status');$('composer-activity').before(box);}
 const text=document.createElement('p'),open=document.createElement('button'),close=document.createElement('button');
 text.textContent=`${command.split(/\s/)[0]}는 공식 CLI 화면이 필요한 명령입니다. 같은 세션을 터미널에서 열어 입력하세요. 대화는 이 앱에도 이어서 기록됩니다.`;
 open.type=close.type='button';open.className='primary';open.textContent='터미널에서 이 세션 이어가기';open.onclick=()=>openSessionTerminal(command);close.textContent='닫기';close.onclick=()=>box.remove();
 box.replaceChildren(text,open,close);open.disabled=!sessionTerminalEnabled||terminalBusy;
 if(!sessionTerminalEnabled)text.textContent+=' 터미널은 서버 Mac의 앱 화면에서만 열 수 있습니다.';
}

// Programmatic value changes (clear after send, handoff prefill, draft restore) fire no input event.
let fittedPrompt=null;
function fitPrompt(){const input=$('prompt');if(!input)return;fittedPrompt=input.value;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';}
function render(){
  if(workspaceLayout&&$('prompt').value!==fittedPrompt)fitPrompt();
  $('session-select').disabled=busy;
  const relation=trialSessions.find(s=>s.id===sessionId),nextAgent=session?.metadata?.flavor==='codex'?'Claude':'Codex';
  $('new-handoff').textContent=handoffState==='created'?'기존 인계 세션 열기':`새 ${nextAgent} 세션으로 인계 준비`;
  $('handoff-state').textContent=!handoffEnabled?'':handoffState==='pending'?'생성 응답을 기다리거나 결과 ID를 받지 못한 상태입니다. 결과 확인만 하며 새로 만들지 않습니다. 계속 이 상태면 서버 확인이 필요합니다.':handoffState==='verifying'?'생성된 세션 ID를 보관했습니다. 결과 확인으로 같은 세션을 재조회할 수 있습니다.':handoffState==='created'?'이 출처의 인계 세션이 있습니다. 다시 만들지 않고 기존 세션을 엽니다.':'';
  $('check-handoff').hidden=!handoffEnabled||!['pending','verifying'].includes(handoffState);
  $('check-handoff').disabled=busy||!connected;
  $('new-handoff').disabled=!!session?.resumeUnconfirmed||handoffEnabled&&!['none','created'].includes(handoffState)||busy||!connected||!session||session.thinking||!!actions?.pending||Object.keys(session?.agentState?.requests??{}).length>0;
  if(workspaceLayout)$('handoff-controls').hidden=!handoffEnabled&&!runnerHandoff&&!relation?.parentId;
 $('parent-session').hidden=!relation?.parentId;$('parent-session').disabled=busy;
  $('lineage').textContent=relation?.parentId?`별도 인계 세션 · 출처: ${trialSessions.find(s=>s.id===relation.parentId)?.label??relation.parentId}. 원래 native 세션을 이어가는 것이 아닙니다. 맥락 전송은 별도입니다.`:'';
  $('older').disabled=loadingHistory||!connected||!history.hasMore||history.limited||messages.length>=1000;
  renderHistorySummary();
  $('handoff').disabled=!!session?.resumeUnconfirmed||busy||!connected||!session||session.thinking||!!actions?.pending;
  $('title').textContent=session?.metadata?.name??'시험 세션';
  const waiting=Object.keys(session?.agentState?.requests??{}).length;
  const inTerminal=session?.active&&session.agentState?.controlledByUser===true;
  $('session-state').textContent=!session?'상태 확인 중':!connected?'연결 끊김 · 표시된 내용은 마지막 확인 상태':!session.active?'실행 종료 · 메시지를 보내면 같은 세션으로 이어집니다':inTerminal?'터미널에서 사용 중 · 앱에서 보내면 세션이 앱으로 돌아옵니다':waiting?'승인 대기 · 아래 요청 내용을 확인해 주세요':session.thinking?'답변 작성 중':'실행 중 · 입력 대기';
  if($('menu-terminal')){$('menu-terminal').hidden=!sessionTerminalEnabled||!session;$('menu-terminal').disabled=terminalBusy||!connected;}
  if($('open-terminal')){$('terminal-controls').hidden=!sessionTerminalEnabled;$('open-terminal').disabled=terminalBusy||!connected||!session||inTerminal;$('terminal-state').textContent=inTerminal?'지금 터미널에서 이 세션을 쓰고 있습니다.':'';}
  $('send').disabled=!!attachmentComposer?.uncertain||!!session?.resumeUnconfirmed||!!settingsPending()||busy||!connected||!session||waiting>0||!!actions?.pending;
  // While the engine works a sent message waits in HAPI's queue; stop asks the engine to end the current turn.
  if($('stop')){$('stop').hidden=!(session?.active&&session.thinking);$('stop').disabled=stopping||!connected;}
  if(session?.thinking&&$('session-state'))$('send').title='보내면 지금 작업이 끝난 뒤 전달됩니다';else $('send').title='보내기 (Enter) · 줄바꿈 (Shift+Enter)';
  $('retry-message').hidden=actions?.pending?.kind!=='send';
  $('retry-message').disabled=!!session?.resumeUnconfirmed||busy||!connected||!session?.active||session.thinking||waiting>0;
  $('retry-help').hidden=$('retry-message').hidden;
  $('archive').hidden=!session?.active;
  $('archive').disabled=!!session?.resumeUnconfirmed||busy||!connected||session?.thinking||session?.agentState?.controlledByUser!==false||waiting>0||!!actions?.pending||!!permissionActions?.pending||!!settingsPending();
  if(actions?.pending?.kind==='archive')$('session-state').textContent='종료 결과 확인 필요 · 상태 다시 확인을 눌러 주세요. 자동 재전송하지 않습니다.';
  if(session?.resumeUnconfirmed||actions?.pending?.kind==='resume')$('session-state').textContent=busy?'실행 환경을 준비하고 같은 세션을 다시 열고 있습니다…':'재개 결과 확인 필요 · 상태 다시 확인을 눌러 주세요. 자동 재전송하지 않습니다.';
  if(workspaceLayout){
    const chrome=workspaceChrome({session,connected,history,loadingHistory,messageCount:messages.length,pendingKind:session?.resumeUnconfirmed?'resume':actions?.pending?.kind});
    $('composer-activity').hidden=!chrome.activity||connected&&session?.active&&(waiting>0||session.thinking&&!session.resumeUnconfirmed&&!actions?.pending);
    $('history-bar').hidden=!chrome.older;
    $('older').textContent=loadingHistory?'이전 대화 불러오는 중…':'이전 대화 더 보기';
  }
  $('connection').textContent=connectionLabels[connectionState];
  attachmentComposer?.render();renderProgress();
  renderWorkflow();
  const scroller=$('conversation-history')??$('messages'),nearBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90;
  const canFork=workspaceLayout&&session?.metadata?.capabilities?.conversationHistory?.forkAtMessage===true&&session.active&&!session.thinking&&!busy&&!actions?.pending;
  renderConversation($('messages'),messages,{engine:session?.metadata?.flavor==='claude'?'Claude':'Codex',session,onFork:canFork?forkAt:null,onDiff:fileTabs?change=>{fileTabs.openDiff(change);if(compactSidebar.matches)workspacePanel('chat');}:null,onGitReview:workspaceLayout?()=>{revealInPanel('git-review');gitReview?.load?.(true);}:null,queued:{ids:queuedIds,busy:queueBusy,steer:session?.metadata?.flavor==='codex',onCancel:cancelQueued,onSteer:steerQueued}});finder?.refresh();
  if(workspaceLayout){const usage=contextUsage(messages),k=v=>v>=1000?Math.round(v/1000)+'K':String(v),el=$('context-usage');
   el.hidden=!usage;el.textContent=usage?`컨텍스트 ${k(usage.used)}${usage.window?` / ${k(usage.window)} · ${Math.round(usage.used/usage.window*100)}%`:''}`:'';
   el.classList.toggle('high',!!usage?.window&&usage.used/usage.window>=0.8);
   el.title=usage?`마지막 응답 기준 엔진 보고값 · ${usage.used.toLocaleString()} 토큰${usage.window?` / 한도 ${usage.window.toLocaleString()}`:' · 한도 미보고'}`:'';}
  if(nearBottom)scroller.scrollTop=scroller.scrollHeight;
  updateJumpLatest();
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
    const title=document.createElement('h3');title.textContent=`${String(request.tool).replace(/^Codex(?=[A-Z])/,'Codex ')} 실행 허용`;
    const summary=document.createElement('p');summary.className='permission-summary';
    const target=String(request.arguments?.command??request.arguments?.file_path??request.arguments?.path??request.arguments?.message??'AI가 다음 작업의 허용을 요청했습니다.'),root=session?.metadata?.path;
    // Paths inside the project read better relative; the full path stays available on hover.
    summary.textContent=root&&!request.arguments?.command&&target.startsWith(root+'/')?target.slice(root.length+1):target;summary.title=target;
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
  // Only the older single-page layout keeps a separate tool list; the workspace shows tools inline in the chat.
  if($('tools')){const opened=new Set([...$('tools').querySelectorAll('details[open]')].map(x=>x.dataset.callId));
  const tools=toolViews(messages).map(tool=>renderTool(tool,opened.has(tool.id),session?.metadata?.path));
  $('tools').replaceChildren(...tools);$('tools-empty').hidden=tools.length>0;}
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
  if(!history.hasMore&&!firstPrompts.has(sessionId)){const first=messages.map(messageView).find(v=>v?.role==='user'&&v.text?.trim());if(first)firstPrompts.set(sessionId,first.text.trim().replace(/\s+/g,' ').slice(0,80));}
  if(confirmedDraft(messages,actions.pending,$('prompt').value.trim())){$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();}
  if(workspaceLayout&&session?.id===sessionId&&alertSnapshots.size)alertSnapshots.set(sessionId,session);
  if(branchTurn?.id===sessionId&&messages.some(m=>m.seq>branchTurn.seq&&m.content?.content?.type==='event'&&m.content.content.data?.type==='ready')){branchTurn=null;branchPin?.afterTurn(sessionId);}
  refreshQueue(mine);
  const previousPending=actions.pending,released=actions.reconcile(messages,session.active,session.resumeUnconfirmed);
  permissionActions?.reconcile(session?.agentState?.requests??{});
  if(released==='resume-not-started')notice('재개가 시작되지 않았습니다. AI 연결·로그인 상태와 원래 기록을 확인한 뒤 메시지를 다시 보내 주세요. 자동으로 다시 시도하지 않습니다.');
  else if(actions.pending)notice('이전 요청의 접수 여부를 확인 중입니다. 자동으로 다시 보내지 않습니다.');
  else if(previousPending)briefNotice(previousPending.kind==='resume'?'같은 세션을 다시 열었습니다. 대화를 이어가세요.':previousPending.kind==='archive'?'실행을 종료했습니다. 대화 기록과 파일은 보존됩니다.':'메시지 접수를 확인했습니다.');
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
 const auth=token;const config=await api('/config');sessionTerminalEnabled=config.sessionTerminal===true;if(!auth||token!==auth)return;importHistorySupported=config.claudeImport===true;pairingEnabled=config.pairing===true;if(workspaceLayout)$('pairing-open').hidden=!pairingEnabled;allSessionEntries=config.sessions;trialSessions=config.sessions.filter(s=>!s.hidden);navigationEnabled=!!config.navigation;if($('restore-navigation'))$('restore-navigation').hidden=!navigationEnabled;handoffEnabled=!!config.newHandoff;$('new-handoff').hidden=!handoffEnabled&&!(runnerHandoff=!!config.newTask&&!config.newHandoff);
 $('session-select').replaceChildren(...trialSessions.map(s=>{const option=document.createElement('option');option.value=s.id;option.textContent=s.label;return option;}));
 if(!trialSessions.length){
  rememberChat();$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();
  epoch++;streamController?.abort();connected=false;sessionId='';session=null;messages=[];actions=null;permissionActions=null;
  $('login').hidden=true;$('workspace').hidden=false;showConnection('empty');render();
  notice(config.newTask?.generalChat?'프로젝트 작업 또는 일반 대화를 선택하고 AI와 대화를 시작하세요.':'프로젝트를 선택하고 새 세션에서 사용할 AI를 고르세요.');
  if(workspaceLayout){await configureTasks(config);refreshCatalog();}workspaceOpened=true;return;
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
  // An 8-character XXXX-XXXX value is a one-time pairing code, never an access token.
  const result=/^[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{4}$/.test(credential.trim())?await api('/api/pair',{method:'POST',body:{code:credential.trim()}}):await api('/api/auth',{method:'POST',body:{accessToken:credential}});
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
  settingsSerial++;settingsData=null;settingsOwner='';settingsLoading=false;commandSuggest?.reset();fileMentions?.reset();
  if(workspaceLayout){$('composer-settings').hidden=true;for(const id of ['model-chip','effort-chip','permissionMode-chip'])$(id).setAttribute('aria-expanded','false');$('setting-model').replaceChildren();$('setting-effort').replaceChildren();$('setting-extras').replaceChildren();$('setting-permissionMode').replaceChildren();$('permission-description').textContent='';$('settings-source').textContent='';$('settings-status').textContent='이 세션의 설정을 조회해 주세요.';}
  sessionId=id;branchTurn=null;fileTabs?.clear();fileTree?.clear();branchPin?.load(id);$('terminal-offer')?.remove();if(workspaceLayout){selectedProject=sessionProject(projectCatalog,trialSessions.find(s=>s.id===id),selectedProject);renderProjects();}session=null;messages=[];history=createHistory();loadingHistory=false;handoffState=null;connected=false;paused=false;directory='';selectedFile='';fileLoaded=false;lastFileRequest=null;fileFeedback('');
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
  sessionTerminalEnabled=false;$('terminal-offer')?.remove();attachmentComposer?.clearAll();questionDrafts.clear();chatDrafts.clear();if($('navigation-dialog'))closeNavigation();
  recovery?.stop();
  saveTabToken(sessionStorage,'',false);clearDeviceLogin(deviceStorage);deviceServerId='';
  catalogSerial++;sessionCards.clear();firstPrompts.clear();catalogChecked=null;cardSignature='';
  epoch++;refreshSerial++;fileSerial++;streamController?.abort();clearTimeout(refreshTimer);refreshTimer=null;token='';session=null;messages=[];connected=false;permissionActions=null;
  if(workspaceLayout){$('account-list').replaceChildren();$('account-host').textContent='연결 상태를 조회해 주세요.';$('account-notice').textContent='';}
  $('workspace').hidden=true;$('login').hidden=false;fileTabs?.clear();$('messages').replaceChildren();$('file-content').textContent='';$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();showConnection(state);render();notice(message);
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
    const panel=$('conversation-history')??$('messages'),height=panel.scrollHeight,top=panel.scrollTop;
    messages=history.messages;render();panel.scrollTop=top+(panel.scrollHeight-height);
    notice('이전 이력을 추가로 불러왔습니다.');
  }catch(e){if(mine===epoch)notice(e.message);}finally{if(mine===epoch){loadingHistory=false;render();}}
};
$('sync').onclick=()=>Promise.resolve(connectionState==='live'?refresh():reconnect()).catch(e=>notice(e.message));
$('stream-toggle').onclick=()=>{
  paused=!paused;epoch++;streamController?.abort();connected=false;
  $('stream-toggle').textContent=paused?'다시 연결':'실시간 연결 끊기';showConnection(paused?'paused':'connecting');render();
  if(!paused)stream(epoch);
};
$('send-form').addEventListener('submit',async e=>{
  e.preventDefault();if($('send').disabled)return;
  const text=$('prompt').value.trim();if(!text&&!attachmentComposer?.count)return;
  const mine=epoch;let submitted=false;busy=true;render();
  try{
    if(chatCommandName(text)){
      let catalog=null;try{catalog=await api(base()+'/slash-commands');}catch{}
      if(mine!==epoch)return;
      if(!catalog?.success||!chatCommandSupported(session?.metadata?.flavor,text,catalog.commands)){offerTerminal(text);notice('채팅으로 보내지 않았습니다. 입력은 그대로 있습니다.');return;}
    }
    await refresh();if(mine!==epoch||!connected)return;
    if(branchPin&&(await branchPin.beforeSend(sessionId)!=='send'||mine!==epoch))return;
    // An ended session resumes first; the message goes out only after the resume is confirmed (never resent blind).
    if(!session.active&&!actions.pending&&!session.resumeUnconfirmed){
     const resumed=await resumeForAction('같은 세션을 다시 열고 있습니다. 열리면 메시지를 보냅니다…');
     if(mine!==epoch)return;
     if(!resumed){notice('세션 재개를 아직 확인하지 못해 메시지는 보내지 않았습니다. 입력은 그대로 있습니다. 상태를 확인한 뒤 다시 보내 주세요.');return;}
    }
    if(!session.active||Object.keys(session.agentState?.requests??{}).length||actions.pending)return;
    const attachments=await attachmentComposer?.prepare()??[];if(mine!==epoch)return;submitted=true;if(branchPin?.pinned)branchTurn={id:sessionId,seq:Math.max(0,...messages.map(m=>m.seq??0))};const result=actions.send(text,attachments);render();await result;if(mine!==epoch)return;if($('prompt').value.trim()===text){$('prompt').value='';$('handoff-note').textContent='';attachmentComposer?.clear();}await refresh();
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
// Returns true once the session is confirmed ended. `ask` is false when the caller already confirmed.
async function endCurrentSession(ask=true){
  if($('archive').disabled){if(!ask)notice('지금은 세션 실행을 종료할 수 없습니다. 답변·승인 대기가 끝난 뒤 다시 시도하세요.');return false;}
  const mine=epoch,id=sessionId,label=$('title').textContent;
  let approval;try{approval=archiveSnapshot(id,session);}catch(error){notice(error.message);return false;}
  if(ask&&!await confirmArchive(label,id))return false;
  if(mine!==epoch||id!==sessionId)return false;
  busy=true;render();
  try{
    await refresh();
    if(mine!==epoch||id!==sessionId||!connected||!session?.active||session.thinking||Object.keys(session.agentState?.requests??{}).length||actions.pending||permissionActions?.pending||settingsPending())return;
    if(!archiveMatches(approval,sessionId,session))throw Error('확인하는 동안 세션 상태가 바뀌었습니다. 내용을 확인한 뒤 다시 종료해 주세요.');
    const request=actions.archive(approval.expected);render();await request;await refresh();
    notice(session?.active?'종료 요청을 보냈습니다. 상태 다시 확인으로 종료 여부를 확인해 주세요.':'세션 실행을 종료했습니다. 대화 기록은 보존됩니다. 다른 활성 세션도 종료한 뒤 앱을 닫을 수 있습니다.');
    return !session?.active;
  }catch(error){notice(error.message);return false;}finally{busy=false;render();}
}
$('archive').onclick=()=>endCurrentSession();
// Resume runs only for an action (send, settings apply), never on opening. Callers hold busy.
// true only once the session is confirmed active; otherwise nothing that depends on it is sent.
async function resumeForAction(status){
  const mine=epoch;$('session-state').textContent=status;
  await actions.resume();
  for(let i=0;i<40&&mine===epoch;i++){await refresh();if(session.active&&!actions.pending)break;await new Promise(r=>setTimeout(r,750));}
  return mine===epoch&&!!session?.active&&!actions.pending;
}
function tab(files){if(workspaceLayout){workspacePanel(files?'files':'chat');if(files&&!fileLoaded)openPath(directory,'directory');return;}$('files').hidden=!files;$('chat').hidden=files;$('files-tab').setAttribute('aria-pressed',String(files));$('chat-tab').setAttribute('aria-pressed',String(!files));if(files&&!fileLoaded)openPath(directory,'directory');}
if($('chat-tab'))$('chat-tab').onclick=()=>tab(false);$('files-tab').onclick=()=>tab(true);
async function openPath(path,kind){
  if(fileTree&&kind==='directory'){const serial=++fileSerial;lastFileRequest={path:'',kind};fileLoaded=true;fileFeedback('불러오는 중…');if(await fileTree.reload()&&serial===fileSerial)fileFeedback('');return;}
  const serial=++fileSerial,authEpoch=epoch;path=relativePath(path);lastFileRequest={path,kind};fileLoaded=true;fileFeedback('불러오는 중…');
  try{
    let d;
    if(kind!=='file')d=await api(base()+'/directory?path='+encodeURIComponent(path));
    if(serial!==fileSerial||authEpoch!==epoch)return;
    if(d?.success){
      directory=path;selectedFile='';$('file-title').textContent='';$('file-content').textContent='';fileFeedback('');$('path').textContent=path||'프로젝트 폴더';$('up').disabled=!path;
      const nodes=d.entries.map(entry=>{const li=document.createElement('li'),btn=document.createElement('button');btn.textContent=entry.name;btn.dataset.kind=entry.type;btn.title=entry.type==='directory'?'폴더':entry.type==='file'?'파일':'링크·기타';btn.onclick=()=>{const p=[path,entry.name].filter(Boolean).join('/');if(fileTabs&&entry.type==='file')openFile(p,entry.size);else openPath(p,entry.type);};li.append(btn);return li;});
      $('entries').replaceChildren(...nodes);notice('폴더 목록을 서버에서 읽었습니다.');
    }else{
      if(kind==='directory')throw Error('폴더를 열 수 없습니다.');
      if(fileTabs){fileFeedback('');openFile(path);return;}
      const f=await api(base()+'/file?path='+encodeURIComponent(path));
      if(serial!==fileSerial||authEpoch!==epoch)return;
      if(!f.success||typeof f.content!=='string')throw Error('파일을 열 수 없습니다.');
      const bytes=Uint8Array.from(atob(f.content),c=>c.charCodeAt(0));
      selectedFile=path;fileFeedback('');$('file-title').textContent=path;$('file-content').textContent=new TextDecoder().decode(bytes);notice('읽기 전용 파일 보기');
    }
  }catch(e){if(serial===fileSerial&&authEpoch===epoch)fileError(e);}
}
const fileError=e=>fileFeedback(e.message.includes('(403)')?'프로젝트 밖의 링크이거나 접근할 수 없는 경로입니다.':e.message,true,e.reason==='RUNNER_OFFLINE');
// Workspace layout opens files as center tabs; the narrow layout closes the inspector overlay to show them.
function openFile(path,size){fileTabs.open(path,{size});fileTree?.render();if(compactSidebar.matches)workspacePanel('chat');}
const fileStatus=document.createElement('div');fileStatus.className='file-feedback';fileStatus.setAttribute('role','status');$('entries').before(fileStatus);
function fileFeedback(message,retry=false,offline=false){
 fileStatus.replaceChildren();if(!message)return;const text=document.createElement('p');text.textContent=message;fileStatus.append(text);
 if(retry){const button=document.createElement('button');button.textContent='다시 읽기';button.onclick=()=>lastFileRequest&&openPath(lastFileRequest.path,lastFileRequest.kind);fileStatus.append(button);}
 if(offline){if(document.querySelector('a[href="/setup"]')){const setup=document.createElement('a');setup.href='/setup';setup.textContent='컴퓨터 설정에서 실행 환경 시작';fileStatus.append(setup);}else{const guide=document.createElement('p');guide.textContent='실행 서버에서 실행 환경을 시작한 뒤 다시 읽어 주세요.';fileStatus.append(guide);}}
}
$('up').onclick=()=>openPath(directory.split('/').slice(0,-1).join('/'),'directory');
$('files-refresh').onclick=()=>fileTree?openPath('','directory'):openPath(selectedFile||directory,selectedFile?'file':'directory');
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
  const config=await api('/config');sessionTerminalEnabled=config.sessionTerminal===true;if(mine!==epoch)return;allSessionEntries=config.sessions;trialSessions=config.sessions.filter(s=>!s.hidden);
  $('session-select').replaceChildren(...trialSessions.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.label;return o;}));
  const target=result.session,text=buildHandoff(source,target,original,{hasOlder,limited});
  await selectSession(target.id);if(sessionId!==target.id||!token)return;
  $('prompt').value=text;
  const report=handoffExcerpt(original);
  $('handoff-note').textContent=`새 인계 세션 · ${source.label} → ${target.label} · 텍스트 ${report.included}개 포함, ${report.omitted}개 생략, ${report.truncated}개 일부 잘림. 아직 전송하지 않았습니다. 내용을 검토하고 보내기를 누르세요.`;
  notice('출처별 인계 세션은 하나만 만듭니다. 같은 요청은 기존 인계 세션을 엽니다.');
 }catch(e){if(mine===epoch){await refresh().catch(()=>{});notice(e.message+' 인계 생성 결과 확인으로 조회할 수 있습니다.');}}finally{busy=false;render();}
}
// Runner workspaces hand off through the normal new-session request (same requestId guard and
// check flow); the excerpt is only placed in the composer for review, never sent automatically.
const handoffPlaceholder='00000000-0000-4000-8000-000000000000';
async function prepareRunnerHandoff(){
 if($('new-handoff').disabled||taskCreating)return;
 if($('prompt').value.trim()){notice('작성 중인 메시지를 먼저 보내거나 비워 주세요.');return;}
 if(taskPending()){notice('확인되지 않은 새 대화 생성 요청이 있습니다. 새 대화 화면에서 결과를 먼저 확인하세요. 새로 만들지 않았습니다.');return;}
 try{await refresh();}catch{}
 if(!session||session.thinking||actions.pending||Object.keys(session.agentState?.requests??{}).length){notice('현재 작업이 끝난 뒤 인계해 주세요.');return;}
 const source=trialSessions.find(s=>s.id===sessionId),agent=session.metadata?.flavor==='codex'?'claude':'codex',project=projectCatalog.find(p=>p.path===source?.project);
 if(!source||!project){notice('이 대화의 프로젝트를 찾지 못해 인계하지 않았습니다.');return;}
 let text;try{text=buildHandoff(source,{id:handoffPlaceholder,label:'새 인계 세션'},messages,{hasOlder:history.hasMore||history.limited,limited:history.limited});}catch(e){notice(e.message);return;}
 const request={requestId:crypto.randomUUID(),agent,project:project.key,handoffFrom:source.id,workspace:{mode:'current'}};
 try{sessionStorage.setItem('maricode-handoff:'+request.requestId,JSON.stringify({text,source:source.label,report:handoffExcerpt(messages)}));sessionStorage.setItem(taskPendingKey,JSON.stringify(request));}catch{notice('요청을 보관하지 못해 인계하지 않았습니다.');return;}
 if(claudeImportPanel?.pending){notice('확인이 필요한 가져오기 요청이 있어 인계하지 않았습니다. 새 대화 화면에서 가져오기 결과를 먼저 확인하세요.');return;}
 // createTask is a no-op while the new-session panel is in import mode.
 draftSessionMode='new';draftContinue=true;await createTask(false);
 if(taskPending())notice('인계 세션 생성 결과를 확인하지 못했습니다. 새 대화 화면의 결과 확인을 눌러 주세요. 다시 만들지 않습니다.');
}
$('new-handoff').onclick=()=>runnerHandoff&&!handoffEnabled?prepareRunnerHandoff():prepareNewHandoff();
$('check-handoff').onclick=()=>prepareNewHandoff(true);

const gitReview=workspaceLayout?createGitReview({element:$('git-review'),api,base,openDiff:change=>{fileTabs?.openDiff(change);if(compactSidebar.matches)workspacePanel('chat');},owner:()=>sessionId&&token?`${epoch}:${sessionId}`:null,untracked:()=>gitView.data?.state==='ready'?gitView.data.untracked:0}):null;
let reviewOwner=null;
function renderGit(){
 if(!workspaceLayout)return;
 if(reviewOwner!==`${epoch}:${sessionId}`){reviewOwner=`${epoch}:${sessionId}`;gitReview?.reset();}
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
 // Only a ready result is cached; an inactive session's failure must not hide status right after resume.
 if(gitView.owner===owner&&(gitView.loading||!force&&gitView.data?.state==='ready'&&Date.now()-gitView.checked<30000))return;
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
 if($('empty-workspace')){$('empty-workspace').hidden=!empty;$('empty-description').textContent=projectCatalog.length?'프로젝트에서 새 대화를 시작하거나 기존 대화를 가져오세요.':draftGeneralSupported?'프로젝트 없이 일반 대화를 시작하거나, 작업할 프로젝트 폴더를 추가하세요.':'프로젝트 폴더를 추가하면 이곳에서 AI와 작업할 수 있습니다.';$('empty-action').textContent=projectCatalog.length?'대화 추가':'프로젝트 폴더 추가';$('empty-action').hidden=!projectCatalog.length&&!window.webkit?.messageHandlers?.maricode;}

 const config=trialSessions.find(s=>s.id===sessionId)??{id:sessionId,label:'작업 세션'};
 const current=sessionPresentation({...config,firstPrompt:firstPrompts.get(sessionId)},session,{stale:!!session&&!connected});
 $('title').textContent=sessionId?current.title:'새 작업을 시작하세요';$('session-status').textContent=actions?.pending?.kind==='archive'?'종료 결과 확인 필요':current.state;
 $('project-name').textContent=current.project;$('model-name').textContent=current.engine;
 $('selected-short-id').textContent=current.shortId;
 $('info-workspace').textContent=current.workspace;$('info-workspace').title=current.workspaceId??'';$('info-engine').textContent=current.engine;$('info-state').textContent=current.state;
 $('info-id').textContent=sessionId||'확인 중';$('info-path').textContent=session?.metadata?.path??'확인 중';
 $('info-host').textContent=session?.metadata?.host??'확인 중';$('host-name').textContent=session?.metadata?.host??'서버 확인 중';
 $('execution-target').textContent=`실행 서버 · ${current.host||'확인 중'}`;
 $('send-target').textContent=`${current.host||'확인 중'} · ${current.project}`;
 $('file-server').textContent=`파일 위치 · ${current.host||'확인 중'}`;
 $('new-task-server').textContent=`실행 컴퓨터 · ${sessionCards.get(trialSessions[0]?.id)?.snapshot?.metadata?.host||'현재 연결 서버'}`;
 $('approval-guidance').textContent=`${current.host||'확인 중'} / ${current.project}의 요청입니다. 표시된 한 건만 허용하거나 거절합니다.`;
 $('approval-guidance').hidden=true;
 if(empty){$('session-status').textContent='세션 없음';$('host-name').textContent=window.webkit?.messageHandlers?.maricode?'이 Mac':'연결된 컴퓨터';$('execution-target').textContent=$('host-name').textContent;$('project-name').textContent=projectCatalog.find(p=>p.key===selectedProject)?.label??'프로젝트를 추가하세요';}

 const query=$('search').value.trim().toLowerCase();
 const cards=trialSessions.map(c=>({config:c,...sessionPresentation({...c,firstPrompt:firstPrompts.get(c.id)},sessionCards.get(c.id)?.snapshot,{stale:sessionCards.get(c.id)?.stale}),selected:c.id===sessionId}));

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
    const recent=c=>c.snapshot?.updatedAt??c.config.updatedAt??c.config.createdAt??0;
    matches.sort((a,b)=>sidebarDisplay.sort==='active'?(b.priority-a.priority||a.title.localeCompare(b.title)):sidebarDisplay.sort==='recent'?recent(b)-recent(a):a.title.localeCompare(b.title));
    if(query&&!workspaceMatch&&!matches.length)continue;
    const label=(sidebarDisplay.group==='flat'?project.label+' / ':'')+w.label+(w.project?.available===false?' · 폴더 확인 필요':'')+(w.kind==='worktree'?' · 워크트리':'')+(w.host?' · '+w.host:'');
    const onselect=async()=>{try{if(w.project)await chooseProject(w.project);else if(w.cards.length)await selectSession(w.cards[0].config.id);}catch(e){notice(e.message);}};
    const content=inline?document.createElement('div'):null;
    const {section,children}=inline?{section:content,children:content}:header(w.key,label,w.path,w.cards.length,w.project?.key===selectedProject,onselect,w.project?()=>openNewWorkspace(w.project.key):null,w.label+'에 대화 추가','workspace',w.project?.workspaceId?{kind:'workspace',id:w.project.workspaceId,name:w.label,path:w.path,default:!w.project.parentKey}:null);
    for(const c of matches){
     const button=document.createElement('button');button.className='task';button.dataset.sessionId=c.config.id;button.title=c.engine+' · '+c.state+' · '+c.config.id;button.setAttribute('aria-current',String(c.selected));button.disabled=busy||taskCreating;
     const dot=document.createElement('span');dot.className='task-dot'+(c.state==='승인 필요'?' amber':c.state==='작업 중'?' green':'');
     const text=document.createElement('span'),title=document.createElement('strong'),state=document.createElement('small');title.textContent=c.title;state.textContent=c.engine+' · '+c.state;text.append(title,state);
     // Pinned: an icon on every row (branches in its tooltip); only the open session spells them out. Orange = the open session is off its branches.
     if(c.config.branchPin){const summary=pinSummary(c.config.branchPin),off=c.selected&&branchPin?.sessionId===c.config.id&&branchPin.offBranch,icon=document.createElement('span');icon.className='task-pin-icon'+(off?' off':'');icon.append(navigationBranch());icon.title=(off?'고정 목록 밖 브랜치에 있습니다 · ':'고정한 브랜치 · ')+summary;icon.setAttribute('aria-label',icon.title);title.prepend(icon);
      if(c.selected){const pin=document.createElement('small');pin.className='task-pin'+(off?' off':'');pin.textContent=summary;pin.title=icon.title;text.append(pin);}}button.append(dot,text);
     button.onclick=()=>{workspaceDrawer(false);selectSession(c.config.id).catch(e=>notice(e.message));};const row=document.createElement('div');row.className='session-row';row.append(button);if(navigationEnabled)row.append(navigationMenu({kind:'session',id:c.config.id,name:c.title,path:w.path}));children.append(row);
    }
    if(!matches.length){const empty=document.createElement('p');empty.className='project-no-sessions';empty.textContent=query?'일치하는 세션 없음':w.cards.length?'보기 설정으로 세션이 숨겨져 있습니다':'＋ 버튼으로 대화를 추가하세요';children.append(empty);}
    workspaceNodes.push(section);
   }
   if(!workspaceNodes.length)continue;
   if(sidebarDisplay.group==='flat'&&!inline){nodes.push(...workspaceNodes);continue;}
   const projectLabel=project.label+(inline&&project.workspaces[0].project.available===false?' · 폴더 확인 필요':'');
   const {section,children}=header(project.key,projectLabel,project.path,inline?project.workspaces[0].cards.length:project.workspaces.length,project.workspaces.some(w=>w.project?.key===selectedProject),()=>{if(collapsedProjects.has(project.key))collapsedProjects.delete(project.key);else collapsedProjects.add(project.key);renderWorkspace();},inline&&project.project?()=>openNewWorkspace(project.project.key):null,project.label+'에 대화 추가','project',project.project?.projectId?{kind:'project',id:project.project.projectId,name:project.label,path:project.path}:null);
   if(inline){children.className='project-sessions';children.append(...workspaceNodes[0].childNodes);}else children.append(...workspaceNodes);
   nodes.push(section);
  }
  if(!nodes.length&&query){const empty=document.createElement('p');empty.className='list-state';empty.textContent='검색 결과가 없습니다.';nodes.push(empty);}
  $('project-list').replaceChildren(...nodes);
 }
 $('session-count').textContent=String(groups.length);$('refresh-list').disabled=catalogBusy||busy||!token;
 $('list-state').textContent=!token?'로그인 필요':catalogBusy?'목록 상태 확인 중…':catalogChecked?`목록 조회 ${catalogChecked} · 선택한 대화는 실시간 갱신`:'목록 상태를 확인해 주세요.';
}
const baseTitle=document.title;
function showTurnAlerts(list){
 const box=$('turn-alerts');if(!box||!list.length)return;
 for(const a of list){
  const label=trialSessions.find(s=>s.id===a.id)?.label??'대화',item=document.createElement('div'),text=document.createElement('span'),open=document.createElement('button'),close=document.createElement('button');
  item.className='turn-alert '+a.kind;text.textContent=`${alertText[a.kind]} · ${label}`;text.title=text.textContent;open.type=close.type='button';open.textContent='열기';close.append(icon('close'));close.setAttribute('aria-label','알림 닫기');
  const dismiss=()=>item.remove();open.onclick=()=>{dismiss();selectSession(a.id);};close.onclick=dismiss;setTimeout(dismiss,30000);
  item.append(text,open,close);box.append(item);while(box.children.length>4)box.firstElementChild.remove();
 }
 if(document.hidden){unseenAlerts+=list.length;document.title=`(${unseenAlerts}) ${baseTitle}`;}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){unseenAlerts=0;document.title=baseTitle;}});
async function forkAt(localId){
 if(busy)return;const from=sessionId;busy=true;render();notice('이 메시지 직전까지의 대화로 새 세션을 만드는 중입니다…');
 try{
  const r=await api(base()+'/fork',{method:'POST',body:{messageLocalId:localId}});
  if(typeof r?.sessionId!=='string'||!/^[-a-f0-9]{36}$/.test(r.sessionId))throw Error('새 세션을 확인하지 못했습니다.');
  await refreshCatalog();await selectSession(r.sessionId);
  notice('분기한 새 대화입니다. 원래 대화는 그대로 남아 있고, 파일 변경은 되돌리지 않았습니다.');
 }catch(e){if(sessionId===from)notice(`분기하지 못했습니다(${e.message}). 다시 보내기 전에 대화 목록에서 새 세션이 생겼는지 확인하세요.`);await refreshCatalog().catch(()=>{});}
 finally{busy=false;render();}
}
let pairingTimer=null,pairingExpires=0;
function renderPairingExpiry(){const left=Math.max(0,Math.round((pairingExpires-Date.now())/1000));$('pairing-expiry').textContent=pairingExpires?(left?`${Math.floor(left/60)}분 ${left%60}초 남음`:'만료됐습니다. 새 코드를 만드세요.'):'';if(!left){clearInterval(pairingTimer);pairingTimer=null;}}
async function pairingAction(action){
 try{const r=await api('/api/pairing-code',{method:'POST',body:{action}});
  if(action==='issue'){$('pairing-code').textContent=r.code;pairingExpires=r.expiresAt;clearInterval(pairingTimer);pairingTimer=setInterval(renderPairingExpiry,1000);}
  else{$('pairing-code').textContent='----';pairingExpires=0;clearInterval(pairingTimer);pairingTimer=null;$('pairing-expiry').textContent='코드를 취소했습니다.';return;}
  renderPairingExpiry();
 }catch{$('pairing-expiry').textContent='코드를 만들지 못했습니다. 이 Mac의 앱에서 로그인한 상태인지 확인하세요.';}
}
function openPairing(){if(!pairingEnabled)return;$('pairing-dialog').showModal();pairingAction('issue');}
if(workspaceLayout){$('pairing-open').onclick=openPairing;$('pairing-new').onclick=()=>pairingAction('issue');$('pairing-cancel').onclick=()=>pairingAction('cancel');$('pairing-close').onclick=()=>$('pairing-dialog').close();}
async function refreshCatalog(){
 if(!workspaceLayout||!token||catalogBusy)return;
 const mine=++catalogSerial,usedToken=token;catalogBusy=true;renderWorkspace();
 try{
  const config=await api('/config');sessionTerminalEnabled=config.sessionTerminal===true;
  const results=await Promise.allSettled(config.sessions.map(c=>api(`/api/sessions/${c.id}`)));
  if(mine!==catalogSerial||usedToken!==token)return;
  allSessionEntries=config.sessions;trialSessions=config.sessions.filter(s=>!s.hidden);
  results.forEach((r,i)=>{const id=config.sessions[i].id;if(id===sessionId&&session&&connected)return;sessionCards.set(id,r.status==='fulfilled'?{snapshot:r.value.session,stale:false}:{...sessionCards.get(id),stale:true});});
  $('session-select').replaceChildren(...trialSessions.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.label;return o;}));$('session-select').value=sessionId;
  const snapshots=new Map(trialSessions.map(s=>[s.id,s.id===sessionId&&session?session:sessionCards.get(s.id)?.snapshot]));
  if(alertSnapshots.size)showTurnAlerts(turnAlerts(alertSnapshots,snapshots,{selectedId:sessionId,visible:!document.hidden}));
  alertSnapshots=snapshots;
  catalogChecked=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
 }catch(e){if(mine===catalogSerial&&usedToken===token){sessionCards.forEach(c=>c.stale=true);notice(e.message);}}
 finally{catalogBusy=false;renderWorkspace();}
}
let workspaceView='chat',lastInspector='info';
// A chat action that opens a part of the side panel brings that part into view and marks it briefly, so the result is seen.
function revealInPanel(id){const el=$(id);if(!el)return;workspacePanel('info');if('open' in el)el.open=true;requestAnimationFrame(()=>{el.scrollIntoView({block:'start',behavior:'smooth'});el.classList.remove('revealed');void el.offsetWidth;el.classList.add('revealed');});}
function workspacePanel(view){
 if(!workspaceLayout)return;
 workspaceView=view;if(view!=='chat')lastInspector=view;
 const panel=view==='chat'?lastInspector:view;
 const label=view==='chat'?'상세 사이드바 보이기':'상세 사이드바 숨기기';
 $('info-tab').setAttribute('aria-expanded',String(view!=='chat'));$('info-tab').setAttribute('aria-label',label);$('info-tab').title=label;
 $('files').hidden=panel!=='files';$('session-info').hidden=panel!=='info';
 $('inspector-title').textContent=panel==='files'?'프로젝트 파일':'세션 정보';
 document.querySelector('.workspace').classList.toggle('inspector-visible',view!=='chat');
 $('chat').hidden=false;
 for(const [id,type] of [['session-info-tab','info'],['files-tab','files']])$(id).setAttribute('aria-pressed',String(panel===type));
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
 $('git-summary').onclick=()=>revealInPanel('info-git');$('git-refresh').onclick=()=>{loadGit(true);gitReview?.reset();};
 $('session-info-tab').onclick=()=>workspacePanel('info');$('info-tab').onclick=()=>workspacePanel(workspaceView==='chat'?lastInspector:'chat');$('back-chat').onclick=()=>workspacePanel('chat');
 updateSidebarToggle();
 compactSidebar.addEventListener('change',()=>workspaceDrawer(false));
 $('open-nav').onclick=()=>{if(compactSidebar.matches){workspaceDrawer(!$('sidebar').classList.contains('open'));return;}sidebarCollapsed=!sidebarCollapsed;try{sessionStorage.setItem('maricode-sidebar-collapsed',String(sidebarCollapsed));}catch{}updateSidebarToggle();};$('close-nav').onclick=()=>workspaceDrawer(false);$('scrim').onclick=()=>workspaceDrawer(false);
 $('search').oninput=renderWorkspace;$('refresh-list').onclick=refreshCatalog;
 let catalogTick=0;
 setInterval(()=>{
  const busyElsewhere=[...alertSnapshots].some(([id,s])=>(id!==sessionId||document.hidden)&&(s?.thinking||Object.keys(s?.agentState?.requests??{}).length));
  if(!token||paused||connectionState==='denied'||(++catalogTick%3&&!busyElsewhere))return;
  // Hidden windows still check busy conversations so a finished turn can be flagged in the title.
  if(document.hidden&&!busyElsewhere)return;
  refreshCatalog();if(!document.hidden)loadGit();if(actions?.pending?.kind==='resume'&&!busy)refresh().catch(()=>{});
 },10000);
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
let importHistorySupported=false,draftSessionMode='new';
const importedHistory=workspaceLayout?createImportedHistory({element:$('imported-history'),api,scroller:$('conversation-history'),changed:renderHistorySummary}):null;
let draftAccount=null;
let draftProject=null,draftOptions=null,draftLoading=false,draftSerial=0,draftMessage='',draftContinue=false,draftSupportsGit=false,draftAccountSerial=0,draftGeneralSupported=false,draftDefaultsSerial=0,draftDefaultsLoading=false;
try{selectedProject=sessionStorage.getItem('maricode-project')||'';}catch{}
const claudeImportPanel=workspaceLayout?createClaudeImportPanel({element:$('claude-import-panel'),api,
 context:()=>({connectionState:draftAccount?.agent===$('task-agent').value?(draftAccount.loading?'checking':draftAccount.provider?.state):'checking',mode:draftSessionMode,agent:$('task-agent').value,project:draftProject,path:projectCatalog.find(p=>p.key===draftProject)?.path,general:projectCatalog.find(p=>p.key===draftProject)?.general,projectAvailable:taskProjectsReady&&projectCatalog.some(p=>p.key===draftProject),busy:busy||taskCreating}),
 changed:value=>{taskCreating=value;busy=value;render();renderTaskCreation();},
 opened:async(id,agent)=>{
  // Codex imports land as ordinary HAPI messages; only Claude keeps a separate imported-history snapshot.
  if(agent!=='codex'){const previous=await api('/api/sessions/'+encodeURIComponent(id)+'/import-history');
  if(previous.imported!==true)throw Error('이전 대화 기록을 확인하지 못했습니다.');}
  const name=agent==='codex'?'Codex':'Claude',where=agent==='codex'?'위 대화':'‘가져온 이전 기록’';
  await openWorkspace();
  if(!trialSessions.some(s=>s.id===id))throw Error('등록된 대화를 목록에서 찾지 못했습니다.');
  await selectSession(id);$('new-task-panel').hidden=true;workspaceDrawer(false);
  const mine=epoch,manual=`기존 ${name} 기록을 가져왔습니다. 메시지를 보내면 복사한 기록으로 이어갑니다. 이전 대화는 ${where}에서 볼 수 있습니다.`;
  // selectSession() starts the SSE stream without awaiting it; `connected`
  // only flips true once that handshake resolves, slightly after this point.
  const start=Date.now();while(mine===epoch&&!connected&&Date.now()-start<4000)await new Promise(r=>setTimeout(r,50));
  if(mine===epoch&&connected&&session&&!session.active&&!actions.pending){
   busy=true;render();
   try{
    const request=actions.resume();render();await request;await refresh();
    if(mine===epoch)notice(session?.active?`기존 ${name} 기록을 가져와 이어갑니다. 이전 대화는 ${where}에서 볼 수 있습니다.`:manual);
   }catch(e){if(mine===epoch){notice(`기존 ${name} 기록을 가져왔습니다. 자동 재개에 실패했습니다(${e.message}). 메시지를 보내면 다시 시도합니다. 이전 대화는 ${where}에서 볼 수 있습니다.`);await refresh().catch(()=>{});}}
   finally{if(mine===epoch){busy=false;render();}}
  }else notice(manual);
 }
}):null;

function taskPending(){try{return JSON.parse(sessionStorage.getItem(taskPendingKey)||'null');}catch{return null;}}
async function configureTasks(config){
 $('new-task-toggle').hidden=!config.newTask;draftGeneralSupported=config.newTask?.generalChat===true;$('draft-general-mode').hidden=!draftGeneralSupported;$('empty-general').hidden=!draftGeneralSupported;draftSupportsGit=!!config.newTask?.workspaceChoices;claudeImportPanel?.configure(config.claudeImport===true,config.codexImport===true);
 if(config.newTask)await loadTaskProjects(true);
}
async function loadTaskProjects(followSession=false){
 taskProjectsReady=false;renderTaskCreation();
 try{
  const result=await api('/api/projects');projectCatalog=result.projects;
  if(followSession&&$('new-task-panel').hidden)selectedProject=sessionProject(projectCatalog,trialSessions.find(s=>s.id===sessionId),selectedProject);
  const chosen=draftProjectSelection(projectCatalog,claudeImportPanel?.pendingProject??taskPending()?.project??draftProject,selectedProject);
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
 $('draft-workspace-field').hidden=workspaces.length<=1;
}
async function openNewWorkspace(project=selectedProject){
 if(taskCreating||busy)return;
 rememberChat();notice('');
 draftSessionMode=claudeImportPanel?.pending?'import':'new';
 draftProject=claudeImportPanel?.pendingProject??taskPending()?.project??(projectCatalog.some(p=>p.key===project)?project:draftProject);draftMessage='';draftContinue=false;draftOptions=null;
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
 if(taskPending()||draftSessionMode==='import')return;
 const project=projectCatalog.find(p=>p.key===draftProject),owner=draftProject,auth=token,ticket=++draftDefaultsSerial;
 const recent=recentWorkspaceSession(trialSessions.map(c=>{const s=sessionCards.get(c.id)?.snapshot;return {...c,agent:s?.metadata?.flavor??c.agent,updatedAt:s?.updatedAt??c.updatedAt};}),project?.path);
 draftInherited=null;draftDefaultsLoading=false;
 if(!recent){$('draft-defaults').textContent='';return;}
 draftDefaultsLoading=true;$('task-agent').value=recent.agent;$('draft-defaults').textContent='최근 대화의 '+(recent.agent==='claude'?'Claude':'Codex')+' 설정 사용';renderTaskCreation();
 try{const data=await api('/api/sessions/'+encodeURIComponent(recent.id));if(ticket!==draftDefaultsSerial||owner!==draftProject||auth!==token||$('task-agent').value!==recent.agent)return;const s=data.session;
  if(s?.metadata?.path!==project.path||s.metadata.flavor!==recent.agent)return;
  draftInherited={agent:recent.agent,model:s.model??null,effort:(recent.agent==='codex'?s.modelReasoningEffort:s.effort)??null};
  $('draft-defaults').textContent+=' · 모델 '+(draftInherited.model??'자동')+' / 추론 '+(draftInherited.effort??'자동')+'.';
 }catch{if(ticket===draftDefaultsSerial&&owner===draftProject)$('draft-defaults').textContent+=' · 모델·추론 조회 실패, 기본값 사용';}
 finally{if(ticket===draftDefaultsSerial){draftDefaultsLoading=false;renderTaskCreation();}}
}
let draftInherited=null;
function renderTaskCreation(){
 if(!workspaceLayout)return;
 if(claudeImportPanel?.pending){draftSessionMode='import';$('task-agent').value=claudeImportPanel.pendingAgent;}
 const importing=draftSessionMode==='import',importPending=!!claudeImportPanel?.pending;
 $('claude-import-panel').open=importing;claudeImportPanel?.render();
 $('session-entry-new').setAttribute('aria-pressed',String(!importing));$('session-entry-import').setAttribute('aria-pressed',String(importing));
 $('session-entry-new').disabled=taskCreating||importPending;
 $('session-entry-import').disabled=taskCreating||!!taskPending()||!importHistorySupported||!projectCatalog.some(p=>!p.general);
 $('session-entry-import').title=!importHistorySupported?'이 실행 환경은 기존 대화 가져오기를 지원하지 않습니다.':!projectCatalog.some(p=>!p.general)?'먼저 원래 대화의 프로젝트 폴더를 등록하세요.':'';
 $('session-entry-note').textContent=importing?`이 컴퓨터에서 진행했던 ${$('task-agent').value==='codex'?'Codex':'Claude'} 대화를 이어갑니다.`:'새로운 주제로 AI와 대화를 시작합니다.';
 $('draft-new-actions').hidden=importing;$('draft-import-actions').hidden=!importing;
 $('draft-scope-modes').hidden=importing||!draftGeneralSupported;
 $('create-task').hidden=importing||importPending;$('draft-defaults').hidden=importing;
 const pending=taskPending();if(pending)$('task-agent').value=pending.agent;
 const project=projectCatalog.find(p=>p.key===draftProject),mode=$('task-mode').value,git=!project?.general&&draftOptions?.kind==='git';
 $('draft-project-fields').hidden=!!project?.general;$('draft-general-note').hidden=!project?.general;
 $('draft-general-mode').setAttribute('aria-pressed',String(!!project?.general));$('draft-project-mode').setAttribute('aria-pressed',String(!project?.general));
 $('draft-general-mode').disabled=$('draft-project-mode').disabled=taskCreating||importPending||!!pending;
 $('task-project').textContent=project?.path??'프로젝트 폴더를 선택하세요.';
 $('task-project-select').disabled=taskCreating||importPending||!!pending;$('task-workspace-select').disabled=taskCreating||importPending||!!pending;
 $('check-task').hidden=!pending;$('check-task').disabled=taskCreating;
 $('park-task').hidden=!pending;$('park-task').disabled=taskCreating;
 for(const id of ['task-agent','task-mode','task-branch','task-worktree','task-worktree-name'])$(id).disabled=taskCreating||importPending||!!pending||id!=='task-agent'&&(!draftOptions||!git);
 for(const option of $('task-mode').options)option.disabled=option.value!=='current'&&(!git||!draftOptions?.head);
 $('draft-git-options').hidden=importing||!git;$('draft-git-summary').textContent='브랜치·워크트리 선택'+(draftOptions?.branch?' · '+draftOptions.branch:'');
 $('draft-branch-field').hidden=!git||mode==='existing';$('draft-worktree-field').hidden=mode!=='existing';$('draft-name-field').hidden=mode!=='new';
 const valid=mode==='new'?!!$('task-worktree-name').value.trim()&&!!$('task-branch').value:mode==='existing'?!!$('task-worktree').value:!git||!!$('task-branch').value||!draftOptions?.branches.length;
 $('create-task').disabled=draftDefaultsLoading||taskCreating||importPending||!!pending&&!draftContinue||!taskProjectsReady||draftLoading||!draftOptions||!valid;
 $('create-task').textContent=draftContinue?'준비된 폴더에서 대화 시작':'새 대화 시작';
 document.querySelector('.task-create-heading h2').textContent=importing?'기존 대화 가져오기':'새 대화';
 $('draft-workspace-refresh').disabled=taskCreating||draftLoading||!!pending;
 $('draft-add-project').disabled=taskCreating||importPending||!!pending;
 $('task-status').textContent=taskCreating?'대화를 준비하고 있습니다…':pending?(draftContinue?'작업 공간은 준비됐고 세션 생성은 아직 시작되지 않았습니다. 같은 요청으로 계속할 수 있습니다.':'이전 요청의 결과 확인이 필요합니다. 작업 대상은 고정해 두었습니다.')+(draftMessage?'\n'+draftMessage:''):draftMessage;
 $('draft-workspace-note').textContent=draftLoading?'브랜치와 워크트리를 확인하고 있습니다…':mode==='new'?'선택한 브랜치의 커밋에서 새 작업 폴더를 만듭니다. 미커밋 변경은 옮기지 않습니다.':mode==='existing'?'기존 작업 폴더와 브랜치를 그대로 사용합니다. 기존 세션은 왼쪽 목록에서 이어갈 수 있습니다.':git&&$('task-branch').value!==draftOptions.branch?'선택한 브랜치로 현재 폴더를 전환합니다. 실행 중인 작업이나 미커밋 변경이 있으면 중단합니다.':draftOptions?.note??'현재 폴더의 파일과 작업 상태를 그대로 사용합니다.';
 const target=mode==='existing'?draftOptions?.worktrees.find(w=>w.key===$('task-worktree').value)?.path:mode==='new'?'앱 전용 폴더에 새 워크트리':project?.path;
 $('draft-target').hidden=importing||!!project?.general||(mode==='current'&&draftWorkspace().mode==='current');
 $('task-agent').disabled=taskCreating||importPending||!!pending;
 renderDraftAccount();
 $('draft-target').textContent=(project?.projectLabel??project?.label??'프로젝트 미선택')+' → '+(mode==='new'?'새 작업공간':mode==='existing'?'기존 워크트리':project?.workspaceLabel??'기본 작업공간')+' → '+($('task-agent').value==='claude'?'Claude':'Codex')+'\n'+(target??'작업 위치 확인 중')+(git?'\n브랜치: '+(mode==='new'?$('task-worktree-name').value.trim()||'이름 입력':mode==='existing'?draftOptions?.worktrees.find(w=>w.key===$('task-worktree').value)?.branch:$('task-branch').value||'분리된 HEAD'):'');
}
async function createTask(checkOnly){
 if(taskCreating||busy||!token||claudeImportPanel?.blocksCreation)return;
 let request=taskPending();
 if(!checkOnly&&request&&!draftContinue||checkOnly&&!request)return;
 if(!request){
  if($('create-task').disabled)return;
  request={requestId:crypto.randomUUID(),agent:$('task-agent').value,project:draftProject,...(draftSupportsGit?{workspace:draftWorkspace()}:{})};
  try{sessionStorage.setItem(taskPendingKey,JSON.stringify(request));sessionStorage.setItem('maricode-task-defaults:'+request.requestId,JSON.stringify(draftInherited));if($('task-branch-pin')?.checked&&!$('draft-project-fields').hidden)sessionStorage.setItem('maricode-task-pin:'+request.requestId,'1');}catch{draftMessage='요청을 보관하지 못해 시작하지 않았습니다.';renderTaskCreation();return;}
 }
 draftContinue=false;taskCreating=true;busy=true;$('prompt').disabled=true;$('logout').disabled=true;render();renderTaskCreation();
 try{
  const result=await api('/api/tasks'+(checkOnly?'/check':''),{method:'POST',body:request});
  if(result.state==='prepared'||result.state==='none'){draftContinue=true;return;}
  if(result.state!=='created')return;
  await openWorkspace();await selectSession(result.session.id);
  sessionStorage.removeItem(taskPendingKey);$('new-task-panel').hidden=true;workspaceDrawer(false);
  if(sessionStorage.getItem('maricode-task-pin:'+request.requestId)){sessionStorage.removeItem('maricode-task-pin:'+request.requestId);if(!await branchPin?.enable(result.session.id))notice('세션은 만들었지만 브랜치를 고정하지 못했습니다. 세션 정보에서 다시 시도하세요.');}
  let inherited;try{inherited=JSON.parse(sessionStorage.getItem('maricode-task-defaults:'+request.requestId));sessionStorage.removeItem('maricode-task-defaults:'+request.requestId);}catch{}
  let settingsNote='';
  if(inherited?.agent===request.agent){
   for(const field of ['model','effort']){
    await loadSettings();
    if(settingsPending()){settingsNote='설정 변경 결과 확인이 필요합니다.';break;}
    const options=settingsData?.[field==='model'?'models':field==='effort'?'efforts':'permissionModes'];
    if(settingsOwner!==sessionId||!settingsData?.editable||!options?.some(o=>o.value===inherited[field])){settingsNote='일부 이전 설정은 지원 여부를 확인하지 못해 적용하지 않았습니다.';continue;}
    if(settingsData.current[field]===inherited[field])continue;
    $(`setting-${field}`).value=inherited[field]??'';
    // Keep the creation UI locked while using the existing confirmed setting flow.
    await applySetting(field,true);
    if(settingsPending()){settingsNote='설정 변경 결과 확인이 필요합니다.';break;}
    if(settingsData?.current?.[field]!==inherited[field]){settingsNote='이전 설정을 적용하지 못했습니다. 채팅의 모델·추론 설정에서 확인하세요.';break;}
   }
  }
  notice('세션을 열었습니다. '+settingsNote);
  let handoff=null;try{handoff=JSON.parse(sessionStorage.getItem('maricode-handoff:'+request.requestId));sessionStorage.removeItem('maricode-handoff:'+request.requestId);}catch{}
  if(handoff?.text){
   const label=trialSessions.find(s=>s.id===result.session.id)?.label??'새 인계 세션';
   $('prompt').value=handoff.text.replace(`대상: 새 인계 세션 (${handoffPlaceholder})`,`대상: ${label} (${result.session.id})`);
   const r=handoff.report??{};$('handoff-note').textContent=`새 인계 세션 · ${handoff.source} → ${request.agent==='codex'?'Codex':'Claude'} · 텍스트 ${r.included??'?'}개 포함, ${r.omitted??'?'}개 생략, ${r.truncated??'?'}개 일부 잘림. 아직 전송하지 않았습니다. 내용을 검토하고 보내기를 누르세요.`;
   notice('인계용 새 세션을 열고 최근 대화 일부를 입력창에 넣었습니다. 원래 세션은 그대로이며 파일·도구 결과·승인은 전달하지 않습니다.');
  }
  $('prompt').focus();
 }catch(error){
  if(error.rejected)sessionStorage.removeItem(taskPendingKey);
  draftMessage=error.message;if(error.reason==='AI_SETUP')await refreshDraftAccount();
 }finally{taskCreating=false;busy=false;$('prompt').disabled=false;$('logout').disabled=false;render();renderTaskCreation();}
}
function renderDraftAccount(){
 const state=draftAccount?.agent===$('task-agent').value?draftAccount:null;
 const loading=!state||state.loading;
 const view=draftAccountView(state?.provider,{local:!!window.webkit?.messageHandlers?.maricode,localLogin:!!state?.localLogin,found:state?.found?.source});
 $('draft-account-state').textContent=loading?'연결 확인 중…':view.label;
 $('draft-account-state').dataset.state=state?.provider?.state??'unknown';
 $('draft-account-detail').textContent=loading?'':state?.error??(view.connect?'연결하면 앱과 터미널이 이 폴더의 로그인·설정·MCP를 함께 씁니다.':draftRunnerLabel(state?.runner,$('task-agent').value));
 $('prepare-task-agent').textContent=view.connect?'이 설정으로 연결':state?.provider?.state==='connection-required'?'기존 CLI 설정 연결':'AI 실행 파일 연결';
 $('prepare-task-agent').hidden=loading||!view.setup;
 $('draft-account-check').hidden=loading||!view.check;$('draft-account-check').disabled=taskCreating;
 $('draft-account-login').hidden=loading||!view.login;$('draft-account-login').disabled=taskCreating;
 $('prepare-task-agent').disabled=taskCreating;
 claudeImportPanel?.render();
}
async function refreshDraftAccount(){
 const serial=++draftAccountSerial,agent=$('task-agent').value,auth=token;
 draftAccount={agent,loading:true};renderDraftAccount();
 try{const data=await api('/api/accounts');if(serial!==draftAccountSerial||auth!==token||agent!==$('task-agent').value)return;
  draftAccount={agent,provider:data.providers.find(p=>p.agent===agent),localLogin:data.localLogin,runner:data.runner};
  // Read-only lookup so the first session can connect the terminal CLI folder in place.
  if(draftAccount.provider?.state==='connection-required'&&window.webkit?.messageHandlers?.maricode){const found=await api('/api/account-profiles',{method:'POST',body:{action:'discover',agent}}).catch(()=>null);if(serial===draftAccountSerial&&found?.source&&found.binary)draftAccount.found=found;}
 }catch{if(serial===draftAccountSerial&&auth===token)draftAccount={agent,provider:{state:'unknown'}};}
 finally{if(serial===draftAccountSerial)renderDraftAccount();}
}

if(workspaceLayout){
 $('draft-general-mode').onclick=$('empty-general').onclick=async()=>{
 if(busy||taskCreating||taskPending()||claudeImportPanel?.pending)return;busy=true;render();
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
 $('session-entry-new').onclick=()=>{if(taskCreating||claudeImportPanel?.pending)return;draftSessionMode='new';renderTaskCreation();};
 $('session-entry-import').onclick=()=>{if($('session-entry-import').disabled)return;draftSessionMode='import';draftDefaultsSerial++;draftDefaultsLoading=false;draftInherited=null;if(projectCatalog.find(p=>p.key===draftProject)?.general){draftProject=projectCatalog.find(p=>!p.general).key;renderDraftLocations();loadWorkspaceChoices();}renderTaskCreation();refreshDraftAccount();};
 $('create-task').onclick=()=>createTask(false);$('check-task').onclick=()=>createTask(true);
 for(const id of ['task-mode','task-branch','task-worktree','task-worktree-name'])$(id).addEventListener(id==='task-worktree-name'?'input':'change',renderTaskCreation);
 $('draft-workspace-refresh').onclick=loadWorkspaceChoices;$('draft-account-check').onclick=refreshDraftAccount;
 $('task-agent').onchange=()=>{draftDefaultsSerial++;draftDefaultsLoading=false;draftInherited=null;$('draft-defaults').textContent='선택한 AI로 새 대화를 시작합니다.';renderTaskCreation();refreshDraftAccount();};
 $('draft-account-login').onclick=()=>openAccounts();
 for(const field of ['group','sort','ended','details','compact']){
  const el=$('display-'+field);if(el.type==='checkbox')el.checked=sidebarDisplay[field];else el.value=sidebarDisplay[field];
  el.onchange=()=>{sidebarDisplay=displayPreferences({...sidebarDisplay,[field]:el.type==='checkbox'?el.checked:el.value});try{localStorage.setItem('maricode-display-preferences',JSON.stringify(sidebarDisplay));}catch{}renderWorkspace();};
 }
}
function settingsPending(){try{return JSON.parse(sessionStorage.getItem(`hapi-settings-pending:${sessionId}`));}catch{return null;}}
function settingsCurrent(){return {model:session?.model??null,effort:(session?.metadata?.flavor==='codex'?session?.modelReasoningEffort:session?.effort)??null,permissionMode:session?.permissionMode??null};}
function renderSettings(){
 if(!workspaceLayout)return;
 const current=settingsCurrent(),pending=settingsPending(),label=v=>v??'자동 (실제 값 미확정)';
 $('model-name').textContent=({claude:'Claude',codex:'Codex'})[session?.metadata?.flavor]??'에이전트';
 const extraOn=settingsOwner===sessionId?(settingsData?.extras??[]).filter(e=>e.current==='fast'||e.current==='plan').map(e=>e.current==='fast'?'Fast':'계획'):[];
 const view=settingsOwner===sessionId?settingsData:null,modelInfo=modelReadout(session,view,messages);
 $('model-chip').textContent=`모델: ${modelInfo.chip}${extraOn.length?' · '+extraOn.join(' · '):''} ▾`;$('effort-chip').textContent=`추론: ${current.effort??'자동'} ▾`;
 $('permissionMode-chip').textContent=`액세스: ${settingsData?.permissionModes?.find(o=>o.value===current.permissionMode)?.label??permissionLabel(session?.metadata?.flavor,current.permissionMode)??'미확인'} ▾`;
 $('model-chip').title=modelInfo.detail;$('effort-chip').title='자동 값은 실제 실행값을 확정하지 않습니다.';
 $('settings-current').textContent=modelInfo.detail+`\n서버 설정: 추론 ${label(current.effort)} / 액세스 ${permissionLabel(session?.metadata?.flavor,current.permissionMode)??'미확인'}`;
 const controls=settingsControls(session,{loaded:!!view,editable:!!view?.editable,connected,busy,loading:settingsLoading,pending:!!pending,actionPending:!!actions?.pending,permissionPending:!!permissionActions?.pending}),allowed=controls.apply;
 $('settings-reason').textContent=controls.reason;
 for(const field of ['model','effort','permissionMode']){$(`setting-${field}`).disabled=!controls.browse;$(`apply-${field}`).disabled=!allowed||!settingsData?.[field==='model'?'models':field==='effort'?'efforts':'permissionModes']?.length;}
 for(const e of settingsOwner===sessionId?settingsData?.extras??[]:[])if($(`setting-${e.field}`)){$(`setting-${e.field}`).disabled=!controls.browse;$(`apply-${e.field}`).disabled=!allowed;}
 $('load-settings').disabled=busy||settingsLoading||!connected;
 if(pending)$('settings-status').textContent=`${({model:'모델',effort:'추론',permissionMode:'액세스',serviceTier:'속도',collaborationMode:'협업 방식'})[pending.field]??'설정'} 변경 결과 확인 필요 · 요청값 ${label(pending.value)}. 자동 재전송하지 않습니다. 결과 확인 전 대화 전송을 잠급니다.`;
}
async function loadSettings(){
 const id=sessionId,mine=++settingsSerial;settingsLoading=true;renderSettings();
 try{
  const result=await api(`/api/sessions/${id}/settings`);
  if(id!==sessionId||mine!==settingsSerial)return;
  settingsData=result;settingsOwner=id;
  for(const field of ['model','effort','permissionMode']){
   const select=$(`setting-${field}`),options=result[field==='model'?'models':field==='effort'?'efforts':'permissionModes']??[];
   select.replaceChildren(...options.map(item=>{const o=document.createElement('option');o.value=item.value??'';o.textContent=item.label;return o;}));
   if(!options.some(o=>o.value===result.current[field])){const o=document.createElement('option');o.value=result.current[field]??'';o.textContent=`현재: ${result.current[field]??(field==='permissionMode'?'미확인':'자동')} (목록 밖)`;o.disabled=true;select.prepend(o);}
   select.value=result.current[field]??'';
  }
  $('setting-extras').replaceChildren(...(result.extras??[]).map(e=>{
   const row=document.createElement('div'),label=document.createElement('label'),select=document.createElement('select'),apply=document.createElement('button');
   row.className='setting-extra';label.textContent=e.label;select.id='setting-'+e.field;apply.id='apply-'+e.field;apply.type='button';apply.textContent=e.label+' 적용';apply.onclick=()=>applySetting(e.field);
   select.replaceChildren(...e.options.map(item=>{const o=document.createElement('option');o.value=item.value;o.textContent=item.label;return o;}));select.value=e.current;label.append(select);row.append(label,apply);return row;}));
  $('settings-source').textContent=result.source;renderPermissionDescription();
  const pending=settingsPending();
  if(pending&&(result.extras?.find(e=>e.field===pending.field)?.current??result.current[pending.field])===pending.value)sessionStorage.removeItem(`hapi-settings-pending:${id}`);
  $('settings-status').textContent='설정 목록을 조회했습니다. 선택만으로 변경되지 않으며 적용 버튼을 눌러야 합니다.';
  await refresh();return id===sessionId&&mine===settingsSerial;
 }catch(e){if(id===sessionId)$('settings-status').textContent=e.message;return false;}
 finally{if(mine===settingsSerial){settingsLoading=false;render();}}
}
async function applySetting(field,fromCreation=false){
 if($(`apply-${field}`).disabled&&!(fromCreation&&taskCreating&&settingsOwner===sessionId&&settingsData?.editable))return;
 if(!fromCreation&&session&&!session.active){
  // Ended session: resume first, reload the server values, keep the user's choice, then apply as usual.
  const id=sessionId,mine=epoch,draft=Object.fromEntries(['model','effort','permissionMode'].map(f=>[f,$(`setting-${f}`).value]));let resumed=false;
  busy=true;render();try{resumed=await resumeForAction('같은 세션을 다시 열고 있습니다. 열리면 설정을 적용합니다…');}catch(e){if(mine===epoch)notice(e.message);}finally{busy=false;render();}
  if(id!==sessionId||mine!==epoch)return;
  if(!resumed){$('settings-status').textContent='세션 재개를 확인하지 못해 설정을 적용하지 않았습니다. 상태를 확인한 뒤 다시 적용하세요.';return;}
  if(!await loadSettings()||id!==sessionId||mine!==epoch)return;
  for(const [f,v] of Object.entries(settingsDraft(draft,settingsData??{})))$(`setting-${f}`).value=v;
  renderPermissionDescription();renderSettings();
  if($(`apply-${field}`).disabled){$('settings-status').textContent='세션을 다시 열었습니다. '+($('settings-reason').textContent||'지금은 설정을 적용할 수 없습니다.');return;}
 }
 const id=sessionId,value=$(`setting-${field}`).value||null,expected={...settingsData.current,...(!['model','effort'].includes(field)?{flavor:settingsData.flavor}:{})};
 if(value===(settingsData.extras?.find(e=>e.field===field)?.current??expected[field])){$('settings-status').textContent='이미 같은 값입니다.';return;}
 const key=`hapi-settings-pending:${id}`;
 try{sessionStorage.setItem(key,JSON.stringify({field,value}));}catch{$('settings-status').textContent='변경 요청 상태를 보관할 수 없어 실행하지 않았습니다.';return;}
 busy=true;render();
 try{
  await api(`/api/sessions/${id}/settings`,{method:'POST',body:{field,value,expected}});
 }catch(error){if(error.rejected)sessionStorage.removeItem(key);if(id===sessionId)$('settings-status').textContent=error.rejected?'전송 전에 거부됐습니다. 최신 설정을 확인해 주세요.':'설정 변경 결과가 불확실합니다. 결과 확인으로 조회해 주세요.';}
 finally{busy=fromCreation;if(id===sessionId){await loadSettings();render();}}
}
function renderPermissionDescription(){
 const option=settingsOwner===sessionId?settingsData?.permissionModes?.find(o=>o.value===$('setting-permissionMode').value):null;
 $('permission-description').textContent=option?option.description+' 이 실행 머신의 현재 세션에만 적용하며 다른 세션·macOS 권한은 변경하지 않습니다.':'';
}
if(workspaceLayout){$('setting-permissionMode').onchange=renderPermissionDescription;$('apply-permissionMode').onclick=()=>applySetting('permissionMode');$('load-settings').onclick=loadSettings;$('apply-model').onclick=()=>applySetting('model');$('apply-effort').onclick=()=>applySetting('effort');}

let accountsBusy=false;
async function refreshAccounts(){
 if(accountsBusy||!token)return;
 const auth=token;accountsBusy=true;$('refresh-accounts').disabled=true;$('account-notice').textContent='실행 머신의 로그인 상태를 확인 중입니다.';
 try{
  const [data,profiles]=await Promise.all([api('/api/accounts'),api('/api/account-profiles').catch(()=>null)]);if(auth!==token)return;
  $('account-host').textContent=`확인 대상: ${data.host}`;
  const labels={'connection-required':'기존 CLI 설정 연결 필요',connected:'구독 로그인 확인', 'signed-out':'로그인 필요', 'not-installed':'설치 경로에서 CLI를 찾지 못함','other-auth':'다른 인증 방식 사용 중 · 자동 변경 안 함','not-configured':'아직 연결하지 않은 AI',unknown:'상태 확인 실패 · 기존 인증을 변경하지 않음'};
  $('account-list').replaceChildren(...data.providers.map(p=>{
   const card=document.createElement('article'),h=document.createElement('h3'),status=document.createElement('p'),button=document.createElement('button');h.textContent=p.agent==='claude'?'Claude Code':'Codex';status.textContent=labels[p.state]??labels.unknown;
   const note=document.createElement('small');note.textContent=p.loginPending?'로그인 창 실행/진행 중입니다. Mac에서 완료한 뒤 상태를 다시 확인하세요.':data.localLogin?'계정 식별 정보는 공식 CLI에서 확인하세요.':'새 로그인은 해당 서버 Mac에서 진행해 주세요.';
   button.textContent='연결한 CLI로 공식 로그인';button.disabled=!data.localLogin||p.state!=='signed-out'||p.loginPending;button.onclick=()=>startAccountLogin(p.agent);card.append(h,status,note);const prof=profiles?.[p.agent];if(prof)card.append(accountProfileControls(p.agent,prof,status,data.localLogin));card.append(button);return card;
  }));$('account-notice').textContent='상태 확인 완료. 기존 로그인은 그대로 사용합니다.';
 }catch{if(auth===token)$('account-notice').textContent='계정 상태를 확인하지 못했습니다. 연결과 서버 설정을 확인해 주세요.';}
 finally{accountsBusy=false;$('refresh-accounts').disabled=false;}
}
// One CLI connection per AI; no app-specific account creation or profile switching UI.
function accountProfileControls(agent,prof,status,local){
 const auth=token;return cliProfileControls({agent,local,active:prof.accounts[0],api,valid:()=>auth===token&&!!token,linked:async()=>{await refreshAccounts();await refreshCatalog();if(workspaceLayout)await refreshDraftAccount();$('account-notice').textContent='기존 CLI 설정을 연결했습니다. 다음 대화부터 이 연결을 사용합니다.';}});
}
async function startAccountLogin(agent){
 if(accountsBusy)return;accountsBusy=true;for(const b of $('account-list').querySelectorAll('button'))b.disabled=true;
 try{await api(`/api/accounts/${agent}/login`,{method:'POST',body:{}});$('account-notice').textContent='Mac의 공식 로그인 창을 확인하세요. 완료 후 상태 확인을 누르세요.';}
 catch{$('account-notice').textContent='로그인 시작 결과를 확인하지 못했습니다. Mac 화면과 연결 상태를 먼저 확인하세요. 자동으로 다시 실행하지 않습니다.';}
 finally{accountsBusy=false;}
}
// AI accounts live in one dialog, opened from the sidebar, the palette and the new-conversation form.
function openAccounts(){const d=$('accounts-dialog');if(!d)return;if(!d.open)d.showModal();refreshAccounts();}
if(workspaceLayout){$('accounts-tab').onclick=openAccounts;$('open-accounts').onclick=openAccounts;$('accounts-close').onclick=()=>$('accounts-dialog').close();$('refresh-accounts').onclick=refreshAccounts;}

if(workspaceLayout){
 const panel=$('composer-settings');
 function closeSettings(){panel.hidden=true;for(const id of ['model-chip','effort-chip','permissionMode-chip'])$(id).setAttribute('aria-expanded','false');}
 for(const field of ['model','effort','permissionMode'])$(field+'-chip').onclick=()=>{
  const opening=panel.hidden||panel.dataset.field!==field;closeSettings();if(!opening)return;
  panel.dataset.field=field;panel.hidden=false;$(field+'-chip').setAttribute('aria-expanded','true');
  $('settings-title').textContent=field==='model'?'모델 선택':field==='effort'?'추론 수준':'액세스 모드';
  for(const f of ['model','effort','permissionMode'])$(f+'-field').hidden=f!==field;
  if(!settingsLoading&&!busy&&connected)loadSettings();
 };
 $('close-settings').onclick=closeSettings;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSettings();workspacePanel('chat');workspaceDrawer(false);}});
 document.addEventListener('click',e=>{if(!e.target.closest('.composer-wrap'))closeSettings();});
 commandSuggest=createCommandSuggest({input:$('prompt'),list:$('command-suggestions'),load:{key:()=>sessionId&&session?.active?`${epoch}:${sessionId}`:null,fetch:async()=>{const agent=session?.metadata?.flavor;const [c,s]=await Promise.all([api(base()+'/slash-commands').catch(()=>null),api(base()+'/skills').catch(()=>null)]);const reported=c?.success?c.commands:[],chat=supportedChatCommands(agent,reported),inChat=new Set(chat.map(x=>x.name.toLowerCase()));
  // Commands the chat cannot carry are still listed; sending one offers the terminal.
  const terminal=sessionTerminalEnabled?reported.filter(x=>typeof x?.name==='string'&&/^[a-zA-Z][\w.:-]{0,127}$/.test(x.name)&&!inChat.has(x.name.toLowerCase())).map(x=>({...x,description:'터미널에서 실행 · '+(x.description??x.name)})):[];
  return {commands:[...chat,...terminal],skills:s?.success?s.skills:[]};}}});
 fileMentions=fileTabs?createFileMentions({input:$('prompt'),list:$('command-suggestions'),search:async term=>{if(!sessionId)return [];const r=await api(base()+'/files?query='+encodeURIComponent(term)+'&limit=20');return r?.success?r.files:[];}}):null;
 bindComposerEnter({input:$('prompt'),form:$('send-form'),button:$('send')});
 finder=createFind({bar:$('find-bar'),input:$('find-input'),count:$('find-count'),scope:()=>$('messages')});$('find-close').onclick=()=>finder.close();
 const shortcuts=[['⌘K','명령 팔레트'],['⌘F','대화에서 찾기'],['Enter','메시지 보내기'],['Shift+Enter','줄바꿈'],['Esc','패널·팝업 닫기']];
 const click=id=>()=>{const b=$(id);if(b&&!b.disabled&&!b.hidden)b.click();};
 palette=createPalette({root:$('palette'),input:$('palette-input'),list:$('palette-list'),items:()=>[
  {group:'동작',label:'새 대화',run:()=>{click('new-task-toggle')();click('session-entry-new')();}},
  {group:'동작',label:'기존 대화 가져오기',keywords:'import 가져오기',run:()=>{click('new-task-toggle')();setTimeout(click('session-entry-import'),50);}},
  {group:'동작',label:'대화에서 찾기',hint:'⌘F',run:()=>finder.open()},
  {group:'동작',label:'프로젝트 사이드바 보이기/숨기기',keywords:'sidebar',run:click('open-nav')},
  {group:'동작',label:'상세 패널 보이기/숨기기',keywords:'inspector 세션 정보',run:click('info-tab')},
  {group:'동작',label:'AI 계정·로그인 상태',keywords:'account login 계정',run:click('accounts-tab')},
  ...(sessionTerminalEnabled&&sessionId?[{group:'동작',label:'터미널에서 이 세션 이어가기',keywords:'terminal cli 터미널 명령 slash',run:()=>openSessionTerminal()}]:[]),
  {group:'동작',label:'세션 목록 새로고침',keywords:'refresh',run:click('refresh-list')},
  ...(pairingEnabled?[{group:'동작',label:'다른 기기 연결 코드 만들기',keywords:'pair qr 연결 원격 remote',run:()=>openPairing()}]:[]),
  ...trialSessions.map(s=>({group:'대화',label:s.displayName??s.label,detail:[s.agent==='claude'?'Claude':s.agent==='codex'?'Codex':'',s.projectLabel].filter(Boolean).join(' · '),run:()=>selectSession(s.id)})),
  ...shortcuts.map(([k,l])=>({group:'단축키',label:l,hint:k,keywords:'shortcut 단축키',run:()=>{}}))]});
 // Shortcuts only open existing UI; IME composition and modifier-less keys are left alone.
 document.addEventListener('keydown',e=>{
  if(!(e.metaKey||e.ctrlKey)||e.altKey||e.isComposing||e.keyCode===229||!token)return;
  const key=e.key.toLowerCase();
  if(key==='k'){e.preventDefault();palette.isOpen?palette.close():palette.open();}
  else if(key==='f'&&!e.shiftKey&&sessionId){e.preventDefault();finder.open();}
 });
 $('prompt').addEventListener('input',()=>{fitPrompt();render();});
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
  $('prepare-task-agent').onclick=async()=>{const found=draftAccount?.found;if(found&&draftAccount?.provider?.state==='connection-required'){$('prepare-task-agent').disabled=true;try{await api('/api/account-profiles',{method:'POST',body:{action:'connect',agent:draftAccount.agent,source:found.source,confirm:true,create:!found.exists,mode:found.mode}});await refreshDraftAccount();}catch(e){draftAccount={...draftAccount,error:e.message||'연결 결과를 확인하지 못했습니다. 상태를 다시 확인하세요.'};renderDraftAccount();}return;}
   if(draftAccount?.provider?.state==='connection-required'){openAccounts();return;}try{sessionStorage.setItem('maricode-new-session-agent',$('task-agent').value);}catch{}bridge.postMessage($('task-agent').value);};
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
 $('navigation-remove').hidden=target.default===true;$('navigation-remove').textContent=target.kind==='session'?'세션 제거':'등록 해제';
 $('navigation-remove-help').textContent=target.default?'기본 작업공간은 프로젝트와 함께 등록 해제합니다.':target.kind==='session'?'목록에서만 제거하거나 앱의 대화 기록까지 삭제할 수 있습니다.':target.kind==='project'?'하위 작업공간과 세션도 목록에서 제외합니다. 소스·Git·대화 기록은 그대로 남습니다.':'이 작업공간과 세션을 목록에서 제외합니다. 실제 폴더와 Git 워크트리는 삭제하지 않습니다.';
 // The server refuses to hide a running session; say so up front instead of failing after confirmation.
 const running=target.kind==='session'&&(target.id===sessionId?session?.active:sessionCards.get(target.id)?.snapshot?.active)===true;
 // Hiding a running session ends it first, after one confirmation, instead of disabling the button.
 navigationTarget.running=running;if(running)$('navigation-remove-help').textContent='실행 중인 세션입니다. 제거하면 먼저 실행을 종료합니다.';
 $('navigation-name').focus();
}
async function changeNavigation(input){
 if(navigationPending)return;navigationPending=true;for(const b of $('navigation-dialog').querySelectorAll('button,input'))b.disabled=true;$('navigation-status').textContent='변경 중…';
 try{await api('/api/navigation',{method:'POST',body:input});await openWorkspace();closeNavigation();notice(input.action==='rename'?'표시 이름을 변경했습니다.':input.action==='restore'?'목록에 복원했습니다.':input.action==='delete'?'세션 기록을 삭제했습니다. CLI 원본 기록은 남아 있습니다.':'목록에서 정리했습니다. 보기 설정에서 복원할 수 있습니다.');}
 catch(error){const text=error.message+' 응답이 끊긴 경우 목록을 새로고침해 결과부터 확인하세요.';$('navigation-status').textContent=text;if($('navigation-dialog').hidden)notice(text);}
 finally{navigationPending=false;for(const b of $('navigation-dialog').querySelectorAll('button,input'))b.disabled=false;}
}
async function restoreNavigation(){
 if(navigationPending)return;$('display-preferences').open=false;navigationTarget=null;showNavigation();$('navigation-edit').hidden=true;$('navigation-restores').hidden=false;$('navigation-restores').replaceChildren();$('navigation-title').textContent='제거한 항목';$('navigation-context').textContent='같은 항목으로 복원합니다. 세션을 새로 만들거나 실행하지 않습니다.';$('navigation-status').textContent='조회 중…';
 try{const data=await api('/api/navigation');if($('navigation-dialog').hidden||navigationTarget)return;
  const items=[...data.removed.filter(r=>r.kind!=='session'||!allSessionEntries.some(s=>s.id===r.id)),...allSessionEntries.filter(s=>s.hidden).map(s=>({kind:'session',id:s.id,name:s.displayName??s.label}))];
  for(const item of items){const row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');label.textContent=({project:'프로젝트',workspace:'작업공간',session:'세션'})[item.kind]+' · '+item.name+(item.parent?` (${item.parent} 안)`:'');if(item.parent)row.className='navigation-child';button.textContent='복원';button.setAttribute('aria-label',item.name+' 복원');button.onclick=()=>changeNavigation({kind:item.kind,id:item.id,action:'restore'});row.append(label);if(!item.parent)row.append(button);
   // Permanent delete removes only the app record; a second click confirms because it cannot be undone.
   if(item.kind==='session'){const remove=document.createElement('button');remove.textContent='기록 삭제';remove.className='danger';remove.setAttribute('aria-label',item.name+' 기록 삭제');
    remove.onclick=()=>{if(remove.dataset.confirm){changeNavigation({kind:'session',id:item.id,action:'delete'});return;}remove.dataset.confirm='1';remove.textContent='삭제 확인';$('navigation-status').textContent='앱의 대화 기록을 영구 삭제합니다. 되돌릴 수 없습니다. 터미널 Claude CLI의 원본 기록은 남습니다. 한 번 더 누르면 삭제합니다.';};row.append(remove);}
   $('navigation-restores').append(row);}
  $('navigation-status').textContent=items.length?'제거한 프로젝트 안의 세션은 프로젝트를 복원하면 함께 돌아옵니다. 기록 삭제는 바로 할 수 있습니다.':'복원할 항목이 없습니다.';
 }catch(e){$('navigation-status').textContent=e.message;}
}
if(workspaceLayout){
 $('navigation-dialog').addEventListener('cancel',e=>{e.preventDefault();if(!navigationPending)closeNavigation();});
 $('navigation-close').onclick=()=>{if(!navigationPending)closeNavigation();};
 $('navigation-rename').onclick=()=>{if(navigationTarget)changeNavigation({kind:navigationTarget.kind,id:navigationTarget.id,action:'rename',name:$('navigation-name').value});};
 $('navigation-remove').onclick=()=>{const t=navigationTarget,session=t.kind==='session';$('navigation-confirm').hidden=false;$('navigation-confirm-delete').hidden=!session;
  $('navigation-confirm-remove').textContent=session?'목록에서만 제거':'등록 해제 확인';
  $('navigation-confirm-text').textContent=session?`${t.running?'실행을 종료한 뒤 ':''}어떻게 제거할까요? 목록에서만 제거하면 ‘제거한 항목 복원’에서 되돌릴 수 있습니다. 기록까지 삭제하면 앱의 대화 기록이 영구 삭제되며 되돌릴 수 없습니다(터미널 CLI 원본 기록은 남음).`:'위 항목을 목록에서 정리할까요? 원본은 유지하며 나중에 복원할 수 있습니다.';};
 $('navigation-cancel-remove').onclick=()=>{$('navigation-confirm').hidden=true;};
 // Session removal: bookmark only (restorable) or also delete the app record. A running session is ended first.
 async function removeTarget(deleteRecord){const t=navigationTarget;if(!t)return;
  if(t.kind==='session'&&t.running){closeNavigation();navigationTarget=null;
   if(t.id!==sessionId){selectSession(t.id);await refresh();}
   if(!await endCurrentSession(false))return;}
  await changeNavigation({kind:t.kind,id:t.id,action:'remove'});
  if(deleteRecord)await changeNavigation({kind:'session',id:t.id,action:'delete'});}
 $('navigation-confirm-remove').onclick=()=>removeTarget(false);
 $('navigation-confirm-delete').onclick=()=>removeTarget(true);
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
// Messages sent while the engine worked wait in HAPI's queue until the turn ends; HAPI reports which are still waiting.
let queuedIds=new Set(),queueBusy=new Set(),stopping=false;
async function refreshQueue(serial){
 const owner=sessionId,local=messages.filter(m=>m.content?.role==='user'&&typeof m.localId==='string').slice(-20);
 if(!local.length||!session?.thinking&&!queuedIds.size){if(queuedIds.size){queuedIds=new Set();render();}return;}
 try{const r=await api(base()+'/messages/queued-state',{method:'POST',body:{localIds:local.map(m=>m.localId)}});
  if(serial!==refreshSerial||owner!==sessionId||!Array.isArray(r?.queuedLocalIds))return;
  const next=new Set(local.filter(m=>r.queuedLocalIds.includes(m.localId)).map(m=>m.id));
  if([...next].join()!==[...queuedIds].join()){queuedIds=next;render();}
 }catch{}
}
async function queueAction(id,kind){
 if(queueBusy.has(id))return;queueBusy.add(id);render();const owner=sessionId;
 try{const r=await api(base()+'/messages/'+encodeURIComponent(id)+(kind==='steer'?'/steer':''),{method:kind==='steer'?'POST':'DELETE',...(kind==='steer'?{body:{}}:{})});
  if(owner!==sessionId)return;
  notice(r?.status==='cancelled'?'대기 중인 메시지를 취소했습니다.':r?.status==='steered'?'진행 중인 작업에 메시지를 반영했습니다.':r?.status==='invoked'?'이미 AI에 전달된 메시지라 취소하지 않았습니다.':`처리하지 못했습니다. ${r?.error??''} 상태를 확인해 주세요.`);
 }catch(e){if(owner===sessionId)notice(e.message+' 자동으로 다시 시도하지 않습니다.');}
 finally{queueBusy.delete(id);await refresh().catch(()=>{});render();}
}
const cancelQueued=id=>queueAction(id,'cancel'),steerQueued=id=>queueAction(id,'steer');
async function stopTurn(){
 if(stopping||!session?.thinking)return;stopping=true;render();const owner=sessionId;
 try{await api(base()+'/abort',{method:'POST',body:{}});if(owner===sessionId)notice('중지를 요청했습니다. 이미 바뀐 파일은 되돌리지 않습니다.');}
 catch(e){if(owner===sessionId)notice('중지 요청을 확인하지 못했습니다. '+e.message);}
 finally{stopping=false;await refresh().catch(()=>{});render();}
}
if($('stop'))$('stop').onclick=stopTurn;
if($('open-terminal'))$('open-terminal').onclick=()=>openSessionTerminal();
if($('menu-terminal'))$('menu-terminal').onclick=()=>openSessionTerminal();
// Menus close once an item is chosen, so the result they open is not hidden behind them.
for(const menu of document.querySelectorAll('details.connection-menu'))menu.addEventListener('click',e=>{if(e.target.closest('button')&&!e.target.closest('summary'))menu.open=false;});
function updateJumpLatest(){const s=$('conversation-history'),b=$('jump-latest');if(s&&b)b.hidden=!moreBelow(s);updateStuckPrompt();}
// The request that scrolled past stays pinned (sticky CSS) in two lines; earlier pinned ones are hidden behind it.
function updateStuckPrompt(){const s=$('conversation-history');if(!s)return;const top=s.getBoundingClientRect().top+1,pinned=[...s.querySelectorAll('.bubble.user:not(.child-message)')].filter(b=>b.getBoundingClientRect().top<=top);
 for(const b of s.querySelectorAll('.bubble.user'))b.classList.remove('stuck','stuck-under');pinned.forEach((b,i)=>b.classList.add(i===pinned.length-1?'stuck':'stuck-under'));}
if($('jump-latest')){const s=$('conversation-history');s.addEventListener('scroll',updateJumpLatest,{passive:true});
 // Cards and streamed replies grow the content without a scroll event.
 const grow=new ResizeObserver(updateJumpLatest);grow.observe($('messages'));
 $('jump-latest').onclick=()=>s.scrollTo({top:s.scrollHeight,behavior:'smooth'});}
