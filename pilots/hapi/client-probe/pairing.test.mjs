import test from 'node:test';
import assert from 'node:assert/strict';
import {createPairing,normalizeCode} from './pairing.mjs';
test('a short code is single use, expires, and is burned after repeated failures',async()=>{
 let clock=0,logins=0;const p=createPairing({authenticate:async()=>{logins++;return 'jwt';},now:()=>clock});
 await assert.rejects(p.redeem('ABCD-EFGH'),/없거나 만료/);
 const {code}=p.issue();assert.match(code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
 assert.equal(await p.redeem(code.toLowerCase().replace('-',' ')),'jwt');assert.equal(logins,1);
 await assert.rejects(p.redeem(code),/없거나 만료/);
 const second=p.issue().code;clock+=5*60*1000;await assert.rejects(p.redeem(second),/만료/);
 const third=p.issue().code;for(let i=0;i<4;i++)await assert.rejects(p.redeem('ZZZZ-ZZZZ'),/맞지 않습니다/);
 await assert.rejects(p.redeem('ZZZZ-ZZZZ'),/여러 번/);await assert.rejects(p.redeem(third),/없거나 만료/);assert.equal(logins,1);
 const fourth=p.issue().code;p.cancel();await assert.rejects(p.redeem(fourth));assert.equal(normalizeCode(' ab-cd '),'ABCD');
});
