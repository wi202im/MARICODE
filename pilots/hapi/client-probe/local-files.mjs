import {readdir,stat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
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
