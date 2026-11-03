export const needsOfficialCli=(agent,text)=>agent==='claude'&&/^\/(?:mcp|config)(?:\s|$)/.test(String(text).trim());
export function cliUiState(state,local){
 if(!local)return {canOpen:false,text:'공식 CLI 창은 해당 서버 Mac의 로컬 화면에서 열어 주세요.'};
 if(!state)return {canOpen:false,text:'CLI 실행 상태를 확인하지 못했습니다. 상태를 다시 확인하세요.'};
 if(!state.supported)return {canOpen:false,text:'이 실행 환경에서는 Mac 터미널 연결을 지원하지 않습니다.'};
 const labels={idle:'아직 연 CLI 창이 없습니다.',opening:'창 열기 요청을 보냈습니다. Mac 터미널을 확인하세요. 중복으로 열지 않습니다.',running:'공식 CLI 설정 창이 열려 있습니다. CLI를 마친 뒤 exit로 셸도 종료하세요.',finished:'설정 창이 종료됐습니다. 실행 중 대화에 자동 반영됐다는 뜻은 아닙니다. 필요하면 실행 종료 후 재개하세요.',failed:'CLI 실행에 실패했습니다. 설치 경로·폴더 접근을 확인한 뒤 다시 여세요.',unknown:'창 실행 결과가 미확인입니다. 터미널을 먼저 확인하세요. 자동으로 다시 열지 않습니다.'};
 return {canOpen:['idle','finished','failed'].includes(state.phase),text:labels[state.phase]??labels.unknown};
}
export function officialCliControls({agent,profile,local,state,projects,selected,api,valid,document:doc=globalThis.document}){
 const el=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
 const box=el('details'),summary=el('summary',agent==='claude'?'공식 CLI · MCP 설정':'공식 CLI 열기');box.className='official-cli';box.dataset.agent=agent;
 const content=el('div'),target=el('p'),label=el('label','작업 폴더'),select=el('select'),path=el('small'),help=el('p'),message=el('p'),open=el('button','공식 CLI 열기'),check=el('button','상태 확인'),row=el('div');
 content.className='official-cli-body';row.className='official-cli-actions';message.setAttribute('role','status');open.type=check.type='button';select.setAttribute('aria-label','공식 CLI 작업 폴더');
 if(!local){content.append(el('p',cliUiState(null,false).text));box.append(summary,content);return box;}
 const account=profile?.accounts.find(a=>a.id===profile.active);target.textContent=`이 Mac · ${agent==='claude'?'Claude':'Codex'} · ${account?.alias??'계정 확인 필요'}`;
 const options=projects.filter(p=>p.available!==false);for(const p of options){const o=el('option',p.label+(p.parentKey?' · '+(p.workspaceLabel??'작업공간'):''));o.value=p.key;select.append(o);}
 if(options.some(p=>p.key===selected))select.value=selected;else if(options.length)select.value=options[0].key;
 help.textContent='선택한 계정·폴더로 별도 터미널을 엽니다. 기존 대화를 재개하지 않으며 터미널의 대화는 앱에 자동 표시되지 않습니다. '+(agent==='claude'?'Claude에서 /mcp를 입력하세요. CLI를 끝낸 뒤 같은 창에서 claude mcp --help로 추가·삭제·인증 명령을 확인할 수 있습니다. ':'')+'설정 변경은 같은 계정·프로젝트의 다른 세션에도 영향을 줄 수 있습니다. 앱을 닫아도 별도 터미널은 남습니다. 암호·인증 코드는 공식 화면에서만 입력하세요.';
 let busy=false,uncertain=false;const sync=()=>{const v=cliUiState(uncertain?{phase:'unknown',supported:true}:state,local);open.disabled=busy||!valid()||!v.canOpen||!account||!options.some(p=>p.key===select.value);check.disabled=busy||!valid()||!local;select.disabled=busy||!local;path.textContent=options.find(p=>p.key===select.value)?.path??'프로젝트 폴더를 먼저 추가하세요.';message.textContent=v.text;};
 select.onchange=sync;
 open.onclick=async()=>{if(open.disabled)return;busy=true;let errorText='';sync();try{const result=await api('/api/official-cli',{method:'POST',body:{agent,accountId:profile.active,project:select.value}});if(!valid())return;state=result;uncertain=false;}
 catch(e){uncertain=!e.rejected;errorText=e.message+' 자동으로 다시 열지 않습니다.';}
 finally{busy=false;sync();if(errorText&&valid())message.textContent=errorText;}};
 check.onclick=async()=>{if(check.disabled)return;busy=true;sync();try{const result=await api('/api/official-cli');if(!valid())return;state=result[agent];uncertain=false;}catch{state=null;}finally{busy=false;sync();}};
 label.append(select);row.append(open,check);content.append(target,label,path,help,row,message);box.append(summary,content);sync();return box;
}
