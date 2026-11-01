import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActions, messageView, relativePath, createSSEDecoder } from './core.mjs';

test('double send and uncertain delivery never cause an automatic replay', async () => {
  let calls=0, reject, saved, started;const ready=new Promise(r=>started=r);
  const actions=createActions({post:()=>{calls++;return new Promise((_,r)=>{reject=r;started();});},save:p=>{saved=p;},pending:null});
  const first=actions.send('hello');
  await assert.rejects(actions.send('hello'));
  await ready;reject(new Error('connection lost'));
  await assert.rejects(first);
  assert.equal(calls,1);assert.equal(saved.kind,'send');
  const restored=createActions({post:async()=>{calls++;},save:()=>{},pending:saved});
  await assert.rejects(restored.send('hello'));
  restored.reconcile([{localId:saved.id}],false);
  assert.equal(restored.pending,null);assert.equal(calls,1);
});

test('resume is not repeated after a lost response until server reports active', async()=>{
  const actions=createActions({post:async()=>{throw new Error('lost');},save:()=>{}});
  await assert.rejects(actions.resume());await assert.rejects(actions.resume());
  actions.reconcile([],false);assert.equal(actions.pending.kind,'resume');
  actions.reconcile([],true,true);assert.equal(actions.pending.kind,'resume');
  actions.reconcile([],true);assert.equal(actions.pending,null);
});

test('SSE handles fragmented frames, unicode and CRLF',()=>{
  const out=[];const parse=createSSEDecoder(x=>out.push(x));
  parse('data: {"type":"message-');parse('received","message":"초록 우산"}\r\n\r');parse('\n');
  assert.equal(out.length,1);assert.equal(out[0].message,'초록 우산');
});

test('only known chat payloads render as messages; metadata stays hidden',()=>{
  assert.deepEqual(messageView({content:{role:'agent',content:{type:'codex',data:{type:'message',message:'초록 우산'}}}}),{role:'agent',text:'초록 우산'});
  assert.equal(messageView({content:{role:'agent',content:{type:'codex',data:{type:'token_count',secret:'not text'}}}}),null);
  assert.equal(messageView({content:null}),null);
});

test('file paths stay relative to the selected test project',()=>{
  assert.equal(relativePath('notes-link/example.txt'),'notes-link/example.txt');
  for(const p of ['../private','/etc/passwd','a/../../b','a\\b','a\0b'])assert.throws(()=>relativePath(p));
});

test('handoff includes bounded visible text and explicit source/target, never tool metadata', async()=>{
  const {buildHandoff}=await import('./core.mjs');
  const source={id:'source',label:'Codex'},target={id:'target',label:'Claude'};
  const messages=[{content:{role:'agent',content:{type:'codex',data:{type:'tool-call',secret:'PRIVATE'}}}},...Array.from({length:25},(_,i)=>({content:{role:'user',content:{type:'text',text:`turn-${i} `+'가'.repeat(2000)}}}))];
  const text=buildHandoff(source,target,messages);
  assert.ok(text.includes('source'));assert.ok(text.includes('target'));assert.ok(text.includes('turn-24'));
  assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes('turn-0 '));
  assert.ok(new TextEncoder().encode(text).length<40000);
  assert.throws(()=>buildHandoff(source,source,messages));
  assert.throws(()=>buildHandoff(source,target,[]));
});

test('confirmed delivery clears only the unchanged draft with the same request ID',async()=>{
  const {confirmedDraft}=await import('./core.mjs');
  const pending={kind:'send',id:'request-one'};
  const messages=[{localId:'request-one',content:{role:'user',content:{type:'text',text:'trial message'}}}];
  assert.equal(confirmedDraft(messages,pending,'trial message'),true);
  assert.equal(confirmedDraft(messages,pending,'new draft'),false);
  assert.equal(confirmedDraft(messages,{...pending,id:'other'},'trial message'),false);
  assert.equal(confirmedDraft(messages,null,'trial message'),false);
  assert.equal(confirmedDraft([{...messages[0],content:{role:'agent',content:{type:'codex',data:{type:'message',message:'trial message'}}}}],pending,'trial message'),false);
});

test('explicit retry checks receipt and preserves original ID and content',async()=>{
 const calls=[];let first=true;
 const a=createActions({save:()=>{},post:async(kind,body)=>{calls.push({kind,body});if(kind==='state')return {queuedLocalIds:[],indeterminateLocalIds:[],invokedLocalMessages:[]};if(first){first=false;throw Error('lost before acceptance');}return {ok:true};}});
 await assert.rejects(a.send('original'));const id=a.pending.id;
 await assert.rejects(a.retry('edited'));assert.equal(calls.length,1);
 await a.retry('original');assert.equal(calls.length,3);assert.equal(calls[2].body.localId,id);assert.equal(calls[2].body.text,'original');
});
test('retry never resends accepted or indeterminate messages',async()=>{
 let pending;const first=createActions({save:p=>pending=p,post:async()=>{throw Error('lost');}});await assert.rejects(first.send('original'));
 for(const kind of ['queued','invoked','indeterminate']){
  let sends=0;const a=createActions({pending,save:()=>{},post:async(action)=>{if(action!=='state'){sends++;return {}; }return {queuedLocalIds:kind==='queued'?[pending.id]:[],indeterminateLocalIds:kind==='indeterminate'?[pending.id]:[],invokedLocalMessages:kind==='invoked'?[{localId:pending.id}]:[]};}});
  if(kind==='indeterminate')await assert.rejects(a.retry('original'));else{await a.retry('original');assert.equal(a.pending,null);}
  assert.equal(sends,0);
 }
});

test('handoff reports actual inclusion, omissions and truncation',async()=>{
 const {handoffExcerpt,buildHandoff}=await import('./core.mjs');
 const ms=Array.from({length:25},(_,i)=>({id:String(i),seq:i+1,content:{role:'user',content:{type:'text',text:'가'.repeat(2000)}}}));
 const report=handoffExcerpt(ms);assert.equal(report.included,6);assert.equal(report.omitted,19);assert.equal(report.truncated,6);assert.equal(report.characters,9000);assert.equal(report.firstSeq,20);assert.equal(report.lastSeq,25);
 const draft=buildHandoff({id:'a',label:'Codex'},{id:'b',label:'Claude'},ms,{hasOlder:true});assert.ok(draft.includes('6개'));assert.ok(draft.includes('19개'));assert.ok(draft.includes('이전 이력 있음'));
});

test('tab login retention is opt-in and clearing removes the only saved credential',async()=>{
 const {saveTabToken,readTabToken}=await import('./core.mjs');
 const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k)};
 saveTabToken(storage,'issued-test-token',false);assert.equal(readTabToken(storage),'');
 assert.equal(saveTabToken(storage,'issued-test-token',true),true);assert.equal(readTabToken(storage),'issued-test-token');
 assert.equal(values.size,1);assert.deepEqual([...values.values()],['issued-test-token']);
 saveTabToken(storage,'',false);assert.equal(values.size,0);
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 assert.equal(readTabToken(blocked),'');assert.equal(saveTabToken(blocked,'issued',true),false);
});

test('restored selection must still belong to the current allowed session list',async()=>{
 const {restoredSession}=await import('./core.mjs');const sessions=[{id:'first'},{id:'child'}];
 assert.equal(restoredSession(sessions,'child'),'child');
 assert.equal(restoredSession(sessions,'removed'),'first');
 assert.equal(restoredSession(sessions,null),'first');
});

test('archive keeps uncertain outcome until inactive, and only explicit rejection unlocks',async()=>{
 let saved,calls=0;
 const actions=createActions({save:p=>saved=p,post:async()=>{calls++;throw Error('lost');}});
 await assert.rejects(actions.archive({metadataVersion:2,agentStateVersion:3}));
 assert.equal(saved.kind,'archive');await assert.rejects(actions.archive({}));
 actions.reconcile([],true);assert.equal(actions.pending.kind,'archive');
 actions.reconcile([],false);assert.equal(actions.pending,null);assert.equal(calls,1);
 const rejected=createActions({save:()=>{},post:async()=>{throw Object.assign(Error('rejected'),{rejected:true});}});
 await assert.rejects(rejected.archive({}));assert.equal(rejected.pending,null);
});

test('archive confirmation binds a copied snapshot to the displayed session and versions',async()=>{
 const {archiveSnapshot,archiveMatches}=await import('./core.mjs');
 const state={metadataVersion:2,agentStateVersion:3};
 const approval=archiveSnapshot('one',state);
 state.metadataVersion=4;
 assert.equal(archiveMatches(approval,'one',state),false);
 assert.equal(archiveMatches(approval,'two',{metadataVersion:2,agentStateVersion:3}),false);
 assert.equal(archiveMatches(approval,'one',{metadataVersion:2,agentStateVersion:4}),false);
 assert.equal(archiveMatches(approval,'one',{metadataVersion:2,agentStateVersion:3}),true);
 assert.throws(()=>archiveSnapshot('one',{}));
});

test('resume rejected before forwarding can be retried after execution environment recovery',async()=>{
 const a=createActions({post:async()=>{throw Object.assign(Error('runner offline'),{rejected:true});},save:()=>{}});
 await assert.rejects(a.resume());assert.equal(a.pending,null);
});
test('attachment retries keep exact payload and reject a changed attachment',async()=>{
 const sent=[],file={id:'attachment',filename:'a.txt',mimeType:'text/plain',size:2,path:'/upload/a'};
 const actions=createActions({save:()=>{},post:async(kind,body)=>{sent.push({kind,body});if(kind==='state')return {queuedLocalIds:[],indeterminateLocalIds:[],invokedLocalMessages:[]};throw Error('response lost');}});
 await assert.rejects(actions.send('',[file]));assert.deepEqual(sent[0].body.attachments,[file]);
 await assert.rejects(actions.retry('',[{...file,path:'/other'}]));assert.equal(sent.length,1);
 await assert.rejects(actions.retry('',[file]));assert.equal(sent.at(-1).body.localId,sent[0].body.localId);assert.deepEqual(sent.at(-1).body.attachments,[file]);
});
