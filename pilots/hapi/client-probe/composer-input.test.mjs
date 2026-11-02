import test from 'node:test';
import assert from 'node:assert/strict';
import {bindComposerEnter} from './composer-input.mjs';
function fixture(){const input=new EventTarget();input.value='hello';const button={disabled:false},form={requestSubmit(b){assert.equal(b,button);this.sent=(this.sent??0)+1;}};let time=1000;bindComposerEnter({input,form,button,now:()=>time});
 return {input,button,form,advance(){time+=1000;},key(props={}){const e=new Event('keydown',{cancelable:true});Object.assign(e,{key:'Enter',...props});input.dispatchEvent(e);return e;}};}
test('Enter uses the existing form once; Shift+Enter stays a newline and blocked send never submits',()=>{
 const f=fixture();assert.equal(f.key().defaultPrevented,true);assert.equal(f.form.sent,1);
 for(const props of [{shiftKey:true},{altKey:true},{key:'a'},{repeat:true}])f.key(props);assert.equal(f.form.sent,1);
 f.button.disabled=true;f.key();assert.equal(f.form.sent,1);f.button.disabled=false;f.input.value='  ';f.key();assert.equal(f.form.sent,1);
});
test('IME confirmation does not send on either WebKit composition ordering',()=>{
 const f=fixture();f.input.dispatchEvent(new Event('compositionstart'));f.key();f.key({isComposing:true});f.input.dispatchEvent(new Event('compositionend'));f.key();assert.equal(f.form.sent,undefined);
 f.advance();f.key({keyCode:229});assert.equal(f.form.sent,undefined);f.key();assert.equal(f.form.sent,1);
});
