import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,realpath,chmod,stat,symlink,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveProjectFile,editLimit} from './local-files.mjs';
import {createServer} from './server.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
async function project(t){const root=await realpath(await mkdtemp(join(tmpdir(),'file-save-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('saving replaces an unchanged text file, keeps its permissions and reports the new hash',async t=>{
 const root=await project(t);await writeFile(join(root,'.env'),'A=1\r\nB=2\r\n');await chmod(join(root,'.env'),0o600);
 const r=await saveProjectFile(root,'.env','A=1\r\nB=3\r\n',sha('A=1\r\nB=2\r\n'));
 assert.equal(r.success,true);assert.equal(r.hash,sha('A=1\r\nB=3\r\n'));assert.equal(r.size,10);
 assert.equal(await readFile(join(root,'.env'),'utf8'),'A=1\r\nB=3\r\n');
 assert.equal((await stat(join(root,'.env'))).mode&0o777,0o600);
 assert.deepEqual((await readdir(root)).sort(),['.env'],'no temporary file is left behind');
});

test('saving never overwrites a file that changed since it was loaded',async t=>{
 const root=await project(t);await writeFile(join(root,'a.js'),'old');
 const r=await saveProjectFile(root,'a.js','mine',sha('older'));
 assert.equal(r.success,false);assert.equal(r.reason,'FILE_CHANGED');assert.equal(await readFile(join(root,'a.js'),'utf8'),'old');
});

test('only existing, bounded UTF-8 text files can be saved',async t=>{
 const root=await project(t);await writeFile(join(root,'bin.dat'),Buffer.from([1,0,2]));await mkdir(join(root,'dir'));await writeFile(join(root,'ok.txt'),'x');
 assert.equal((await saveProjectFile(root,'missing.txt','x',sha(''))).reason,'NOT_FILE');
 assert.equal((await saveProjectFile(root,'dir','x',sha(''))).reason,'NOT_FILE');
 assert.equal((await saveProjectFile(root,'bin.dat','x',sha(Buffer.from([1,0,2])))).reason,'NOT_TEXT');
 assert.equal((await saveProjectFile(root,'ok.txt','a\0b',sha('x'))).reason,'NOT_TEXT');
 assert.equal((await saveProjectFile(root,'ok.txt','x'.repeat(editLimit+1),sha('x'))).reason,'TOO_LARGE');
 await writeFile(join(root,'big.txt'),'y'.repeat(editLimit+1));
 assert.equal((await saveProjectFile(root,'big.txt','y',sha('y'.repeat(editLimit+1)))).reason,'TOO_LARGE');
 assert.equal(await readFile(join(root,'ok.txt'),'utf8'),'x');
});

test('two saves of the same file at once do not both run',async t=>{
 const root=await project(t);await writeFile(join(root,'a.txt'),'0');
 const [a,b]=await Promise.all([saveProjectFile(root,'a.txt','1',sha('0')),saveProjectFile(root,'a.txt','2',sha('0'))]);
 assert.deepEqual([a.success,b.success].sort(),[false,true]);assert.ok([a.reason,b.reason].some(r=>r==='BUSY'||r==='FILE_CHANGED'));
});

const id='10000000-0000-4000-8000-000000000001';
async function setupServer(t){
 const root=await project(t);await writeFile(join(root,'.env'),'KEY=old\n');
 const outside=await project(t);await writeFile(join(outside,'secret.txt'),'outside');await symlink(join(outside,'secret.txt'),join(root,'link.txt'));
 const upstream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}res.end(JSON.stringify({session:{active:true,metadata:{machineId:'machine',path:root,flavor:'claude'}}}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:id,handoffTarget:{directory:join(root,'.records'),machineId:'machine',project:root}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const save=(body,headers={})=>fetch(origin+`/api/sessions/${id}/file-save`,{method:'POST',headers:{Authorization:'Bearer synthetic',Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 return {root,outside,origin,save};
}

test('file save route: Hub authorization, this Mac only, project paths only, no overwrite of changed files',async t=>{
 const {root,outside,origin,save}=await setupServer(t);const env={path:'.env',content:'KEY=new\n',expectedHash:sha('KEY=old\n')};
 assert.equal((await save(env,{Authorization:''})).status,401);
 assert.equal((await save(env,{Authorization:'Bearer bad'})).status,401);
 assert.equal((await save(env,{'X-Forwarded-For':'100.64.0.2'})).status,403,'remote clients stay read-only');
 assert.equal((await save(env,{Origin:'https://elsewhere.test'})).status,403);
 assert.equal((await save({...env,path:'../x'})).status,403);
 assert.equal((await save({path:'link.txt',content:'pwned',expectedHash:sha('outside')})).status,403);assert.equal(await readFile(join(outside,'secret.txt'),'utf8'),'outside');
 assert.equal((await save({...env,extra:1})).status,400);
 assert.equal((await save({...env,expectedHash:'zz'})).status,400);
 let r=await save({...env,expectedHash:sha('other')});assert.equal(r.status,409);assert.equal((await r.json()).reason,'FILE_CHANGED');
 assert.equal(await readFile(join(root,'.env'),'utf8'),'KEY=old\n');
 r=await save(env);assert.equal(r.status,200);const body=await r.json();assert.equal(body.success,true);assert.equal(body.hash,sha('KEY=new\n'));
 assert.equal(await readFile(join(root,'.env'),'utf8'),'KEY=new\n');
 assert.ok(!JSON.stringify(body).includes(root));
 const config=await(await fetch(origin+'/config')).json();assert.equal(config.fileEdit,true);
 const remote=await(await fetch(origin+'/config',{headers:{'X-Forwarded-For':'100.64.0.2'}})).json();assert.equal(remote.fileEdit,false);
});
