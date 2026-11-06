import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
// Remote devices that chose to stay signed in. HAPI issues fixed 4-hour tokens with no refresh, so each device gets
// its own refresh secret instead of the server's access token. Only hashes are stored. A secret rotates on every use;
// presenting an old one later means it was copied, so the device is revoked. Unused for 30 days, a device expires.
const idleMs=30*24*3600*1000,raceMs=60*1000;
const hash=v=>createHash('sha256').update(v).digest('base64url');
const same=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const refused=(status,message)=>Object.assign(Error(message),{status});
function expiry(token){try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url')).exp*1000;}catch{return 0;}}
export function createDeviceLogins({path,authenticate,now=Date.now}){
 let chain=Promise.resolve(),revokedCache=null;
 async function load(){try{const s=JSON.parse(await readFile(path,'utf8'));if(s.version!==1)throw Error('Unknown device login format');return s;}catch(e){if(e.code==='ENOENT')return {version:1,devices:{},revoked:[]};throw e;}}
 async function save(s){const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(s)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,path);}
 // Serialized read-modify-write; a failed step leaves the file as it was.
 function update(fn){const next=chain.then(async()=>{const s=await load();const t=now();
  for(const [id,d] of Object.entries(s.devices))if(t-d.lastUsed>=idleMs)delete s.devices[id];
  s.revoked=s.revoked.filter(r=>r.exp>t);
  const out=await fn(s,t);await save(s);revokedCache=s.revoked;return out;});chain=next.catch(()=>{});return next;}
 const remember=(d,token)=>{d.tokens=[...(d.tokens??[]),{hash:hash(token),exp:expiry(token)}].slice(-3);};
 function drop(s,id){const d=s.devices[id];if(!d)return;s.revoked.push(...d.tokens.filter(x=>x.exp>now()));delete s.devices[id];}
 return {
  async register(name,token){
   if(typeof name!=='string'||!name.trim()||name.length>60||/[\u0000-\u001f]/.test(name))throw Error('Invalid device name');
   return update((s,t)=>{const id=randomUUID(),secret=randomBytes(32).toString('base64url');
    s.devices[id]={name:name.trim(),created:t,lastUsed:t,hash:hash(secret),previous:null};remember(s.devices[id],token);return {id,secret};});
  },
  async refresh(id,secret){
   const ended='이 기기의 로그인이 끝났습니다. 서버 Mac에서 새 코드를 만들어 다시 연결하세요.';
   const result=await update(async(s,t)=>{const d=s.devices[id];if(!d||typeof secret!=='string')throw refused(401,ended);
    const given=hash(secret);
    if(same(given,d.hash)){
     const token=await authenticate();if(typeof token!=='string'||!token)throw Error('Login unavailable');
     const next=randomBytes(32).toString('base64url');d.previous={hash:d.hash,at:t};d.hash=hash(next);d.lastUsed=t;remember(d,token);
     return {token,device:{id,secret:next}};
    }
    // Another window of the same device refreshed a moment ago; it should read the new secret instead.
    if(d.previous&&same(given,d.previous.hash)&&t-d.previous.at<raceMs)throw refused(409,'다른 창에서 로그인을 갱신했습니다.');
    // The revocation must be saved, so it is reported after the update instead of thrown inside it.
    if(d.previous&&same(given,d.previous.hash)){drop(s,id);return null;}
    throw refused(401,ended);
   });
   if(!result)throw refused(401,ended);return result;
  },
  async forget(id,secret){return update(s=>{const d=s.devices[id];if(!d||!same(hash(String(secret)),d.hash))throw refused(401,'Unknown device');drop(s,id);});},
  async revoke(id){return update(s=>{drop(s,id);});},
  async list(){return update(s=>Object.entries(s.devices).map(([id,d])=>({id,name:d.name,created:d.created,lastUsed:d.lastUsed})).sort((a,b)=>b.lastUsed-a.lastUsed));},
  // Checked on every request, so it reads the file once and then follows this process's own writes.
  async revoked(token){revokedCache??=(await load()).revoked;const h=hash(String(token));return revokedCache.some(r=>r.hash===h&&r.exp>now());}
 };
}
