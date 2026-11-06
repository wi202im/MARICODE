export const deviceLoginKey='merry-device-login-v1';
export const validServerId=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
function expiry(token){
 if(typeof token!=='string'||token.length>16384)throw Error('Invalid token');
 const parts=token.split('.');if(parts.length!==3)throw Error('Issued token required');
 const exp=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'))).exp;
 if(!Number.isSafeInteger(exp))throw Error('Expiry required');return exp;
}
// A readable name for the server Mac's device list; not used for any decision.
export function deviceLabel(ua=globalThis.navigator?.userAgent??'',touch=globalThis.navigator?.maxTouchPoints??0){
 const os=/iPhone/.test(ua)?'iPhone':/iPad/.test(ua)||/Macintosh/.test(ua)&&touch>1?'iPad':/Android/.test(ua)?'Android':/Macintosh/.test(ua)?'Mac':/Windows/.test(ua)?'Windows':/Linux/.test(ua)?'Linux':'기기';
 const browser=/Edg\//.test(ua)?'Edge':/CriOS|Chrome\//.test(ua)?'Chrome':/FxiOS|Firefox\//.test(ua)?'Firefox':/Safari\//.test(ua)?'Safari':'브라우저';
 return os+' · '+browser;
}
export function clearDeviceLogin(storage){try{storage.removeItem(deviceLoginKey);}catch{}}
const validRefresh=r=>r===undefined||!!r&&Object.keys(r).sort().join(',')==='id,secret'&&typeof r.id==='string'&&r.id.length<=64&&typeof r.secret==='string'&&r.secret.length<=128;
// A device registered at this server also keeps its own refresh secret (never the server's access token).
export function saveDeviceLogin(storage,token,serverId,now=Date.now()/1000,refresh){
 try{
  const expires=Math.min(expiry(token),Math.floor(now)+4*60*60);
  if(!validServerId(serverId)||expires<=now||!validRefresh(refresh))throw Error('Invalid login');
  storage.setItem(deviceLoginKey,JSON.stringify({token,serverId,expires,...(refresh?{refresh}:{})}));return true;
 }catch{clearDeviceLogin(storage);return false;}
}
export function readDeviceLogin(storage,now=Date.now()/1000){
 try{
  const raw=storage.getItem(deviceLoginKey);if(!raw)return null;
  const saved=JSON.parse(raw);
  if(!['expires,serverId,token','expires,refresh,serverId,token'].includes(Object.keys(saved).sort().join(','))||!validServerId(saved.serverId)||!validRefresh(saved.refresh)||!Number.isSafeInteger(saved.expires)||saved.expires<=now&&!saved.refresh||saved.expires>expiry(saved.token))throw Error('Invalid login');
  return saved;
 }catch{clearDeviceLogin(storage);return null;}
}
export async function restoreDeviceLogin(storage,fetcher,now=Date.now()/1000,locks=globalThis.navigator?.locks){
 const saved=readDeviceLogin(storage,now);if(!saved)return null;
 const response=await fetcher('/api/server-identity',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('서버 신원을 확인하지 못했습니다. 연결을 확인하고 새로고침해 주세요.');
 const id=(await response.json()).serverId;
 if(id!==saved.serverId){clearDeviceLogin(storage);throw Error('서버 신원이 바뀌었습니다. 보관된 로그인을 삭제했습니다. 서버를 확인한 뒤 다시 로그인해 주세요.');}
 const current=readDeviceLogin(storage,now);if(!current||current.token!==saved.token||current.serverId!==saved.serverId)return null;
 if(current.refresh&&current.expires-now<refreshAhead)return refreshDeviceLogin(storage,fetcher,now,locks);
 return saved;
}
const refreshAhead=10*60;
// One window refreshes at a time; a window that waited reads the result instead of reusing the rotated secret.
export async function refreshDeviceLogin(storage,fetcher,now=Date.now()/1000,locks=globalThis.navigator?.locks){
 const run=async()=>{
  const saved=readDeviceLogin(storage,now);if(!saved?.refresh)return null;
  if(saved.expires-now>=refreshAhead)return saved;
  const r=await fetcher('/api/device-refresh',{method:'POST',credentials:'omit',redirect:'error',headers:{'X-Merry-Protocol':'1','X-Merry-Server-Id':saved.serverId,'Content-Type':'application/json'},body:JSON.stringify(saved.refresh),signal:AbortSignal.timeout(15000)});
  if(r.status===409){const other=readDeviceLogin(storage,now);if(other?.expires>now)return other;throw Error('다른 창에서 로그인을 갱신하는 중입니다. 잠시 뒤 새로고침해 주세요.');}
  const body=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===401)clearDeviceLogin(storage);throw Error(body.error??'로그인을 갱신하지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.');}
  if(!saveDeviceLogin(storage,body.token,saved.serverId,now,body.device))throw Error('갱신한 로그인을 보관하지 못했습니다.');
  return readDeviceLogin(storage,now);
 };
 return locks?.request?locks.request('maricode-device-refresh',run):run();
}
