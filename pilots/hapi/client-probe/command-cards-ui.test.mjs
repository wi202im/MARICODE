import test from 'node:test';import assert from 'node:assert/strict';
import {cardCommands,cardCommand,createCardRequest,reconnectCommandSession} from './command-cards-ui.mjs';
test('only executable card capabilities appear, with unsupported commands and arguments excluded',()=>{
 assert.deepEqual(cardCommands(null),[]);assert.deepEqual(cardCommands({actions:['mcp-list','account']}).map(x=>x.name),['mcp','account']);
 assert.equal(cardCommand('/MCP '),'mcp');assert.equal(cardCommand('/mcp add secret'),null);assert.equal(cardCommand('/plugins'),'plugins');assert.equal(cardCommand('/config'),null);
});
test('response loss keeps only request ID and checks it without posting again',async()=>{
 let stored,posts=0,checks=0;const request=createCardRequest({id:'session',cap:{contextKey:'revision'},save:v=>stored=v,uuid:()=> 'test-id',api:async(path,opt)=>{if(opt){posts++;assert.equal(opt.body.contextKey,'revision');throw Error('lost');}checks++;return {state:'succeeded',rows:[],summary:'saved'};}});
 await request.run('mcp-add',{name:'demo',url:'https://a.test'},true);assert.deepEqual(stored,{requestId:'test-id'});assert.equal(request.pending,true);
 await request.run('mcp-add',{},true);assert.equal(posts,1);await request.check();assert.equal(checks,1);assert.equal(posts,1);assert.equal(stored,null);
});
test('reconnect stops on changed context, pending requests, unconfirmed archive and resumes same session only',async()=>{
 let s={id:'one',connected:true,active:true,thinking:false,agentState:{controlledByUser:false,requests:{}},metadata:{},metadataVersion:1,agentStateVersion:1};let archived=0,resumed=0;
 const options={id:'one',read:()=>s,refresh:async()=>{},confirm:async()=>true,archive:async()=>{archived++;s={...s,active:false};},resume:async()=>{resumed++;s={...s,active:true};}};
 await reconnectCommandSession(options);assert.equal(archived,1);assert.equal(resumed,1);
 s={...s,pending:true};await assert.rejects(reconnectCommandSession(options));assert.equal(archived,1);
 s={...s,pending:false};await assert.rejects(reconnectCommandSession({...options,archive:async()=>{}}));assert.equal(resumed,1);
 await assert.rejects(reconnectCommandSession({...options,confirm:async()=>{s={...s,id:'other'};return true;}}));assert.equal(resumed,1);
});

test('chat MCP card requires explicit scoped confirmation, shows results and never repeats a lost mutation',async()=>{
 const {createCommandCard}=await import('./command-cards-ui.mjs');const nodes=[];
 const doc={createElement(tag){const n={tag,children:[],value:'',hidden:false,append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(){},remove(){this.removed=true;}};nodes.push(n);return n;}};
 let writes=0,reads=0;const records=new Map(),storage={getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
 const card=createCommandCard({id:'fixture',name:'mcp',cap:{agent:'claude',accountId:'default',alias:'Fixture',cwd:'/fixture',contextKey:'bound',actions:['mcp-list','mcp-add','mcp-remove']},document:doc,storage,reconnect:async()=>true,api:async(path,opt)=>{
  if(opt?.body.action==='mcp-list'){reads++;return {state:'succeeded',summary:'fixture list',rows:[{name:'existing',status:'Connected'}]};}
  if(opt){writes++;assert.equal(opt.body.confirm,true);assert.deepEqual(opt.body.params,{name:'demo',url:'https://example.test/mcp',scope:'local'});throw Error('response lost');}
  return {state:'succeeded',needsReconnect:true,summary:'saved',rows:[]};
 }});
 const button=text=>nodes.find(n=>n.tag==='button'&&n.textContent===text);
 await card.load();assert.equal(reads,1);assert.ok(nodes.some(n=>n.textContent==='existing'));
 const inputs=nodes.filter(n=>n.tag==='input');inputs[0].value='demo';inputs[1].value='https://example.test/mcp';nodes.find(n=>n.tag==='form').onsubmit({preventDefault(){}});assert.equal(writes,0);
 await button('변경 확인').onclick();assert.equal(writes,1);assert.equal(button('변경 결과 확인').hidden,false);assert.equal(button('서버 추가 검토').disabled,true);
 await button('변경 확인').onclick();assert.equal(writes,1);assert.ok([...records.values()].every(v=>!v.includes('example.test')));
 await button('변경 결과 확인').onclick();assert.equal(writes,1);assert.equal(button('적용하고 이어가기').hidden,false);assert.equal(button('서버 추가 검토').disabled,false);
});

test('MCP authentication has an explicit per-server action and checks the same request without retrying',async()=>{
 const {createCommandCard}=await import('./command-cards-ui.mjs');const nodes=[];
 const doc={createElement(tag){const n={tag,children:[],value:'',hidden:false,append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(){},remove(){}};nodes.push(n);return n;}};
 let starts=0,checks=0;const card=createCommandCard({id:'fixture',name:'mcp',cap:{agent:'claude',accountId:'default',cwd:'/fixture',actions:['mcp-list','mcp-login']},document:doc,api:async(path,opt)=>{
  if(opt?.body.action==='mcp-list')return {state:'succeeded',rows:[{name:'demo',status:'인증 필요'}]};
  if(opt){starts++;assert.equal(opt.body.action,'mcp-login');assert.deepEqual(opt.body.params,{name:'demo'});assert.equal(opt.body.confirm,true);return {state:'running',action:'mcp-login',summary:'인증 대기'};}
  checks++;return {state:'succeeded',action:'mcp-login',needsReconnect:true,summary:'인증 완료'};
 }});
 const button=text=>nodes.find(n=>n.tag==='button'&&n.textContent===text);
 await card.load();assert.ok(button('인증 시작'));button('인증 시작').onclick();assert.equal(starts,0);
 await button('변경 확인').onclick();assert.equal(starts,1);assert.equal(button('인증 결과 확인').hidden,false);
 button('인증 시작').onclick();assert.equal(starts,1);
 await button('인증 결과 확인').onclick();assert.equal(starts,1);assert.equal(checks,1);assert.equal(button('적용하고 이어가기').hidden,false);
});
