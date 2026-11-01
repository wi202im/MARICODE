import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,access,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {packageProductSource} from './source-package.mjs';
test('source packaging rejects an incomplete native source tree before creating an archive',async t=>{
 const root=await mkdtemp(join(tmpdir(),'maricode-source-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'output'));
 await assert.rejects(packageProductSource(root,join(root,'output')));
 await assert.rejects(access(join(root,'output','MARICODE-1.0.0-source.tar.gz')));
});

test('source packaging rejects hidden data and symlinks',async t=>{
 const {writeFile,symlink,unlink}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'maricode-source-boundary-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const native=join(root,'source/apps/mac-launcher');await mkdir(native,{recursive:true});await mkdir(join(root,'source/pilots/hapi/client-probe'),{recursive:true});await mkdir(join(root,'output'));
 for(const name of ['Merry.swift','DesktopNavigation.swift','DataLocation.swift','AgentDiscovery.swift','RemoteConnection.swift','build.mjs','dmg.mjs','source-package.mjs','package-hapi.mjs','LICENSE','BUILDING.txt','Bun-LICENSE.md','HAPI-DEPENDENCY-NOTICES.txt'])await writeFile(join(native,name),'fixture');
 const hidden=join(native,'.private');await writeFile(hidden,'fixture-secret');
 await assert.rejects(packageProductSource(root,join(root,'output')),/Unexpected source entry/);
 await unlink(hidden);await symlink('/tmp',join(native,'linked'));
 await assert.rejects(packageProductSource(root,join(root,'output')),/Unexpected source entry/);
 await assert.rejects(access(join(root,'output','MARICODE-1.0.0-source.tar.gz')));
});

test('upstream source packaging rejects wrong content before creating output',async()=>{
 const {packageUpstreamSources,UPSTREAM_SOURCES}=await import('./source-package.mjs');
 const root=await mkdtemp(join(tmpdir(),'maricode-upstream-'));
 try{
  const input=join(root,'input'),output=join(root,'output');
  await mkdir(input);await mkdir(output);
  for(const item of UPSTREAM_SOURCES)await writeFile(join(input,item.name),'incorrect source');
  await assert.rejects(packageUpstreamSources(input,output),/source checksum mismatch/);
  assert.deepEqual(await readdir(output),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
