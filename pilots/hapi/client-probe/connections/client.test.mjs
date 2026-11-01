import {test} from 'node:test';import assert from 'node:assert/strict';import {createServerConnection} from './client.mjs';
test('credentials are bound to one origin, redirects/cookies disabled, 401 affects only its server',async()=>{
 const calls=[];let expired=false;
 const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/auth'))return {ok:true,status:200,json:async()=>({token:url.includes('100.64.0.1')?'token-a':'token-b'})};if(url.endsWith('/config'))return {ok:true,status:200,json:async()=>({sessions:[{id:'s'}]})};return {ok:!expired,status:expired?401:200,json:async()=>({session:{id:'s'}})};};
 const a=createServerConnection('https://100.64.0.1',{fetcher}),b=createServerConnection('https://100.64.0.2',{fetcher});
 await a.login('a');await b.login('b');assert.equal(a.state().status,'connected');assert.equal(b.state().status,'connected');
 for(const {url,options} of calls){assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');if(!url.endsWith('/api/auth'))assert.equal(options.headers.Authorization,url.includes('100.64.0.1')?'Bearer token-a':'Bearer token-b');}
 expired=true;await a.refresh();assert.equal(a.state().status,'expired');assert.equal(b.state().status,'connected');assert.ok(!JSON.stringify(a.state()).includes('token-a'));
});
test('disconnect invalidates in-flight login; network failure is not auth expiry',async()=>{
 let finish;const c=createServerConnection('http://127.0.0.1:61165',{fetcher:()=>new Promise(r=>finish=r)});const p=c.login('synthetic');c.disconnect();finish({ok:true,status:200,json:async()=>({token:'late'})});await p;assert.equal(c.state().status,'signed-out');
 const broken=createServerConnection('https://10.0.0.1',{fetcher:async()=>{throw Error('network detail');}});await broken.login('synthetic');assert.equal(broken.state().status,'unavailable');assert.ok(!JSON.stringify(broken.state()).includes('network detail'));
});
test('rejected initial credential is distinct from expired established authentication',async()=>{
 const c=createServerConnection('https://10.0.0.1',{fetcher:async()=>({ok:false,status:401})});await c.login('synthetic');assert.equal(c.state().status,'rejected');
});
test('session selection is scoped per server and only accepts the discovered catalog',async()=>{
 const calls=[];const fetcher=async(url)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one',label:'First'},{id:'two',label:'Second'}]}:{session:{id:url.split('/').at(-1),active:true,thinking:false}}};};
 const a=createServerConnection('https://10.0.0.1',{fetcher}),b=createServerConnection('https://10.0.0.2',{fetcher});await a.login('synthetic');await b.login('synthetic');
 await a.selectSession('two');assert.equal(a.state().selectedId,'two');assert.equal(b.state().selectedId,'one');assert.equal(a.state().session.active,true);
 const before=calls.length;await a.selectSession('../escape');assert.equal(calls.length,before);assert.equal(a.state().selectedId,'two');
 await a.refresh();assert.equal(a.state().selectedId,'two');a.disconnect();assert.deepEqual(a.state().catalog,[]);assert.equal(a.state().session,null);
});
test('late selection response cannot restore disconnected session details',async()=>{
 let finish;const fetcher=async(url)=>{if(url.endsWith('/two'))return new Promise(r=>finish=r);return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'},{id:'two'}]}:{session:{id:'one'}}};};
 const c=createServerConnection('https://10.0.0.1',{fetcher});await c.login('synthetic');const pending=c.selectSession('two');await new Promise(r=>setImmediate(r));c.disconnect();finish({ok:true,json:async()=>({session:{id:'two'}})});await pending;assert.equal(c.state().session,null);assert.equal(c.state().status,'signed-out');
});
test('history is bound to selected origin/session, filtered and discarded on selection change',async()=>{
 const calls=[];const fetcher=async(url)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'},{id:'two'}]}:url.includes('/messages?')?{messages:[{content:{role:'user',content:'hello'}},{content:{role:'agent',content:{type:'metadata',secret:'hidden'}}}],page:{hasMore:true}}:{session:{id:url.split('/').at(-1)}}};};
 const a=createServerConnection('https://10.0.0.1',{fetcher}),b=createServerConnection('https://10.0.0.2',{fetcher});await a.login('synthetic');await b.login('synthetic');await a.loadHistory();assert.deepEqual(a.state().messages,[{role:'user',text:'hello'}]);assert.equal(a.state().hasOlder,true);assert.deepEqual(b.state().messages,[]);assert.ok(calls.includes('https://10.0.0.1/api/sessions/one/messages?limit=50'));await a.selectSession('two');assert.deepEqual(a.state().messages,[]);
});
test('late history response and history auth expiry cannot leave visible conversation',async()=>{
 let finish,mode='late';const fetcher=async(url)=>{if(url.includes('/messages?'))return mode==='late'?new Promise(r=>finish=r):{ok:false,status:401};return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'}]}:{session:{id:'one'}}};};
 const c=createServerConnection('https://10.0.0.1',{fetcher});await c.login('synthetic');const pending=c.loadHistory();c.disconnect();finish({ok:true,json:async()=>({messages:[{content:{role:'user',content:'late'}}]})});await pending;assert.deepEqual(c.state().messages,[]);await c.login('synthetic');mode='expired';await c.loadHistory();assert.equal(c.state().status,'expired');assert.equal(c.state().session,null);assert.deepEqual(c.state().messages,[]);
});
test('send uses selected session, preserves other draft, confirms only from receipt history',async()=>{
 const m=new Map(),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};let sent,posts=0;
 const fetcher=async(url,options)=>{if(options.method==='POST'&&!url.endsWith('/api/auth')){posts++;sent=JSON.parse(options.body);assert.ok(url.endsWith('/two/messages'));return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'},{id:'two'}]}:url.includes('/messages?')?{messages:[{localId:sent.localId,content:{role:'user',content:sent.text}}]}:{session:{id:url.split('/').at(-1),active:true}}};};
 const c=createServerConnection('https://10.0.0.1',{fetcher,storage});await c.login('synthetic');c.setDraft('first');await c.selectSession('two');c.setDraft('second');const p=c.send();await c.send();await p;assert.equal(posts,1);assert.equal(sent.text,'second');assert.equal(c.state().pending,false);assert.equal(c.state().draft,'');await c.selectSession('one');assert.equal(c.state().draft,'first');
});
test('disconnect during send preparation never posts under a later connection',async()=>{
 const m=new Map(),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};let posts=0;
 const fetcher=async(url)=>{if(url.endsWith('/messages'))posts++;return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'}]}:{session:{id:'one',active:true}}};};
 const c=createServerConnection('https://10.0.0.1',{fetcher,storage});await c.login('synthetic');c.setDraft('hello');const p=c.send();c.disconnect();await c.login('synthetic');await p;assert.equal(posts,0);assert.equal(c.state().pending,true);
});
test('manual retry checks selected receipt, keeps ID and never replays after restored receipt',async()=>{
 const m=new Map(),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)},posts=[];let delivered=false;
 const fetcher=async(url,options)=>{if(url.endsWith('/queued-state'))return {ok:true,json:async()=>({queuedLocalIds:[],indeterminateLocalIds:[],invokedLocalMessages:[]})};if(url.endsWith('/messages')){posts.push(JSON.parse(options.body));if(posts.length===1)throw Error('lost');delivered=true;return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'}]}:url.includes('/messages?')?{messages:delivered?[{localId:posts.at(-1).localId,content:{role:'user',content:'hello'}}]:[]}:{session:{id:'one',active:true}}};};
 const c=createServerConnection('https://10.0.0.1',{fetcher,storage});await c.login('synthetic');c.setDraft('hello');await c.send();assert.equal(c.state().pending,true);await c.retry();assert.equal(posts.length,2);assert.equal(posts[0].localId,posts[1].localId);assert.equal(c.state().pending,false);await c.retry();assert.equal(posts.length,2);
});
test('file reads stay within selected session, reject traversal and clear on switch',async()=>{
 const calls=[];const fetcher=async(url)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{fileRead:true,sessions:[{id:'one'},{id:'two'}]}:url.includes('/directory?')?{success:true,entries:[{name:'hello.txt',type:'file'}]}:url.includes('/file?')?{success:true,content:Buffer.from('한글 파일').toString('base64')}:{session:{id:url.split('/').at(-1)}}};};
 const c=createServerConnection('https://10.0.0.1',{fetcher});await c.login('synthetic');await c.openPath('','directory');assert.equal(c.state().files.entries[0].name,'hello.txt');await c.openPath('hello.txt','file');assert.equal(c.state().files.content,'한글 파일');const count=calls.length;await c.openPath('../secret','file');assert.equal(calls.length,count);await c.selectSession('two');assert.equal(c.state().files.content,'');
});
test('late file response cannot restore contents after disconnect',async()=>{
 let finish;const fetcher=async(url)=>{if(url.includes('/file?'))return new Promise(r=>finish=r);return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{fileRead:true,sessions:[{id:'one'}]}:{session:{id:'one'}}};};const c=createServerConnection('https://10.0.0.1',{fetcher});await c.login('synthetic');const p=c.openPath('hello.txt','file');c.disconnect();finish({ok:true,json:async()=>({success:true,content:Buffer.from('late').toString('base64')})});await p;assert.equal(c.state().files.content,'');
});
test('permission previews belong to selected server/session and clear on failure',async()=>{
 let fail=false;const fetcher=async url=>({ok:!fail,status:fail?401:200,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'},{id:'two'}]}:{session:{id:url.split('/').at(-1),active:true,agentState:{requests:{request1:{tool:'Bash',arguments:{command:'echo synthetic'},extra:'not displayed'}}}}}});
 const a=createServerConnection('https://10.0.0.1',{fetcher}),b=createServerConnection('https://10.0.0.2',{fetcher});await a.login('synthetic');
 assert.deepEqual(a.state().permissions,[{id:'request1',tool:'Bash',blocked:true,details:'{\n  "command": "echo synthetic"\n}'}]);assert.deepEqual(b.state().permissions,[]);
 fail=true;await a.refresh();assert.deepEqual(a.state().permissions,[]);a.disconnect();assert.deepEqual(a.state().permissions,[]);
});
test('decisions bind displayed session and arguments, persist before POST, and never repeat after lost response',async()=>{
 const m=new Map(),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)},posts=[];let current={tool:'Bash',arguments:{command:'echo first'}},waiting=true;
 const fetcher=async(url,o)=>{if(url.includes('/permissions/')){posts.push({url,body:JSON.parse(o.body)});assert.ok([...m.values()].some(v=>v.includes('request1')));throw Error('lost');}return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'},{id:'two'}]}:{session:{id:url.split('/').at(-1),active:true,agentState:{requests:waiting?{request1:current}:{}}}}};};
 const a=createServerConnection('https://10.0.0.1',{fetcher,storage});await a.login('synthetic');const shown=a.state().permissions[0];await a.selectSession('two');await a.decide('one',shown,'approve');assert.equal(posts.length,0);
 await a.selectSession('one');current={tool:'Bash',arguments:{command:'echo changed'}};await a.refresh();await a.decide('one',shown,'approve');assert.equal(posts.length,0);
 const next=a.state().permissions[0];await Promise.all([a.decide('one',next,'deny'),a.decide('one',next,'approve')]);assert.equal(posts.length,1);assert.ok(posts[0].url.endsWith('/one/permissions/request1/deny'));assert.deepEqual(posts[0].body,{expected:current});assert.equal(a.state().permissionPending,true);
 a.disconnect();await a.login('synthetic');await a.decide('one',a.state().permissions[0],'approve');assert.equal(posts.length,1);
 waiting=false;await a.refresh();assert.equal(a.state().permissionPending,false);waiting=true;await a.refresh();await a.decide('one',a.state().permissions[0],'approve');assert.equal(posts.length,1);
 const b=createServerConnection('https://10.0.0.2',{fetcher,storage});await b.login('synthetic');await b.decide('one',b.state().permissions[0],'approve');assert.equal(posts.length,2);
});
test('permission storage failure and user-input requests never send a decision',async()=>{
 let tool='Bash',posts=0;const storage={getItem:()=>null,setItem:()=>{throw Error('blocked');}};
 const fetcher=async(url)=>{if(url.includes('/permissions/'))posts++;return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'}]}:{session:{id:'one',active:true,agentState:{requests:{r:{tool,arguments:{}}}}}}};};
 const c=createServerConnection('https://10.0.0.1',{fetcher,storage});await c.login('synthetic');await c.decide('one',c.state().permissions[0],'approve');assert.equal(posts,0);assert.equal(c.state().permissionStatus,'not-sent');tool='request_user_input';await c.refresh();await c.decide('one',c.state().permissions[0],'deny');assert.equal(posts,0);
});

test('a decision refreshes only its session and preserves the open conversation and file',async()=>{
 const m=new Map(),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};let waiting=true;
 const fetcher=async(url)=>{if(url.includes('/permissions/')){waiting=false;return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{fileRead:true,sessions:[{id:'one'}]}:url.includes('/messages?')?{messages:[{content:{role:'user',content:'visible'}}]}:url.includes('/file?')?{success:true,content:Buffer.from('file contents').toString('base64')}:{session:{id:'one',active:true,agentState:{requests:waiting?{r:{tool:'Bash',arguments:{}}}:{}}}}};};
 const c=createServerConnection('https://10.0.0.1',{fetcher,storage});await c.login('synthetic');await c.loadHistory();await c.openPath('hello.txt','file');await c.decide('one',c.state().permissions[0],'approve');assert.equal(c.state().messages[0]?.text,'visible');assert.equal(c.state().historyStatus,'ready');assert.equal(c.state().files.content,'file contents');assert.equal(c.state().permissionPending,false);
});
test('workspace navigation stays blocked across session changes and disconnect while a known session is pending',async()=>{
 const m=new Map(),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/api/auth')?{token:'synthetic'}:url.endsWith('/config')?{sessions:[{id:'one'},{id:'two'}]}:{session:{id:url.split('/').at(-1),active:true,agentState:{requests:{}}}}});
 const c=createServerConnection('https://10.0.0.1',{fetcher,storage});assert.equal(c.state().workspaceBlocked,true);await c.login('synthetic');assert.equal(c.state().workspaceBlocked,false);
 m.set('mari-server-pending:https://10.0.0.1:one',JSON.stringify({kind:'send',id:'p',digest:'d'}));assert.equal(c.state().workspaceBlocked,true);await c.selectSession('two');assert.equal(c.state().workspaceBlocked,true);c.disconnect();assert.equal(c.state().workspaceBlocked,true);
});
