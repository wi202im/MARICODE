import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
// Version 1 describes the existing development layout; no payload conversion.
// A future conversion must explicitly back up data before changing this version.
export async function checkDataFormat(directory){
 const path=join(directory,'data-format.json');let raw;
 try{raw=await readFile(path,'utf8');}catch(e){
  if(e.code!=='ENOENT')throw e;
  try{await writeFile(path,JSON.stringify({product:'merry-development',version:1})+'\n',{mode:0o600,flag:'wx'});return;}
  catch(e){if(e.code!=='EEXIST')throw e;raw=await readFile(path,'utf8');}
 }
 let marker;try{marker=JSON.parse(raw);}catch{throw Error('Invalid data format; data preserved');}
 if(!marker||marker.product!=='merry-development'||marker.version!==1||Object.keys(marker).some(k=>!['product','version'].includes(k)))throw Error('Unsupported data format; data preserved');
}
