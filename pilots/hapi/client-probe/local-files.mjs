import {readdir,stat,lstat,readFile,writeFile,rename,rm,chmod} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
// Same response shapes as the HAPI file RPCs, for this Mac's session folders while its Runner is stopped.
// Callers pass a folder-relative path already checked by projectFilePath.
export async function listDirectory(root,path){
 const dir=join(root,path),entries=await readdir(dir,{withFileTypes:true});
 const rows=await Promise.all(entries.map(async e=>{
  const type=e.isDirectory()?'directory':e.isFile()?'file':'other';let size,modified;
  if(!e.isSymbolicLink()){try{const s=await stat(join(dir,e.name));size=s.size;modified=s.mtime.getTime();}catch{}}
  return {name:e.name,type,size,modified};
 }));
 rows.sort((a,b)=>(a.type==='directory')!==(b.type==='directory')?(a.type==='directory'?-1:1):a.name.localeCompare(b.name));
 return {success:true,entries:rows};
}
export async function readProjectFile(root,path,limit=16*1024*1024){
 const file=join(root,path),s=await stat(file);
 if(!s.isFile())return {success:false,error:'Not a file'};
 if(s.size>limit)return {success:false,error:'File too large'};
 return {success:true,content:(await readFile(file)).toString('base64'),size:s.size,modified:s.mtime.getTime()};
}

// Editing from this Mac's file tab. Callers pass a folder-relative path already checked by projectFilePath
// (real path inside the project). Only an existing UTF-8 text file whose current bytes still match the
// loaded hash is replaced; the new bytes go to a sibling temporary file with the same mode, then rename.
export const editLimit=1024*1024;
const saving=new Set();
const sha256=b=>createHash('sha256').update(b).digest('hex');
const isText=bytes=>{if(bytes.includes(0))return false;try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return true;}catch{return false;}};
export async function saveProjectFile(root,path,content,expectedHash){
 const file=join(root,path);
 if(saving.has(file))return {success:false,reason:'BUSY'};
 saving.add(file);
 try{
  let s;try{s=await lstat(file);}catch{return {success:false,reason:'NOT_FILE'};}
  if(!s.isFile())return {success:false,reason:'NOT_FILE'};
  const next=Buffer.from(content,'utf8');
  if(s.size>editLimit||next.length>editLimit)return {success:false,reason:'TOO_LARGE'};
  const current=await readFile(file);
  if(!isText(current)||next.includes(0))return {success:false,reason:'NOT_TEXT'};
  if(sha256(current)!==expectedHash)return {success:false,reason:'FILE_CHANGED'};
  const temp=join(dirname(file),`.${basename(file)}.maricode-${randomUUID()}.tmp`);
  try{
   await writeFile(temp,next,{flag:'wx',mode:s.mode&0o7777,flush:true});
   await chmod(temp,s.mode&0o7777);
   // Last check right before replacing: something else may have written while the temp file was prepared.
   if(sha256(await readFile(file))!==expectedHash)return {success:false,reason:'FILE_CHANGED'};
   await rename(temp,file);
  }finally{await rm(temp,{force:true});}
  const after=await stat(file);
  return {success:true,hash:sha256(next),size:next.length,modified:after.mtime.getTime()};
 }finally{saving.delete(file);}
}
