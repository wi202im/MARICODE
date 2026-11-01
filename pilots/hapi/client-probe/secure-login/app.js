const $=id=>document.getElementById(id);let csrf='',selected=null,busy=false;
const labels={pending:'입력 대기',submitting:'처리 중',completed:'완료',cancelled:'취소',expired:'만료',failed:'실패',unknown:'결과 미확인'};
function clear(){ $('password').value='';$('otp').value=''; }
async function api(path,data){const r=await fetch(path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','X-Trial-CSRF':csrf}:{},body:data?JSON.stringify(data):undefined});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
async function refresh(){const v=await api('/state');csrf=v.csrf;$('requests').replaceChildren();
  for(const r of v.requests){const b=document.createElement('button');b.textContent=`${r.engine} · ${labels[r.state]}`;b.onclick=()=>{clear();selected=r.id;render(r);};$('requests').append(b);}
  const r=v.requests.find(r=>r.id===selected);if(r)render(r);else $('entry').hidden=true;
}
function render(r){$('binding').textContent=`${r.machine} → ${r.target} · ${r.engine} · 요청 ${r.id.slice(0,8)}`;$('entry').hidden=r.state!=='pending';$('result').textContent=JSON.stringify(r,null,2);}
async function action(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();$('notice').textContent='상태를 확인했습니다.';}catch(e){$('notice').textContent=e.message;}finally{clear();try{await refresh();}catch{$('notice').textContent='연결이 끊겼습니다. 자동 재전송하지 않습니다. 상태 다시 확인을 눌러 주세요.';$('entry').hidden=true;}busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
for(const engine of ['claude','codex'])$(engine).onclick=()=>action(async()=>{const r=await api('/start',{engine});selected=r.id;});
$('refresh').onclick=()=>action(async()=>{});
$('form').onsubmit=e=>{e.preventDefault();const data={id:selected,password:$('password').value,otp:$('otp').value};clear();action(async()=>{try{await api('/submit',data);}finally{data.password='';data.otp='';}});};
$('cancel').onclick=()=>action(()=>api('/cancel',{id:selected}));
window.addEventListener('pagehide',clear);refresh().catch(()=>{$('notice').textContent='시험 서버에 연결하지 못했습니다.';});
