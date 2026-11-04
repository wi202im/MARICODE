import test from 'node:test';import assert from 'node:assert/strict';
import {mentionQuery,insertMention,createFileMentions} from './file-mentions.mjs';

test('an @ word before the caret is a mention query; e-mail-like text is not',()=>{
 assert.deepEqual(mentionQuery('이 파일 @src/ap'),{term:'src/ap',start:5});
 assert.deepEqual(mentionQuery('@'),{term:'',start:0});
 assert.equal(mentionQuery('mail a@b.c'),null);assert.equal(mentionQuery('@a b'),null);
 assert.deepEqual(insertMention('보기 @ap 다음',6,{term:'ap',start:3},'src/app.mjs'),{text:'보기 @src/app.mjs 다음',caret:15});
 assert.deepEqual(insertMention('@ap',3,{term:'ap',start:0},'src/app.mjs'),{text:'@src/app.mjs ',caret:13});
});
function fake(){
 const handlers={},nodes=[];const doc={createElement:tag=>{const n={tag,children:[],attrs:{},append(...c){this.children.push(...c);},setAttribute(k,v){this.attrs[k]=v;}};nodes.push(n);return n;}};
 const input={value:'',selectionStart:0,ownerDocument:doc,attrs:{},addEventListener:(t,f)=>{(handlers[t]??=[]).push(f);},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(){},dispatchEvent(e){for(const f of handlers[e.type]??[])f(e);},focus(){},setSelectionRange(a){this.selectionStart=a;}};
 const list={hidden:true,dataset:{},children:[],replaceChildren(...c){this.children=c;}};
 return {input,list,handlers,type(text){input.value=text;input.selectionStart=text.length;input.dispatchEvent({type:'input'});},key(key){const e={key,preventDefault(){this.prevented=true;},stopPropagation(){}};for(const f of handlers.keydown)f(e);return e;}};
}
test('typing @term searches the session files; Enter inserts the chosen path instead of sending',async()=>{
 const f=fake(),terms=[];
 createFileMentions({input:f.input,list:f.list,delay:0,search:async term=>{terms.push(term);return [{fileName:'app.mjs',filePath:'src',fullPath:'src/app.mjs'},{fileName:'api.mjs',filePath:'src',fullPath:'src/api.mjs'}];}});
 f.type('여기 @ap');await new Promise(r=>setTimeout(r,5));
 assert.deepEqual(terms,['ap']);assert.equal(f.list.hidden,false);assert.equal(f.list.children.length,2);
 f.key('ArrowDown');const e=f.key('Enter');assert.equal(e.prevented,true);
 assert.equal(f.input.value,'여기 @src/api.mjs ');assert.equal(f.list.hidden,true);
 f.type('끝');await new Promise(r=>setTimeout(r,5));assert.equal(f.list.hidden,true);assert.equal(f.key('Enter').prevented,undefined);
});
