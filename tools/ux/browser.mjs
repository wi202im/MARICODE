// Minimal Chrome DevTools driver for usability runs: an isolated headless Chrome profile, real mouse/keyboard input.
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const chromePaths=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium'];
export async function launchChrome({profile,port}){
 const {access}=await import('node:fs/promises');let bin=null;for(const p of chromePaths)if(await access(p).then(()=>true,()=>false)){bin=p;break;}
 if(!bin)throw Error('Google Chrome is required for usability runs');
 const child=spawn(bin,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
 for(let i=0;i<50;i++){try{await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();break;}catch{await new Promise(r=>setTimeout(r,200));}}
 const exited=new Promise(r=>child.once('exit',r));
 return {port,close:async()=>{child.kill();await Promise.race([exited,new Promise(r=>setTimeout(r,3000))]);}};
}
export async function openPage(chrome,{width=1400,height=880}={}){
 const target=await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`,{method:'PUT'})).json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);let id=0;const pending=new Map(),logs=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}
  if(m.method==='Runtime.exceptionThrown')logs.push({level:'exception',text:(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text).split('\n')[0]});
  if(m.method==='Log.entryAdded'&&!/favicon/.test(m.params.entry.url??'')&&m.params.entry.level==='error'&&!/status of 40[34]/.test(m.params.entry.text))logs.push({level:'error',text:m.params.entry.text.slice(0,200)});
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push({level:'console',text:m.params.args.map(a=>a.value??a.description).join(' ').slice(0,200)});};
 await new Promise(r=>ws.onopen=r);
 const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
 await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error('page: '+(r.result.exceptionDetails.exception?.description??r.result.exceptionDetails.text).split('\n')[0]);return r.result?.result?.value;};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 // Finds a visible element by CSS selector or by its visible text/label; returns its center.
 const locate=async target=>JSON.parse(await evaluate(`(()=>{const t=${JSON.stringify(target)};const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.opacity!=='0'&&s.pointerEvents!=='none';};
  let el=null;try{el=[...document.querySelectorAll(t)].find(vis);}catch{}
  if(!el){const label=e=>[e.getAttribute('aria-label'),e.textContent,e.title].filter(Boolean).join(' ').trim().replace(/\\s+/g,' ');
   const all=[...document.querySelectorAll('button,a,summary,[role=button],[role=tab],vscode-tree-item,input,textarea,select,li,label')].filter(vis);
   el=all.find(e=>label(e)===t)||all.find(e=>label(e).startsWith(t))||all.find(e=>label(e).includes(t));}
  if(!el)return 'null';el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return 'null';return JSON.stringify({x:r.x+Math.min(r.width/2,40),y:r.y+r.height/2,label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,60)});})()`));
 // Counts DOM changes after an action so a click without visible feedback is reported.
 const watch=()=>evaluate(`(()=>{window.__ux={changes:0,first:null,start:performance.now()};new MutationObserver(ms=>{for(const m of ms){if(m.target.closest?.('#notice')||m.type==='childList'||m.type==='attributes'&&['hidden','open','aria-pressed','aria-selected','class'].includes(m.attributeName)){window.__ux.changes++;window.__ux.first??=performance.now()-window.__ux.start;}}}).observe(document.body,{subtree:true,childList:true,attributes:true});return true;})()`);
 const feedback=async(ms=1500)=>{await wait(ms);return evaluate('JSON.stringify(window.__ux)').then(JSON.parse);};
 const find=async target=>{for(let i=0;i<15;i++){const at=await locate(target);if(at)return at;await wait(200);}return null;};
 async function click(target){const at=await find(target);if(!at)throw Error(`찾을 수 없음: ${target}`);await watch();
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:at.x,y:at.y,button:'left',clickCount:1});return {...at,...(await feedback())};}
 async function type(text){await watch();await send('Input.insertText',{text});return feedback(600);}
 async function key(key,modifiers=0){await watch();const code={Enter:13,Escape:27,ArrowDown:40,ArrowUp:38,Tab:9}[key]??key.toUpperCase().charCodeAt(0);
  for(const t of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type:t,key,code:key.length===1?'Key'+key.toUpperCase():key,windowsVirtualKeyCode:code,modifiers});if(key==='Enter')await send('Input.dispatchKeyEvent',{type:'char',text:'\r'});return feedback(800);}
 // The result of a step must be on screen: inside the viewport and not covered by another layer.
 async function expectVisible(selector,ms=2000){for(let t=0;t<ms;t+=200){const ok=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();if(r.width<2||r.height<2||r.bottom<8||r.top>innerHeight-8||r.right<8||r.left>innerWidth-8)return false;const x=Math.min(Math.max(r.left+Math.min(r.width/2,40),1),innerWidth-1),y=Math.min(Math.max(r.top+Math.min(r.height/2,20),1),innerHeight-1),c=document.elementFromPoint(x,y);return !!c&&(e.contains(c)||c.contains(e)||!!e.shadowRoot?.contains(c));})()`);if(ok)return {changes:1};await wait(200);}throw Error(`결과가 화면에 보이지 않음: ${selector}`);}
 async function screenshot(path){const s=await send('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(s.result.data,'base64'));}
 async function goto(url){await send('Page.navigate',{url});for(let i=0;i<50;i++){if(await evaluate("document.readyState==='complete'&&performance.getEntriesByType('resource').some(e=>e.name.endsWith('/app.mjs'))").catch(()=>false))break;await wait(200);}await wait(700);}
 // Logs in through the form once the app is ready; waits for the workspace and retries the click once.
 async function login(token='ux'){for(let attempt=0;attempt<2;attempt++){await evaluate(`document.getElementById('token').value=${JSON.stringify(token)};document.querySelector('#login-form button').click();true`);
  for(let i=0;i<40;i++){if(await evaluate("!document.getElementById('workspace').hidden&&document.getElementById('login').hidden"))return true;await wait(250);}}throw Error('로그인 화면에서 넘어가지 않음');}
 // Closing the tab (not just the socket) ends its live event stream; Chrome allows only 6 connections per host.
 return {send,evaluate,click,type,key,screenshot,goto,login,wait,expectVisible,locate:find,logs,close:async()=>{ws.close();await fetch(`http://127.0.0.1:${chrome.port}/json/close/${target.id}`).catch(()=>{});}};
}
