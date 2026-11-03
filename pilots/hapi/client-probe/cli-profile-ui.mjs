// Profile paths stay in the authenticated local UI; no credentials or shell evaluation.
export function cliProfileControls({agent,local,active,api,linked,valid=()=>true,document:doc=globalThis.document}){
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
 const box=el('details');box.className='cli-profile-link';box.open=local&&active?.source!=='cli';
 box.append(el('summary','기존 CLI 설정 연결'));
 const description=el('p',active?.source==='cli'?`기존 CLI와 공유 중 · ${active.path}`:'터미널에서 쓰던 로그인·MCP·설정 폴더를 복사 없이 연결합니다.');
 const source=el('input');source.type='text';source.placeholder=agent==='claude'?'자동으로 찾기 또는 ~/.claude-global':'자동으로 찾기 또는 ~/.codex';source.setAttribute('aria-label','기존 CLI 설정 폴더');
 const find=el('button','기존 CLI 설정 찾기');find.type='button';
 const result=el('p');result.setAttribute('role','status');
 const consent=el('input');consent.type='checkbox';const label=el('label','이 폴더의 로그인·설정·MCP·훅을 CLI와 공유하고, 폴더가 없으면 만듭니다. 앱에서 실행한 작업도 이 설정을 사용하고 변경할 수 있습니다.');label.append(consent);
 const link=el('button','이 CLI로 연결');link.type='button';
 const note=el('small','연결하면 다음 대화부터 이 설정을 사용합니다. 진행 중인 앱 대화가 있으면 먼저 실행을 종료하세요. CLI와 같은 대화를 동시에 실행하지 마세요. 셸 함수·별칭·추가 환경변수는 자동 실행하거나 복사하지 않습니다. HAPI의 지시문·권한 옵션은 아직 별도로 적용됩니다.');
 let busy=false,review=null,serial=0;
 const sync=()=>{find.disabled=!local||busy;source.disabled=consent.disabled=!local||busy;link.disabled=!local||busy||!review?.source||!review?.binary||!consent.checked;};
 source.oninput=()=>{serial++;review=null;consent.checked=false;result.textContent='경로가 바뀌었습니다. 다시 확인하세요.';sync();};consent.onchange=sync;
 find.onclick=async()=>{if(!local||busy||!valid())return;busy=true;const query=review&&source.value===review.source?review.query:source.value;review=null;consent.checked=false;const request=++serial;sync();result.textContent='설정 출처 확인 중…';
  try{const r=await api('/api/account-profiles',{method:'POST',body:{action:'discover',agent,source:query}});if(request!==serial||!valid())return;review={...r,query};source.value=r.source??'';
   const origins={selected:'직접 지정',environment:'실행 환경', 'shell-file':'셸 설정의 고정 경로',default:'CLI 기본 위치',unresolved:'자동 확인 불가'};
   result.textContent=`설정 출처: ${origins[r.origin]??'미확인'} · ${r.source??'경로를 직접 입력하세요.'}\n${r.exists?'폴더 확인됨':'연결 시 이 위치에 CLI 설정 폴더를 만듭니다.'}\n설정 방식: ${r.mode==='default'?'CLI 기본값 · 환경변수 덮어쓰기 없음':'사용자 지정 설정 폴더'}\n실행 파일: ${r.binary??'미연결'}\n현재 앱 설정 폴더: ${r.current??'미확인'}`;
  }catch(e){if(valid())result.textContent=e.message||'설정 출처를 확인하지 못했습니다.';}finally{busy=false;sync();}
 };
 link.onclick=async()=>{if(link.disabled||busy||!valid())return;busy=true;sync();
  try{const r=await api('/api/account-profiles',{method:'POST',body:{action:'connect',agent,source:review.source,confirm:true,create:!review.exists,mode:review.mode}});if(valid()){result.textContent='기존 CLI 설정을 연결했습니다.';await linked(r);}}
  catch(e){if(valid())result.textContent=e.message||'연결 결과를 확인하지 못했습니다. 목록을 다시 확인하세요.';}finally{busy=false;sync();}
 };
 if(!local)result.textContent='기존 CLI 연결은 해당 컴퓨터의 로컬 앱에서 설정하세요.';
 box.append(description,source,find,result,label,link,note);sync();return box;
}
