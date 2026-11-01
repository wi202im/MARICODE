import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHistory} from './history.mjs';
const msg=n=>({id:String(n),seq:n,createdAt:n});
const page=(start,end,epoch=1)=>({messages:Array.from({length:end-start+1},(_,i)=>msg(start+i)),page:{epoch,nextBeforeAt:start,nextBeforeSeq:start,hasMore:start>1}});
test('older pages survive live refresh, overlap deduplicates and newest versions win',()=>{
 const h=createHistory();h.latest(page(101,200));h.older(page(1,100));h.latest(page(151,250));
 assert.equal(h.messages.length,250);assert.equal(h.messages[0].seq,1);assert.equal(h.hasMore,false);
 const update=page(151,250);update.messages[0].updated=true;h.latest(update);assert.equal(h.messages.length,250);assert.equal(h.messages.find(x=>x.seq===151).updated,true);
});
test('epoch changes and gaps discard stale history; old responses cannot cross epochs',()=>{
 const h=createHistory();h.latest(page(50,100));h.older(page(1,49));
 assert.equal(h.latest(page(1,5,2)),true);assert.equal(h.messages.length,5);assert.equal(h.older(page(1,49,1)),false);
 assert.equal(h.latest(page(100,150,2)),true);assert.equal(h.messages[0].seq,100);
});
test('history is bounded and clearly reports its limit',()=>{
 const h=createHistory(150);h.latest(page(101,200));h.older(page(1,100));assert.equal(h.messages.length,150);assert.equal(h.limited,true);
});
