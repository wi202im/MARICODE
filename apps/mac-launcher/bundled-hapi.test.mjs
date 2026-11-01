import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveHapiBinary,bundledHapiSelection} from './bundled-hapi.mjs';
test('bundled selection follows the current bundle location; external configuration stays explicit',()=>{
 for(const name of ['first','moved'])assert.equal(resolveHapiBinary(bundledHapiSelection,`file:///tmp/${name}/Marico.app/Contents/Resources/source/apps/mac-launcher/runtime.mjs`),`/tmp/${name}/Marico.app/Contents/Resources/hapi/hapi`);
 assert.equal(resolveHapiBinary('/explicit/hapi'),'/explicit/hapi');
 assert.throws(()=>resolveHapiBinary('bundled:other'));assert.throws(()=>resolveHapiBinary('../hapi'));
});

test('packaging rejects changed artifacts before creating the embedded runtime',async t=>{
 const {mkdtemp,writeFile,rm,access}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {packageHapi}=await import('./package-hapi.mjs');
 const root=await mkdtemp(join(tmpdir(),'marico-package-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'hapi'),'changed artifact');
 await assert.rejects(packageHapi(root,join(root,'resources')));
 await assert.rejects(access(join(root,'resources/hapi')));
});

test('tunwg build input extraction rejects an unverified parent executable',async()=>{
 const {extractBundledTunwg}=await import('./package-hapi.mjs');
 assert.throws(()=>extractBundledTunwg(Buffer.from('unverified executable')),/HAPI artifact digest mismatch/);
});
