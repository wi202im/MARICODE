import test from 'node:test';import assert from 'node:assert/strict';
import {takeSetupKey} from './setup-key.mjs';
const page=(hash,stored=null)=>{const store=new Map(stored?[['maricode-setup-key',stored]]:[]),replaced=[];
 return {location:{hash,pathname:'/setup',search:''},storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},history:{replaceState:(a,b,url)=>replaced.push(url)},store,replaced};};
const key='a'.repeat(64);
test('the Mac app hands the setup key in the fragment; it is kept for this window and removed from the address',()=>{
 const p=page('#setup='+key);assert.equal(takeSetupKey(p),key);assert.equal(p.store.get('maricode-setup-key'),key);assert.deepEqual(p.replaced,['/setup']);
 const reload=page('',key);assert.equal(takeSetupKey(reload),key,'a reload in the same window keeps working');assert.deepEqual(reload.replaced,[]);
 const fresh=page('#setup='+'b'.repeat(64),key);assert.equal(takeSetupKey(fresh),'b'.repeat(64),'a newly opened page replaces an old key');
});
test('no or malformed key means the page was not opened by the Mac app',()=>{
 for(const hash of ['','#setup=short','#setup='+'G'.repeat(64),'#other='+key])assert.equal(takeSetupKey(page(hash)),null,hash);
});
