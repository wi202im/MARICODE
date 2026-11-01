import {createActions} from '../core.mjs';
export function createOutbox(origin,id,storage,post){
 const key=`mari-server-pending:${origin}:${id}`,raw=storage.getItem(key),pending=raw?JSON.parse(raw):null;
 if(pending&&(pending.kind!=='send'||typeof pending.id!=='string'||typeof pending.digest!=='string'))throw Error('Invalid pending state');
 return createActions({pending,post:(kind,body)=>post(body,kind),save:value=>{if(value)storage.setItem(key,JSON.stringify(value));else storage.removeItem(key);}});
}
