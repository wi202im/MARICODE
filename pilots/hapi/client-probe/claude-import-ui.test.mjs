import test from 'node:test';
import assert from 'node:assert/strict';
import {createClaudeImportPanel,nativeClaudeSourcePicker,createImportedHistory} from './claude-import-ui.mjs';

function fixture(pickSource,respond=()=>({sessions:[],status:"empty"})){
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,hidden:false,textContent:'',replaceChildren(...rows){this.rows=rows;},click(){if(!this.disabled)return this.onclick?.();}});return nodes.get(id);};
 const element={open:false,hidden:true,querySelector:s=>get(s.slice(1)),addEventListener(){}};
 globalThis.sessionStorage={getItem:()=>null};globalThis.document={createElement:()=>({})};
 const c={agent:'claude',project:'one',path:'/fixture/project',projectAvailable:true,busy:false},requests=[];
 const panel=createClaudeImportPanel({element,pickSource,context:()=>c,changed(){},opened(){},api:async(path,options)=>{requests.push({path,...options.body});return respond(options.body);}});
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

test('older pages preserve the chosen session; blocked records explain why without enabling import',async()=>{
 const f=fixture(null,request=>request.offset?{sessions:[{id:'older',title:'Older',modifiedAt:0,importable:false,warning:'too large'}],total:2,nextOffset:null}:{sessions:[{id:'recent',title:'Recent',modifiedAt:0,importable:true}],total:2,nextOffset:50,searched:{source:'/resolved',project:'/fixture/project',records:'/records'}});
 await f.get('claude-import-find').onclick();f.get('claude-import-select').value='recent';f.get('claude-import-confirm').checked=true;f.panel.render();
 assert.equal(f.get('claude-import-start').disabled,false);assert.equal(f.get('claude-import-more').hidden,false);
 await f.get('claude-import-more').onclick();assert.equal(f.requests[1].offset,50);assert.equal(f.requests[1].source,'/resolved');
 assert.equal(f.get('claude-import-select').value,'recent');assert.equal(f.get('claude-import-select').rows.length,2);assert.equal(f.get('claude-import-more').hidden,true);assert.equal(f.get('claude-import-confirm').checked,false);
 f.get('claude-import-select').value='older';f.get('claude-import-select').onchange();f.get('claude-import-confirm').checked=true;f.panel.render();
 assert.match(f.get('claude-import-detail').textContent,/too large/);assert.equal(f.get('claude-import-start').disabled,true);
 await f.get('claude-import-start').onclick();assert.equal(f.requests.length,2);
});

function historyFixture(api,scroller){
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{hidden:false,disabled:false,textContent:'',replaceChildren(...children){this.children=children;}});return nodes.get(s);};
 globalThis.document={createElement:()=>({append(...children){this.children=children;}})};
 const element={hidden:true,open:false,querySelector:get};
 return {element,get,history:createImportedHistory({element,api,scroller})};
}
test('import opens prior conversation immediately; pagination preserves an explicit collapse',async()=>{
 const f=historyFixture(async path=>({imported:true,total:2,messages:[{role:'user',text:path.includes('?')?'earlier':'recent'}],before:1,hasMore:!path.includes('?')}));
 await f.history.load('one',true);assert.equal(f.element.hidden,false);assert.equal(f.element.open,true);
 assert.match(f.get('summary').textContent,/1\/2/);assert.equal(f.get('.imported-records').children[0].children[1].textContent,'recent');
 f.element.open=false;await f.get('button').onclick();assert.equal(f.element.open,false);assert.equal(f.get('.imported-records').children.length,2);
 await f.history.load('normal',false);assert.equal(f.element.hidden,true);assert.equal(f.get('.imported-records').children.length,0);
});
test('late imported history cannot appear in a different session; read failures are visible',async()=>{
 let resolve;const f=historyFixture(()=>new Promise(r=>resolve=r));
 const first=f.history.load('one',true);await f.history.load('two',false);resolve({imported:true,messages:[{text:'private'}],total:1});await first;assert.equal(f.element.hidden,true);
 const failed=historyFixture(async()=>{throw Error('unavailable');});await failed.history.load('one',true);assert.equal(failed.element.open,true);assert.match(failed.get('p').textContent,/읽지 못/);
});

test('initial transcript scrolls to recent content; older pages keep the reading position',async()=>{
 const scroller={scrollTop:0,scrollHeight:1000};
 const f=historyFixture(async path=>{if(path.includes('?'))scroller.scrollHeight=1400;return {imported:true,total:2,messages:[{role:'user',text:'history'}],before:1,hasMore:true};},scroller);
 await f.history.load('one',true);assert.equal(scroller.scrollTop,1000);
 scroller.scrollTop=100;await f.get('button').onclick();assert.equal(scroller.scrollTop,500);
});
