import {readFile,writeFile,copyFile,unlink,lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hapiRelease,hapiHashes} from './package-hapi.mjs';

const execute=(file,args)=>execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function signingOptions({identity,profile}={}){
 if(identity===undefined&&profile===undefined)return null;
 if(!/^[a-fA-F0-9]{40}$/.test(identity??'')||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(profile??''))throw Error('Developer ID requires an explicit SHA-1 identity and keychain profile');
 return {identity,profile};
}

export async function notarizeArtifact(artifact,profile,receipt,run=execute){
 // Reserve before submitting. Unknown reception must be reconciled via notarytool
 // history/info, never by automatically submitting the artifact again.
 const lock=await open(receipt,'wx',0o600);await lock.writeFile(JSON.stringify({state:'submitting'}));await lock.close();
 const submission=JSON.parse(run('/usr/bin/xcrun',['notarytool','submit',artifact,'--keychain-profile',profile,'--output-format','json','--no-wait']));
 if(!/^[a-fA-F0-9-]{36}$/.test(submission.id??''))throw Error('Notarization reception unknown; inspect history before retry');
 await writeFile(receipt,JSON.stringify({state:'submitted',id:submission.id})+'\n');
 const result=JSON.parse(run('/usr/bin/xcrun',['notarytool','wait',submission.id,'--keychain-profile',profile,'--output-format','json','--timeout','20m']));
 await writeFile(receipt,JSON.stringify({state:result.status,id:submission.id})+'\n');
 if(result.status!=='Accepted')throw Error('Notarization not accepted: '+String(result.status));
 return submission.id;
}

// Only called on the packager's new, private stage copy; never on an installed app.
export async function signAndNotarizeApp(app,output,options,run=execute){
 const {identity,profile}=signingOptions(options);
 const available=run('/usr/bin/security',['find-identity','-v','-p','codesigning']);
 if(!available.split('\n').some(line=>line.toLowerCase().includes(identity.toLowerCase())&&line.includes('"Developer ID Application:')))throw Error('Selected Developer ID Application identity unavailable');
 const hapi=join(app,'Contents/Resources/hapi');
 for(const [name,expected] of Object.entries(hapiHashes)){
  const path=join(hapi,name);if(!(await lstat(path)).isFile()||digest(await readFile(path))!==expected)throw Error('Original HAPI artifact mismatch: '+name);
 }
 // Upstream's source archive contains development binaries. Preserve its exact
 // bytes as a separate release asset, outside the executable DMG/app payload.
 const sourceName=`HAPI-${hapiRelease.version}-source.tar.gz`;
 await copyFile(join(hapi,'source.tar.gz'),join(output,sourceName),constants.COPYFILE_EXCL);
 await writeFile(join(output,sourceName+'.sha256'),hapiHashes['source.tar.gz']+'  '+sourceName+'\n',{flag:'wx'});
 await unlink(join(hapi,'source.tar.gz'));
 await writeFile(join(hapi,'README.txt'),`HAPI ${hapiRelease.version} (AGPL-3.0-only)\nUpstream: https://github.com/tiann/hapi\nSource commit: ${hapiRelease.commit}\nExact original source: ${sourceName}, provided alongside this release with its checksum.\nThe official executable is re-signed with Developer ID. Original build input hashes remain in release.json; codeSignedBinarySha256 records the signed executable.\nLicense: LICENSE. Notices: DEPENDENCY-NOTICES.txt and Bun-LICENSE.md. See the release BUILDING.txt for rebuild instructions.\n`);
 const entitlements=join(output,'jit-entitlements.plist');
 await writeFile(entitlements,'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>',{flag:'wx'});
 for(const binary of [join(app,'Contents/Resources/node'),join(hapi,'hapi')])run('/usr/bin/codesign',['--force','--sign',identity,'--timestamp','--options','runtime','--entitlements',entitlements,binary]);
 const release=JSON.parse(await readFile(join(hapi,'release.json'),'utf8'));
 await writeFile(join(hapi,'release.json'),JSON.stringify({...release,codeSignedBinarySha256:digest(await readFile(join(hapi,'hapi')))},null,2)+'\n');
 run('/usr/bin/codesign',['--force','--sign',identity,'--timestamp','--options','runtime',app]);
 run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 const archive=join(output,'app-notary.zip');
 run('/usr/bin/ditto',['-c','-k','--keepParent',app,archive]);
 await notarizeArtifact(archive,profile,join(output,'app-notary-submission.json'),run);
 run('/usr/bin/xcrun',['stapler','staple',app]);
 run('/usr/bin/xcrun',['stapler','validate',app]);
 run('/usr/sbin/spctl',['--assess','--type','execute',app]);
 await unlink(archive);await unlink(entitlements);
}

export async function signAndNotarizeDmg(image,output,options,run=execute){
 const {identity,profile}=signingOptions(options);
 run('/usr/bin/codesign',['--sign',identity,'--timestamp',image]);
 await notarizeArtifact(image,profile,join(output,'dmg-notary-submission.json'),run);
 run('/usr/bin/xcrun',['stapler','staple',image]);
 run('/usr/bin/xcrun',['stapler','validate',image]);
 run('/usr/bin/codesign',['--verify','--strict',image]);
 run('/usr/sbin/spctl',['--assess','--type','open','--context','context:primary-signature',image]);
}
