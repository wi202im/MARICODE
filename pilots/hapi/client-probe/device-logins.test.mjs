import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDeviceLogins} from './device-logins.mjs';

const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'device-logins-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let clock=1_000_000_000_000,n=0;const jwt=()=>`${b64({alg:'HS256'})}.${b64({exp:Math.floor(clock/1000)+4*3600,n:++n})}.s`;
 const logins=createDeviceLogins({path:join(dir,'devices.json'),authenticate:async()=>jwt(),now:()=>clock});
 return {dir,logins,jwt,tick:ms=>{clock+=ms;}};
}

test('a registered device refreshes with a rotating secret and stays signed in while used',async t=>{
 const {dir,logins,jwt,tick}=await fixture(t);
 const first=jwt(),device=await logins.register('iPhone · Safari',first);
 assert.match(device.id,/^[a-f0-9-]{36}$/);assert.ok(device.secret.length>=40);
 assert.equal((await stat(join(dir,'devices.json'))).mode&0o777,0o600);
 assert.ok(!(await readFile(join(dir,'devices.json'),'utf8')).includes(device.secret),'only a hash is stored');
 tick(3*3600*1000);
 const next=await logins.refresh(device.id,device.secret);
 assert.notEqual(next.token,first);assert.notEqual(next.device.secret,device.secret);assert.equal(next.device.id,device.id);
 // Used within 30 days: still valid long after the first token expired.
 tick(29*24*3600*1000);const later=await logins.refresh(device.id,next.device.secret);assert.ok(later.token);
 assert.deepEqual((await logins.list()).map(d=>d.name),['iPhone · Safari']);
});

test('an unused device expires after 30 days; a wrong secret is refused',async t=>{
 const {logins,jwt,tick}=await fixture(t);
 const device=await logins.register('Android · Chrome',jwt());
 await assert.rejects(logins.refresh(device.id,'x'.repeat(43)),e=>e.status===401);
 tick(30*24*3600*1000+1);
 await assert.rejects(logins.refresh(device.id,device.secret),e=>e.status===401);
 assert.deepEqual(await logins.list(),[]);
});

test('reusing a rotated secret revokes the device, except a near-simultaneous second window',async t=>{
 const {logins,jwt,tick}=await fixture(t);
 const token=jwt(),device=await logins.register('Mac · Chrome',token);
 const next=await logins.refresh(device.id,device.secret);
 // Another window raced with the old secret just now: refused without revoking.
 await assert.rejects(logins.refresh(device.id,device.secret),e=>e.status===409);
 assert.equal((await logins.list()).length,1);
 tick(61*1000);
 await assert.rejects(logins.refresh(device.id,device.secret),e=>e.status===401);
 assert.deepEqual(await logins.list(),[]);
 await assert.rejects(logins.refresh(device.id,next.device.secret),e=>e.status===401);
 // Tokens handed to a revoked device stop working at this server before their own expiry.
 assert.equal(await logins.revoked(token),true);assert.equal(await logins.revoked(next.token),true);assert.equal(await logins.revoked(jwt()),false);
});

test('revoking from the server Mac or forgetting on logout ends the device',async t=>{
 const {logins,jwt}=await fixture(t);
 const a=await logins.register('iPhone · Safari',jwt()),b=await logins.register('Android · Chrome',jwt());
 await logins.revoke(a.id);await assert.rejects(logins.refresh(a.id,a.secret),e=>e.status===401);
 await assert.rejects(logins.forget(b.id,'wrong'),e=>e.status===401);
 await logins.forget(b.id,b.secret);assert.deepEqual(await logins.list(),[]);
 await assert.rejects(logins.register('x'.repeat(200),jwt()),/name/i);
});
