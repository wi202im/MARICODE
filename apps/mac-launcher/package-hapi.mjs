import {readFile,lstat,mkdir,copyFile,chmod,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
// Fixed, verified official npm darwin-arm64 artifact and its source commit archive.
export const hapiRelease={version:'0.33.3',arch:'arm64',commit:'d9acc0c31e0d9115e09429fd788a414a522bd5c7',license:'AGPL-3.0-only'};
const hashes={hapi:'e7e2721ac7b41bfea0957e55c22c1f7e537db8385d6e6dfcd71df198f03d4686',LICENSE:'9a32109537554d51dd83792f3e9d6999376e0974d1d309cb1f922acad3946d1c','source.tar.gz':'d23df25a9b63708d4916328ffcf72fb626f8d683ca91b82bca6729cf1d73e9ae'};
export async function packageHapi(source,resources){
 if(process.platform!=='darwin'||process.arch!==hapiRelease.arch)throw Error('HAPI bundle artifact is only verified for Apple Silicon');
 const bunLicense=await readFile(new URL('./Bun-LICENSE.md',import.meta.url));
 if(createHash('sha256').update(bunLicense).digest('hex')!=='362fe32c954ec829240bd7429c53d705eef08c6bfa45ffc2d02005f857cba4dd')throw Error('Bun license digest mismatch');
 for(const [name,expected] of Object.entries(hashes)){
  const p=join(source,name),s=await lstat(p);if(!s.isFile()||s.isSymbolicLink())throw Error('Regular HAPI artifact required');
  if(createHash('sha256').update(await readFile(p)).digest('hex')!==expected)throw Error('HAPI artifact digest mismatch: '+name);
 }
 const dependencyNotices=await readFile(new URL('./HAPI-DEPENDENCY-NOTICES.txt',import.meta.url));
 if(createHash('sha256').update(dependencyNotices).digest('hex')!=='cba47389fc6a7bc9fce2a857d3ff8c518e6ac2d19e649268db78df1cf040d7e8')throw Error('HAPI dependency notice digest mismatch');
 const target=join(resources,'hapi');await mkdir(target);
 await writeFile(join(target,'Bun-LICENSE.md'),bunLicense);
 await writeFile(join(target,'DEPENDENCY-NOTICES.txt'),dependencyNotices);
 for(const name of Object.keys(hashes))await copyFile(join(source,name),join(target,name));
 // Read exact members only, after verifying the complete upstream archive.
 for(const [name,member] of Object.entries({NOTICE:'cli/NOTICE','ripgrep-LICENSE':'cli/tools/licenses/ripgrep-LICENSE','difftastic-LICENSE':'cli/tools/licenses/difftastic-LICENSE','tunwg-LICENSE':'shared/tools/tunwg/LICENSE'})){
  const body=execFileSync('/usr/bin/tar',['-xOf',join(source,'source.tar.gz'),`hapi-${hapiRelease.commit}/${member}`],{maxBuffer:1024*1024});
  await writeFile(join(target,name),body);
 }
 await chmod(join(target,'hapi'),0o755);
 await writeFile(join(target,'release.json'),JSON.stringify({...hapiRelease,hashes},null,2)+'\n');
 await writeFile(join(target,'README.txt'),'HAPI '+hapiRelease.version+' (AGPL-3.0-only)\nUpstream: https://github.com/tiann/hapi\nSource commit: '+hapiRelease.commit+'\nOfficial unmodified binary. License: LICENSE. Source snapshot: source.tar.gz.\nThird-party notices: DEPENDENCY-NOTICES.txt and Bun-LICENSE.md. See the accompanying MARICODE BUILDING.txt for matching runtime source and rebuild instructions.\n');
}

// Build input extraction for the exact pinned, unmodified darwin-arm64 HAPI.
// No binary is executed and no file is written by this helper.
export function extractBundledTunwg(hapi){
 if(createHash('sha256').update(hapi).digest('hex')!==hashes.hapi)throw Error('HAPI artifact digest mismatch');
 const tool=hapi.subarray(132422690,132422690+10921970);
 if(createHash('sha256').update(tool).digest('hex')!=='4ff96e3ff7271a1bb940c8e7e071900d2135b483baab387d4f8ba8dc2ddd333a')throw Error('Embedded tunwg digest mismatch');
 return Buffer.from(tool);
}
