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
 assert.equal((await accounts.status('codex')).state,'connected');
 await writeFile(configPath,JSON.stringify({...base,cwd:environment}));
 assert.equal((await accounts.status('codex')).state,'configuration-error');
});

test('new CLI connection must be confirmed before status or login executes any installed CLI',async t=>{
 const root=await mkdtemp(join(tmpdir(),'cli-consent-'));t.after(()=>rm(root,{recursive:true,force:true}));const configPath=join(root,'accounts.json');await writeFile(join(root,'env'),JSON.stringify({CODEX_HOME:root,PATH:'/bin'}));await writeFile(configPath,JSON.stringify({environment:join(root,'env'),directory:root,cwd:root,binaries:{codex:'/bin/echo'},cliConnectionRequired:true}));let calls=0;
 const accounts=createAccounts(configPath,{run:async()=>{calls++;return {code:1,stderr:'Not logged in'};},open:async()=>{calls++;}});
 assert.equal((await accounts.start('codex')).state,'connection-required');assert.equal(calls,0);
});

test('account authentication survives a removed default project without changing CLI environment or saved configuration',async t=>{
 const {readFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'account-no-project-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'accounts.json'),env={CODEX_HOME:join(root,'profile'),CUSTOM:'preserved'};
 await writeFile(join(root,'env.json'),JSON.stringify(env));
 const original=JSON.stringify({environment:join(root,'env.json'),directory:root,cwd:join(root,'removed-project'),binaries:{codex:'/fake/codex'}});await writeFile(path,original);
 let calls=0,opens=0;const accounts=createAccounts(path,{run:async(binary,args,options)=>{calls++;assert.equal(options.cwd,root);assert.deepEqual(options.env,env);return {code:1,stderr:'Not logged in'};},open:async()=>{opens++;}});
 assert.equal((await accounts.status('codex')).state,'signed-out');
 assert.equal((await accounts.start('codex')).loginPending,true);assert.equal(opens,1);assert.equal(calls,2);
 assert.equal(await readFile(path,'utf8'),original);
});
