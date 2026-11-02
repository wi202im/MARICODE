import {PRODUCT_VERSION} from './version.mjs';
import {mkdir,lstat,cp,copyFile,symlink,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {packageProductSource,packageUpstreamSources} from './source-package.mjs';
import {signingOptions,signAndNotarizeApp,signAndNotarizeDmg} from './signing.mjs';

export async function createDmg(app,output,upstreamSources,signing){
 const signed=signingOptions(signing);
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Apple Silicon macOS required');
 app=resolve(app);output=resolve(output);
 for(const name of ['Contents/Info.plist','Contents/MacOS/Merry','Contents/Resources/node','Contents/Resources/hapi/hapi','Contents/Resources/hapi/LICENSE','Contents/Resources/hapi/source.tar.gz']){
  if(!(await lstat(join(app,name))).isFile())throw Error('Complete bundled app required');
 }
 const info=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',join(app,'Contents/Info.plist')],{encoding:'utf8'}));
 if(info.CFBundleName!=='Maricode'||info.CFBundleShortVersionString!==PRODUCT_VERSION||info.MARICODERelease!==true||info.CFBundleIdentifier!=='dev.maricode.desktop')throw Error('Expected matching MARICODE release bundle');
 // A fresh destination is mandatory. Do not overwrite a previous release or source app.
 await mkdir(output,{mode:0o700});
 if(upstreamSources)await packageUpstreamSources(resolve(upstreamSources),output);
 const stage=join(output,'stage');await mkdir(stage);
 const copy=join(stage,'Maricode.app');await cp(app,copy,{recursive:true,errorOnExist:true,force:false});
 // Developer ID is explicit and fail-closed; never fall back to ad-hoc on error.
 if(signed)await signAndNotarizeApp(copy,output,signed);
 else execFileSync('/usr/bin/codesign',['--force','--sign','-',copy],{stdio:'pipe'});
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',copy],{stdio:'pipe'});
 await symlink('/Applications',join(stage,'Applications'));
 await writeFile(join(stage,'READ-ME.txt'),`Maricode ${PRODUCT_VERSION} — installation

Copy Maricode.app to Applications, then eject this disk image.
${signed?'This app has a Developer ID signature and an Apple notarization ticket. The unchanged HAPI source archive is provided alongside this release.':'This build has an ad-hoc signature, not a Developer ID signature or notarization.'}
Keep the matching product/runtime sources, BUILDING.txt, NOTICES.txt and checksums with this release.
HAPI 0.33.3 and Node are included. Claude/Codex installation and official login are separate.
Quit active work and stop the app before replacing an existing copy.
Keep application data outside the app; replacing the app does not migrate or delete it.
Do not run the app from the read-only disk image.
`);
 await copyFile(new URL(signed?'./INSTALL-SIGNED.html':'./INSTALL.html',import.meta.url),join(stage,'처음 실행 안내.html'));
 if(!signed)await writeFile(join(stage,'보안 설정 열기.webloc'),'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>URL</key><string>x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension</string></dict></plist>');
 const name=`MARICODE-${PRODUCT_VERSION}-arm64.dmg`,image=join(output,name);
 execFileSync('/usr/bin/hdiutil',['create','-volname',`Maricode ${PRODUCT_VERSION}`,'-srcfolder',stage,'-format','UDZO',image],{stdio:'pipe'});
 execFileSync('/usr/bin/hdiutil',['verify',image],{stdio:'pipe'});
 if(signed)await signAndNotarizeDmg(image,output,signed);
 // Ticket attachment changes DMG bytes. Hash only the final validated artifact.
 const digest=createHash('sha256').update(await readFile(image)).digest('hex');
 await writeFile(join(output,name+'.sha256'),digest+'  '+name+'\n');
 const sourceName=await packageProductSource(join(copy,'Contents/Resources'),output,PRODUCT_VERSION);
 const sourceDigest=createHash('sha256').update(await readFile(join(output,sourceName))).digest('hex');
 await writeFile(join(output,sourceName+'.sha256'),sourceDigest+'  '+sourceName+'\n');
 await rm(stage,{recursive:true});
 return image;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==4&&process.argv.length!==5)throw Error('Usage: node dmg.mjs <built-Maricode.app> <new-output-directory> [upstream-source-directory]');
 console.log(await createDmg(process.argv[2],process.argv[3],process.argv[4],{identity:process.env.MARICODE_SIGN_IDENTITY,profile:process.env.MARICODE_NOTARY_PROFILE,keychain:process.env.MARICODE_NOTARY_KEYCHAIN}));
}
