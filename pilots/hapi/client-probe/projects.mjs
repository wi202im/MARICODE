import {readdir,realpath,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {projectFilePath} from './files.mjs';
export async function projectChoices(root){
 const base=await realpath(root),result=[{key:'',label:'작업 폴더 전체',path:base}];
 for(const name of (await readdir(base)).sort()){
  if(name.startsWith('.'))continue;
  try{const path=resolve(base,await projectFilePath(base,name));if((await stat(path)).isDirectory())result.push({key:name,label:name,path});}catch{}
 }
 return result;
}
export async function selectProject(root,key){
 if(typeof key!=='string')throw Error('Invalid project');
 const choice=(await projectChoices(root)).find(c=>c.key===key);
 if(!choice)throw Error('Project not allowed');
 return choice.path;
}
