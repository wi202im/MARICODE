import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttachmentComposer} from './attachment-composer.mjs';
// Small DOM double: assert observable controls and identity across server refreshes.
class Element {
 children=[];attributes={};listeners={};
 append(...nodes){this.children.push(...nodes);}
 prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,v){this.listeners[k]=v;}
 querySelector(){return this.footer;}
}
test('duplicate attachment controls stay distinct and survive unrelated refreshes',t=>{
 const prior=globalThis.document;globalThis.document={createElement:()=>new Element(),createElementNS:()=>new Element()};t.after(()=>{globalThis.document=prior;});
 const form=new Element();form.footer=new Element();let context={id:'session-a',active:true,connected:true,busy:false,pending:null},composer;
 composer=createAttachmentComposer({form,prompt:{},context:()=>context,upload:()=>assert.fail('draft must not upload'),changed:()=>composer.render(),notice:()=>{}});
 const file=new File(['trial'],'same.txt',{type:'text/plain'});
 form.listeners.paste({clipboardData:{files:[file,file]},preventDefault(){}});
 const list=form.children[0],first=list.children[1].children.at(-1),second=list.children[2].children.at(-1);
 assert.notEqual(first.attributes['aria-label'],second.attributes['aria-label']);
 assert.notEqual(first.id,second.id);
 composer.render();assert.equal(list.children[1].children.at(-1),first);assert.equal(list.children[2].children.at(-1),second);
 second.onclick();assert.equal(composer.count,1);assert.equal(list.children[1].children.at(-1).id,first.id);
 const oldControl=list.children[1].children.at(-1);context={...context,id:'session-b'};composer.render();oldControl.onclick();assert.equal(composer.count,0);
 context={...context,id:'session-a'};composer.render();assert.equal(composer.count,1);
});
