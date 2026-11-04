import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import {mkdtemp,writeFile,rm,realpath,unlink,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createFileLinks} from './file-stream.mjs';
import {fileKind,highlightLanguage,mediaType} from './file-kinds.mjs';

async function serve(t,links){
 const server=http.createServer((req,res)=>links.serve(req,res,req.url.split('/').pop()));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 return (path,headers={},method='GET')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers,method});
}
test('a media link streams one file with byte ranges and expires',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'stream-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'clip.mp4');await writeFile(file,'0123456789');let clock=0;
 const links=createFileLinks({ttl:1000,now:()=>clock}),get=await serve(t,links),url=await links.issue(file);
 assert.match(url,/^\/file-raw\/[0-9a-f]{64}$/);
 let r=await get(url);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'video/mp4');assert.equal(await r.text(),'0123456789');assert.match(r.headers.get('content-security-policy'),/sandbox/);
 r=await get(url,{range:'bytes=2-4'});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 2-4/10');assert.equal(await r.text(),'234');
 r=await get(url,{range:'bytes=-3'});assert.equal(await r.text(),'789');
 r=await get(url,{range:'bytes=20-'});assert.equal(r.status,416);await r.text();
 r=await get(url,{},'POST');assert.equal(r.status,405);await r.text();
 assert.equal((await get('/file-raw/'+'0'.repeat(64))).status,404);
 clock=2000;assert.equal((await get(url)).status,404);
});
test('only media files get links, and a file swapped for a link stops streaming',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'stream-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'a.svg'),'<svg/>');await writeFile(join(dir,'a.pdf'),'%PDF');await writeFile(join(dir,'secret.png'),'x');
 const links=createFileLinks(),get=await serve(t,links);
 await assert.rejects(links.issue(join(dir,'a.svg')),/Not a media file/);
 const pdf=await get(await links.issue(join(dir,'a.pdf')));assert.doesNotMatch(pdf.headers.get('content-security-policy'),/sandbox/);await pdf.text();
 const file=join(dir,'b.png');await writeFile(file,'x');const url=await links.issue(file);
 await unlink(file);await symlink(join(dir,'secret.png'),file);assert.equal((await get(url)).status,404);
});
test('file kinds and highlight languages come from the name',()=>{
 assert.deepEqual(['a.MP4','b.png','c.pdf','d.md','e.svg','f.mjs','g'].map(fileKind),['video','image','pdf','markdown','text','text','text']);
 assert.equal(mediaType('x.html'),null);
 assert.deepEqual(['a.mjs','Dockerfile','b.swift','c.unknownext','README'].map(highlightLanguage),['javascript','dockerfile','swift','unknownext','plaintext']);
});
