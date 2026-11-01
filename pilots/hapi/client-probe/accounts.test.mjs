import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {accountStatus,createAccounts} from './accounts.mjs';
test('account status never exposes CLI output, account identifiers or API credentials',()=>{
 assert.deepEqual(accountStatus('codex',{code:0,stdout:'',stderr:'Logged in using ChatGPT'}),{state:'connected',method:'subscription'});
 assert.equal(accountStatus('codex',{code:1,stderr:'Not logged in'}).state,'signed-out');
 assert.equal(accountStatus('codex',{code:0,stderr:'Logged in using API key: secret'}).state,'other-auth');
 assert.equal(accountStatus('claude',{code:0,stdout:JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'private@example.test',token:'secret'})}).state,'connected');
 assert.equal(accountStatus('claude',{code:1,stdout:'invalid secret'}).state,'unknown');
});
test('account login preserves existing auth, locks before launch and retains lock across restart',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-account-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const configPath=join(root,'config.json');await writeFile(join(root,'env.json'),'{}');await writeFile(configPath,JSON.stringify({environment:join(root,'env.json'),directory:root,cwd:root,binaries:{claude:'/fake/claude',codex:'/fake/codex'}}));
 let logged=true,opens=0;
 const run=async()=>({code:logged?0:1,stderr:logged?'Logged in using ChatGPT':'Not logged in'}),open=async()=>{opens++;};
 const accounts=createAccounts(configPath,{run,open});
 assert.equal((await accounts.start('codex')).state,'connected');assert.equal(opens,0);
 logged=false;await Promise.all([accounts.start('codex'),accounts.start('codex')]);assert.equal(opens,1);
 const restarted=createAccounts(configPath,{run,open});await restarted.start('codex');assert.equal(opens,1);
 await assert.rejects(()=>accounts.start('../claude'));
 assert.equal((await accounts.status('codex')).loginPending,true);
});

test('terminal helper completes one synthetic login and then reports status without replay',async t=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const {fileURLToPath}=await import('node:url');
 const root=await mkdtemp(join(tmpdir(),'merry-login-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const binary=join(root,'fake-codex'),configPath=join(root,'config.json');
 await writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[3]==='status'){const yes=fs.existsSync('connected');console.error(yes?'Logged in using ChatGPT':'Not logged in');process.exit(yes?0:1);}fs.appendFileSync('connected','one');\n`,{mode:0o700});
 await writeFile(join(root,'env.json'),'{}');await writeFile(configPath,JSON.stringify({environment:join(root,'env.json'),directory:root,cwd:root,binaries:{claude:binary,codex:binary}}));
 const accounts=createAccounts(configPath,{open:async()=>{}});await accounts.start('codex');
 const run=promisify(execFile),helper=fileURLToPath(new URL('./accounts.mjs',import.meta.url));await run(process.execPath,[helper,configPath,'codex']);
 const status=await accounts.status('codex');assert.equal(status.state,'connected');assert.equal(status.loginPending,false);
 await assert.rejects(()=>run(process.execPath,[helper,configPath,'codex']));
 const {readFile}=await import('node:fs/promises');assert.equal(await readFile(join(root,'connected'),'utf8'),'one');
});

test('one configured AI works independently and missing or invalid configuration never launches login',async t=>{
 const root=await mkdtemp(join(tmpdir(),'merry-account-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const configPath=join(root,'config.json'),environment=join(root,'env.json');
 await writeFile(environment,'{}');
 const base={environment,directory:root,cwd:root,binaries:{codex:'/fake/codex'}};
 await writeFile(configPath,JSON.stringify(base));let runs=0,opens=0;
 const accounts=createAccounts(configPath,{run:async()=>{runs++;return {code:0,stderr:'Logged in using ChatGPT'};},open:async()=>{opens++;}});
 assert.equal((await accounts.status('codex')).state,'connected');
 assert.equal((await accounts.start('claude')).state,'not-configured');assert.equal(runs,1);assert.equal(opens,0);
 await writeFile(configPath,JSON.stringify({...base,binaries:{...base.binaries,claude:'relative/claude'}}));
 assert.equal((await accounts.status('claude')).state,'configuration-error');
 assert.equal((await accounts.status('codex')).state,'connected');
 await writeFile(environment,'{"TOKEN":42}');
 assert.equal((await accounts.start('codex')).state,'configuration-error');assert.equal(opens,0);
 await writeFile(environment,'{}');await writeFile(configPath,JSON.stringify({...base,cwd:join(root,'missing')}));
 assert.equal((await accounts.status('codex')).state,'configuration-error');
});
