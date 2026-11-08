// Vendors pinned CodeMirror 6 browser ESM files into pilots/hapi/client-probe/vendor/codemirror.
// No bundler or npm install: each pinned tarball is downloaded from the npm registry, its sha512
// integrity is verified, the package's ES module entry is copied and package imports are rewritten
// to relative files. Every remaining import must resolve to a vendored file, or the run fails.
// Usage: node tools/vendor-codemirror.mjs   (output directory must not exist)
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'pilots/hapi/client-probe/vendor/codemirror');
const pinned={
 '@codemirror/autocomplete':'6.20.4','@codemirror/commands':'6.11.1','@codemirror/lang-css':'6.3.1','@codemirror/lang-html':'6.4.12',
 '@codemirror/lang-javascript':'6.2.5','@codemirror/lang-json':'6.0.2','@codemirror/lang-markdown':'6.5.2','@codemirror/lang-python':'6.2.1',
 '@codemirror/lang-yaml':'6.1.3','@codemirror/language':'6.13.1','@codemirror/legacy-modes':'6.5.5','@codemirror/lint':'6.9.7',
 '@codemirror/search':'6.7.2','@codemirror/state':'6.7.6','@codemirror/streamparser':'6.0.0','@codemirror/theme-one-dark':'6.1.3',
 '@codemirror/view':'6.43.15','@lezer/common':'1.5.5','@lezer/css':'1.3.9','@lezer/highlight':'1.2.5','@lezer/html':'1.3.13',
 '@lezer/javascript':'1.5.6','@lezer/json':'1.0.3','@lezer/lr':'1.4.12','@lezer/markdown':'1.8.1','@lezer/python':'1.1.19',
 '@lezer/yaml':'1.0.4','@marijn/find-cluster-break':'1.0.4','crelt':'1.0.7','style-mod':'4.1.4','w3c-keyname':'2.2.8'
};
// Legacy stream modes used for common files without a Lezer grammar (.env, shell, TOML, Go, Rust, ...).
const legacyModes=['shell','properties','toml','go','rust','swift','sql','dockerfile','simple-mode'];
const fileName=name=>name.startsWith('@lezer/')?'lezer-'+name.slice(7)+'.js':name.startsWith('@codemirror/')?name.slice(12)+'.js':name.replace(/^@[^/]+\//,'')+'.js';
// The package's browser ES module entry (package.json module / exports import), never a CommonJS build.
const esmEntry=pkg=>{const x=pkg.exports,e=pkg.module??x?.import??x?.['.']?.import??(typeof x?.['.']==='string'?x['.']:null)??(pkg.type==='module'?pkg.main:null);if(typeof e!=='string')throw Error('No ES module entry: '+pkg.name);return e.replace(/^\.\//,'');};
// Static module statements only (rollup output puts them at line starts); string literals elsewhere are ignored.
const importPattern=/^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)(['"])([^'"]+)\2/gm;
const caret=(range,version)=>{const m=/^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);if(!m)return false;const v=version.split('.').map(Number),r=m.slice(1).map(Number);return v[0]===r[0]&&(v[1]>r[1]||v[1]===r[1]&&v[2]>=r[2]);};

try{await access(output);throw Error('Output exists: remove vendor/codemirror explicitly before re-vendoring');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(join(root,'.runtime'),{recursive:true});
const work=await mkdtemp(join(root,'.runtime','vendor-codemirror-'));
const files=new Map(),licenses=[],manifest=[];
try{
 for(const [name,version] of Object.entries(pinned)){
  const meta=await (await fetch(`https://registry.npmjs.org/${name.replace('/','%2f')}/${version}`,{headers:{'User-Agent':'maricode-vendor'}})).json();
  if(meta.name!==name||meta.version!==version||!/^sha512-/.test(meta.dist?.integrity??''))throw Error('Registry metadata mismatch: '+name);
  const tarball=Buffer.from(await (await fetch(meta.dist.tarball,{headers:{'User-Agent':'maricode-vendor'}})).arrayBuffer());
  if('sha512-'+createHash('sha512').update(tarball).digest('base64')!==meta.dist.integrity)throw Error('Integrity mismatch: '+name);
  const dir=join(work,fileName(name).slice(0,-3));await mkdir(dir);await writeFile(join(dir,'package.tgz'),tarball);
  execFileSync('/usr/bin/tar',['-xzf',join(dir,'package.tgz'),'-C',dir]);
  const pkg=JSON.parse(await readFile(join(dir,'package/package.json'),'utf8'));
  if(pkg.license!=='MIT')throw Error('Unexpected license: '+name);
  for(const [dep,range] of Object.entries(pkg.dependencies??{}))if(!pinned[dep]||!caret(range,pinned[dep]))throw Error(`Unpinned or incompatible dependency ${name} -> ${dep}@${range}`);
  const license=await readFile(join(dir,'package/LICENSE'),'utf8').catch(()=>{throw Error('Missing LICENSE: '+name);});
  licenses.push(`----- ${name} ${version} (vendor/codemirror) -----\n${license.trim()}\n`);
  const entries=name==='@codemirror/legacy-modes'?legacyModes.map(m=>[`mode/${m}.js`,`legacy-${m}.js`]):[[esmEntry(pkg),fileName(name)]];
  for(const [source,target] of entries){files.set(target,{name,version,text:await readFile(join(dir,'package',source),'utf8')});manifest.push({package:name,version,integrity:meta.dist.integrity,source,file:target});}
 }
 await mkdir(output);
 for(const [target,f] of files){
  let text=f.text.replace(/\n\/\/# sourceMappingURL=.*$/m,'');
  // The app's CSP (style-src 'self') blocks <style> elements; style-mod only uses constructable
  // stylesheets inside shadow roots. Use them for documents too (supported by WKWebView on macOS 14+).
  if(target==='style-mod.js'){const from='if (!root.head && root.adoptedStyleSheets && win.CSSStyleSheet) {';if(text.split(from).length!==2)throw Error('style-mod patch target not found');text=text.replace(from,'if (root.adoptedStyleSheets && win.CSSStyleSheet) { // Maricode: constructable sheets also for documents (CSP)');}
  if(/\brequire\s*\(|\bmodule\.exports\b/.test(text)||!/\bexport\b/.test(text))throw Error('Not an ES module: '+target);
  text=text.replace(importPattern,(all,lead,q,spec)=>{
   const mapped=spec.startsWith('./')&&f.name==='@codemirror/legacy-modes'?'./legacy-'+spec.slice(2).replace(/\.js$/,'')+'.js':pinned[spec]?'./'+fileName(spec):spec;
   return lead+q+mapped+q;
  });
  for(const m of text.matchAll(importPattern))if(!m[3].startsWith('./')||!files.has(m[3].slice(2)))throw Error(`Unresolved import in ${target}: ${m[3]}`);
  if(/\bimport\s*\(/.test(text))throw Error('Dynamic import not supported: '+target);
  await writeFile(join(output,target),text);
  manifest.find(x=>x.file===target).sha256=createHash('sha256').update(text).digest('hex');
 }
 await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,1)+'\n');
 await writeFile(join(work,'LICENSES.txt'),licenses.join('\n'));
 console.log(`Vendored ${files.size} files from ${Object.keys(pinned).length} packages. Licenses: ${join(work,'LICENSES.txt')}`);
}catch(e){await rm(output,{recursive:true,force:true});throw e;}
