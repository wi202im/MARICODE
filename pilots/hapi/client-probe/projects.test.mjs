import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectChoices,selectProject} from './projects.mjs';
test('only root and immediate internal directories can be selected',async()=>{
 const d=await mkdtemp(join(tmpdir(),'projects-')),root=join(d,'root');
 try{
 await mkdir(join(root,'app'),{recursive:true});await mkdir(join(root,'.private'));await mkdir(join(d,'outside'));await symlink('../outside',join(root,'external'));await symlink('app',join(root,'alias'));
 const choices=await projectChoices(root);assert.deepEqual(choices.map(c=>c.key).sort(),['','alias','app']);
 assert.equal(await selectProject(root,'app'),await realpath(join(root,'app')));
 assert.equal(await selectProject(root,'alias'),await realpath(join(root,'app')));
 for(const key of ['../outside','external','.private','app/nested','/tmp'])await assert.rejects(selectProject(root,key));
 }finally{await rm(d,{recursive:true,force:true});}
});
