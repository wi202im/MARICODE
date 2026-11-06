import {readFile,writeFile,mkdir,rename,rm,lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
export function remoteOrigin(value){
 if(typeof value!=='string'||value!==value.trim())throw Error('Invalid remote address');
 const u=new URL(value);
 if(u.protocol!=='https:'||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.){2}ts\.net$/.test(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!([u.origin,u.origin+'/'].includes(value)))throw Error('Tailscale HTTPS origin required');
 return u.origin;
}
export async function readRemoteOrigin(directory){
 let raw;try{raw=await readFile(join(directory,'remote.json'),'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
 const c=JSON.parse(raw);
 if(c.version!==1||Object.keys(c).sort().join(',')!=='origin,version')throw Error('Invalid remote configuration');
 return c.origin===null?null:remoteOrigin(c.origin);
}
export async function saveRemoteOrigin({directory,origin,expected}){
 if(!isAbsolute(directory))throw Error('Absolute directory required');
 const next=origin===null?null:remoteOrigin(origin);
 await mkdir(directory,{recursive:true,mode:0o700});
 const lock=join(directory,'web.lock');await mkdir(lock,{mode:0o700});
 const temp=join(directory,'remote.'+randomUUID()+'.tmp');
 try{
  if(await readRemoteOrigin(directory)!==expected)throw Error('Configuration changed');
  await writeFile(temp,JSON.stringify({version:1,origin:next})+'\n',{flag:'wx',mode:0o600});
  await rename(temp,join(directory,'remote.json'));
 }finally{await rm(temp,{force:true});await rm(lock,{recursive:true});}
}

// Called only while runtime owns web.lock, at startup or for an explicit local pairing request.
// A saved null is an explicit unregister decision and must survive subsequent launches.
export async function registerStartupOrigin({directory,server,query}){
 const path=join(directory,'remote.json');
 try{await lstat(path);return await readRemoteOrigin(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!server)return null;
 let origin;
 try{
  const state=await query(),name=state?.Self?.DNSName?.replace(/\.$/,'');
  if(state?.BackendState!=='Running'||typeof name!=='string'||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.){2}ts\.net$/.test(name))return null;
  origin=remoteOrigin('https://'+name);
 }catch{return null;} // Missing/offline Tailscale must not prevent local work.
 try{await writeFile(path,JSON.stringify({version:1,origin})+'\n',{flag:'wx',mode:0o600});}
 catch(e){if(e.code!=='EEXIST')throw e;return await readRemoteOrigin(directory);}
 return origin;
}
