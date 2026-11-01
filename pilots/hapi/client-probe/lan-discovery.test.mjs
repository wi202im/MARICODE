import test from 'node:test';import assert from 'node:assert/strict';
import {bonjourCandidates,createLanDiscovery} from './lan-discovery.mjs';
test('Bonjour parser accepts only local HTTPS service endpoints and bounds deduplicated candidates',()=>{
 const text='x._merry._tcp.local. IN SRV 0 0 8444 mini.local.\nx._merry._tcp SRV 0 0 8444 mini.local.\nx._merry._tcp SRV 0 0 80 evil.example.\nx._merry._tcp SRV 0 0 70000 bad.local.\nx._merry._tcp SRV 0 0 0 zero.local.';
 assert.deepEqual(bonjourCandidates(text),[{name:'mini',host:'mini.local',port:8444}]);
 assert.equal(bonjourCandidates(Array.from({length:100},(_,i)=>'x._merry._tcp SRV 0 0 8444 m'+i+'.local.').join('\n')).length,50);
});
test('LAN lookup is one bounded fixed command, cached, and returns no CLI errors',async()=>{
 let calls=0;const s=createLanDiscovery({binary:'/usr/bin/dns-sd',execute:async(binary,args,options)=>{calls++;assert.deepEqual(args,['-Z','_merry._tcp','local.']);assert.equal(options.timeout,3000);throw {killed:true,signal:'SIGTERM',stdout:'x._merry._tcp SRV 0 0 8444 mini.local.'};}});
 assert.equal((await s.find()).candidates.length,1);await s.find();assert.equal(calls,1);
 const failed=createLanDiscovery({binary:'/usr/bin/dns-sd',execute:async()=>{throw Error('private');}});assert.deepEqual(await failed.find(),{state:'unavailable',candidates:[]});
});
