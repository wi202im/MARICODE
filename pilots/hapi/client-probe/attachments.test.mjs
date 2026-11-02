import test from 'node:test';import assert from 'node:assert/strict';
import {selectedFiles,validateFiles,uploadPayload,attachmentMetadata} from './attachments.mjs';
import {formatSize} from './attachments.mjs';
test('paste and drop consume only real files, never clipboard HTML or local path text',()=>{
 const file=new File(['hi'],'note.txt',{type:'text/plain'});
 assert.deepEqual(selectedFiles({items:[{kind:'string',getAsFile:()=>null},{kind:'file',getAsFile:()=>file}]}),[file]);
 assert.deepEqual(selectedFiles({items:[{kind:'string'}]}),[]);assert.deepEqual(selectedFiles({files:[file]}),[file]);
 assert.throws(()=>validateFiles([new File([new Uint8Array(5*1024*1024+1)],'large.bin')]));
 assert.throws(()=>validateFiles(Array(6).fill(file)));assert.throws(()=>validateFiles([new File([],'empty')]));
});
test('upload validation binds a bounded binary payload; no caller-selected filesystem path',()=>{
 const p={requestId:'10000000-0000-4000-8000-000000000001',filename:'hello.txt',mimeType:'text/plain',content:'aGk='};
 assert.equal(uploadPayload(p).content,'aGk=');assert.throws(()=>uploadPayload({...p,path:'/private'}));assert.throws(()=>uploadPayload({...p,content:'not base64!'}));
 assert.deepEqual(attachmentMetadata({id:p.requestId,name:'hello.txt',type:'text/plain',size:2},{success:true,path:'/owned/upload'}),{id:p.requestId,filename:'hello.txt',mimeType:'text/plain',size:2,path:'/owned/upload'});
 assert.throws(()=>attachmentMetadata({},{success:false}));
});
test('attachment sizes read naturally from bytes to megabytes',()=>{assert.equal(formatSize(18),'18 B');assert.equal(formatSize(1500),'2 KB');assert.equal(formatSize(5*1024*1024),'5.0 MB');});
