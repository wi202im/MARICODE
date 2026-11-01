import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,mkdirSync,rmdirSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const blocked=()=>Object.assign(Error('Runtime ownership or previous operation is unconfirmed'),{startupKind:'locked'});
function exists(path){try{return lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function json(path){if(!exists(path)?.isFile())throw blocked();return JSON.parse(readFileSync(path,'utf8'));}
function bootIdentity(){
 if(process.platform==='darwin')return execFileSync('/usr/sbin/sysctl',['-n','kern.bootsessionuuid'],{encoding:'utf8',timeout:3000}).trim().toLowerCase();
 if(process.platform==='linux')return readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim().toLowerCase();
 throw blocked();
}
function isAlive(pid){try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
function emptyLock(lock){const info=exists(lock);if(info&&(!info.isDirectory()||readdirSync(lock).length))throw blocked();return !!info;}
function completed(directory,state){
 const info=exists(directory);if(!info)return;
 if(!info.isDirectory())throw blocked();
 for(const name of readdirSync(directory))if(!uuid.test(name.slice(0,-5))||!name.endsWith('.json')||json(join(directory,name)).state!==state)throw blocked();
}
function inspectRunner(directory,newBoot){
 const slot=join(directory,'runner');
 if(exists(slot+'.lifecycle-lock'))throw blocked();
 completed(join(slot,'tasks'),'created');completed(slot+'.workspace-plans','ready');
 let generation=slot;
 if(exists(slot+'.current.json')){
  generation=json(slot+'.current.json').directory;
  if(typeof generation!=='string'||!generation.startsWith(slot+'.generation-')||!uuid.test(generation.slice((slot+'.generation-').length)))throw blocked();
 }
 const info=exists(generation);if(info&&!info.isDirectory())throw blocked();
 if(exists(join(generation,'session-operation.json')))throw blocked();
 const home=exists(join(generation,'runner-home')),stopped=exists(join(generation,'runner-stopped.json'));
 if(stopped&&!stopped.isFile())throw blocked();
 if(home){
  if(!home.isDirectory())throw blocked();
  if(!stopped){if(!newBoot)throw blocked();return join(generation,'runner-stopped.json');}
 }
 return null;
}

// SQLite's OS-backed transaction serializes claims, including recovery after a
// crash. Unlike a second mkdir mutex it cannot itself leave a stale mutex.
// This file records ownership only; it never contains authentication or chats.
export async function acquireRuntimeLock(directory,{bootId=bootIdentity,pid=process.pid,alive=isAlive}={}){
 const lock=join(directory,'web.lock'),file=join(directory,'web-ownership.sqlite');
 const boot=bootId();if(!uuid.test(boot)||!Number.isSafeInteger(pid)||pid<1)throw blocked();
 const nonce=randomUUID();let recovered=false;
 function transaction(fn){
  const info=exists(file);if(info&&!info.isFile())throw blocked();
  let db;
  try{
   db=new DatabaseSync(file,{timeout:0});chmodSync(file,0o600);
   db.exec('CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
   db.exec('BEGIN IMMEDIATE');
   const row=db.prepare('SELECT value FROM owner WHERE id=1').get();
   const value=row?JSON.parse(row.value):null;
   const result=fn(db,value);db.exec('COMMIT');return result;
  }catch(e){if(db){try{db.exec('ROLLBACK');}catch{}}throw e.startupKind?e:blocked();}
  finally{db?.close();}
 }
 const save=(db,value)=>db.prepare('INSERT OR REPLACE INTO owner(id,value) VALUES(1,?)').run(JSON.stringify(value));
 transaction((db,old)=>{
  const locked=emptyLock(lock);
  if(old){
   if(old.version!==1||!uuid.test(old.nonce)||!uuid.test(old.bootId)||!Number.isSafeInteger(old.pid)||old.pid<1||!['none','starting','running'].includes(old.hub?.state)||typeof old.remoteUnsafe!=='boolean')throw blocked();
   const newBoot=old.bootId.toLowerCase()!==boot.toLowerCase();
   if(!newBoot&&(alive(old.pid)||old.hub.state==='starting'||(old.hub.state==='running'&&(!Number.isSafeInteger(old.hub.pid)||old.hub.pid<1||alive(old.hub.pid)))))throw blocked();
   if(old.remoteUnsafe)throw blocked();
   const stopped=inspectRunner(directory,newBoot);
   // Account registration is also a mutation, independent of Runner lifecycle.
   if(exists(join(directory,'backend.json'))){const config=json(join(directory,'backend.json'));if(typeof config.accountConfig!=='string'||exists(config.accountConfig+'.register-lock'))throw blocked();}
   if(stopped)writeFileSync(stopped,'{}',{flag:'wx',mode:0o600});
   recovered=true;
  }else if(locked)throw blocked(); // Legacy ownership cannot be inferred.
  if(!locked)mkdirSync(lock,{mode:0o700});
  save(db,{version:1,nonce,bootId:boot,pid,hub:{state:'none'},remoteUnsafe:false});
 });
 function update(fn){return transaction((db,value)=>{if(value?.nonce!==nonce)throw blocked();fn(value);save(db,value);});}
 return {recovered,
  hubStarting(){update(value=>{value.hub={state:'starting'};});},
  hubStarted(childPid){if(!Number.isSafeInteger(childPid)||childPid<1)throw blocked();update(value=>{value.hub={state:'running',pid:childPid};});},
  remoteStarting(){update(value=>{value.remoteUnsafe=true;});},
  remoteStopped(){update(value=>{value.remoteUnsafe=false;});},
  async release(){transaction((db,value)=>{if(value?.nonce!==nonce)throw blocked();if(!emptyLock(lock))throw blocked();rmdirSync(lock);db.exec('DELETE FROM owner WHERE id=1');});}
 };
}
