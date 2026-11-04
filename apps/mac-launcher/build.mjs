import {PRODUCT_VERSION} from './version.mjs';
import {packageHapi} from './package-hapi.mjs';
import {mkdir,copyFile,readdir,writeFile,chmod} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const release=process.argv.at(-1)==='--release';
if(release)process.argv.pop();
const nodeRoot=resolve(process.argv[2]??''),output=resolve(process.argv[3]??'');
if(process.platform!=='darwin'||![4,5].includes(process.argv.length))throw Error('Usage: node build.mjs <existing-node-root> <new-output-directory> [verified-hapi-artifact-directory] [--release] (macOS only)');
if(release&&!process.argv[4])throw Error('Release requires bundled HAPI');
const binary=join(nodeRoot,'bin/node');
const version=execFileSync(binary,['--version'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).trim();
const [major,minor]=version.slice(1).split('.').map(Number);
if(major<26||(major===26&&minor<7))throw Error('Node 26.7+ required');
// No overwrite, install, download or automatic signing identity selection.
await mkdir(output,{mode:0o700});
const bundle=join(output,'Maricode.app'),contents=join(bundle,'Contents'),resources=join(contents,'Resources');
await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(resources);
await copyFile(binary,join(resources,'node'));await chmod(join(resources,'node'),0o755);
await copyFile(join(nodeRoot,'LICENSE'),join(resources,'Node-LICENSE.txt'));
await copyFile(join(root,'apps/mac-launcher/LICENSE'),join(resources,'MARICODE-LICENSE.txt'));
await copyFile(join(root,'apps/mac-launcher/USER-GUIDE.txt'),join(resources,'USER-GUIDE.txt'));
await copyFile(join(root,'apps/mac-launcher/NOTICES.txt'),join(resources,'NOTICES.txt'));
await copyFile(join(root,'apps/mac-launcher/Paseo-LICENSE.txt'),join(resources,'Paseo-LICENSE.txt'));
if(process.argv[4])await packageHapi(resolve(process.argv[4]),resources);
const iconset=join(output,'AppIcon.iconset');await mkdir(iconset);
execFileSync('/usr/bin/swift',[join(root,'apps/mac-launcher/AppIcon.swift'),iconset],{stdio:'inherit'});
execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',join(resources,'AppIcon.icns')],{stdio:'inherit'});
const destination=join(resources,'source');
async function copySources(relative){
 const source=join(root,relative),target=join(destination,relative);await mkdir(target,{recursive:true});
 for(const item of await readdir(source,{withFileTypes:true})){
  if(item.name.startsWith('.')||item.name==='node_modules'||item.name.endsWith('.test.mjs'))continue;
  if(item.isSymbolicLink())throw Error('Source symlink is not packaged');
  // Everything under vendor/ is shipped as vendored (fonts, icons, library builds).
  if(item.isDirectory()){if(relative.split('/').includes('vendor')||['connections','setup','workspace','design','secure-login','vendor'].includes(item.name))await copySources(join(relative,item.name));}
  else if(/\.(mjs|js|html|css|webmanifest|png|svg|ttf)$/.test(item.name))await copyFile(join(source,item.name),join(target,item.name));
 }
}
await copySources('pilots/hapi/client-probe');
await copyFile(join(root,'pilots/hapi/client-probe/LICENSE'),join(destination,'pilots/hapi/client-probe/LICENSE'));
await copyFile(join(root,'pilots/hapi/client-probe/vendor/LICENSES.txt'),join(destination,'pilots/hapi/client-probe/vendor/LICENSES.txt'));
await mkdir(join(destination,'apps/mac-launcher'),{recursive:true});
for(const name of ['clean-start.mjs','cli-profile-reset.mjs','AppIcon.swift','AppUpdate.swift','version.mjs','INSTALL.html','INSTALL-SIGNED.html','signing.mjs','Merry.swift','DesktopNavigation.swift','DataLocation.swift','AgentDiscovery.swift','RemoteConnection.swift','build.mjs','package-hapi.mjs','dmg.mjs','LICENSE','README.md','USER-GUIDE.txt','NOTICES.txt','BUILDING.txt','source-package.mjs','Bun-LICENSE.md','HAPI-DEPENDENCY-NOTICES.txt','Paseo-LICENSE.txt'])await copyFile(join(root,'apps/mac-launcher',name),join(destination,'apps/mac-launcher',name));
await copyFile(join(root,'apps/mac-launcher/runtime-lock.mjs'),join(destination,'apps/mac-launcher/runtime-lock.mjs'));
await copyFile(join(root,'apps/mac-launcher/runtime.mjs'),join(destination,'apps/mac-launcher/runtime.mjs'));
await copyFile(join(root,'apps/mac-launcher/backend.mjs'),join(destination,'apps/mac-launcher/backend.mjs'));
await copyFile(join(root,'apps/mac-launcher/data-format.mjs'),join(destination,'apps/mac-launcher/data-format.mjs'));
await copyFile(join(root,'apps/mac-launcher/desktop-access.mjs'),join(destination,'apps/mac-launcher/desktop-access.mjs'));
await copyFile(join(root,'apps/mac-launcher/https-forward.mjs'),join(destination,'apps/mac-launcher/https-forward.mjs'));
await copyFile(join(root,'apps/mac-launcher/remote-config.mjs'),join(destination,'apps/mac-launcher/remote-config.mjs'));
await copyFile(join(root,'apps/mac-launcher/bundled-hapi.mjs'),join(destination,'apps/mac-launcher/bundled-hapi.mjs'));
await copyFile(join(root,'apps/mac-launcher/configure.mjs'),join(destination,'apps/mac-launcher/configure.mjs'));
await writeFile(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Merry</string><key>CFBundleIdentifier</key><string>${release?'dev.maricode.desktop':'dev.merry.launcher.preview'}</string><key>MARICODERelease</key>${release?'<true/>':'<false/>'}<key>CFBundleIconFile</key><string>AppIcon.icns</string><key>CFBundleName</key><string>Maricode</string><key>CFBundleDisplayName</key><string>Maricode</string><key>CFBundleShortVersionString</key><string>${PRODUCT_VERSION}</string><key>CFBundleVersion</key><string>${PRODUCT_VERSION}</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/><key>LSMinimumSystemVersion</key><string>14.0</string></dict></plist>`);
execFileSync('/usr/bin/swiftc',[join(root,'apps/mac-launcher/Merry.swift'),join(root,'apps/mac-launcher/AppUpdate.swift'),join(root,'apps/mac-launcher/DesktopNavigation.swift'),join(root,'apps/mac-launcher/DataLocation.swift'),join(root,'apps/mac-launcher/AgentDiscovery.swift'),join(root,'apps/mac-launcher/RemoteConnection.swift'),'-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos14.0`,'-framework','AppKit','-framework','WebKit','-o',join(contents,'MacOS/Merry')],{stdio:'inherit'});
console.log('Development bundle built: '+bundle);
