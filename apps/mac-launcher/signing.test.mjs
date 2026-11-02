import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signingOptions,notarizeArtifact} from './signing.mjs';

test('Developer ID mode requires both explicit identity and keychain profile',()=>{
 assert.equal(signingOptions({}),null);
 assert.throws(()=>signingOptions({identity:'-'}));
 assert.throws(()=>signingOptions({profile:'example'}));
 assert.throws(()=>signingOptions({identity:'a'.repeat(40),profile:'--password'}));
 assert.deepEqual(signingOptions({identity:'a'.repeat(40),profile:'example'}),{identity:'a'.repeat(40),profile:'example'});
});

test('notarization rejection preserves receipt and prevents duplicate submission or stapling',async t=>{
 const root=await mkdtemp(join(tmpdir(),'maricode-notary-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const calls=[],receipt=join(root,'submission.json'),id='12345678-1234-1234-1234-123456789012';
 const run=(file,args)=>{calls.push(args);return JSON.stringify(args[1]==='submit'?{id}:{id,status:'Invalid'});};
 await assert.rejects(notarizeArtifact('/test/app.zip','example',receipt,run),/Invalid/);
 assert.equal(JSON.parse(await readFile(receipt,'utf8')).id,id);
 assert.equal(calls.length,2);
 await assert.rejects(notarizeArtifact('/test/app.zip','example',receipt,run),/EEXIST/);
 assert.equal(calls.length,2);
});

test('notarization returns only after Accepted; uncertain submission is not repeated',async t=>{
 const root=await mkdtemp(join(tmpdir(),'maricode-notary-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const id='12345678-1234-1234-1234-123456789012';
 assert.equal(await notarizeArtifact('/test/app.zip','example',join(root,'ok.json'),(file,args)=>JSON.stringify(args[1]==='submit'?{id}:{id,status:'Accepted'})),id);
 const receipt=join(root,'unknown.json');let calls=0;
 const fail=()=>{calls++;throw Error('connection lost');};
 await assert.rejects(notarizeArtifact('/test/app.zip','example',receipt,fail),/connection lost/);
 await assert.rejects(notarizeArtifact('/test/app.zip','example',receipt,fail),/EEXIST/);
 assert.equal(calls,1);
});
