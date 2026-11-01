import {test} from 'node:test';import assert from 'node:assert/strict';
import {serverAddress,addServer,readServers} from './registry.mjs';
test('addresses are origin-only, private-network candidates and HTTPS outside loopback',()=>{
 assert.equal(serverAddress('https://mini.tail000000.ts.net:8444/'),'https://mini.tail000000.ts.net:8444');
 assert.equal(serverAddress('http://127.0.0.1:61165'),'http://127.0.0.1:61165');
 assert.equal(serverAddress('https://192.168.1.8:8444'),'https://192.168.1.8:8444');
 for(const s of ['https://example.com','http://192.168.1.8','https://user:pass@192.168.1.8','https://192.168.1.8/?token=x','https://192.168.1.8/#x','https://192.168.1.8/workspace','javascript:alert(1)','https://169.254.169.254','https://100.128.0.1','https://127.1','https://2130706433'])assert.throws(()=>serverAddress(s));
});
test('registry deduplicates canonical origins and persists no auth fields',()=>{
 const a=addServer([],{name:'Mac mini',address:'https://MINI.tail000000.ts.net:8444/'});
 assert.equal(a.length,1);assert.throws(()=>addServer(a,{name:'duplicate',address:a[0].address}));
 assert.throws(()=>addServer([],{name:'bad',address:'http://127.0.0.1:61165',token:'secret'}));
 assert.deepEqual(readServers(JSON.stringify(a)),a);assert.throws(()=>readServers('broken'));assert.throws(()=>readServers('[{"name":"a","address":"https://public.example"}]'));
});
