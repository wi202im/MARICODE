// In-page usability checks on the current screen. Returns findings a person would notice.
export const auditScript=`(()=>{
 // Screen-reader-only (1px clipped) and invisible/inert elements are not what a person sees.
 const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'&&s.pointerEvents!=='none'&&!e.closest('details:not([open])>:not(summary)')&&r.bottom>0&&r.top<innerHeight;};
 const name=e=>(e.getAttribute('aria-label')||e.title||e.labels?.[0]?.textContent||e.closest('label')?.textContent||e.textContent||e.getAttribute('placeholder')||'').trim().replace(/\\s+/g,' ').slice(0,50);
 const where=e=>{const id=e.closest('[id]')?.id;return (id?'#'+id+' ':'')+(name(e)||e.tagName.toLowerCase());};
 const out=[],seen=new Set(),add=(kind,e,detail='')=>{const k=kind+where(e);if(seen.has(k)||out.length>60)return;seen.add(k);out.push({kind,where:where(e),detail});};
 // Covered by another layer (e.g. the composer over the transcript) is not on screen either.
 const onTop=e=>{const r=e.getBoundingClientRect(),x=Math.min(Math.max(r.left+r.width/2,0),innerWidth-1),y=Math.min(Math.max(r.top+r.height/2,0),innerHeight-1),c=document.elementFromPoint(x,y);return !!c&&(c===e||e.contains(c)||c.contains(e)||!!e.shadowRoot?.contains(c));};
 const controls=[...document.querySelectorAll('button,a[href],summary,[role=button],[role=tab],input:not([type=hidden]),select,textarea')].filter(e=>vis(e)&&onTop(e));
 for(const e of controls){
  const r=e.getBoundingClientRect();
  if(r.right>innerWidth+1||r.left<-1)add('화면 밖',e,Math.round(r.left)+'~'+Math.round(r.right));
  if(!name(e)&&!e.querySelector('img[alt]:not([alt=""])'))add('이름 없는 조작',e);
  // Checkboxes inside a label are clicked through the label.
  if((r.width<20||r.height<16)&&!e.closest('p,li,.markdown,label'))add('작은 클릭 영역',e,Math.round(r.width)+'x'+Math.round(r.height));
 }
 for(const e of [...document.querySelectorAll('button,summary,label,strong,small,span,h2,h3,p')].filter(vis)){
  const s=getComputedStyle(e);if(e.children.length>2)continue;
  if(e.scrollWidth>e.clientWidth+2&&s.overflowX!=='visible'&&s.textOverflow!=='ellipsis'&&e.clientWidth>0)add('글자 잘림',e,e.scrollWidth+'>'+e.clientWidth);
 }
 const boxes=controls.filter(e=>!['INPUT','TEXTAREA','SELECT'].includes(e.tagName)).map(e=>[e,e.getBoundingClientRect()]);
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const [a,ra]=boxes[i],[b,rb]=boxes[j];if(a.contains(b)||b.contains(a))continue;
  const w=Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left),h=Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top);
  if(w>4&&h>4&&w*h>0.3*Math.min(ra.width*ra.height,rb.width*rb.height))add('겹친 조작',a,'↔ '+where(b));}
 return JSON.stringify(out);
})()`;
