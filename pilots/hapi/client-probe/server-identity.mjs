import {readFile,mkdir,writeFile,link,rm} from 'node:fs/promises';import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';
// Installation identity, not an authentication credential or a certificate.
export async function serverIdentity(path){
 async function read(){const id=JSON.parse(await readFile(path,'utf8')).serverId;if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))throw Error('Invalid server identity');return id;}
 try{return await read();}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,JSON.stringify({serverId:randomUUID()}),{mode:0o600,flag:'wx'});try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;}return await read();}
 finally{await rm(temp,{force:true});}
}
