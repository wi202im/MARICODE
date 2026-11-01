import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectFilePath} from './files.mjs';
test('file reads allow internal links but reject traversal and external file or folder links',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'file-root-'));
 try{
 const root=join(dir,'project');await mkdir(root);await writeFile(join(root,'a.txt'),'test');await mkdir(join(dir,'outside'));await writeFile(join(dir,'outside','b.txt'),'outside');
 await symlink('a.txt',join(root,'internal'));await symlink('../outside',join(root,'external'));await symlink('../outside/b.txt',join(root,'external-file'));
 assert.equal(await projectFilePath(root,'internal'),'a.txt');assert.equal(await projectFilePath(root,''),'');
 for(const p of ['../outside/b.txt','external/b.txt','external-file','/etc/passwd'])await assert.rejects(projectFilePath(root,p));
 }finally{await rm(dir,{recursive:true,force:true});}
});
