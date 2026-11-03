import {archiveSnapshot,archiveMatches} from './core.mjs';
import {createAccountCardControls} from './account-card-ui.mjs';
const definitions=[['mcp','mcp-list','MCP 목록·인증·HTTP 서버 추가/삭제'],['plugins','plugins-list','설치된 플러그인 목록'],['account','account','AI 로그인 상태·공식 로그인·CLI 연결 설정'],['doctor','doctor','Codex 설치·설정 진단']];
export const cardCommands=cap=>definitions.filter(([,action])=>cap?.actions?.includes(action)).map(([name,,description])=>({name,description:'명령 카드 · '+description,source:'maricode'}));
export const cardCommand=text=>{const name=/^\s*\/([a-z]+)\s*$/i.exec(text)?.[1]?.toLowerCase();return definitions.some(d=>d[0]===name)?name:null;};
export function createCardRequest({id,cap,api,save=()=>{},stored=null,uuid=()=>crypto.randomUUID(),changed=()=>{}}){
 let pending=stored?.requestId??null,busy=false,value=null;
 const path=`/api/sessions/${id}/command-cards`;
 function accept(r){value=r;if(['succeeded','failed'].includes(r.state)){pending=null;save(null);}changed();}
 return {get pending(){return !!pending;},get busy(){return busy;},get value(){return value;},
  async run(action,params={},confirm=false){if(pending||busy)return;pending=uuid();save({requestId:pending});busy=true;changed();
   try{accept(await api(path,{method:'POST',body:{requestId:pending,contextKey:cap.contextKey,action,params,confirm}}));}
   catch(e){if(e.rejected){pending=null;save(null);}value={state:e.rejected?'failed':'unknown',summary:e.message,rows:[]};}
   finally{busy=false;changed();}
  },
  async check(){if(!pending||busy)return;busy=true;changed();try{accept(await api(path+'/'+pending));}catch{value={state:'unknown',summary:'접수·결과를 확인하지 못했습니다. 다시 실행하지 않고 결과만 조회합니다.',rows:[]};}finally{busy=false;changed();}}
 };
}
export async function reconnectCommandSession({id,read,refresh,confirm,archive,resume}){
 const check=()=>{const s=read();if(s.id!==id||!s.connected||s.pending||s.resumeUnconfirmed||s.thinking||Object.keys(s.agentState?.requests??{}).length)throw Error('대상·승인·미확인 요청 상태를 확인한 뒤 같은 세션에서 다시 진행하세요.');return s;};
 await refresh();let s=check();
 if(s.active){if(s.agentState?.controlledByUser!==false)throw Error('앱에서 제어 중인 세션만 재개할 수 있습니다.');const approval=archiveSnapshot(id,s);if(!await confirm())return false;await refresh();s=check();if(!s.active||!archiveMatches(approval,id,s))throw Error('확인하는 동안 세션 상태가 바뀌었습니다. 자동 재개하지 않습니다.');await archive(approval.expected);await refresh();s=check();if(s.active)throw Error('종료가 확인되지 않아 재개하지 않았습니다. 상태를 다시 확인하세요.');}
 await resume();await refresh();if(!check().active)throw Error('재개 결과를 확인해야 합니다. 자동 재시도하지 않습니다.');return true;
}
// The tools Claude listed at start plus what the conversation shows: deferred MCP tools loaded later (tool_use,
// ToolSearch references) and the servers Claude reported as failed to connect. The CLI list card is a fresh check
// and cannot see this; a server failed here stays failed until the session restarts.
export function liveMcpServers(tools,messages=[]){
 if(!Array.isArray(tools)&&!messages?.length)return null;
 const names=new Set(),label=raw=>raw.replace(/^claude_ai_(.*)$/,(_,r)=>'claude.ai '+r.replaceAll('_',' '));let failed=[];
 const add=name=>{const m=/^mcp__(.+?)__/.exec(name??'');if(m)names.add(label(m[1]));};
 for(const t of tools??[])add(t);
 for(const m of messages??[]){
  const blocks=m?.content?.content?.data?.message?.content;if(!Array.isArray(blocks))continue;
  for(const b of blocks){
   if(b?.type==='tool_use')add(b.name);if(b?.type!=='tool_result')continue;
   for(const c of Array.isArray(b.content)?b.content:[b.content]){
    if(c?.type==='tool_reference')add(c.tool_name);
    const text=typeof c==='string'?c:c?.type==='text'?c.text:'',note=/MCP servers failed to connect[^:]*:\s*([\s\S]*)/.exec(text??'');
    if(note)failed=[...note[1].matchAll(/(?:^|;\s*)([\w.@ -]+?) \([^)]*\):/g)].map(x=>x[1]);
   }
  }
 }
 return {servers:[...names].sort(),failed:[...new Set(failed)].filter(n=>!names.has(n)).sort()};
}
// claude.ai account connectors are authorized on claude.ai, so unused ones are not actionable from the CLI card.
const needsAction=status=>['인증 필요','연결 실패','프로젝트 승인 필요'].includes(status);
export function createCommandCard({id,name,cap,api,storage,valid=()=>true,reconnect,accountSettings,backToChat,liveTools=()=>null,liveMessages=()=>null,document:doc=globalThis.document}){
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
 const card=el('section');card.className='cli-command-card';card.setAttribute('aria-label',`/${name} 명령 카드`);
 const head=el('header'),title=el('strong',`/${name} · ${cap.agent==='claude'?'Claude':'Codex'}`),close=el('button','닫기');close.type='button';head.append(title,close);
 const context=el('p',`${cap.alias||cap.accountId} · ${cap.cwd}`);context.className='cli-card-context';
 const note=el('small','공식 CLI를 이 컴퓨터에서 실행합니다. 결과는 AI에게 전송하지 않습니다.');
 const reflection=el('p');
 const status=el('p','조회 준비');status.setAttribute('role','status');const rows=el('div'),controls=el('div'),writeStatus=el('p');writeStatus.setAttribute('role','status');
 const check=el('button','조회 결과 확인'),reload=el('button','목록 새로고침'),writeCheck=el('button','변경 결과 확인'),apply=el('button','적용하고 이어가기');for(const b of [check,reload,writeCheck,apply])b.type='button';controls.append(reload,check);const live=el('p');live.hidden=name!=='mcp';const reload2=el('button','같은 세션 다시 시작해 MCP 다시 불러오기');reload2.type='button';reload2.hidden=true;
 // MCP: the live servers and rows needing action stay open; the full settings list starts folded.
 const all=el('details'),allSummary=el('summary'),allRows=el('div');all.append(allSummary,allRows);all.hidden=true;
 if(name==='mcp'){reload.textContent='새로고침';head.insertBefore?.(reload,close);note.hidden=true;}
 card.append(head,context,note,live,reload2,controls,status,rows,all,reflection);
 const buttons=[],key=kind=>`maricode-command-card:${id}:${name}:${kind}`;
 const stored=kind=>{try{return JSON.parse(storage?.getItem(key(kind)));}catch{return null;}};
 const save=kind=>v=>{try{if(v)storage?.setItem(key(kind),JSON.stringify(v));else storage?.removeItem(key(kind));}catch{}};
 let rowsValue=null,reconnecting=false,disposed=false,resumeDone=false;
 let accountFlow=null;
 const read=createCardRequest({id,cap,api,save:save('read'),stored:name==='account'?null:stored('read'),changed:render}),write=createCardRequest({id,cap,api,save:save('write'),stored:stored('write'),changed:render});
 const scope=el('select');scope.setAttribute('aria-label','Claude MCP 변경 범위');for(const [value,text] of [['local','이 계정·이 폴더 (local)'],['project','프로젝트 공유 파일 (project)'],['user','이 계정의 모든 폴더 (user)']]){const o=el('option',text);o.value=value;scope.append(o);}scope.value='local';
 const confirmation=el('div');confirmation.hidden=true;let proposal=null,editPanel=null;
 const confirmText=el('p'),confirm=el('button','변경 확인'),cancel=el('button','취소');confirm.type=cancel.type='button';confirmation.append(confirmText,confirm,cancel);
 function propose(action,params){if(!valid()||write.pending||write.busy)return;proposal={action,params};if(editPanel)editPanel.open=true;confirmText.textContent=`${cap.alias||cap.accountId} · ${cap.cwd}\n${params.name}${params.url?' → '+params.url:''}\n${params.scope||'현재 Codex 계정'} 범위에서 ${action==='mcp-login'?'인증을 시작':action==='mcp-add'?'추가':'삭제'}합니다. 같은 설정을 쓰는 다른 세션에도 영향을 줄 수 있습니다.`;if(action==='mcp-login')confirmText.textContent=`${cap.alias||cap.accountId} · ${cap.cwd}\n${params.name} 서버의 공식 인증을 이 컴퓨터의 브라우저에서 시작합니다. 인증은 현재 CLI 계정에 저장되며 같은 설정을 쓰는 다른 세션에도 영향을 줄 수 있습니다. 암호·코드를 채팅에 보내지 마세요.`;confirmation.hidden=false;}
 cancel.onclick=()=>{proposal=null;confirmation.hidden=true;};
 confirm.onclick=async()=>{if(!valid()||!proposal)return;const p=proposal;proposal=null;confirmation.hidden=true;resumeDone=false;reflection.textContent='변경 결과 확인 → 같은 세션 재개 → 실제 도구 연결 확인 순서로 진행합니다.';await write.run(p.action,p.params,true);};
 if(name==='mcp'&&(cap.actions.includes('mcp-add')||cap.actions.includes('mcp-remove')||cap.actions.includes('mcp-login'))){
  const panel=el('details');editPanel=panel;const summary=el('summary','MCP 설정 변경');panel.append(summary,el('p','HTTP 서버만 지원합니다. 토큰·암호 없는 주소를 사용하세요. 인증 시작은 공식 CLI가 이 컴퓨터의 브라우저를 엽니다. 완료 후 인증 결과를 확인하고 목록을 새로고침하세요. 브라우저가 열리지 않거나 직접 코드 입력이 필요한 서버는 공식 CLI 보조 경로를 이용하세요.'));
  if(cap.agent==='claude'&&(cap.actions.includes('mcp-add')||cap.actions.includes('mcp-remove')))panel.append(scope);else if(cap.agent==='codex') panel.append(el('p','현재 Codex 계정 프로필에 저장'));
  if(cap.actions.includes('mcp-add')){const form=el('form'),server=el('input'),url=el('input'),add=el('button','서버 추가 검토');server.required=true;server.maxLength=64;server.pattern='[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}';url.required=true;url.type='url';url.placeholder='https://example.com/mcp';
   for(const [label,input] of [['서버 이름',server],['HTTP MCP 주소',url]]){const l=el('label',label);l.append(input);form.append(l);}add.type='submit';form.append(add);buttons.push(add);panel.append(form);form.onsubmit=e=>{e.preventDefault();propose('mcp-add',{name:server.value.trim(),url:url.value.trim(),...(cap.agent==='claude'?{scope:scope.value}:{})});};}
  panel.append(confirmation,writeStatus,writeCheck,apply);card.append(panel);panel.open=write.pending;
 }
 if(name==='account'){accountFlow=createAccountCardControls({agent:cap.agent,api,storage,valid:()=>!disposed&&valid(),settings:accountSettings,back:backToChat,changed:render,document:doc});card.append(accountFlow.element);controls.hidden=status.hidden=true;}
 async function load(){if(!valid())return;if(accountFlow)return accountFlow.load();await read.run(definitions.find(d=>d[0]===name)[1]);}
 reload.onclick=load;check.onclick=()=>valid()&&read.check();writeCheck.onclick=()=>valid()&&write.check();
 reload2.onclick=async()=>{if(!valid()||reconnecting||resumeDone)return;reconnecting=true;render();try{const done=await reconnect(id);resumeDone=done;reflection.textContent=done?'같은 세션을 다시 시작했습니다. MCP는 새 실행에서 다시 연결합니다. 대화에서 도구를 써서 확인하세요.':'다시 시작을 취소했습니다.';}catch(e){reflection.textContent=e.message;}finally{reconnecting=false;render();}};
 apply.onclick=async()=>{if(!valid()||reconnecting||resumeDone||!write.value?.needsReconnect)return;reconnecting=true;render();try{const done=await reconnect(id);resumeDone=done;if(done)reflection.textContent='같은 세션 재개 완료 · 실제 MCP 도구 연결은 미확인입니다. CLI 목록 새로고침만으로 도구 연결이 검증되지는 않습니다.';writeStatus.textContent=done?'같은 세션을 재개했습니다. MCP 실제 도구 연결은 아직 확인하지 않았습니다. 대화에서 필요한 도구를 사용해 확인하세요.':'재개를 취소했습니다. 설정은 저장되어 있습니다.';}catch(e){writeStatus.textContent=e.message;}finally{reconnecting=false;apply.disabled=resumeDone;reflection.hidden=!reflection.textContent;}};
 close.onclick=()=>{if(!read.busy&&!write.busy&&!read.pending&&!write.pending&&!reconnecting&&!accountFlow?.busy){disposed=true;card.remove();}};
 function render(){if(disposed)return;reload.disabled=read.busy||read.pending;check.hidden=!read.pending;check.disabled=read.busy;writeCheck.textContent=write.value?.action==='mcp-login'?'인증 결과 확인':'변경 결과 확인';writeCheck.hidden=!write.pending;writeCheck.disabled=write.busy;apply.hidden=!write.value?.needsReconnect;apply.disabled=reconnecting||write.busy||resumeDone;close.disabled=read.busy||write.busy||read.pending||write.pending||reconnecting||!!accountFlow?.busy;
  for(const b of buttons)b.disabled=write.pending||write.busy;scope.disabled=write.pending||write.busy;
  reflection.hidden=!reflection.textContent;
  const liveState=liveMcpServers(liveTools(),liveMessages()),servers=liveState?.servers;live.textContent=servers?`이 대화의 MCP ${servers.length}개${servers.length?' · '+servers.join(', '):''}${liveState.failed.length?`\n이 대화에서 연결 실패: ${liveState.failed.join(', ')} — 대화는 시작할 때의 연결을 유지합니다. 설정을 고쳤다면 같은 세션을 다시 시작해야 반영됩니다.`:''}\n아직 쓰지 않은 MCP는 여기 없을 수 있습니다.`:'이 대화가 불러온 MCP 정보가 아직 없습니다. 대화를 시작하면 표시됩니다.';reload2.hidden=!liveState?.failed.length||resumeDone;reload2.disabled=reconnecting;
  const listed=read.value?.rows??[],attention=name==='mcp'?listed.filter(r=>needsAction(r.status)&&!r.name.startsWith('claude.ai ')):[];
  status.textContent=read.busy?'공식 CLI 조회 중…':name==='mcp'&&listed.length?(attention.length?`확인 필요 ${attention.length}개`:'확인이 필요한 MCP 없음'):read.value?.summary??(read.pending?'미확인 조회가 있습니다. 결과를 확인하세요.':'조회 준비');
  writeStatus.textContent=write.busy?'설정 변경 중…':write.value?.summary??(write.pending?'앞선 변경 결과가 미확인입니다. 다시 변경하지 않고 결과를 조회하세요.':'');
  if(rowsValue===read.value)return;rowsValue=read.value;rows.replaceChildren();allRows.replaceChildren();
  const line=(row,{remove=false,login=false}={})=>{const n=el('div');n.className='cli-card-row';n.append(el('strong',row.name),el('span',row.status));
   if(remove&&cap.actions.includes('mcp-remove')){const b=el('button','삭제 검토');b.type='button';b.onclick=()=>propose('mcp-remove',{name:row.name,...(cap.agent==='claude'?{scope:scope.value}:{})});n.append(b);}
   if(login&&cap.actions.includes('mcp-login')&&row.status!=='비활성'){const b=el('button','인증 시작');b.type='button';b.onclick=()=>propose('mcp-login',{name:row.name});n.append(b);}return n;};
  if(name!=='mcp'){for(const row of listed)rows.append(line(row));return;}
  // Claude reports which servers need auth; Codex rows carry no auth state, so their login stays in the full list.
  for(const row of attention)rows.append(line(row,{login:cap.agent==='claude'&&row.status==='인증 필요'}));
  for(const row of listed)allRows.append(line(row,{remove:true,login:cap.agent!=='claude'}));
  allSummary.textContent=`설정된 MCP 전체 ${listed.length}개`;all.hidden=!listed.length;
 }
 render();return {element:card,load,show:()=>{card.hidden=false;},hide:()=>{card.hidden=true;}};
}
