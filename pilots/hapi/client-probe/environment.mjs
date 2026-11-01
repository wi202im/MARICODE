import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';
function roles(value){
 if(!value||Object.keys(value).sort().join(',')!=='local,remote,server'||Object.values(value).some(v=>typeof v!=='boolean')||!Object.values(value).some(Boolean))throw Error('하나 이상의 역할을 선택하세요.');
 return {...value,local:value.local||value.server};
}
export function canUseMachine(state,local){return state.configured===true&&(local?state.roles.local:state.roles.server)===true;}
export function createEnvironment(path){
 async function read(){
  let raw;try{raw=await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return {configured:false,revision:0,roles:{local:false,server:false,remote:false}};throw e;}
  const state=JSON.parse(raw);
  if(state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<1)throw Error('저장된 환경을 읽을 수 없습니다.');
  return {configured:true,revision:state.revision,roles:roles(state.roles)};
 }
 return {read,async save(input){
  if(!input||Object.keys(input).sort().join(',')!=='revision,roles'||!Number.isSafeInteger(input.revision))throw Error('잘못된 설정 요청입니다.');
  const next=roles(input.roles);await mkdir(dirname(path),{recursive:true,mode:0o700});
  // Exclusive on-disk lock also prevents a second proxy process overwriting this machine.
  const lock=path+'.lock';await mkdir(lock,{mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';
  try{const current=await read();if(current.revision!==input.revision)throw Error('설정이 변경되었습니다. 다시 조회하세요.');
   const state={version:1,revision:current.revision+1,roles:next};await writeFile(temp,JSON.stringify(state)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path);return await read();
  }finally{await rm(temp,{force:true});await rm(lock,{recursive:true,force:true});}
 }};
}
