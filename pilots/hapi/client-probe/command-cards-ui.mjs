import {archiveSnapshot,archiveMatches} from './core.mjs';
const definitions=[['mcp','mcp-list','MCP 목록·인증·HTTP 서버 추가/삭제'],['plugins','plugins-list','설치된 플러그인 목록'],['account','account','현재 AI 계정 로그인 상태'],['doctor','doctor','Codex 설치·설정 진단']];
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
export function createCommandCard({id,name,cap,api,storage,valid=()=>true,reconnect,document:doc=globalThis.document}){
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
 const card=el('section');card.className='cli-command-card';card.setAttribute('aria-label',`/${name} 명령 카드`);
 const head=el('header'),title=el('strong',`/${name} · ${cap.agent==='claude'?'Claude':'Codex'}`),close=el('button','닫기');close.type='button';head.append(title,close);
 const context=el('p',`${cap.alias||cap.accountId} · ${cap.cwd}`);context.className='cli-card-context';
 const note=el('small','공식 CLI를 이 컴퓨터에서 실행합니다. 결과는 AI에게 전송하지 않습니다.');
 const status=el('p','조회 준비');status.setAttribute('role','status');const rows=el('div'),controls=el('div'),writeStatus=el('p');writeStatus.setAttribute('role','status');
 const check=el('button','조회 결과 확인'),reload=el('button','목록 새로고침'),writeCheck=el('button','변경 결과 확인'),apply=el('button','적용하고 이어가기');for(const b of [check,reload,writeCheck,apply])b.type='button';controls.append(reload,check);card.append(head,context,note,controls,status,rows);
 const buttons=[],key=kind=>`maricode-command-card:${id}:${name}:${kind}`;
 const stored=kind=>{try{return JSON.parse(storage?.getItem(key(kind)));}catch{return null;}};
 const save=kind=>v=>{try{if(v)storage?.setItem(key(kind),JSON.stringify(v));else storage?.removeItem(key(kind));}catch{}};
 let rowsValue=null,reconnecting=false,disposed=false;
 const read=createCardRequest({id,cap,api,save:save('read'),stored:stored('read'),changed:render}),write=createCardRequest({id,cap,api,save:save('write'),stored:stored('write'),changed:render});
 const scope=el('select');scope.setAttribute('aria-label','Claude MCP 변경 범위');for(const [value,text] of [['local','이 계정·이 폴더 (local)'],['project','프로젝트 공유 파일 (project)'],['user','이 계정의 모든 폴더 (user)']]){const o=el('option',text);o.value=value;scope.append(o);}scope.value='local';
 const confirmation=el('div');confirmation.hidden=true;let proposal=null,editPanel=null;
 const confirmText=el('p'),confirm=el('button','변경 확인'),cancel=el('button','취소');confirm.type=cancel.type='button';confirmation.append(confirmText,confirm,cancel);
 function propose(action,params){if(!valid()||write.pending||write.busy)return;proposal={action,params};if(editPanel)editPanel.open=true;confirmText.textContent=`${cap.alias||cap.accountId} · ${cap.cwd}\n${params.name}${params.url?' → '+params.url:''}\n${params.scope||'현재 Codex 계정'} 범위에서 ${action==='mcp-login'?'인증을 시작':action==='mcp-add'?'추가':'삭제'}합니다. 같은 설정을 쓰는 다른 세션에도 영향을 줄 수 있습니다.`;if(action==='mcp-login')confirmText.textContent=`${cap.alias||cap.accountId} · ${cap.cwd}\n${params.name} 서버의 공식 인증을 이 컴퓨터의 브라우저에서 시작합니다. 인증은 현재 CLI 계정에 저장되며 같은 설정을 쓰는 다른 세션에도 영향을 줄 수 있습니다. 암호·코드를 채팅에 보내지 마세요.`;confirmation.hidden=false;}
 cancel.onclick=()=>{proposal=null;confirmation.hidden=true;};
 confirm.onclick=async()=>{if(!valid()||!proposal)return;const p=proposal;proposal=null;confirmation.hidden=true;await write.run(p.action,p.params,true);};
 if(name==='mcp'&&(cap.actions.includes('mcp-add')||cap.actions.includes('mcp-remove')||cap.actions.includes('mcp-login'))){
  const panel=el('details');editPanel=panel;const summary=el('summary','MCP 설정 변경');panel.append(summary,el('p','HTTP 서버만 지원합니다. 토큰·암호 없는 주소를 사용하세요. 인증 시작은 공식 CLI가 이 컴퓨터의 브라우저를 엽니다. 완료 후 인증 결과를 확인하고 목록을 새로고침하세요. 브라우저가 열리지 않거나 직접 코드 입력이 필요한 서버는 공식 CLI 보조 경로를 이용하세요.'));
  if(cap.agent==='claude'&&(cap.actions.includes('mcp-add')||cap.actions.includes('mcp-remove')))panel.append(scope);else if(cap.agent==='codex') panel.append(el('p','현재 Codex 계정 프로필에 저장'));
  if(cap.actions.includes('mcp-add')){const form=el('form'),server=el('input'),url=el('input'),add=el('button','서버 추가 검토');server.required=true;server.maxLength=64;server.pattern='[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}';url.required=true;url.type='url';url.placeholder='https://example.com/mcp';
   for(const [label,input] of [['서버 이름',server],['HTTP MCP 주소',url]]){const l=el('label',label);l.append(input);form.append(l);}add.type='submit';form.append(add);buttons.push(add);panel.append(form);form.onsubmit=e=>{e.preventDefault();propose('mcp-add',{name:server.value.trim(),url:url.value.trim(),...(cap.agent==='claude'?{scope:scope.value}:{})});};}
  panel.append(confirmation,writeStatus,writeCheck,apply);card.append(panel);panel.open=write.pending;
 }
 async function load(){if(!valid())return;await read.run(definitions.find(d=>d[0]===name)[1]);}
 reload.onclick=load;check.onclick=()=>valid()&&read.check();writeCheck.onclick=()=>valid()&&write.check();
 apply.onclick=async()=>{if(!valid()||reconnecting||!write.value?.needsReconnect)return;reconnecting=true;render();try{const done=await reconnect(id);writeStatus.textContent=done?'같은 세션을 재개했습니다. MCP 실제 연결은 다음 작업에서 확인하세요.':'재개를 취소했습니다. 설정은 저장되어 있습니다.';}catch(e){writeStatus.textContent=e.message;}finally{reconnecting=false;apply.disabled=false;}};
 close.onclick=()=>{if(!read.busy&&!write.busy&&!read.pending&&!write.pending&&!reconnecting){disposed=true;card.remove();}};
 function render(){if(disposed)return;reload.disabled=read.busy||read.pending;check.hidden=!read.pending;check.disabled=read.busy;writeCheck.textContent=write.value?.action==='mcp-login'?'인증 결과 확인':'변경 결과 확인';writeCheck.hidden=!write.pending;writeCheck.disabled=write.busy;apply.hidden=!write.value?.needsReconnect;apply.disabled=reconnecting||write.busy;close.disabled=read.busy||write.busy||read.pending||write.pending||reconnecting;
  for(const b of buttons)b.disabled=write.pending||write.busy;scope.disabled=write.pending||write.busy;
  status.textContent=read.busy?'공식 CLI 조회 중…':read.value?.summary??(read.pending?'미확인 조회가 있습니다. 결과를 확인하세요.':'조회 준비');
  writeStatus.textContent=write.busy?'설정 변경 중…':write.value?.summary??(write.pending?'앞선 변경 결과가 미확인입니다. 다시 변경하지 않고 결과를 조회하세요.':'');
  if(rowsValue===read.value)return;rowsValue=read.value;rows.replaceChildren();for(const row of read.value?.rows??[]){const line=el('div');line.className='cli-card-row';line.append(el('strong',row.name),el('span',row.status));if(name==='mcp'&&cap.actions.includes('mcp-remove')){const remove=el('button','삭제 검토');remove.type='button';remove.onclick=()=>propose('mcp-remove',{name:row.name,...(cap.agent==='claude'?{scope:scope.value}:{})});line.append(remove);}if(name==='mcp'&&cap.actions.includes('mcp-login')&&row.status!=='비활성'){const login=el('button','인증 시작');login.type='button';login.onclick=()=>propose('mcp-login',{name:row.name});line.append(login);}rows.append(line);}
 }
 render();return {element:card,load,show:()=>{card.hidden=false;},hide:()=>{card.hidden=true;}};
}
