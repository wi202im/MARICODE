import test from 'node:test';
import assert from 'node:assert/strict';
import {createClaudeImportPanel,nativeClaudeSourcePicker} from './claude-import-ui.mjs';

function fixture(pickSource){
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,hidden:false,textContent:'',replaceChildren(...rows){this.rows=rows;},click(){if(!this.disabled)return this.onclick?.();}});return nodes.get(id);};
 const element={open:false,hidden:true,querySelector:s=>get(s.slice(1)),addEventListener(){}};
 globalThis.sessionStorage={getItem:()=>null};globalThis.document={createElement:()=>({})};
 const c={agent:'claude',project:'one',path:'/fixture/project',projectAvailable:true,busy:false},requests=[];
 const panel=createClaudeImportPanel({element,pickSource,context:()=>c,changed(){},opened(){},api:async(path,options)=>{requests.push({path,...options.body});return {sessions:[],status:'empty'};}});
 panel.configure(true);return {get,c,requests,panel};
}
test('selected profile searches the current workspace once; cancel preserves the previous path',async()=>{
 let answer='/fixture/.claude-global';const f=fixture(async()=>answer);
 await f.get('claude-import-browse').onclick();
 assert.equal(f.get('claude-import-source').value,answer);
 assert.deepEqual(f.requests,[{path:'/api/claude-import/list',project:'one',source:answer}]);
 answer=null;await f.get('claude-import-browse').onclick();
 assert.equal(f.requests.length,1);assert.equal(f.get('claude-import-source').value,'/fixture/.claude-global');
});
test('late folder selection cannot retarget a different workspace or bypass a busy state',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));
 const choosing=f.get('claude-import-browse').onclick();f.c.project='two';f.panel.render();resolve('/fixture/.claude-global');await choosing;
 assert.equal(f.requests.length,0);assert.equal(f.get('claude-import-source').value,'');
 f.c.busy=true;f.panel.render();assert.equal(f.get('claude-import-browse').disabled,true);
});
test('native folder response is tied to one request and unavailable on remote pages',async()=>{
 const view=new EventTarget();view.location={origin:'http://127.0.0.1:61192',pathname:'/workspace'};view.crypto=crypto;
 let sent;view.webkit={messageHandlers:{maricode:{postMessage:s=>sent=s}}};
 const result=nativeClaudeSourcePicker(view)();let done=false;result.then(()=>done=true);
 view.dispatchEvent(new CustomEvent('maricode-claude-source-selected',{detail:{requestId:'wrong',path:'/wrong'}}));await Promise.resolve();assert.equal(done,false);
 view.dispatchEvent(new CustomEvent('maricode-claude-source-selected',{detail:{requestId:sent.split(':')[1],path:'/fixture/.claude-global'}}));
 assert.equal(await result,'/fixture/.claude-global');
 view.location.origin='https://remote.local';assert.equal(nativeClaudeSourcePicker(view),null);
});
