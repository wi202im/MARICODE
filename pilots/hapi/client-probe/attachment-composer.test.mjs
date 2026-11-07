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
test('sending a pasted image keeps a small thumbnail in the sent attachment metadata',async t=>{
 const prior=globalThis.document;globalThis.document={createElement:()=>new Element(),createElementNS:()=>new Element()};t.after(()=>{globalThis.document=prior;});
 const priorUrl=URL.createObjectURL;URL.createObjectURL=()=>'blob:local';t.after(()=>{URL.createObjectURL=priorUrl;});
 const form=new Element();form.footer=new Element();const context={id:'session-a',active:true,connected:true,busy:false,pending:null};let composer;const made=[];
 composer=createAttachmentComposer({form,prompt:{},context:()=>context,upload:async(id,body)=>({success:true,path:'/owned/'+body.filename}),changed:()=>composer.render(),notice:()=>{},
  thumbnail:async file=>{made.push(file.name);if(file.name==='broken.png')throw Error('decode');return 'data:image/jpeg;base64,/9j/thumb';}});
 const image=new File(['png'],'image.png',{type:'image/png'}),broken=new File(['png'],'broken.png',{type:'image/png'}),text=new File(['t'],'note.txt',{type:'text/plain'});
 form.listeners.paste({clipboardData:{files:[image,broken,text]},preventDefault(){}});
 const sent=await composer.prepare();
 assert.deepEqual(made,['image.png','broken.png']);
 assert.equal(sent[0].previewUrl,'data:image/jpeg;base64,/9j/thumb');
 assert.equal('previewUrl' in sent[1],false,'thumbnail failure must not block sending');
 assert.equal('previewUrl' in sent[2],false);
 assert.deepEqual(composer.metadata(),sent,'retry uses the same metadata as the first send');
});
