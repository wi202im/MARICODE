import test from 'node:test';
import assert from 'node:assert/strict';
import {createClaudeImportPanel,nativeClaudeSourcePicker,createImportedHistory} from './claude-import-ui.mjs';

function fixture(pickSource,respond=()=>({sessions:[],status:"empty"}),opened=()=>{}){
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,hidden:false,textContent:'',replaceChildren(...rows){this.rows=rows;},click(){if(!this.disabled)return this.onclick?.();}});return nodes.get(id);};
 const element={open:false,hidden:true,querySelector:s=>get(s.slice(1)),addEventListener(){}};
 const store=new Map();globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};globalThis.document={createElement:()=>({})};
 const c={agent:'claude',project:'one',path:'/fixture/project',projectAvailable:true,busy:false,mode:'import'},requests=[];
 const panel=createClaudeImportPanel({element,pickSource,context:()=>c,changed(){},opened,api:async(path,options)=>{requests.push({path,...options.body});return respond(options.body,path);}});
 panel.configure(true);return {get,c,requests,panel,store,element};
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
 await f.get('claude-import-find').onclick();f.get('claude-import-select').value='recent';f.panel.render();
 assert.equal(f.get('claude-import-start').disabled,false);assert.equal(f.get('claude-import-more').hidden,false);
 await f.get('claude-import-more').onclick();assert.equal(f.requests[1].offset,50);assert.equal(f.requests[1].source,'/resolved');
 assert.equal(f.get('claude-import-select').value,'recent');assert.equal(f.get('claude-import-select').rows.length,2);assert.equal(f.get('claude-import-more').hidden,true);
 f.get('claude-import-select').value='older';f.get('claude-import-select').onchange();f.panel.render();
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


test('new and existing session routes are exclusive, including an unresolved import',async()=>{
 const f=fixture(null,(_,path)=>path.endsWith('/list')?{sessions:[{id:'source',title:'Prior',importable:true,fingerprint:'abc'}],searched:{source:'/fixture'}}:{state:'registering'});
 f.c.mode='new';f.panel.render();assert.equal(f.element.hidden,true);assert.equal(f.panel.blocksCreation,false);
 f.c.mode='import';f.panel.render();assert.equal(f.element.hidden,false);assert.equal(f.panel.blocksCreation,true);
 await f.get('claude-import-find').onclick();f.get('claude-import-select').value='source';f.panel.render();
 await f.get('claude-import-start').onclick();f.c.mode='new';f.panel.render();assert.equal(f.panel.blocksCreation,true);assert.equal(f.panel.pending,true);
});
test('a registered import retains its ID when opening fails and retries only opening that conversation',async()=>{
 let opens=0;const id='11111111-1111-4111-8111-111111111111';
 const f=fixture(null,(_,path)=>path.endsWith('/list')?{sessions:[{id:'source',title:'Prior',importable:true,fingerprint:'abc'}],searched:{source:'/fixture'}}:{state:'registered',id},async selected=>{assert.equal(selected,id);if(++opens===1)throw Error('history unavailable');});
 await f.get('claude-import-find').onclick();f.get('claude-import-select').value='source';f.panel.render();
 await f.get('claude-import-start').onclick();assert.equal(f.panel.pending,true);assert.equal(f.get('claude-import-check').hidden,false);assert.match(f.get('claude-import-status').textContent,/등록.*완료/);
 assert.equal(JSON.parse(f.store.get('maricode-claude-import-pending')).registeredId,id);
 await f.get('claude-import-check').onclick();assert.equal(opens,2);assert.equal(f.requests.length,2);assert.equal(f.panel.pending,false);
});

test('refresh replaces stale rows and fingerprints while retaining a still-present selection',async()=>{
 let generation=0;const f=fixture(null,()=>({sessions:[{id:'same',title:'Latest '+generation,fingerprint:String(generation),importable:true}],searched:{source:'/fixture'}}));
 await f.get('claude-import-find').onclick();f.get('claude-import-select').value='same';f.panel.render();assert.equal(f.get('claude-import-start').disabled,false);
 generation++;await f.get('claude-import-find').onclick();assert.equal(f.get('claude-import-select').value,'same');assert.match(f.get('claude-import-select').rows[0].textContent,/Latest 1/);
 assert.match(f.get('claude-import-updated').textContent,/마지막 확인/);assert.equal(f.requests.length,2);
});

test('imported counts distinguish prior history, failed reads and ordinary sessions',async()=>{
 let fail=false;const f=historyFixture(async()=>{if(fail)throw Error('read failed');return {imported:true,total:54,messages:[{role:'user',text:'prior'}],before:53,hasMore:true};});
 await f.history.load('import',true);assert.deepEqual(f.history.status,{imported:true,shown:1,total:54,loading:false,error:false});
 fail=true;await f.history.load('broken',true);assert.equal(f.history.status.error,true);assert.equal(f.history.status.shown,0);
 await f.history.load('ordinary',false);assert.deepEqual(f.history.status,{imported:false,shown:0,total:0,loading:false,error:false});
});

test('history remains searchable before CLI connection, but import waits for setup and result checks remain available',async()=>{
 const f=fixture(null,(_,path)=>path.endsWith('/list')?{sessions:[{id:'source',title:'Prior',importable:true,fingerprint:'abc'}],searched:{source:'/fixture'}}:{state:'registering'});
 f.c.connectionState='connection-required';await f.get('claude-import-find').onclick();f.get('claude-import-select').value='source';f.panel.render();
 assert.equal(f.get('claude-import-find').disabled,false);assert.equal(f.get('claude-import-start').disabled,true);
 assert.match(f.get('claude-import-readiness').textContent,/CLI/);await f.get('claude-import-start').onclick();assert.equal(f.requests.length,1);
 f.c.connectionState='connected';f.panel.render();assert.equal(f.get('claude-import-start').disabled,false);await f.get('claude-import-start').onclick();
 f.c.connectionState='connection-required';f.panel.render();assert.equal(f.get('claude-import-check').disabled,false);await f.get('claude-import-check').onclick();assert.equal(f.requests.at(-1).path,'/api/claude-import/check');
});
test('preflight rejection keeps the selected record for explicit retry after connection repair',async()=>{
 const f=fixture(null,(_,path)=>{if(path.endsWith('/list'))return {sessions:[{id:'source',title:'Prior',importable:true,fingerprint:'abc'}],searched:{source:'/fixture'}};throw Object.assign(Error('CLI 연결이 필요합니다.'),{rejected:true,reason:'IMPORT_CLI_CONNECTION'});});
 await f.get('claude-import-find').onclick();f.get('claude-import-select').value='source';f.panel.render();await f.get('claude-import-start').onclick();
 assert.equal(f.panel.pending,false);assert.match(f.get('claude-import-status').textContent,/CLI 연결/);assert.equal(f.get('claude-import-start').disabled,false);assert.equal(f.requests.length,2);
});
