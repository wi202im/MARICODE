import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOfficialCli,runOfficialCli} from './official-cli.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'maricode-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const cwd=join(root,"project ' $(not-a-command)"),profile=join(root,'profile');await mkdir(cwd);await mkdir(profile);
 const environment=join(root,'env.json'),configPath=join(root,'accounts.json');
 await writeFile(environment,JSON.stringify({PATH:'/usr/bin:/bin',CLAUDE_CONFIG_DIR:profile,CODEX_HOME:profile,PRIVATE_TEST:'secret-fixture'}));
 await writeFile(configPath,JSON.stringify({environment,directory:join(root,'login'),cwd,binaries:{claude:'/bin/echo',codex:'/bin/echo'}}));
 return {root,cwd,profile,environment,configPath,request:{agent:'claude',accountId:'default',cwd}};
}
test('official CLI freezes the selected environment and folder without resuming a conversation',async t=>{
 const f=await fixture(t);let script;
 const cli=createOfficialCli(f.configPath,{platform:'darwin',open:async p=>{script=p;}});
 assert.equal((await cli.status('claude')).phase,'idle');
 const result=await cli.start(f.request);assert.equal(result.phase,'opening');assert.ok(script.endsWith('.command'));
 assert.equal(JSON.stringify(result).includes('secret-fixture'),false);
 assert.equal((await stat(script)).mode&0o777,0o700);
 let directory=join(f.root,'login','official-cli-claude',(await cli.status('claude')).id);
 assert.equal((await stat(join(directory,'request.private.json'))).mode&0o777,0o600);
 await writeFile(f.environment,JSON.stringify({PATH:'/bin',CLAUDE_CONFIG_DIR:'/wrong'}));
 let observed;await runOfficialCli(directory,{run:async plan=>{observed=plan;return 0;}});
 assert.equal(observed.cwd,f.cwd);assert.equal(observed.env.CLAUDE_CONFIG_DIR,f.profile);
 assert.ok(observed.env.PATH.startsWith(join(directory,'bin')+':'));
 const rc=await readFile(join(directory,'shell.rc'),'utf8');assert.ok(rc.includes('/bin/echo'));assert.ok(!rc.includes('--resume'));assert.ok(!rc.includes('secret-fixture'));
 assert.equal((await cli.status('claude')).phase,'finished');
 await assert.rejects(runOfficialCli(directory,{run:async()=>assert.fail('replayed')}));
});
test('uncertain and duplicate launch never reopens a terminal, including after service restart',async t=>{
 const f=await fixture(t);let opens=0;const deps={platform:'darwin',open:async()=>{opens++;throw Error('uncertain');}};
 const cli=createOfficialCli(f.configPath,deps);await assert.rejects(cli.start(f.request));
 await assert.rejects(cli.start(f.request));await assert.rejects(createOfficialCli(f.configPath,deps).start(f.request));assert.equal(opens,1);
 assert.equal((await cli.status('claude')).phase,'opening');
});
test('official CLI rejects unsupported host, stale account, missing folder, and arbitrary options',async t=>{
 const f=await fixture(t);let opens=0;const cli=createOfficialCli(f.configPath,{platform:'darwin',open:async()=>opens++});
 await assert.rejects(cli.start({...f.request,accountId:'old'}));
 await assert.rejects(cli.start({...f.request,cwd:join(f.root,'absent')}));
 await assert.rejects(cli.start({...f.request,args:['--dangerously-skip-permissions']}));
 await assert.rejects(createOfficialCli(f.configPath,{platform:'linux',open:async()=>opens++}).start(f.request));
 assert.equal(opens,0);
});
test('confirmed CLI exit permits an explicit new launch but CLI failure is not reported as success',async t=>{
 const f=await fixture(t);let opens=0;const cli=createOfficialCli(f.configPath,{platform:'darwin',open:async()=>opens++});
 await cli.start(f.request);let directory=join(f.root,'login','official-cli-claude',(await cli.status('claude')).id);
 await runOfficialCli(directory,{run:async()=>7});assert.deepEqual((await cli.status('claude')).exitCode,7);
 await cli.start(f.request);assert.equal(opens,2);directory=join(f.root,'login','official-cli-claude',(await cli.status('claude')).id);
 await runOfficialCli(directory,{run:async()=>{throw Error('secret error');}}).catch(()=>{});
 assert.equal((await cli.status('claude')).phase,'failed');
 assert.equal(JSON.stringify(await cli.status('claude')).includes('secret'),false);
});
test('runner CLI launch validates auth, registered folder and account; connection changes are blocked while CLI is pending',async t=>{
 const {createRunnerSetup}=await import('./runner-setup.mjs'),{projectRegistry}=await import('./project-registry.mjs'),{createServer}=await import('node:http');
 const f=await fixture(t);const hub=createServer((req,res)=>{res.writeHead(req.headers.authorization==='Bearer fixture'?200:401,{'Content-Type':'application/json'}).end('{"sessions":[]}');});
 await new Promise(r=>hub.listen(0,'127.0.0.1',r));t.after(()=>{hub.closeAllConnections();hub.close();});
 const projectsPath=join(f.root,'projects.json'),project=await projectRegistry(projectsPath).add(f.cwd);let opens=0;
 const cli=createOfficialCli(f.configPath,{platform:'darwin',open:async()=>opens++});
 const runner=createRunnerSetup({directory:join(f.root,'runner'),projectsPath,accountConfig:f.configPath,binary:'/bin/echo',tokenFile:join(f.root,'token'),hubUrl:`http://127.0.0.1:${hub.address().port}`},{officialCli:cli});
 const input={agent:'claude',accountId:'default',project:project.id};
 await assert.rejects(runner.openOfficialCli('Bearer wrong',input));
 await assert.rejects(runner.openOfficialCli('Bearer fixture',{...input,project:'missing'}));
 await assert.rejects(runner.openOfficialCli('Bearer fixture',{...input,cwd:f.cwd}));assert.equal(opens,0);
 const result=await runner.openOfficialCli('Bearer fixture',input);assert.equal(result.cwd,await realpath(f.cwd));assert.equal(opens,1);
 await assert.rejects(runner.accountProfile('Bearer fixture',{action:'connect',agent:'claude',source:f.cwd,confirm:true}),/CLI/);
});
test('real helper shell uses only the snapshot profile and exact registered executable for interactive and subsequent MCP commands',async t=>{
 const {execFile}=await import('node:child_process'),{fileURLToPath}=await import('node:url');const f=await fixture(t);
 const binary=join(f.root,'fixture-cli'),resultPath=join(f.cwd,'calls.jsonl');
 await writeFile(binary,`#!${process.execPath}\nrequire('node:fs').appendFileSync('calls.jsonl',JSON.stringify({cwd:process.cwd(),profile:process.env.CLAUDE_CONFIG_DIR,args:process.argv.slice(2)})+'\\n');\n`,{mode:0o700});
 const config=JSON.parse(await readFile(f.configPath,'utf8'));config.binaries.claude=binary;await writeFile(f.configPath,JSON.stringify(config));
 const cli=createOfficialCli(f.configPath,{platform:'darwin',open:async()=>{}});const request=await cli.start(f.request),directory=join(f.root,'login','official-cli-claude',request.id);
 await new Promise((resolve,reject)=>{const child=execFile(process.execPath,[fileURLToPath(new URL('./official-cli.mjs',import.meta.url)),directory],{timeout:10000},error=>error?reject(error):resolve());child.stdin.end('claude mcp list\nexit\n');});
 const canonicalCwd=await realpath(f.cwd);const calls=(await readFile(resultPath,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,2);
 assert.deepEqual(calls.map(c=>c.args),[[],['mcp','list']]);assert.ok(calls.every(c=>c.profile===f.profile&&c.cwd===canonicalCwd));
 assert.equal((await cli.status('claude')).phase,'finished');
});
