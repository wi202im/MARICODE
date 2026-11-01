import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHttpsForward} from './https-forward.mjs';
const origin='https://mini.tail123.ts.net:8445',target='http://127.0.0.1:61200';
function fixture(){
 let config={},starts=0,stops=0;
 const self={BackendState:'Running',Self:{DNSName:'mini.tail123.ts.net.'}};
 const deps={query:async args=>args[0]==='status'?self:config,launch:()=>{starts++;config={Foreground:{owned:{TCP:{8445:{HTTPS:true}},Web:{'mini.tail123.ts.net:8445':{Handlers:{'/':{Proxy:target}}}}}}};return {stop:async()=>{stops++;config={};}};},delay:async()=>{}};
 return {deps,get starts(){return starts;},get stops(){return stops;},set config(v){config=v;}};
}
test('forward refuses existing Serve settings and another machine DNS without launching',async()=>{
 const f=fixture();const service=createHttpsForward(f.deps);f.config={TCP:{443:{HTTPS:true}}};
 await assert.rejects(service.start({origin,target}));assert.equal(f.starts,0);
 f.config={};await assert.rejects(service.start({origin:'https://other.tail123.ts.net:8445',target}));assert.equal(f.starts,0);
});
test('only one forward starts and stop releases its child without a reset command',async()=>{
 const f=fixture(),service=createHttpsForward(f.deps);
 await service.start({origin,target});assert.equal(f.starts,1);
 await assert.rejects(service.start({origin,target}));assert.equal(f.starts,1);
 await service.stop();await service.stop();assert.equal(f.stops,1);
});
test('concurrent start and unavailable status do not launch a second child',async()=>{
 const f=fixture();let release;const gate=new Promise(r=>release=r);const original=f.deps.query;
 f.deps.query=async args=>{if(args[0]==='status')await gate;return original(args);};
 const service=createHttpsForward(f.deps);const pending=service.start({origin,target});
 await assert.rejects(service.start({origin,target}));release();await pending;assert.equal(f.starts,1);
 // A failed prerequisite status query must not launch another child.
 const broken=createHttpsForward({query:async args=>{if(args[0]==='status')return {BackendState:'Running',Self:{DNSName:'mini.tail123.ts.net.'}};throw Error('unavailable');},launch:f.deps.launch});
 await assert.rejects(broken.start({origin,target}));assert.equal(f.starts,1);
 await service.stop();
});
test('a child exit during readiness never reports running',async()=>{
 const f=fixture();const original=f.deps.launch;f.deps.launch=()=>({...original(),alive:false});const service=createHttpsForward(f.deps);
 await assert.rejects(service.start({origin,target}));assert.notEqual(service.phase,'running');
});
test('signal errors and false kill results are not proof of child exit',async()=>{
 const {EventEmitter}=await import('node:events');const {launchOwned}=await import('./https-forward.mjs');
 for(const mode of ['error','false']){
  const child=new EventEmitter();child.pid=123;child.kill=()=>{if(mode==='error')child.emit('error',Error('signal'));return mode!=='false';};
  const owned=launchOwned([],()=>{},{spawnChild:()=>child,timeout:5});
  await assert.rejects(owned.stop());assert.equal(owned.alive,true);
  child.emit('exit',0);await owned.stop();assert.equal(owned.alive,false);
 }
});

test('unconfirmed cleanup stays locked until a successful explicit stop',async()=>{
 const f=fixture();let fail=false;
 const service=createHttpsForward({...f.deps,query:async args=>{if(fail)throw Error('unavailable');return f.deps.query(args);}});
 await service.start({origin,target});fail=true;
 await assert.rejects(service.stop());assert.equal(service.phase,'unknown');
 await assert.rejects(service.start({origin,target}));assert.equal(f.starts,1);
 fail=false;await service.stop();assert.equal(service.phase,'stopped');
});
