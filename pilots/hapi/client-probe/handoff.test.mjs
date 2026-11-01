import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandoffs} from './handoff.mjs';
const source={id:'11111111-1111-1111-1111-111111111111',active:true,metadata:{machineId:'machine',path:'/trial',flavor:'codex'}};
test('creation is durable, bounded to configured target and never replays an uncertain spawn',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'handoff-'));let calls=0;
 try{
 const options={directory:dir,machineId:'machine',project:'/trial'};
 const h=createHandoffs(options);
 await assert.rejects(h.create({...source,metadata:{...source.metadata,path:'/other'}},async()=>{}));
 await assert.rejects(h.create(source,async()=>{calls++;throw Error('lost response');}));
 await assert.rejects(createHandoffs(options).create(source,async()=>{calls++;}));
 assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('successful creation returns the same child across repeated requests and restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'handoff-'));let calls=0;
 try{
 const options={directory:dir,machineId:'machine',project:'/trial'},h=createHandoffs(options);
 const child={id:'22222222-2222-2222-2222-222222222222',metadata:{machineId:'machine',path:'/trial',flavor:'claude'}};
 const result=await h.create(source,async(agent)=>{calls++;assert.equal(agent,'claude');return child.id;},async()=>child);
 assert.equal(result.parentId,source.id);assert.equal(result.id,child.id);
 assert.deepEqual(await createHandoffs(options).create(source,async()=>{calls++;}),result);assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('known child survives failed readback and recovery only looks up that ID',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'handoff-recover-'));let spawns=0;const child={id:'22222222-2222-2222-2222-222222222222',metadata:{machineId:'machine',path:'/trial',flavor:'claude'}};
 try{
 const options={directory:dir,machineId:'machine',project:'/trial'},h=createHandoffs(options);
 await assert.rejects(h.create(source,async()=>{spawns++;return child.id;},async()=>{throw Error('readback unavailable');}));
 const restarted=createHandoffs(options);
 assert.equal((await restarted.status(source)).state,'verifying');
 await assert.rejects(restarted.check(source,async()=>({...child,metadata:{...child.metadata,path:'/wrong'}})));
 assert.equal((await restarted.status(source)).state,'verifying');
 const recovered=await restarted.check(source,async id=>{assert.equal(id,child.id);return child;});
 assert.equal(recovered.state,'created');assert.equal(recovered.id,child.id);assert.equal(spawns,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unknown creation outcome cannot be guessed or respawned by a status check',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'handoff-unknown-'));let reads=0;
 try{
 const h=createHandoffs({directory:dir,machineId:'machine',project:'/trial'});
 await assert.rejects(h.create(source,async()=>{throw Error('response lost');},async()=>{}));
 const result=await h.check(source,async()=>{reads++;});assert.equal(result.state,'pending');assert.equal(reads,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
