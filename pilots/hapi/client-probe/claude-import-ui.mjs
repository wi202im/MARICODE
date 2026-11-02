// Local-only, explicitly selected transcript snapshot. No conversation contents
// or credentials are kept in browser storage.
export function nativeClaudeSourcePicker(view=globalThis.window){
 if(view?.location?.origin!=='http://127.0.0.1:61192'||view.location.pathname!=='/workspace'||!view.webkit?.messageHandlers?.maricode)return null;
 return ()=>new Promise((resolve,reject)=>{
  const requestId=view.crypto.randomUUID();
  const clear=()=>{view.removeEventListener('maricode-claude-source-selected',receive);view.removeEventListener('pagehide',cancel);};
  const cancel=()=>{clear();resolve(null);};
  const receive=event=>{if(event.detail?.requestId!==requestId)return;clear();resolve(typeof event.detail.path==='string'?event.detail.path:null);};
  view.addEventListener('maricode-claude-source-selected',receive);view.addEventListener('pagehide',cancel);
  try{view.webkit.messageHandlers.maricode.postMessage('choose-claude-source:'+requestId);}catch(error){clear();reject(error);}
 });
}
export function createClaudeImportPanel({element,api,context,opened,changed,pickSource=nativeClaudeSourcePicker()}){
 const $=id=>element.querySelector('#'+id)??element.ownerDocument.getElementById(id),key='maricode-claude-import-pending';
 let supported=false,loading=false,selection=null,owner=null,serial=0,searchedOwner=null,lastChecked=null;
 const freshness=()=>{const label=$('claude-import-updated');if(label)label.textContent=lastChecked?'마지막 확인 '+new Date(lastChecked).toLocaleString()+' · 원본 작업을 마친 뒤 새로고침하세요.':'목록을 확인한 적이 없습니다.';};
 let pending;try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
 function render(){
  freshness();const c=context();element.hidden=!supported||c.agent!=='claude'||c.general||c.mode!=='import';
  $('claude-import-project').textContent=c.path??'작업 폴더를 먼저 선택하세요.';
  if(pending)$('claude-import-source').value=pending.source??'';
  const blocked=loading||c.busy;
  $('claude-import-source').disabled=blocked||!!pending;
  $('claude-import-browse').hidden=!pickSource;
  $('claude-import-browse').disabled=blocked||!!pending||!c.projectAvailable;
  $('claude-import-find').disabled=blocked||!!pending||!c.projectAvailable;
  $('claude-import-find').title=loading?'목록 확인 중…':'대화 목록 새로고침';
  $('claude-import-select').disabled=blocked||!!pending||!selection?.rows.length;
  const chosen=selection?.rows.find(row=>row.id===$('claude-import-select').value);
  $('claude-import-detail').textContent=chosen?`${chosen.size==null?'':(chosen.size/1024/1024).toFixed(1)+' MiB · '}ID ${chosen.id.slice(0,8)}${chosen.warning?' · '+chosen.warning:''}`:'';
  $('claude-import-more').hidden=selection?.nextOffset==null;
  $('claude-import-more').disabled=blocked||!!pending;
  $('claude-import-start').disabled=blocked||!!pending||!chosen||chosen.importable===false||selection.project!==c.project;
  $('claude-import-check').hidden=!pending;$('claude-import-check').disabled=blocked;$('claude-import-check').textContent=pending?.registeredId?'가져온 대화 다시 열기':'가져오기 결과 확인';
  if(owner!==c.project){owner=c.project;selection=null;searchedOwner=null;lastChecked=null;serial++;$('claude-import-status').textContent='';$('claude-import-searched').textContent='';$('claude-import-select').replaceChildren();}
  if(element.open&&!element.hidden&&!blocked&&!pending&&c.projectAvailable&&searchedOwner!==c.project)queueMicrotask(()=>{if(element.open&&!element.hidden&&!loading&&!pending&&searchedOwner!==context().project)$('claude-import-find').click();});
  if(pending)$('claude-import-status').textContent=pending.registeredId?'등록은 완료됐습니다. 가져온 대화를 여는 중이거나 화면 확인이 필요합니다. 새 세션은 만들지 않습니다.':loading?'선택한 기록을 복사하고 등록 결과를 확인하고 있습니다…':'이전 가져오기 결과 확인이 필요합니다. 선택을 바꾸거나 다시 등록하지 않습니다.';
 }
 async function search(more=false){
  if(loading||pending||context().busy||!context().projectAvailable||more&&selection?.nextOffset==null)return;
  const previous=more?selection:null,selectedId=$('claude-import-select').value;
  const c=context(),request={project:c.project,source:previous?.source??$('claude-import-source').value.trim(),...(more?{offset:previous.nextOffset}:{})},ticket=++serial;searchedOwner=c.project;loading=true;if(!more)selection=null;render();
  $('claude-import-status').textContent='선택한 작업 폴더의 Claude 기록을 찾고 있습니다…';
  try{
   const result=await api('/api/claude-import/list',{method:'POST',body:request});
   if(ticket!==serial||context().project!==request.project)return;
   const rows=[...new Map([...(previous?.rows??[]),...result.sessions].map(row=>[row.id,row])).values()];
   lastChecked=Date.now();selection={...request,source:result.searched?.source??request.source,rows,total:result.total??rows.length,nextOffset:result.nextOffset??null};
   $('claude-import-source-status').textContent=result.searched?`${({'selected':'선택한 기록 폴더','environment':'CLI 환경변수에서 찾은 폴더','shell-file':'셸 설정에서 찾은 경로 후보','default':'기본 Claude 기록 폴더'})[result.sourceOrigin]??'기록 폴더'}: ${result.searched.source}`:'저장 위치를 자동으로 확인하지 못했습니다. 기록 폴더를 선택해 주세요.';

   $('claude-import-searched').textContent=result.searched?`작업 폴더: ${result.searched.project}\n기록 저장소: ${result.searched.source}\n검색한 기록 폴더: ${result.searched.records}`:'';
   $('claude-import-select').replaceChildren(...(rows.length?rows:[{id:'',empty:true}]).map(row=>{if(row.empty){const o=document.createElement('option');o.value='';o.textContent='가져올 대화 없음';return o;}const o=document.createElement('option');o.value=row.id;o.textContent=row.title+' · '+new Date(row.modifiedAt).toLocaleString()+(row.messageCount==null?'':' · '+row.messageCount+'개 메시지')+(row.importable===false?' · 확인 필요':'');return o;}));
   if(selectedId&&rows.some(row=>row.id===selectedId))$('claude-import-select').value=selectedId;
   $('claude-import-status').textContent=rows.length?`전체 ${selection.total}개 중 ${rows.length}개 표시. 가져오기 전 확인이 필요한 기록도 목록에 표시합니다.`:({ 'source-unresolved':'CLI 설정이 동적이거나 후보가 여러 개여서 저장 위치를 확정하지 않았습니다. 기록 폴더를 직접 선택하세요.', 'profile-missing':'표시된 Claude 기록 폴더가 없습니다. 기록 폴더 선택 또는 직접 입력으로 지정하세요.', 'store-missing':'지정한 위치에 Claude 기록 저장소가 없습니다. 프로젝트 폴더가 아닌 Claude 프로필 위치인지 확인하세요.', 'project-missing':'이 작업 폴더에 대응하는 기록을 찾지 못했습니다. CLI에서 Claude를 실행했던 폴더와 위 작업 폴더가 같은지 확인하세요.', excluded:'기록 파일은 있지만 현재 지원하는 형식으로 읽지 못했습니다.', empty:'이 작업 폴더에 저장된 대화가 없습니다.' }[result.status]??'이 작업 폴더의 기록을 찾지 못했습니다.');

  }catch{if(ticket===serial)$('claude-import-status').textContent='기록을 찾지 못했습니다. 이 컴퓨터의 Claude 설정 폴더와 파일 접근 권한을 확인하세요.';}
  finally{loading=false;render();}
 }
 $('claude-import-find').onclick=()=>search();
 $('claude-import-more').onclick=()=>search(true);
 $('claude-import-select').onchange=()=>{render();};
 $('claude-import-browse').onclick=async()=>{
  if(!pickSource||$('claude-import-browse').disabled||element.hidden)return;
  const project=context().project,ticket=++serial;searchedOwner=project;loading=true;render();let search=false;
  try{
   const path=await pickSource();
   if(ticket!==serial||context().project!==project||context().busy||pending||element.hidden||!path)return;
   $('claude-import-source').value=path;selection=null;
   $('claude-import-select').replaceChildren();$('claude-import-searched').textContent='';search=true;
  }catch{$('claude-import-status').textContent='폴더 선택창을 열지 못했습니다. 경로를 직접 입력할 수도 있습니다.';}
  finally{loading=false;render();}
  if(search)await $('claude-import-find').onclick();
 };
 async function run(check){
  if(loading||context().busy)return;
  if(!check){
   if(element.hidden||$('claude-import-start').disabled)return;
   const row=selection.rows.find(r=>r.id===$('claude-import-select').value);if(!row)return;
   const request={project:selection.project,source:selection.source,id:row.id,fingerprint:row.fingerprint};
   try{sessionStorage.setItem(key,JSON.stringify(request));pending=request;}catch{$('claude-import-status').textContent='요청을 보관하지 못해 시작하지 않았습니다.';return;}
  }
  if(!pending)return;loading=true;changed(true);render();
  let message='';
  try{
   const result=pending.registeredId?{state:'registered',id:pending.registeredId}:await api('/api/claude-import'+(check?'/check':''),{method:'POST',body:pending});
   if(result.state==='registered'){
    if(typeof result.id!=='string'||!/^[-a-f0-9]{36}$/.test(result.id))throw Error('등록된 세션 ID를 확인하지 못했습니다.');
    pending={...pending,registeredId:result.id};sessionStorage.setItem(key,JSON.stringify(pending));
    await opened(result.id);
    pending=null;sessionStorage.removeItem(key);selection=null;
   }else if(result.state==='none'){
    pending=null;sessionStorage.removeItem(key);selection=null;message='등록 요청은 시작되지 않았습니다. 폴더와 실행기 준비 상태를 확인한 뒤 기록을 다시 찾으세요.';
   }else message='가져오기 결과가 미확인입니다. 결과 확인은 조회만 하며 원본 복사나 등록을 반복하지 않습니다.';
  }catch(error){
   if(pending?.registeredId)message='등록은 완료됐지만 이전 대화 화면을 열지 못했습니다. 가져온 대화 다시 열기를 눌러 주세요. 새 세션을 만들거나 원본을 다시 복사하지 않습니다.';
   else if(error.rejected){pending=null;sessionStorage.removeItem(key);selection=null;message=error.message;}
   else message='가져오기 결과를 확인하지 못했습니다. 결과 확인을 눌러 주세요. 원본 기록은 변경하지 않습니다.';
  }
  finally{loading=false;changed(false);render();if(message)$('claude-import-status').textContent=message;}
 }
 $('claude-import-start').onclick=()=>run(false);$('claude-import-check').onclick=()=>run(true);
 element.addEventListener('toggle',()=>{if(element.open&&!element.hidden&&!loading&&!pending&&searchedOwner!==context().project)$('claude-import-find').click();});
 $('claude-import-source').oninput=()=>{$('claude-import-source-status').textContent='입력한 위치는 아직 검색하지 않았습니다.';serial++;searchedOwner=context().project;selection=null;$('claude-import-status').textContent='저장 위치를 입력한 뒤 목록 옆 새로고침를 누르세요.';$('claude-import-searched').textContent='';$('claude-import-select').replaceChildren();render();};
 return {render,get pending(){return !!pending;},get pendingProject(){return pending?.project;},get blocksCreation(){return !!pending||context().mode==='import';},configure(enabled){supported=enabled;render();}};
}

export function createImportedHistory({element,api,scroller,changed=()=>{}}){
 let owner='',serial=0,before,rows=[],state={imported:false,shown:0,total:0,loading:false,error:false};
 const summary=element.querySelector('summary'),list=element.querySelector('.imported-records'),more=element.querySelector('button'),note=element.querySelector('p');
 async function load(id,enabled,older=false){
  const ticket=++serial,top=scroller?.scrollTop??0,height=scroller?.scrollHeight??0;
  if(!older){owner=id;rows=[];before=undefined;element.hidden=true;list.replaceChildren();element.open=false;state={imported:false,shown:0,total:0,loading:false,error:false};}
  if(!enabled||!id){changed();return;}more.disabled=true;state={...state,loading:true,error:false};changed();
  try{
   const r=await api('/api/sessions/'+encodeURIComponent(id)+'/import-history'+(older?'?before='+before:''));
   if(ticket!==serial||owner!==id||!r.imported)return;
   rows=older?[...r.messages,...rows]:r.messages;before=r.before;element.hidden=false;if(!older)element.open=true;
   state={imported:true,shown:rows.length,total:r.total,loading:false,error:false};
   summary.textContent=`가져온 이전 기록 · ${rows.length}/${r.total}개`;
   note.textContent='가져온 시점의 이전 대화입니다. 같은 세션으로 이어서 대화합니다. 도구·첨부는 요약 표시하며 과거 승인은 실행하지 않습니다. 이후 대화는 아래에 이어집니다.';
   more.hidden=!r.hasMore;
   list.replaceChildren(...rows.map(row=>{const article=document.createElement('article'),label=document.createElement('strong'),text=document.createElement('p');label.textContent=(row.role==='user'?'사용자':'Claude')+(row.timestamp?' · '+new Date(row.timestamp).toLocaleString():'');text.textContent=row.text+(row.truncated?'\n[화면 표시 일부 생략]':'');article.append(label,text);return article;}));
   if(scroller)scroller.scrollTop=older?top+(scroller.scrollHeight-height):scroller.scrollHeight;
  }catch{if(ticket===serial){state={...state,error:true};element.hidden=false;element.open=true;summary.textContent='가져온 기록 확인 필요';note.textContent='이전 기록을 읽지 못했습니다. 세션을 다시 선택해 확인하세요. 원래 대화와 실행 상태는 변경하지 않았습니다.';}}
  finally{if(ticket===serial){more.disabled=false;state={...state,loading:false};changed();}}
 }
 more.onclick=()=>load(owner,true,true);
 return {load,get status(){return {...state};}};
}
