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
test('sent image previews accept only bounded raster data URLs for image attachments',async()=>{
 const {sentPreview}=await import('./attachments.mjs');
 const ok='data:image/jpeg;base64,/9j/4AAQ';
 assert.equal(sentPreview({mimeType:'image/png',previewUrl:ok}),ok);
 assert.equal(sentPreview({mimeType:'image/png',previewUrl:'data:image/webp;base64,UklGR'}),'data:image/webp;base64,UklGR');
 for(const previewUrl of ['data:image/svg+xml;base64,PHN2Zz4=','/api/uploads/x/preview','https://example.com/a.png','javascript:alert(1)','data:image/png;base64,not base64!','data:text/html;base64,PGI+',`data:image/png;base64,${'A'.repeat(8*1024*1024)}`,null,7])
  assert.equal(sentPreview({mimeType:'image/png',previewUrl}),null,String(previewUrl).slice(0,40));
 assert.equal(sentPreview({mimeType:'application/pdf',previewUrl:ok}),null);
 assert.equal(sentPreview(null),null);
});
test('previews are dropped as a whole when the message body would exceed the server limit',async()=>{
 const {fitPreviews,messageBodyLimit}=await import('./attachments.mjs');
 const a=[{id:'1',filename:'a.png',mimeType:'image/png',size:3,path:'/p/a',previewUrl:'data:image/jpeg;base64,'+'A'.repeat(8000)},{id:'2',filename:'b.txt',mimeType:'text/plain',size:3,path:'/p/b'}];
 assert.deepEqual(fitPreviews('짧은 질문',a),a);
 const long='가'.repeat(messageBodyLimit/3);const fitted=fitPreviews(long,a);
 assert.equal(fitted.some(x=>'previewUrl' in x),false);assert.equal(fitted[0].path,'/p/a');assert.equal(a[0].previewUrl.length>0,true);
 assert.deepEqual(fitPreviews('q',[]),[]);
 assert.equal(fitPreviews(long,a)[0].id,fitPreviews(long,a)[0].id);
});
test('attachment sizes read naturally from bytes to megabytes',()=>{assert.equal(formatSize(18),'18 B');assert.equal(formatSize(1500),'2 KB');assert.equal(formatSize(5*1024*1024),'5.0 MB');});
