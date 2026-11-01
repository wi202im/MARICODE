import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBroker} from './broker.mjs';

test('bind request to engine/session; expose only metadata; never repeat accepted input',async()=>{
  let calls=0,finish; const b=createBroker({execute:async()=>{calls++;await new Promise(r=>finish=r);return true;}});
  const r=b.start('claude','session-a');
  assert.equal(b.start('claude','session-a').id,r.id);
  assert.throws(()=>b.submit(r.id,'codex','session-a',{password:'demo-only',otp:'123456'}));
  const pending=b.submit(r.id,'claude','session-a',{password:'demo-only',otp:'123456'});
  await assert.rejects(async()=>b.submit(r.id,'claude','session-a',{password:'demo-only',otp:'123456'}));
  assert.equal(b.status(r.id,'claude','session-a').state,'submitting');
  finish();await pending;assert.equal(calls,1);
  assert.equal(b.status(r.id,'claude','session-a').state,'completed');
  assert.ok(!JSON.stringify(b.status(r.id,'claude','session-a')).includes('demo-only'));
});
test('cancel, expiry, invalid input, errors and unknown outcomes fail closed',async()=>{
  let now=0,calls=0;const b=createBroker({now:()=>now,ttl:100,execute:async()=>{calls++;throw Error('private payload');}});
  let r=b.start('codex','s');b.cancel(r.id,'codex','s');assert.throws(()=>b.submit(r.id,'codex','s',{}));
  r=b.start('codex','s');now=101;assert.equal(b.status(r.id,'codex','s').state,'expired');assert.throws(()=>b.submit(r.id,'codex','s',{}));
  r=b.start('codex','s');assert.throws(()=>b.submit(r.id,'codex','s',{password:'real-secret',otp:'123456'}));assert.equal(calls,0);
  await b.submit(r.id,'codex','s',{password:'demo-only',otp:'123456'});
  assert.equal(b.status(r.id,'codex','s').state,'unknown');assert.equal(b.start('codex','s').id,r.id);
  assert.ok(!JSON.stringify(b.status(r.id,'codex','s')).includes('private'));
});
