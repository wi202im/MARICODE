import {serverAddress} from './registry.mjs';
const valid=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
export function identityTransport(address,{storage,fetcher=fetch,onBlocked=()=>{}}){
 const origin=serverAddress(address),key='mari-server-identity-v1:'+origin;let observed;
 return async(url,options={})=>{
  let id;
  try{
   if(new URL(url).origin!==origin)throw Error();
   const pinned=storage.getItem(key);if(pinned!==null&&!valid(pinned))throw Error();
   const r=await fetcher(origin+'/api/server-identity',{method:'GET',credentials:'omit',redirect:'error',signal:options.signal});if(!r.ok)throw Error();
   id=(await r.json()).serverId;if(!valid(id)||(pinned&&id!==pinned)||(observed&&id!==observed))throw Error();
   options.signal?.throwIfAborted();observed=id;
  }catch{options.signal?.throwIfAborted();onBlocked();throw Object.assign(Error('Server identity unavailable or changed'),{status:403});}
  const response=await fetcher(url,{...options,credentials:'omit',redirect:'error',headers:{...options.headers,'X-Merry-Server-Id':id}});
  if(new URL(url).pathname==='/api/auth'&&response.ok){
   try{options.signal?.throwIfAborted();const previous=storage.getItem(key);if(previous!==null&&previous!==id)throw Error();storage.setItem(key,id);}
   catch{options.signal?.throwIfAborted();onBlocked();throw Object.assign(Error('Server identity could not be saved'),{status:403});}
  }
  return response;
 };
}

export async function reviewServerIdentity(address,{storage,fetcher=fetch}){
 const origin=serverAddress(address),previous=storage.getItem('mari-server-identity-v1:'+origin);
 if(!valid(previous))throw Error('기존 서버 ID를 확인할 수 없습니다.');
 const r=await fetcher(origin+'/api/server-identity',{method:'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('현재 서버 ID를 확인할 수 없습니다.');
 const current=(await r.json()).serverId;
 if(!valid(current))throw Error('현재 서버 ID가 올바르지 않습니다.');
 return {origin,previous,current};
}
export async function acceptServerIdentity(review,options){
 if(!review||!valid(review.previous)||!valid(review.current)||review.previous===review.current)throw Error('변경된 서버 ID를 먼저 확인하세요.');
 const latest=await reviewServerIdentity(review.origin,options);
 const key='mari-server-identity-v1:'+latest.origin;
 if(latest.previous!==review.previous||latest.current!==review.current||options.storage.getItem(key)!==review.previous)throw Error('확인 중 서버 정보가 바뀌었습니다. 다시 조회하세요.');
 options.storage.setItem(key,review.current);
}
