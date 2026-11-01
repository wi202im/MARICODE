export const deviceLoginKey='merry-device-login-v1';
export const validServerId=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
function expiry(token){
 if(typeof token!=='string'||token.length>16384)throw Error('Invalid token');
 const parts=token.split('.');if(parts.length!==3)throw Error('Issued token required');
 const exp=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'))).exp;
 if(!Number.isSafeInteger(exp))throw Error('Expiry required');return exp;
}
export function clearDeviceLogin(storage){try{storage.removeItem(deviceLoginKey);}catch{}}
export function saveDeviceLogin(storage,token,serverId,now=Date.now()/1000){
 try{
  const expires=Math.min(expiry(token),Math.floor(now)+4*60*60);
  if(!validServerId(serverId)||expires<=now)throw Error('Invalid login');
  storage.setItem(deviceLoginKey,JSON.stringify({token,serverId,expires}));return true;
 }catch{clearDeviceLogin(storage);return false;}
}
export function readDeviceLogin(storage,now=Date.now()/1000){
 try{
  const raw=storage.getItem(deviceLoginKey);if(!raw)return null;
  const saved=JSON.parse(raw);
  if(Object.keys(saved).sort().join(',')!=='expires,serverId,token'||!validServerId(saved.serverId)||!Number.isSafeInteger(saved.expires)||saved.expires<=now||saved.expires>expiry(saved.token))throw Error('Invalid login');
  return saved;
 }catch{clearDeviceLogin(storage);return null;}
}
export async function restoreDeviceLogin(storage,fetcher,now=Date.now()/1000){
 const saved=readDeviceLogin(storage,now);if(!saved)return null;
 const response=await fetcher('/api/server-identity',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('서버 신원을 확인하지 못했습니다. 연결을 확인하고 새로고침해 주세요.');
 const id=(await response.json()).serverId;
 if(id!==saved.serverId){clearDeviceLogin(storage);throw Error('서버 신원이 바뀌었습니다. 보관된 로그인을 삭제했습니다. 서버를 확인한 뒤 다시 로그인해 주세요.');}
 const current=readDeviceLogin(storage,now);if(!current||current.token!==saved.token||current.serverId!==saved.serverId)return null;
 return saved;
}
