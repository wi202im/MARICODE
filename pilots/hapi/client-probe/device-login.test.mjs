import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveDeviceLogin,readDeviceLogin,clearDeviceLogin,deviceLoginKey} from './device-login.mjs';
const id='11111111-1111-4111-8111-111111111111';
const token=exp=>'header.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.signature';
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test('device login stores only expiring issued token and server binding, clearing on expiry',()=>{
 const s=storage(),t=token(2000);assert.equal(saveDeviceLogin(s,t,id,1000),true);
 assert.deepEqual(readDeviceLogin(s,1001),{token:t,serverId:id,expires:2000});
 assert.equal(readDeviceLogin(s,2000),null);assert.equal(s.getItem(deviceLoginKey),null);
 assert.equal(saveDeviceLogin(s,'raw-access-token',id,1000),false);
 assert.equal(saveDeviceLogin(s,token(999),id,1000),false);
 assert.equal(saveDeviceLogin(s,t,'wrong',1000),false);
});
test('corrupt and unavailable storage never restores credentials',()=>{
 const s=storage();s.setItem(deviceLoginKey,'bad');assert.equal(readDeviceLogin(s),null);
 assert.equal(saveDeviceLogin({setItem(){throw Error();}},token(2000),id,1000),false);
 clearDeviceLogin(s);assert.equal(s.getItem(deviceLoginKey),null);
});
test('restore verifies identity without credentials before returning a saved token',async()=>{
 const {restoreDeviceLogin}=await import('./device-login.mjs');const s=storage();saveDeviceLogin(s,token(2000),id,1000);
 const restored=await restoreDeviceLogin(s,async(path,options)=>{assert.equal(path,'/api/server-identity');assert.equal(options.headers,undefined);assert.equal(options.credentials,'omit');return {ok:true,json:async()=>({serverId:id})};},1001);
 assert.equal(restored.serverId,id);
 await assert.rejects(restoreDeviceLogin(s,async()=>({ok:true,json:async()=>({serverId:'22222222-2222-4222-8222-222222222222'})}),1001));
 assert.equal(readDeviceLogin(s,1001),null);
});
test('restoration cannot undo a logout while identity is loading',async()=>{
 const {restoreDeviceLogin}=await import('./device-login.mjs');const s=storage();saveDeviceLogin(s,token(2000),id,1000);
 let release;const gate=new Promise(r=>release=r);
 const pending=restoreDeviceLogin(s,async()=>{await gate;return {ok:true,json:async()=>({serverId:id})};},1001);
 clearDeviceLogin(s);release();assert.equal(await pending,null);
});
test('device storage is capped at four hours even for a longer issued expiry',()=>{
 const s=storage();saveDeviceLogin(s,token(999999),id,1000);assert.equal(readDeviceLogin(s,1000).expires,15400);
});
test('a device with a refresh secret keeps it past token expiry and refreshes once under a lock',async()=>{
 const {refreshDeviceLogin,restoreDeviceLogin}=await import('./device-login.mjs');const s=storage(),refresh={id:'d1',secret:'old'};
 assert.equal(saveDeviceLogin(s,token(2000),id,1000,refresh),true);
 assert.deepEqual(readDeviceLogin(s,3000)?.refresh,refresh,'an expired token with a refresh secret is kept');
 const calls=[];let held=0;const locks={request:async(name,fn)=>{assert.equal(name,'maricode-device-refresh');held++;try{return await fn();}finally{held--;}}};
 const fetcher=async(path,options)=>{if(path==='/api/server-identity')return {ok:true,json:async()=>({serverId:id})};
  calls.push([path,JSON.parse(options.body),options.headers['X-Merry-Server-Id'],held]);return {ok:true,status:200,json:async()=>({token:token(20000),device:{id:'d1',secret:'new'}})};};
 const restored=await restoreDeviceLogin(s,fetcher,3000,locks);
 assert.equal(restored.token,token(20000));assert.deepEqual(readDeviceLogin(s,3000).refresh,{id:'d1',secret:'new'});
 assert.deepEqual(calls,[['/api/device-refresh',{id:'d1',secret:'old'},id,1]]);
 // Still fresh: no second refresh.
 await refreshDeviceLogin(s,fetcher,3000,locks);assert.equal(calls.length,1);
});
test('a refused refresh clears the device login; a raced one reads the other window\'s result',async()=>{
 const {refreshDeviceLogin}=await import('./device-login.mjs');const s=storage();
 saveDeviceLogin(s,token(2000),id,1000,{id:'d1',secret:'old'});
 await assert.rejects(refreshDeviceLogin(s,async()=>({ok:false,status:401,json:async()=>({error:'끝났습니다'})}),3000),/끝났습니다/);
 assert.equal(s.getItem(deviceLoginKey),null);
 saveDeviceLogin(s,token(2000),id,1000,{id:'d1',secret:'old'});
 const raced=await refreshDeviceLogin(s,async()=>{saveDeviceLogin(s,token(20000),id,3000,{id:'d1',secret:'new'});return {ok:false,status:409,json:async()=>({})};},3000);
 assert.equal(raced.token,token(20000));
});
