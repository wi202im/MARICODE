import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createRunnerPool} from './runner-pool.mjs';

// Fake Runner units: placement and machine are scripted; calls are recorded.
function fixture(t,{placement='ready',sessions={}}={}){
 const root=t?null:null,made=[],calls=[];let primaryPlacement=placement;
 const unit=(config,name)=>{const u={config,name,machineId:name==='primary'?'m-primary':'m-'+made.length,
  placement:async()=>name==='primary'?primaryPlacement:'refreshable',machine:async()=>u.machineId,
  ready:async(...a)=>{calls.push([name,'ready',...a.slice(1)]);if(config.roots)await config.roots(a[1]);},
  task:async(raw)=>{calls.push([name,'task',raw.project]);if(config.roots)await config.roots(raw.project);return {state:'created'};},
  status:async()=>({phase:'running',workspaceAvailable:true,unit:name}),
  workspace:async()=>Object.entries(sessions).filter(([,m])=>m===u.machineId).map(([id])=>({id})),
  navigation:async()=>({sessions:{},removed:[]}),
  close:async()=>calls.push([name,'close']),runSessionMutation:async fn=>{calls.push([name,'mutation']);return fn();},
  reconcileResume:async()=>{calls.push([name,'reconcile']);return true;},
  projects:async()=>[],stop:async()=>calls.push([name,'stop'])};
  if(name!=='primary')made.push(u);return u;};
 return {made,calls,unit,setPlacement:p=>{primaryPlacement=p;}};
}
async function dir(t){const d=await mkdtemp(join(tmpdir(),'runner-pool-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
const lookup=map=>async id=>map[id]??null;

test('the primary Runner keeps folders it already allows or can restart for; a busy primary gets a dedicated Runner',async t=>{
 const d=await dir(t),f=fixture(t),config={directory:join(d,'runner'),projectsPath:join(d,'projects.json')};
 const pool=createRunnerPool(config,{createUnit:f.unit,sessionMachine:lookup({}),resolvePath:async k=>'/x/'+k});
 await pool.ready('Bearer x','p1','claude');assert.deepEqual(f.calls.at(-1),['primary','ready','p1','claude']);
 f.setPlacement('refreshable');await pool.ready('Bearer x','p2','claude');assert.deepEqual(f.calls.at(-1),['primary','ready','p2','claude']);
 f.setPlacement('busy');await pool.ready('Bearer x','p3','claude');
 assert.equal(f.made.length,1);assert.deepEqual(f.calls.at(-1),['dedicated','ready','p3','claude']);
 // The assignment is durable and sticky: the same folder returns to the same Runner even when the primary is free again.
 const saved=JSON.parse(await readFile(join(d,'runner.assignments.json'),'utf8'));assert.equal(Object.keys(saved.rows)[0],'p3');
 f.setPlacement('refreshable');await pool.ready('Bearer x','p3','claude');assert.equal(f.made.length,1);assert.equal(f.calls.at(-1)[0],'dedicated');
 assert.deepEqual(await f.made[0].config.excludeKeys?.()??[],[]);
 assert.deepEqual(await pool.assignedElsewhere(),['p3']);
 const reopened=createRunnerPool(config,{createUnit:f.unit,sessionMachine:lookup({}),resolvePath:async k=>'/x/'+k});await reopened.ready('Bearer x','p3','claude');assert.equal(f.calls.at(-1)[0],'dedicated');
});

test('session calls follow the Runner that owns the session, and lists merge every Runner',async t=>{
 const d=await dir(t),sessions={s1:'m-primary'},f=fixture(t,{placement:'busy',sessions}),config={directory:join(d,'runner'),projectsPath:join(d,'projects.json')};
 const pool=createRunnerPool(config,{createUnit:f.unit,sessionMachine:async id=>sessions[id]??null,resolvePath:async k=>'/x/'+k});
 await pool.ready('Bearer x','p3','claude');sessions.s2=f.made[0].machineId;
 assert.deepEqual((await pool.workspace('Bearer x')).map(s=>s.id).sort(),['s1','s2']);
 await pool.runSessionMutation(async()=>{},{session:'s2'});assert.deepEqual(f.calls.at(-1),['dedicated','mutation']);
 await pool.runSessionMutation(async()=>{},{resume:{id:'s1',metadata:{machineId:'m-primary'}}});assert.deepEqual(f.calls.at(-1),['primary','mutation']);
 await pool.reconcileResume('s2','Bearer x');assert.deepEqual(f.calls.at(-1),['dedicated','reconcile']);
 assert.equal((await pool.status({session:'s2'})).unit,'dedicated');assert.equal((await pool.status('p3')).unit,'dedicated');assert.equal((await pool.status()).unit,'primary');
 await pool.close();assert.deepEqual(f.calls.slice(-2).map(c=>c[0]).sort(),['dedicated','primary']);
});

test('a worktree request made while the primary is busy runs on a dedicated Runner and its retry returns there',async t=>{
 const d=await dir(t),f=fixture(t,{placement:'busy'}),config={directory:join(d,'runner'),projectsPath:join(d,'projects.json')};
 const pool=createRunnerPool(config,{createUnit:f.unit,sessionMachine:lookup({}),resolvePath:async k=>'/x/'+k});
 const raw={requestId:'40000000-0000-4000-8000-000000000001',agent:'claude',project:'p1',workspace:{mode:'new',branch:'main',name:'feature/x'}};
 await pool.task(raw,'Bearer x');assert.deepEqual(f.calls.at(-1),['dedicated','task','p1']);
 f.setPlacement('refreshable');await pool.task(raw,'Bearer x',true);assert.deepEqual(f.calls.at(-1),['dedicated','task','p1']);assert.equal(f.made.length,1);
});

test('an idle dedicated Runner stops after the idle time; a refused stop is retried and a new request restarts the clock',async t=>{
 const d=await dir(t),f=fixture(t,{placement:'busy'}),config={directory:join(d,'runner'),projectsPath:join(d,'projects.json')};let clock=0;
 const pool=createRunnerPool(config,{createUnit:f.unit,sessionMachine:lookup({}),resolvePath:async k=>'/x/'+k,now:()=>clock,idleMs:600000,sweepMs:0});
 await pool.ready('Bearer x','p3','claude');const u=f.made[0];let refuse=true;
 u.stop=async()=>{if(refuse)throw Object.assign(Error(),{code:'RUNNER_ACTIVE'});f.calls.push(['dedicated','stop']);};
 const stops=()=>f.calls.filter(c=>c[1]==='stop').length;
 clock=599999;await pool.sweepIdle();assert.equal(stops(),0);
 clock=600000;await pool.sweepIdle();assert.equal(stops(),0);
 refuse=false;clock=660000;await pool.sweepIdle();assert.equal(stops(),1);
 // The primary Runner is never stopped by the sweep.
 assert.equal(f.calls.filter(c=>c[0]==='primary'&&c[1]==='stop').length,0);
 await pool.ready('Bearer x','p3','claude');clock=900000;await pool.sweepIdle();assert.equal(stops(),1);
 clock=1260000;await pool.sweepIdle();assert.equal(stops(),2);
});

test('resume preparation follows the session owner even when its folder is assigned elsewhere',async t=>{
 const d=await dir(t),sessions={old:'m-primary'},f=fixture(t,{placement:'busy',sessions});
 const pool=createRunnerPool({directory:join(d,'runner'),projectsPath:join(d,'projects.json')},{createUnit:f.unit,sessionMachine:lookup(sessions),resolvePath:async k=>'/x/'+k,sweepMs:0});
 await pool.ready('Bearer x','p1','codex');assert.equal(f.made.length,1);
 await pool.ready('Bearer x','p1','codex',{session:'old'});assert.equal(f.calls.at(-1)[0],'primary');
 sessions.new=f.made[0].machineId;await pool.ready('Bearer x','p1','codex',{session:'new'});assert.equal(f.calls.at(-1)[0],'dedicated');
 const count=f.calls.length;sessions.lost='unregistered-machine';
 await assert.rejects(pool.ready('Bearer x','p1','codex',{session:'lost'}));await assert.rejects(pool.ready('Bearer x','p1','codex',{session:'missing'}));assert.equal(f.calls.length,count);assert.equal(f.made.length,1);
});
