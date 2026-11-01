import {mkdir,lstat,cp,symlink,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {packageProductSource,packageUpstreamSources} from './source-package.mjs';

export async function createDmg(app,output,upstreamSources){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Apple Silicon macOS required');
 app=resolve(app);output=resolve(output);
 for(const name of ['Contents/Info.plist','Contents/MacOS/Merry','Contents/Resources/node','Contents/Resources/hapi/hapi','Contents/Resources/hapi/LICENSE','Contents/Resources/hapi/source.tar.gz']){
  if(!(await lstat(join(app,name))).isFile())throw Error('Complete bundled app required');
 }
 const info=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',join(app,'Contents/Info.plist')],{encoding:'utf8'}));
 if(info.CFBundleName!=='MARICODE'||info.CFBundleShortVersionString!=='1.0.0'||info.MARICODERelease!==true||info.CFBundleIdentifier!=='dev.maricode.desktop')throw Error('Expected MARICODE 1.0.0 release bundle');
 // A fresh destination is mandatory. Do not overwrite a previous release or source app.
 await mkdir(output,{mode:0o700});
 if(upstreamSources)await packageUpstreamSources(resolve(upstreamSources),output);
 const stage=join(output,'stage');await mkdir(stage);
 const copy=join(stage,'MARICODE.app');await cp(app,copy,{recursive:true,errorOnExist:true,force:false});
 // Seal only this new copy; keep the bundled vendor executables unchanged.
 execFileSync('/usr/bin/codesign',['--force','--sign','-',copy],{stdio:'pipe'});
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',copy],{stdio:'pipe'});
 await symlink('/Applications',join(stage,'Applications'));
 await writeFile(join(stage,'READ-ME.txt'),`MARICODE 1.0.0 — local installation test candidate

Copy MARICODE.app to Applications, then eject this disk image.
This build has an ad-hoc signature, not a Developer ID signature or notarization.
Public redistribution is pending license/source-notice review.
HAPI 0.33.3 and Node are included. Claude/Codex installation and official login are separate.
Quit active work and stop the app before replacing an existing copy.
Keep application data outside the app; replacing the app does not migrate or delete it.
Do not run the app from the read-only disk image.
`);
 const name='MARICODE-1.0.0-arm64.dmg',image=join(output,name);
 execFileSync('/usr/bin/hdiutil',['create','-volname','MARICODE 1.0.0','-srcfolder',stage,'-format','UDZO',image],{stdio:'pipe'});
 execFileSync('/usr/bin/hdiutil',['verify',image],{stdio:'pipe'});
 const digest=createHash('sha256').update(await readFile(image)).digest('hex');
 await writeFile(join(output,name+'.sha256'),digest+'  '+name+'\n');
 const sourceName=await packageProductSource(join(copy,'Contents/Resources'),output);
 const sourceDigest=createHash('sha256').update(await readFile(join(output,sourceName))).digest('hex');
 await writeFile(join(output,sourceName+'.sha256'),sourceDigest+'  '+sourceName+'\n');
 await rm(stage,{recursive:true});
 return image;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==4&&process.argv.length!==5)throw Error('Usage: node dmg.mjs <built-MARICODE.app> <new-output-directory> [upstream-source-directory]');
 console.log(await createDmg(process.argv[2],process.argv[3],process.argv[4]));
}
