const $=id=>document.getElementById(id),key='merry-machine-layout-preview-v2';
const examples={mini:{name:'Mac mini',network:'Tailscale',project:'mari-core',task:'파일 탐색 개선',agent:'Codex',text:'파일 탐색 개선 작업을 진행하고 있습니다. 실행과 파일은 Mac mini에 남아 있습니다.'},studio:{name:'Mac Studio',network:'LAN',project:'image-pipeline',task:'이미지 처리 테스트',agent:'Claude',text:'이미지 처리 테스트를 확인하고 있습니다. Mac mini와 별개로 Mac Studio의 자원을 사용합니다.'},local:{name:'이 컴퓨터',network:'로컬',project:'local-project',task:'로컬 작업 예시',agent:'Claude',text:'이 작업은 현재 컴퓨터에서 실행됩니다. 원격 서버의 작업과 분리되어 있습니다.'}};
let saved=null,selected='',offline=new Set();
try{saved=JSON.parse(localStorage.getItem(key));if(!saved||typeof saved.local!=='boolean'||typeof saved.server!=='boolean'||typeof saved.remote!=='boolean'||!Array.isArray(saved.servers))saved=null;}catch{}
function roleState(){return {local:$('role-local').checked||$('role-server').checked,server:$('role-server').checked,remote:$('role-remote').checked,servers:['mini','studio'].filter(id=>$('connect-'+id).checked)};}
function roleNames(s){return [s.server?'서버 · 로컬':s.local?'로컬':null,s.remote?'원격':null].filter(Boolean).join(' + ');}
function updateRoles(){
 if($('role-server').checked)$('role-local').checked=true;
 $('role-local').disabled=$('role-server').checked;$('local-included').textContent=$('role-server').checked?'서버 역할에 포함되어 함께 켜집니다.':'다른 로컬 기기에서는 원래 세션을 복원해 이어갑니다.';
 const s=roleState();$('ai-setup').hidden=!s.local;$('remote-ai-note').hidden=!s.remote;$('connect-setup').hidden=!s.remote;$('save-setup').disabled=!s.local&&!s.remote;$('role-summary').textContent=roleNames(s)?'이 기기의 역할 · '+roleNames(s):'하나 이상의 역할을 선택해 주세요.';
}
function setup(){
 $('setup-view').hidden=false;$('dashboard').hidden=true;
 const s=saved||{local:false,server:false,remote:false,servers:[]};
 for(const name of ['local','server','remote'])$('role-'+name).checked=s[name];
 for(const id of ['mini','studio'])$('connect-'+id).checked=s.servers.includes(id);
 $('discovered').hidden=!s.servers.length;updateRoles();
}
function machineIds(){return [...(saved.local||saved.server?['local']:[]),...(saved.remote?saved.servers.filter(id=>examples[id]&&id!=='local'):[])];}
function dashboard(){
 $('setup-view').hidden=true;$('dashboard').hidden=false;$('device-roles').textContent='이 기기 · '+roleNames(saved);
 const ids=machineIds();if(!ids.includes(selected))selected=ids[0]||'';
 $('preview-servers').replaceChildren(...ids.map(id=>{
  const m=examples[id],button=document.createElement('button');button.className='preview-server';button.setAttribute('aria-current',String(id===selected));button.dataset.machine=id;
  const name=document.createElement('strong');name.textContent=m.name;const status=document.createElement('small');status.textContent=`${id==='local'&&saved.server?'서버 · 로컬':m.network} · ${offline.has(id)?'연결 끊김':'작업 중'}`;
  const task=document.createElement('span');task.textContent=m.project+' / '+m.task;button.append(name,status,task);button.onclick=()=>{selected=id;dashboard();};return button;
 }));
 $('empty-workspace').hidden=!!selected;$('preview-work').hidden=!selected;$('disconnect-demo').hidden=!selected||selected==='local';
 if(!selected){$('preview-target').textContent='아직 연결한 서버가 없습니다';$('preview-status').textContent='연결 대기';return;}
 const m=examples[selected],down=offline.has(selected);
 $('preview-target').textContent=m.name;$('preview-status').textContent=down?'연결 끊김':'작업 중 · 예시';$('preview-project').textContent=m.project+' / '+m.task;
 $('sample-agent').textContent=m.agent+' · '+m.name;$('sample-text').textContent=m.text;$('sample-destination').textContent=m.name+' / '+m.project+'에 전송';
 $('offline-note').hidden=!down;$('sample-input').disabled=down;$('sample-send').disabled=down;$('sample-input').value='';$('sample-notice').textContent='';$('disconnect-demo').textContent=down?'다시 연결 시연':'연결 끊김 시연';
}
for(const name of ['local','server','remote'])$('role-'+name).onchange=updateRoles;
$('discover').onclick=()=>{$('discovered').hidden=false;$('discovery-note').textContent='예시 서버 2대입니다. 실제 네트워크를 검색한 결과가 아닙니다.';};
$('setup-form').onsubmit=e=>{e.preventDefault();saved=roleState();if(!saved.local&&!saved.remote)return;try{localStorage.setItem(key,JSON.stringify(saved));}catch{$('setup-note').textContent='이 브라우저에 시안 설정을 저장할 수 없습니다.';}dashboard();};
for(const id of ['edit-setup','add-server','empty-connect'])$(id).onclick=setup;
$('reset').onclick=()=>{localStorage.removeItem(key);saved=null;selected='';offline.clear();setup();};
$('disconnect-demo').onclick=()=>{offline.has(selected)?offline.delete(selected):offline.add(selected);dashboard();};
$('sample-send').onclick=()=>{$('sample-notice').textContent='시안입니다. 실제 메시지를 전송하지 않았습니다.';$('sample-input').value='';};
if(saved&&(saved.local||saved.server||saved.remote))dashboard();else setup();
