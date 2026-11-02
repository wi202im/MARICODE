// Local-only, explicitly selected transcript snapshot. No conversation contents
// or credentials are kept in browser storage.
export function createClaudeImportPanel({element,api,context,opened,changed}){
 const $=id=>element.querySelector('#'+id),key='maricode-claude-import-pending';
 let supported=false,loading=false,selection=null,owner=null,serial=0;
 let pending;try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
 function render(){
  const c=context();element.hidden=!supported||c.agent!=='claude';
  if(pending)$('claude-import-source').value=pending.source??'';
  const blocked=loading||c.busy;
  $('claude-import-source').disabled=blocked||!!pending;
  $('claude-import-find').disabled=blocked||!!pending||!c.projectAvailable;
  $('claude-import-select').disabled=blocked||!!pending||!selection?.rows.length;
  $('claude-import-confirm').disabled=blocked||!!pending;
  $('claude-import-start').disabled=blocked||!!pending||!selection?.rows.length||selection.project!==c.project||!$('claude-import-confirm').checked;
  $('claude-import-check').hidden=!pending;$('claude-import-check').disabled=blocked;
  if(owner!==c.project){owner=c.project;selection=null;serial++;$('claude-import-select').replaceChildren();$('claude-import-confirm').checked=false;}
  if(pending)$('claude-import-status').textContent=loading?'선택한 기록을 복사하고 등록 결과를 확인하고 있습니다…':'이전 가져오기 결과 확인이 필요합니다. 선택을 바꾸거나 다시 등록하지 않습니다.';
 }
 $('claude-import-find').onclick=async()=>{
  const c=context(),request={project:c.project,source:$('claude-import-source').value.trim()},ticket=++serial;loading=true;selection=null;render();
  $('claude-import-status').textContent='선택한 작업 폴더의 Claude 기록을 찾고 있습니다…';
  try{
   const result=await api('/api/claude-import/list',{method:'POST',body:request});
   if(ticket!==serial||context().project!==request.project)return;
   selection={...request,rows:result.sessions};
   $('claude-import-select').replaceChildren(...result.sessions.map(row=>{const o=document.createElement('option');o.value=row.id;o.textContent=row.title+' · '+new Date(row.modifiedAt).toLocaleString()+' · '+row.messageCount+'개 메시지';return o;}));
   $('claude-import-status').textContent=result.sessions.length?`${result.sessions.length}개 기록을 찾았습니다.`:'이 작업 폴더의 기록이 없습니다. 원래 Claude를 실행한 폴더와 설정 폴더가 맞는지 확인하세요.';
   if(result.skipped)$('claude-import-status').textContent+=` 검색 한도·형식 확인 문제로 ${result.skipped}개는 제외했습니다.`;
  }catch{$('claude-import-status').textContent='기록을 찾지 못했습니다. 이 컴퓨터의 Claude 설정 폴더와 파일 접근 권한을 확인하세요.';}
  finally{loading=false;render();}
 };
 async function run(check){
  if(loading||context().busy)return;
  if(!check){
   if($('claude-import-start').disabled)return;
   const row=selection.rows.find(r=>r.id===$('claude-import-select').value);if(!row)return;
   const request={project:selection.project,source:selection.source,id:row.id,fingerprint:row.fingerprint};
   try{sessionStorage.setItem(key,JSON.stringify(request));pending=request;}catch{$('claude-import-status').textContent='요청을 보관하지 못해 시작하지 않았습니다.';return;}
  }
  if(!pending)return;loading=true;changed(true);render();
  let message='';
  try{
   const result=await api('/api/claude-import'+(check?'/check':''),{method:'POST',body:pending});
   if(result.state==='registered'){
    pending=null;sessionStorage.removeItem(key);selection=null;$('claude-import-confirm').checked=false;
    await opened(result.id);
   }else if(result.state==='none'){
    pending=null;sessionStorage.removeItem(key);selection=null;message='등록 요청은 시작되지 않았습니다. 폴더와 실행기 준비 상태를 확인한 뒤 기록을 다시 찾으세요.';
   }else message='가져오기 결과가 미확인입니다. 결과 확인은 조회만 하며 원본 복사나 등록을 반복하지 않습니다.';
  }catch(error){
   if(error.rejected){pending=null;sessionStorage.removeItem(key);selection=null;message=error.message;}
   else message='가져오기 결과를 확인하지 못했습니다. 결과 확인을 눌러 주세요. 원본 기록은 변경하지 않습니다.';
  }
  finally{loading=false;changed(false);render();if(message)$('claude-import-status').textContent=message;}
 }
 $('claude-import-start').onclick=()=>run(false);$('claude-import-check').onclick=()=>run(true);
 $('claude-import-confirm').onchange=render;
 $('claude-import-source').oninput=()=>{selection=null;$('claude-import-select').replaceChildren();$('claude-import-confirm').checked=false;render();};
 return {render,configure(enabled){supported=enabled;render();}};
}

export function createImportedHistory({element,api}){
 let owner='',serial=0,before,rows=[];
 const summary=element.querySelector('summary'),list=element.querySelector('.imported-records'),more=element.querySelector('button'),note=element.querySelector('p');
 async function load(id,enabled,older=false){
  const ticket=++serial;
  if(!older){owner=id;rows=[];before=undefined;element.hidden=true;list.replaceChildren();element.open=false;}
  if(!enabled||!id)return;more.disabled=true;
  try{
   const r=await api('/api/sessions/'+encodeURIComponent(id)+'/import-history'+(older?'?before='+before:''));
   if(ticket!==serial||owner!==id||!r.imported)return;
   rows=older?[...r.messages,...rows]:r.messages;before=r.before;element.hidden=false;
   summary.textContent=`가져온 이전 기록 · ${rows.length}/${r.total}개`;
   note.textContent='가져온 시점의 텍스트 기록입니다. 도구·첨부는 요약 표시하며 과거 승인은 다시 실행하지 않습니다. 이후 대화는 아래에 표시됩니다.';
   more.hidden=!r.hasMore;
   list.replaceChildren(...rows.map(row=>{const article=document.createElement('article'),label=document.createElement('strong'),text=document.createElement('p');label.textContent=(row.role==='user'?'사용자':'Claude')+(row.timestamp?' · '+new Date(row.timestamp).toLocaleString():'');text.textContent=row.text+(row.truncated?'\n[화면 표시 일부 생략]':'');article.append(label,text);return article;}));
  }catch{if(ticket===serial){element.hidden=false;summary.textContent='가져온 기록 확인 필요';note.textContent='이전 기록을 읽지 못했습니다. 세션을 다시 선택해 확인하세요. 원래 대화와 실행 상태는 변경하지 않았습니다.';}}
  finally{if(ticket===serial)more.disabled=false;}
 }
 more.onclick=()=>load(owner,true,true);
 return {load};
}
