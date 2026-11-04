import {createReadStream,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {lstat,readdir,open,copyFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

export async function packageProductSource(resources,output,version='1.0.0'){
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid product version');
 const source=join(resources,'source');
 for(const name of ['Merry.swift','DesktopNavigation.swift','DataLocation.swift','AgentDiscovery.swift','RemoteConnection.swift','build.mjs','dmg.mjs','signing.mjs','INSTALL-SIGNED.html','source-package.mjs','package-hapi.mjs','LICENSE','BUILDING.txt','Bun-LICENSE.md','HAPI-DEPENDENCY-NOTICES.txt']){
  if(!(await lstat(join(source,'apps/mac-launcher',name))).isFile())throw Error('Complete product source required');
 }
 async function inspect(path){
  for(const item of await readdir(path,{withFileTypes:true})){
   if(item.isSymbolicLink()||item.name.startsWith('.')||item.name==='node_modules')throw Error('Unexpected source entry');
   if(item.isDirectory())await inspect(join(path,item.name));
   else if(!item.isFile()||(!/\.(mjs|js|swift|html|css|png|svg|ttf|webmanifest|md|txt)$/.test(item.name)&&item.name!=='LICENSE'))throw Error('Unexpected source file');
  }
 }
 const roots=['apps/mac-launcher','pilots/hapi/client-probe'];for(const path of roots)await inspect(join(source,path));
 const name=`MARICODE-${version}-source.tar.gz`,archive=join(output,name);
 // Exclusive reservation prevents replacing an existing release artifact.
 const file=await open(archive,'wx');await file.close();
 execFileSync('/usr/bin/tar',['-czf',archive,'-C',source,...roots],{env:{PATH:'/usr/bin:/bin',COPYFILE_DISABLE:'1'},stdio:'pipe'});
 await copyFile(join(source,'apps/mac-launcher/BUILDING.txt'),join(output,'BUILDING.txt'));
 return name;
}

// Exact artifacts acquired from the upstream commits documented in BUILDING.txt.
export const UPSTREAM_SOURCES=Object.freeze([
 Object.freeze({name:'bun-38afee6c84fcf48c0edb2466aa4b27d287a59c30.tar.gz',sha256:'64c0d268a6fa9f5e6e5ac40761dacb6b0825b2092f02cd07d772a9018f39e520'}),
 Object.freeze({name:'webkit-d6375c72affe0f70222cdcb45012b10f0bf3a9d5.tar.gz',sha256:'476755ee93bb645025e53290babb213994b0f9b64c83c7c4d5875b13c8000c59'})
]);
async function verifySource(path,expected){
 if(!(await lstat(path)).isFile())throw Error('Regular upstream source file required');
 const hash=createHash('sha256');
 for await(const chunk of createReadStream(path))hash.update(chunk);
 if(hash.digest('hex')!==expected)throw Error('Upstream source checksum mismatch');
}
export async function packageUpstreamSources(input,output){
 // Validate every input first. Never recurse into the input directory or copy Git data.
 for(const item of UPSTREAM_SOURCES)await verifySource(join(input,item.name),item.sha256);
 const destination=join(output,'upstream-sources');
 await mkdir(destination,{mode:0o700}); // Existing destinations are never overwritten.
 for(const item of UPSTREAM_SOURCES){
  const target=join(destination,item.name);
  await copyFile(join(input,item.name),target,constants.COPYFILE_EXCL);
  await verifySource(target,item.sha256);
 }
 // A failed copy leaves no completion checksum list and may be inspected manually.
 await writeFile(join(destination,'SHA256SUMS'),UPSTREAM_SOURCES.map(x=>`${x.sha256}  ${x.name}\n`).join(''),{flag:'wx'});
 return destination;
}
