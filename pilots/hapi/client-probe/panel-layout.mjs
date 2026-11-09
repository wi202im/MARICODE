const clamp=(n,min,max,fallback)=>Math.max(min,Math.min(max,Number.isFinite(n)?n:fallback));
export function fitPanelWidths(value,width,leftOpen,rightOpen){
 let left=clamp(value?.left,200,440,260),right=clamp(value?.right,240,520,320);
 const budget=Math.max(440,width-320);
 let excess=Math.max(0,(leftOpen?left:0)+(rightOpen?right:0)-budget);
 if(rightOpen){const cut=Math.min(excess,right-240);right-=cut;excess-=cut;}
 if(leftOpen)left-=Math.min(excess,left-200);
 return {left,right};
}
export function setupPanelLayout({shell,sidebar,inspector,storage}){
 const key='maricode-panel-widths-v1',root=document.documentElement,mobile=matchMedia('(max-width:760px)');
 let preferred={left:260,right:320},drag=null;
 try{const saved=JSON.parse(storage?.getItem(key));if(saved&&typeof saved==='object')preferred=fitPanelWidths(saved,2000,true,true);}catch{}
 const handles={};
 const apply=()=>{
  if(mobile.matches)return;
  const size=fitPanelWidths(preferred,shell.clientWidth,!document.body.classList.contains('sidebar-collapsed'),inspector.parentElement.classList.contains('inspector-visible'));
  for(const side of ['left','right']){root.style.setProperty(side==='left'?'--sidebar-width':'--inspector-width',size[side]+'px');handles[side]?.setAttribute('aria-valuenow',Math.round(size[side]));}
 };
 const save=()=>{try{storage?.setItem(key,JSON.stringify(preferred));}catch{}};
 const finish=()=>{if(!drag)return;drag=null;document.body.classList.remove('resizing-panels');save();};
 for(const [side,panel] of [['left',sidebar],['right',inspector]]){
  const handle=document.createElement('div');handles[side]=handle;handle.className='panel-resizer panel-resizer-'+side;handle.tabIndex=0;handle.role='separator';handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',side==='left'?'프로젝트 패널 너비':'상세 패널 너비');handle.setAttribute('aria-controls',panel.id);handle.setAttribute('aria-valuemin',side==='left'?'200':'240');handle.setAttribute('aria-valuemax',side==='left'?'440':'520');
  // The panels clip overflow, so the handle sits in their parent to straddle the border line.
  panel.parentElement.append(handle);
  handle.addEventListener('pointerdown',e=>{if(e.button!==0||mobile.matches)return;e.preventDefault();drag={side,x:e.clientX,width:panel.getBoundingClientRect().width};handle.setPointerCapture(e.pointerId);document.body.classList.add('resizing-panels');});
  handle.addEventListener('pointermove',e=>{if(drag?.side!==side)return;preferred[side]=clamp(drag.width+(e.clientX-drag.x)*(side==='left'?1:-1),side==='left'?200:240,side==='left'?440:520,side==='left'?260:320);apply();});
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
  handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();preferred[side]=e.key==='Home'?(side==='left'?260:320):panel.getBoundingClientRect().width+(e.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*(e.shiftKey?40:10);preferred=fitPanelWidths(preferred,2000,true,true);apply();save();});
  handle.addEventListener('dblclick',()=>{preferred[side]=side==='left'?260:320;apply();save();});
 }
 new ResizeObserver(apply).observe(shell);
 new MutationObserver(apply).observe(document.body,{attributes:true,attributeFilter:['class']});
 new MutationObserver(apply).observe(inspector.parentElement,{attributes:true,attributeFilter:['class']});
 mobile.addEventListener('change',()=>{finish();apply();});window.addEventListener('blur',finish);apply();
}
