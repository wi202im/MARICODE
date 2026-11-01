import {randomBytes} from 'node:crypto';
import {writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
export function createDesktopAccess({directory,authenticate,now=Date.now}){
 const path=join(directory,'connect.private.html');let grant=null,timer=null,preparing=false,closed=false;
 async function close(){closed=true;grant=null;clearTimeout(timer);await rm(path,{force:true});}
 return {path,close,async prepare(origin){
  if(closed||preparing)throw Error('Connection unavailable');
  const url=new URL(origin);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.origin!==origin)throw Error('Loopback required');
  preparing=true;grant=null;clearTimeout(timer);
  try{
   const code=randomBytes(32).toString('hex');
   await rm(path,{force:true});
   await writeFile(path,`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action ${origin}; base-uri 'none'"><title>MARICODE · 로컬 연결</title><h1>이 Mac의 작업 화면에 연결</h1><p>MARICODE 앱에서 요청한 연결입니다. 30초 동안 한 번만 사용할 수 있습니다.</p><form method="post" action="${origin}/desktop-connect"><input type="hidden" name="code" value="${code}"><button type="submit">작업 화면 연결</button></form><p>만료되면 앱에서 작업 화면 연결을 다시 누르세요.</p></html>`,{flag:'wx',mode:0o600});
   grant={code,expires:now()+30000};timer=setTimeout(()=>{grant=null;void rm(path,{force:true}).catch(()=>{});},30000);timer.unref();
  }finally{preparing=false;}
 },async exchange(code){
  if(!grant||grant.expires<=now()||code!==grant.code)throw Error('Invalid connection grant');
  grant=null;clearTimeout(timer);await rm(path,{force:true});
  return authenticate();
 }};
}
