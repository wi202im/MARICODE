import {realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {relativePath} from './core.mjs';
export async function projectFilePath(root,path){
 const safe=relativePath(path),base=await realpath(root),target=await realpath(resolve(base,safe));
 const result=relative(base,target);
 if(result==='..'||result.startsWith('../')||isAbsolute(result))throw Error('Outside project');
 return result;
}
// Where a project path really leads. The path itself stays inside the project (no '..' or absolute paths),
// so only a link placed in the project can lead outside it.
export async function linkedFilePath(root,path){
 return realpath(resolve(await realpath(root),relativePath(path)));
}
