import {realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {relativePath} from './core.mjs';
export async function projectFilePath(root,path){
 const safe=relativePath(path),base=await realpath(root),target=await realpath(resolve(base,safe));
 const result=relative(base,target);
 if(result==='..'||result.startsWith('../')||isAbsolute(result))throw Error('Outside project');
 return result;
}
