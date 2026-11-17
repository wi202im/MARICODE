import {test} from 'node:test';import assert from 'node:assert/strict';
import {createVoiceDraft,browserVoiceAdapter,setupVoiceInput} from './voice-input.mjs';
function fixture(){let session='one',value='기존 입력',events=[],writes=0,aborts=0;const callbacks=[];const voice=createVoiceDraft({context:()=>session,read:()=>value,write:v=>{value=v;writes++;},state:s=>events.push(s),adapter:emit=>{callbacks.push(emit);return {start(){},stop(){emit({type:'end'});},abort(){aborts++;}}}});return {voice,callbacks,events,get value(){return value;},get writes(){return writes;},get aborts(){return aborts;},switch(){session='two';},edit(){value='수동 수정';}};}
test('dictation previews cumulative text and appends once only on end; no submission API exists',()=>{const f=fixture();f.voice.start();f.voice.start();assert.equal(f.callbacks.length,1);f.callbacks[0]({type:'result',text:'안녕'});f.callbacks[0]({type:'result',text:'안녕하세요'});assert.equal(f.value,'기존 입력');f.voice.stop();assert.equal(f.value,'기존 입력\n안녕하세요');assert.equal(f.writes,1);f.callbacks[0]({type:'end'});assert.equal(f.writes,1);});
test('cancel and session changes discard late results without touching another draft',()=>{const f=fixture();f.voice.start();f.callbacks[0]({type:'result',text:'다른 대화'});f.switch();f.voice.stop();assert.equal(f.writes,0);f.voice.start();f.voice.cancel();f.callbacks[1]({type:'result',text:'늦은 결과'});f.callbacks[1]({type:'end'});assert.equal(f.writes,0);assert.ok(f.aborts>0);});
test('permission/network errors and manual edits preserve the existing draft',()=>{const f=fixture();f.voice.start();f.callbacks[0]({type:'error',message:'마이크 권한이 필요합니다.'});assert.equal(f.voice.active,false);assert.equal(f.writes,0);f.voice.start();f.callbacks[1]({type:'result',text:'음성'});f.edit();f.voice.stop();assert.equal(f.value,'수동 수정');assert.equal(f.writes,0);});
test('repeated finish clicks stop capture once while awaiting final recognition',()=>{let stops=0,emit;const voice=createVoiceDraft({context:()=> 'one',read:()=>'',write(){},state(){},adapter:cb=>{emit=cb;return {start(){},stop(){stops++;},abort(){}}}});voice.start();voice.stop();voice.stop();assert.equal(stops,1);assert.equal(voice.active,true);emit({type:'end'});assert.equal(voice.active,false);});

test('browser finish timeout preserves recognized text even when abort emits an error synchronously',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let recognition;const events=[];
 class Recognition{constructor(){recognition=this;}start(){}stop(){}abort(){this.onerror?.({error:'aborted'});this.onend?.();}}
 const adapter=browserVoiceAdapter(Recognition,e=>events.push(e));adapter.start();recognition.onresult({results:[[{transcript:'남겨야 할 문장'}]]});adapter.stop();t.mock.timers.tick(2000);
 assert.deepEqual(events.map(e=>e.type),['result','end']);
});
test('browser aborted while finishing is normal completion; unexpected abort explains the cause',()=>{
 let recognition;const events=[];class Recognition{constructor(){recognition=this;}start(){}stop(){this.onerror?.({error:'aborted'});}abort(){}}
 const adapter=browserVoiceAdapter(Recognition,e=>events.push(e));adapter.start();adapter.stop();assert.deepEqual(events.map(e=>e.type),['end']);
 const other=[];browserVoiceAdapter(Recognition,e=>other.push(e)).start();recognition.onerror({error:'aborted'});assert.equal(other[0].type,'error');assert.match(other[0].message,/aborted/);
});

test('failed browser recognition offers keyboard dictation without losing the draft or restarting capture',()=>{
 class Element extends EventTarget{constructor(){super();this.children=[];this.hidden=false;this.value='기존 초안';}setAttribute(){}append(...items){this.children.push(...items);}before(item){this.status=item;}insertBefore(item){this.children.push(item);}focus(){this.focused=true;}}
 const doc=new Element();doc.createElement=()=>new Element();const form=new Element(),prompt=new Element(),footer=new Element();form.querySelector=selector=>selector==='#send'?null:footer;
 let recognition,starts=0;class Recognition{constructor(){recognition=this;}start(){starts++;this.onerror({error:'aborted'});}abort(){}}
 const win=new Element();win.SpeechRecognition=Recognition;win.isSecureContext=true;win.confirm=()=>true;
 setupVoiceInput({form,prompt,context:()=> 'session',changed(){},window:win,document:doc});
 footer.children[0].onclick();const keyboard=form.status.children.find(x=>x.id==='voice-keyboard');assert.ok(keyboard);assert.equal(keyboard.hidden,false);keyboard.onclick();assert.equal(prompt.focused,true);assert.equal(prompt.readOnly,false);assert.equal(prompt.value,'기존 초안');assert.equal(starts,1);
});
