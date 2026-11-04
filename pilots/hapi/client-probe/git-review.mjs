import {numstatRows,diffLines} from './git-status.mjs';
// Read-only change review over HAPI's git-diff-numstat / git-diff-file RPCs. Never stages, commits or checks out.
// openDiff: show a file's diff as a center tab (the same place as the chat's change cards) instead of inside the panel.
export function createGitReview({element,api,base,owner,untracked,openDiff=null}){
 const doc=element.ownerDocument,$=id=>doc.getElementById(id),node=(tag,cls,text)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
 let loadedFor=null,serial=0;
 async function showDiff(file){
  const ticket=serial,pre=$('git-review-diff');pre.hidden=false;pre.replaceChildren(node('span','diff-meta',`${file.path} 확인 중…`));
  try{
   const r=await api(base()+'/git-diff-file?path='+encodeURIComponent(file.path)+(file.staged?'&staged=true':''));if(ticket!==serial)return;
   if(r.state!=='ready'){pre.replaceChildren(node('span','diff-meta','이 파일의 변경 내용을 가져오지 못했습니다.'));return;}
   if(openDiff){pre.hidden=true;pre.replaceChildren();openDiff({path:file.path,key:'git:'+(file.staged?'staged:':'')+file.path,title:`${file.path.split('/').pop()} · Git`,diff:r.stdout||'@@ 표시할 변경이 없습니다 @@',label:`${file.path} · Git ${file.staged?'스테이징된':'작업 중'} 변경`});return;}
   const lines=diffLines(r.stdout);pre.replaceChildren(...(lines.length?lines.map(l=>node('span','diff-'+l.kind,l.text+'\n')):[node('span','diff-meta',file.binary?'바이너리 파일은 내용을 표시하지 않습니다.':'표시할 변경이 없습니다.')]));
  }catch{if(ticket===serial)pre.replaceChildren(node('span','diff-meta','변경 내용을 가져오지 못했습니다. 실행 중인 세션에서 다시 시도하세요.'));}
 }
 async function load(force=false){
  const key=owner();if(!element.open||!key||(!force&&loadedFor===key))return;
  const ticket=++serial;loadedFor=key;$('git-review-status').textContent='변경 파일을 확인하고 있습니다…';$('git-review-files').replaceChildren();$('git-review-diff').hidden=true;
  try{
   const [work,staged]=await Promise.all([api(base()+'/git-diff-numstat'),api(base()+'/git-diff-numstat?staged=true')]);if(ticket!==serial)return;
   if(work.state!=='ready'||staged.state!=='ready'){loadedFor=null;$('git-review-status').textContent='변경 목록을 가져오지 못했습니다. 세션이 실행 중이어야 조회할 수 있습니다.';return;}
   const files=[...numstatRows(staged.stdout,true),...numstatRows(work.stdout,false)],extra=untracked();
   $('git-review-status').textContent=(files.length?`변경 파일 ${files.length}건 · 파일을 누르면 변경 내용을 봅니다.`:'커밋되지 않은 기존 파일 변경이 없습니다.')+(extra?` 새 파일 ${extra}개는 파일 탭에서 확인하세요.`:'');
   $('git-review-files').replaceChildren(...files.map(f=>{const li=node('li'),b=node('button','git-review-file');b.type='button';b.append(node('span','git-review-path',f.path),node('span','git-review-stat',f.binary?'바이너리':`+${f.added} −${f.removed}`),...(f.staged?[node('span','git-review-staged','스테이징')]:[]));b.onclick=()=>showDiff(f);li.append(b);return li;}));
  }catch{if(ticket===serial){loadedFor=null;$('git-review-status').textContent='변경 목록을 가져오지 못했습니다. 실행기 연결을 확인하세요.';}}
 }
 element.addEventListener('toggle',()=>load());element.addEventListener('vsc-collapsible-toggle',()=>setTimeout(load)); // native <details> or <vscode-collapsible>
 return {load,reset(){serial++;loadedFor=null;$('git-review-files').replaceChildren();$('git-review-diff').hidden=true;$('git-review-status').textContent='';if(element.open)load();}};
}
