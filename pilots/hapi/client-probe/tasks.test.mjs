import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTasks} from './tasks.mjs';
const requestId='33333333-3333-3333-3333-333333333333';
const child={id:'44444444-4444-4444-4444-444444444444',metadata:{machineId:'m',path:'/trial',flavor:'codex'}};
test('independent task has no parent, locks agent, and survives duplicate creation and restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tasks-'));let count=0;
 try{
 const config={directory,machineId:'m',project:'/trial'},t=createTasks(config);
 const result=await t.create({requestId,agent:'codex'},async agent=>{assert.equal(agent,'codex');count++;return child.id;},async()=>child);
 assert.equal(result.parentId,undefined);assert.equal(result.requestId,requestId);
 assert.equal((await createTasks(config).create({requestId,agent:'codex'},()=>{count++;})).id,child.id);
 await assert.rejects(t.create({requestId,agent:'claude'},()=>{count++;}));
 assert.equal(count,1);assert.equal((await t.list())[0].parentId,undefined);
 await assert.rejects(createTasks({...config,project:'/other'}).create({requestId,agent:'codex'},()=>{count++;}));
 assert.equal(count,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('unknown task creation cannot replay; known result can recover without spawning',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tasks-'));let count=0;
 try{
 const t=createTasks({directory,machineId:'m',project:'/trial'}),request={requestId,agent:'codex'};
 await assert.rejects(t.create(request,async()=>{count++;return child.id;},async()=>{throw Error('lost readback');}));
 assert.equal((await t.check(request,async()=>child)).id,child.id);
 assert.equal(count,1);
 const unknown={...request,requestId:'77777777-7777-7777-7777-777777777777'};
 await assert.rejects(t.create(unknown,async()=>{count++;throw Error('lost spawn');}));
 await assert.rejects(t.create(unknown,async()=>{count++;}));
 assert.equal((await t.check(unknown,async()=>{throw Error('must not guess');})).state,'pending');
 assert.equal(count,2);
 await assert.rejects(t.create({...request,requestId:'bad'},()=>{}));
 await assert.rejects(t.create({...request,agent:'other'},()=>{}));
 }finally{await rm(directory,{recursive:true,force:true});}
});
