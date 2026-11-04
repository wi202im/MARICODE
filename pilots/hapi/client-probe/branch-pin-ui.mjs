import {newBranches} from './branch-rules.mjs';
// Branch pin UI: the session-info section, the pre-send warning and the after-turn card.
// The app only reads branches and edits the pin list; it never switches, creates or deletes branches.
const repoName=r=>r==='.'?'이 폴더':r;
export function createBranchPin({api,section,banner,document:doc=globalThis.document,changed=()=>{},shown=()=>{}}){
 let id=null,state=null,busy=false,before=null,serial=0,answer=null;
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,onclick,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=onclick;b.disabled=busy;return b;};
 async function load(sessionId=id){
  if(sessionId!==id){id=sessionId;state=null;before=null;hideBanner();}
  const mine=++serial;render();if(!id)return null;
  try{const r=await api('/api/branches?session='+encodeURIComponent(id));if(mine===serial&&sessionId===id){state=r;render();}return r;}
  catch(e){if(mine===serial&&sessionId===id){state={error:e.message};render();}return null;}
 }
 async function act(body){
  const target=id;busy=true;render();
  try{const r=await api('/api/branch-pin',{method:'POST',body:{id:target,...body}});if(target===id){state=r;changed(r);}return r;}
  catch(e){if(target===id)state={...state,error:e.message};return null;}
  finally{busy=false;render();}
 }
 let lastOff=null;
 function render(){
  const off=!!state?.mismatches?.length;if(off!==lastOff){lastOff=off;shown();}
  if(!section)return;
  const head=el('h3','브랜치 고정');
  if(!id){section.replaceChildren(head,el('p','세션을 선택하세요.'));return;}
  if(!state){section.replaceChildren(head,el('p','브랜치를 확인하고 있습니다…'));return;}
  const rows=[head];if(state.error)rows.push(el('p',state.error,'branch-error'));
  const repos=state.repos??[];
  if(!state.pin){
   rows.push(el('p',repos.length?'브랜치와 상관없이 진행하는 세션입니다. 고정하면 아래 브랜치에서만 진행하고, 바뀌면 보내기 전에 알립니다.':'세션 폴더와 바로 아래 폴더에서 Git 저장소를 찾지 못했습니다.'));
   for(const r of repos)rows.push(el('p',`${repoName(r.repo)} · ${r.current??'분리된 HEAD'}`,'branch-repo'));
   if(repos.some(r=>r.current))rows.push(button('현재 브랜치로 고정',()=>act({action:'enable'})));
  }else{
   for(const r of repos.filter(r=>Array.isArray(state.pin.repos[r.repo]))){
    const allowed=state.pin.repos[r.repo],ok=!!r.current&&allowed.includes(r.current),box=el('div',undefined,'branch-repo'+(ok?'':' off'));
    box.append(el('strong',repoName(r.repo)),el('span',`지금 ${r.current??'분리된 HEAD'}${ok?'':' · 고정 목록 밖'}`));
    const list=el('ul');for(const b of allowed){const li=el('li');li.append(el('span',b),button('빼기',()=>act({action:'remove',repo:r.repo,branch:b}),'branch-remove'));li.lastChild.setAttribute('aria-label',`${b} 빼기`);list.append(li);}
    box.append(el('small','고정한 브랜치','branch-caption'),list);
    const extra=r.branches.filter(b=>!allowed.includes(b));
    // Folded with an empty choice so other branches never read as already pinned; opens when the current branch is off the list.
    if(extra.length){const more=el('details',undefined,'branch-add'),pick=el('select'),blank=el('option','추가할 브랜치 선택');blank.value='';pick.append(blank);pick.setAttribute('aria-label',`${repoName(r.repo)}에 추가할 브랜치`);
     for(const b of extra){const o=el('option',b);o.value=b;pick.append(o);}pick.value=!ok&&r.current&&extra.includes(r.current)?r.current:'';pick.disabled=busy;more.open=!!pick.value;
     const add=button('추가',()=>pick.value&&act({action:'add',repo:r.repo,branch:pick.value}));add.disabled=busy||!pick.value;pick.onchange=()=>{add.disabled=busy||!pick.value;};
     const row=el('div');row.append(pick,add);more.append(el('summary','다른 브랜치 추가'),row);box.append(more);}
    rows.push(box);
   }
   const unpinned=repos.filter(r=>!state.pin.repos[r.repo]);
   if(unpinned.length)rows.push(el('small',`고정하지 않은 저장소: ${unpinned.map(r=>repoName(r.repo)).join(', ')} · 다시 고정하면 포함됩니다.`));
   rows.push(button('고정 해제',()=>act({action:'disable'}),'branch-disable'));
  }
  section.replaceChildren(...rows);
 }
 function hideBanner(){if(banner){banner.hidden=true;banner.replaceChildren();}if(answer){const a=answer;answer=null;a('cancel');}}
 function showBanner(title,items,actions){
  if(!banner)return;banner.replaceChildren(el('strong',title));
  for(const it of items){const row=el('div',undefined,'branch-banner-item');row.append(el('p',it.text));if(it.actions)row.append(...it.actions);banner.append(row);}
  if(actions){const row=el('div',undefined,'branch-banner-actions');row.append(...actions);banner.append(row);}
  banner.hidden=false;
 }
 const mismatchText=m=>`${repoName(m.repo)} 저장소가 ${m.current}에 있습니다 (고정: ${m.allowed.join(', ')||'없음'})`;
 return {
  load,render,
  get pinned(){return !!state?.pin;},
  get sessionId(){return id;},
  get offBranch(){return !!state?.mismatches?.length;},
  // Before sending: 'send' | 'cancel'. A pinned session off its branches asks first; unpinned or unreadable sends.
  async beforeSend(sessionId){
   const r=await load(sessionId);if(!r?.pin)return 'send';
   before=r.repos;if(!r.mismatches.length)return 'send';
   const addable=r.mismatches.filter(m=>r.repos.find(x=>x.repo===m.repo)?.current===m.current);
   const choice=await new Promise(resolve=>{answer=resolve;
    const done=v=>()=>{answer=null;banner.hidden=true;banner.replaceChildren();resolve(v);};
    showBanner('고정한 브랜치가 아닙니다',r.mismatches.map(m=>({text:mismatchText(m)})),[...(addable.length?[button('목록에 추가하고 보내기',done('add'),'primary')]:[]),button('그냥 보내기',done('send')),button('취소',done('cancel'))]);});
   if(choice==='add'){for(const m of addable)if(!await act({action:'add',repo:m.repo,branch:m.current}))return 'cancel';before=state.repos;return 'send';}
   return choice;
  },
  // After a turn of the selected pinned session: new branches the turn made and any switch off the list.
  async afterTurn(sessionId){
   if(sessionId!==id||!before)return;const start=before;before=null;
   const r=await load(sessionId);if(!r?.pin||sessionId!==id||!r.mismatches.length)return;
   const made=newBranches(start,r.repos);
   const items=r.mismatches.map(m=>{const n=made.find(x=>x.repo===m.repo&&x.branch===m.current);
    const item={text:n?`${repoName(m.repo)} 저장소 · 새 브랜치 ${n.branch} — ${n.base??'분리된 HEAD'}에서 분기`:`${mismatchText(m)} · 이번 작업 중 바뀌었습니다`};
    if(r.repos.find(x=>x.repo===m.repo)?.current===m.current)item.actions=[button('이 세션에 추가',async()=>{if(await act({action:'add',repo:m.repo,branch:m.current}))hideBanner();},'primary'),button('추가 안 함',hideBanner)];
    return item;});
   showBanner(made.length?'새 브랜치가 생겼습니다':'브랜치가 바뀌었습니다',items,[el('small','추가하지 않으면 다음에 보낼 때 다시 확인합니다. 브랜치는 앱이 되돌리지 않습니다.')]);
  },
  async enable(sessionId){await load(sessionId);return act({action:'enable'});},
  hideBanner
 };
}
