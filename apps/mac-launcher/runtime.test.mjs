import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startDesktopWeb} from './runtime.mjs';
test('blocked shutdown keeps server and ownership intact and allows a later safe close',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'merry-stop-'));let runtime,blocked=true,checks=0;
 try{
  runtime=await startDesktopWeb({directory,port:0,beforeClose:async()=>{checks++;if(blocked)throw Error('unsafe');}});
  await assert.rejects(runtime.close(),/unsafe/);
  assert.equal((await fetch(runtime.url+'/setup')).status,200);
  await access(join(directory,'web.lock'));
  blocked=false;await runtime.close();assert.equal(checks,2);
  await assert.rejects(access(join(directory,'web.lock')));
 }finally{blocked=false;await runtime?.close();await rm(directory,{recursive:true,force:true});}
});
test('concurrent close requests share one safety check',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'merry-stop-'));let runtime,checks=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 try{
  runtime=await startDesktopWeb({directory,port:0,beforeClose:async()=>{checks++;await gate;}});
  const a=runtime.close(),b=runtime.close();release();await Promise.all([a,b]);assert.equal(checks,1);
 }finally{release();await runtime?.close();await rm(directory,{recursive:true,force:true});}
});
test('isolated launcher serves setup, rejects duplicate owner and releases only its lock',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'merry-launcher-'));let first,second;
 try{
 first=await startDesktopWeb({directory,port:0});
 const url=first.url;assert.equal(new URL(url).hostname,'127.0.0.1');
 const page=await fetch(url+'/setup');assert.equal(page.status,200);assert.match(await page.text(),/작업 시작까지/);
 await assert.rejects(startDesktopWeb({directory,port:0}),e=>e.startupKind==='locked');
 assert.equal((await fetch(url+'/api/environment')).status,200);
 await first.close();first=null;
 second=await startDesktopWeb({directory,port:0});assert.ok(second.url);
 }finally{await first?.close();await second?.close();await rm(directory,{recursive:true,force:true});}
});
test('port conflict fails without retaining a new lock or closing existing listener',async()=>{
 const a=await mkdtemp(join(tmpdir(),'merry-a-')),b=await mkdtemp(join(tmpdir(),'merry-b-'));let first;
 try{first=await startDesktopWeb({directory:a,port:0});await assert.rejects(startDesktopWeb({directory:b,port:Number(new URL(first.url).port)}),e=>e.startupKind==='port');await assert.rejects(access(join(b,'web.lock')));assert.equal((await fetch(first.url+'/setup')).status,200);}
 finally{await first?.close();await rm(a,{recursive:true,force:true});await rm(b,{recursive:true,force:true});}
});
test('unsupported data format refuses startup and preserves payload without retaining a new lock',async()=>{
 const {writeFile,readFile}=await import('node:fs/promises');const directory=await mkdtemp(join(tmpdir(),'merry-version-'));
 try{
  const marker='{"product":"merry-development","version":2}';await writeFile(join(directory,'data-format.json'),marker);await writeFile(join(directory,'environment.json'),'preserve');
  await assert.rejects(startDesktopWeb({directory,port:0}),e=>e.startupKind==='format');
  assert.equal(await readFile(join(directory,'data-format.json'),'utf8'),marker);assert.equal(await readFile(join(directory,'environment.json'),'utf8'),'preserve');await assert.rejects(access(join(directory,'web.lock')));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('launcher reports lock failure by exit code without printing private paths',async()=>{
 const {mkdir,readFile,writeFile}=await import('node:fs/promises');
 const {spawnSync}=await import('node:child_process');
 const directory=await mkdtemp(join(tmpdir(),'merry-private-'));
 try{
  await mkdir(join(directory,'web.lock'));await writeFile(join(directory,'web.lock','preserve'),'unknown');
  const result=spawnSync(process.execPath,[new URL('./runtime.mjs',import.meta.url).pathname,directory,'0'],{encoding:'utf8'});
  assert.equal(result.status,21);assert.equal(result.stdout,'');assert.equal(result.stderr.includes(directory),false);
  assert.equal(await readFile(join(directory,'web.lock','preserve'),'utf8'),'unknown');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('SIGKILL leaves recoverable ownership; concurrent relaunches admit only one process',async t=>{
 const {spawn}=await import('node:child_process');const {readFile,writeFile}=await import('node:fs/promises');
 const directory=await mkdtemp(join(tmpdir(),'maricode-crash-')),children=[];
 t.after(async()=>{for(const p of children)if(p.exitCode===null&&p.signalCode===null){const exit=new Promise(r=>p.once('exit',r));p.kill('SIGKILL');await exit;}await rm(directory,{recursive:true,force:true});});
 const start=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[new URL('./runtime.mjs',import.meta.url).pathname,directory,'0'],{stdio:['pipe','pipe','ignore']});children.push(child);let settled=false,output='';
  const timer=setTimeout(()=>reject(Error('Launcher timeout')),10000);
  child.on('error',reject);child.stdout.on('data',part=>{output+=part;if(!settled&&output.includes('READY ')){settled=true;clearTimeout(timer);resolve({child,url:output.trim().slice(6)});}});
  child.once('exit',code=>{if(!settled){settled=true;clearTimeout(timer);resolve({child,code});}});
 });
 const first=await start();assert.ok(first.url);await writeFile(join(directory,'preserved.txt'),'settings and history placeholder');
 const died=new Promise(r=>first.child.once('exit',r));first.child.kill('SIGKILL');await died;await access(join(directory,'web.lock'));
 const results=await Promise.all([start(),start()]);assert.equal(results.filter(r=>r.url).length,1);assert.equal(results.find(r=>!r.url).code,21);
 const winner=results.find(r=>r.url);assert.equal((await fetch(winner.url+'/workspace')).status,200);assert.equal(await readFile(join(directory,'preserved.txt'),'utf8'),'settings and history placeholder');
 const ended=new Promise(r=>winner.child.once('exit',r));winner.child.stdin.write('quit\n');assert.equal(await ended,0);await assert.rejects(access(join(directory,'web.lock')));
});

test('1.1.0 clean launch clears old catalog and roles before serving first-run setup, then preserves new settings',async t=>{
 const {mkdir,writeFile,readFile}=await import('node:fs/promises');const directory=await mkdtemp(join(tmpdir(),'maricode-upgrade-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(join(directory,'hub'));await writeFile(join(directory,'hub/data.db'),'old session history');await writeFile(join(directory,'projects.json'),'old project registrations');await writeFile(join(directory,'environment.json'),JSON.stringify({version:1,revision:1,roles:{local:true,server:false,remote:false}}));let runtime;
 try{runtime=await startDesktopWeb({directory,port:0,cleanInstall:true});const state=await (await fetch(runtime.url+'/api/environment')).json();assert.equal(state.configured,false);assert.equal(state.cleanStart,true);await assert.rejects(access(join(directory,'hub/data.db')));await assert.rejects(access(join(directory,'projects.json')));assert.match(await (await fetch(runtime.url+'/setup')).text(),/clean-start-notice/);
 const r=await fetch(runtime.url+'/api/environment',{method:'POST',headers:{origin:runtime.url,'content-type':'application/json','x-setup-nonce':state.nonce},body:JSON.stringify({revision:0,roles:{local:true,server:false,remote:false}})});assert.equal(r.status,200);await runtime.close();runtime=null;
 runtime=await startDesktopWeb({directory,port:0,cleanInstall:true});const again=await (await fetch(runtime.url+'/api/environment')).json();assert.equal(again.configured,true);assert.equal(again.cleanStart,false);assert.equal(JSON.parse(await readFile(join(directory,'environment.json'))).roles.local,true);
 }finally{await runtime?.close();}
});
test('upgrade cannot clean while another app runtime owns the directory',async t=>{const {writeFile,readFile}=await import('node:fs/promises');const directory=await mkdtemp(join(tmpdir(),'maricode-upgrade-busy-'));t.after(()=>rm(directory,{recursive:true,force:true}));const runtime=await startDesktopWeb({directory,port:0});try{await writeFile(join(directory,'projects.json'),'keep');await assert.rejects(startDesktopWeb({directory,port:0,cleanInstall:true}),e=>e.startupKind==='locked');assert.equal(await readFile(join(directory,'projects.json'),'utf8'),'keep');}finally{await runtime.close();}});
