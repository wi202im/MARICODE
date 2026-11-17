import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupVoiceInput} from './voice-input.mjs';

function ui({native=true,supported=true,secure=true}={}){
 class Element extends EventTarget{
  constructor(){super();this.children=[];this.hidden=false;this.value='기존 초안';this.attributes={};}
  setAttribute(k,v){this.attributes[k]=v;}append(...items){this.children.push(...items);}
  before(item){this.status=item;}insertBefore(item){this.children.push(item);}focus(){this.focused=true;}
 }
 const doc=new Element();doc.createElement=()=>new Element();
 const win=new Element(),form=new Element(),prompt=new Element(),footer=new Element();
 form.querySelector=s=>s==='#send'?null:footer;
 let session='one',counter=0;const calls=[],recognizers=[];
 win.isSecureContext=secure;win.confirm=()=>true;win.crypto={randomUUID:()=>String(++counter)};
 if(native)win.webkit={messageHandlers:{maricode:{postMessage:m=>calls.push(m)}}};
 else if(supported)win.SpeechRecognition=class{constructor(){recognizers.push(this);}start(){calls.push('start');this.onstart?.();}stop(){calls.push('stop');this.onend?.();}abort(){calls.push('abort');}};
 const voice=setupVoiceInput({form,prompt,context:()=>session,changed(){},window:win,document:doc});
 const event=(id,type,text)=>win.maricodeVoiceEvent({id,type,text,message:type==='error'?'권한 거부':undefined});
 return {voice,form,prompt,doc,win,calls,recognizers,event,click:()=>footer.children[0].onclick(),session:s=>{session=s;}};
}

test('native events are isolated by attempt; submit is blocked until dictation finishes',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=ui();f.click();f.event('1','ready');f.event('1','result','받아쓴 문장');
 let submissions=0;f.form.addEventListener('submit',()=>submissions++);
 const submit=new Event('submit',{cancelable:true});f.form.dispatchEvent(submit);assert.equal(submit.defaultPrevented,true);assert.equal(submissions,0);assert.equal(f.prompt.readOnly,true);
 f.click();f.event('1','end');assert.equal(f.prompt.value,'기존 초안\n받아쓴 문장');assert.equal(f.prompt.readOnly,false);
 f.event('1','end');assert.equal(f.prompt.value,'기존 초안\n받아쓴 문장');
 f.click();f.event('1','error');assert.equal(f.voice.active,true);f.event('2','error');assert.equal(f.voice.active,false);assert.equal(f.prompt.readOnly,false);
 assert.equal(submissions,0);f.form.dispatchEvent(new Event('submit'));assert.equal(submissions,1);
});

test('background, page exit and session change discard recognition without auto restart',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=ui();f.click();f.event('1','result','버릴 문장');f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));
 assert.equal(f.voice.active,false);assert.equal(f.prompt.readOnly,false);assert.ok(f.calls.includes('voice-cancel:1'));
 f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.calls.filter(x=>x.startsWith('voice-start')).length,1);
 f.click();f.win.dispatchEvent(new Event('pagehide'));f.event('2','result','늦은 결과');f.event('2','end');assert.equal(f.prompt.value,'기존 초안');
 f.click();f.event('3','result','다른 대화에 넣으면 안 됨');f.session('two');f.click();f.event('3','end');assert.equal(f.prompt.value,'기존 초안');
});

test('60 second limit is fixed despite interim results and missing native callbacks unlock the input',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=ui();f.click();t.mock.timers.tick(59000);f.event('1','result','중간 결과');t.mock.timers.tick(1000);
 assert.equal(f.calls.filter(x=>x==='voice-stop:1').length,1);assert.equal(f.voice.active,true);
 t.mock.timers.tick(3000);assert.equal(f.voice.active,false);assert.equal(f.prompt.readOnly,false);assert.equal(f.prompt.value,'기존 초안');assert.ok(f.calls.includes('voice-cancel:1'));
 f.click();f.event('1','end');assert.equal(f.voice.active,true);f.voice.cancel();
});

test('unsupported or insecure browsers and missing sessions never start capture',()=>{
 for(const options of [{native:false,supported:false},{native:false,secure:false}]){
  const f=ui(options);f.click();assert.equal(f.voice.active,false);assert.deepEqual(f.calls,[]);assert.equal(f.form.status.children.find(x=>x.id==='voice-keyboard').hidden,false);
 }
 const f=ui();f.session('');f.click();assert.deepEqual(f.calls,[]);
});

test('browser permission, network and no-speech errors keep the draft; retry can finish normally',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=ui({native:false});
 for(const error of ['not-allowed','audio-capture','network','no-speech','service-not-allowed','language-not-supported','aborted','unknown']){
  f.click();f.recognizers.at(-1).onerror({error});assert.equal(f.voice.active,false,error);assert.equal(f.prompt.readOnly,false,error);assert.equal(f.prompt.value,'기존 초안',error);
 }
 f.click();f.recognizers.at(-1).onresult({results:[[{transcript:'복구 후 입력'}]]});f.click();assert.equal(f.prompt.value,'기존 초안\n복구 후 입력');
});
