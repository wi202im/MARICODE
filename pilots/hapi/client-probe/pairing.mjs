import {randomInt,timingSafeEqual} from 'node:crypto';
// Short one-time connection code shown on the server Mac (goals: 짧게 유효한 일회용 코드 + 서버측 확인).
// Memory only, one active code, single use, 5-minute lifetime; repeated failures burn the code.
// It carries no token: redeeming it asks the server's own Hub login for a normal session JWT.
const alphabet='ABCDEFGHJKMNPQRSTUVWXYZ23456789',length=8,ttl=5*60*1000,maxFailures=5;
export const normalizeCode=value=>String(value??'').toUpperCase().replace(/[\s-]/g,'');
export function createPairing({authenticate,now=Date.now}){
 let active=null,failures=0;
 const same=(a,b)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
 return {
  issue(){
   const code=Array.from({length},()=>alphabet[randomInt(alphabet.length)]).join('');
   active={code,expires:now()+ttl};failures=0;
   return {code:code.slice(0,4)+'-'+code.slice(4),expiresAt:active.expires};
  },
  cancel(){active=null;failures=0;},
  get status(){return active&&active.expires>now()?{active:true,expiresAt:active.expires}:{active:false};},
  async redeem(input){
   const code=normalizeCode(input);
   if(!active||active.expires<=now()){active=null;throw Object.assign(Error('연결 코드가 없거나 만료됐습니다. 서버 Mac에서 새 코드를 만드세요.'),{status:401});}
   if(code.length!==length||!same(code,active.code)){
    if(++failures>=maxFailures)active=null;
    throw Object.assign(Error(active?'연결 코드가 맞지 않습니다.':'연결 코드가 여러 번 틀려 사용을 막았습니다. 서버 Mac에서 새 코드를 만드세요.'),{status:401});
   }
   active=null;failures=0;
   return authenticate();
  }
 };
}
