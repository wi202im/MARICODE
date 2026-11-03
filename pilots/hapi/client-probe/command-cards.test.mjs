import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {createCommandCards,commandArgs,commandResult} from './command-cards.mjs';
import {accountRevision} from './machine-setup.mjs';
async function fixture(t,run){const root=await mkdtemp(join(tmpdir(),'maricode-cards-'));t.after(()=>rm(root,{recursive:true,force:true}));const env=join(root,'env.json'),config=join(root,'account.json');await writeFile(env,JSON.stringify({PATH:'/usr/bin:/bin',CLAUDE_CONFIG_DIR:root,CODEX_HOME:root}));await writeFile(config,JSON.stringify({directory:root,environment:env,cwd:root,binaries:{claude:'/bin/echo',codex:'/bin/echo'}}));const scope={sessionId:randomUUID(),agent:'codex',cwd:root,accountId:'default',alias:'Test',revision:await accountRevision(config)};return {root,config,env,scope,cards:createCommandCards(config,join(root,'cards'),{run})};}
test('fixed command builders never accept shell, credential URLs, arbitrary flags or unscoped deletion',()=>{
 assert.deepEqual(commandArgs('codex','mcp-add',{name:'demo',url:'https://example.test/mcp'}),['mcp','add','demo','--url','https://example.test/mcp']);
 assert.deepEqual(commandArgs('claude','mcp-remove',{name:'demo',scope:'local'}),['mcp','remove','--scope','local','demo']);
 for(const p of [{name:'--x',url:'https://a.test'},{name:'x',url:'https://u:p@a.test'},{name:'x',url:'https://a.test?token=x'},{name:'x',url:'https://a.test',args:['--yolo']},{name:'x',url:'file:///tmp/x'}])assert.throws(()=>commandArgs('codex','mcp-add',p));
 assert.throws(()=>commandArgs('claude','mcp-remove',{name:'demo'}));assert.throws(()=>commandArgs('claude','shell',{command:'echo x'}));
});
test('results expose only allowlisted fields and never raw errors, tokens, environment or launch commands',()=>{
 const secret='NEVER_SHOW_TEST_SECRET';const r=commandResult('codex','mcp-list',{code:0,stdout:JSON.stringify([{name:'demo',enabled:true,transport:{url:'https://a?token='+secret,env:{TOKEN:secret}},auth_status:'unsupported'}])});assert.equal(r.rows[0].name,'demo');assert.ok(!JSON.stringify(r).includes(secret));
 assert.ok(!JSON.stringify(commandResult('claude','mcp-list',{code:0,stdout:'demo: https://a?token='+secret+' (HTTP) - ✓ Connected\n'})).includes(secret));
 assert.ok(!JSON.stringify(commandResult('codex','plugins-list',{code:1,stderr:secret})).includes(secret));
 assert.throws(()=>commandResult('codex','mcp-list',{code:0,stdout:'not json'}));
});
test('mutations run once with explicit confirmation and frozen context, and persisted results recover lost responses',async t=>{
 let calls=0;const f=await fixture(t,async(b,args)=>{if(args.includes('--help'))return {code:0,stdout:'Usage: --json --scope'};if(args[1]==='list')return {code:0,stdout:'[]'};calls++;return {code:0,stdout:'private command output'};});const input={requestId:randomUUID(),action:'mcp-add',params:{name:'demo',url:'https://example.test/mcp'},confirm:true};
 await assert.rejects(f.cards.execute(f.scope,{...input,confirm:false}));assert.equal(calls,0);
 const one=await f.cards.execute(f.scope,input);assert.equal(one.state,'succeeded');assert.equal(one.needsReconnect,true);assert.equal(calls,1);
 const two=await f.cards.execute(f.scope,input);assert.deepEqual(two,one);assert.equal(calls,1);
 const restart=createCommandCards(f.config,join(f.root,'cards'),{run:()=>assert.fail('replay')});assert.deepEqual(await restart.result(f.scope,input.requestId),one);
 await assert.rejects(restart.result({...f.scope,sessionId:randomUUID()},input.requestId));
 await assert.rejects(f.cards.execute(f.scope,{...input,params:{name:'other',url:'https://example.test/mcp'}}));
 await writeFile(f.env,JSON.stringify({PATH:'/bin',CODEX_HOME:'/changed'}));await assert.rejects(f.cards.execute(f.scope,{...input,requestId:randomUUID()}));assert.equal(calls,1);
});
test('uncertain CLI mutation blocks fresh mutations and profile switching; reads stay available without automatic replay',async t=>{
 let mutations=0;const f=await fixture(t,async(b,args)=>{if(args.includes('--help'))return {code:0,stdout:'Usage: --json --scope'};if(args[1]==='list')return {code:0,stdout:'[]'};mutations++;throw Error('timeout secret');});
 const r=await f.cards.execute(f.scope,{requestId:randomUUID(),action:'mcp-add',params:{name:'demo',url:'https://example.test'},confirm:true});assert.equal(r.state,'unknown');assert.equal(await f.cards.pending('codex'),true);
 await assert.rejects(f.cards.execute(f.scope,{requestId:randomUUID(),action:'mcp-remove',params:{name:'demo'},confirm:true}));assert.equal(mutations,1);
 const read=await f.cards.execute(f.scope,{requestId:randomUUID(),action:'mcp-list',params:{}});assert.equal(read.state,'succeeded');assert.ok(!JSON.stringify(r).includes('secret'));
});
test('failures before command admission are rejected rather than creating phantom pending results',async t=>{
 const f=await fixture(t,async()=>({code:0,stdout:'Usage: --json --scope'}));await rm(f.env);
 await assert.rejects(f.cards.execute(f.scope,{requestId:randomUUID(),action:'account',params:{}}),e=>e.rejected===true);assert.equal(await f.cards.pending('codex'),false);
});

test('MCP login uses only a confirmed configured server and keeps OAuth output private',async t=>{
 for(const agent of ['claude','codex'])assert.deepEqual(commandArgs(agent,'mcp-login',{name:'demo'}),['mcp','login','demo']);
 assert.throws(()=>commandArgs('claude','mcp-login',{name:'demo',url:'https://auth.test'}));
 let finish,calls=0;const f=await fixture(t,async(b,args,opts)=>{
  if(args.includes('--help'))return {code:0,stdout:'Usage: --json --scope'};
  if(args[1]==='list')return {code:0,stdout:'[{"name":"demo","enabled":true}]'};
  assert.deepEqual(args,['mcp','login','demo']);assert.equal(opts.timeout,300000);calls++;return new Promise(r=>finish=r);
 });
 const input={requestId:randomUUID(),action:'mcp-login',params:{name:'demo'},confirm:true};
 await assert.rejects(f.cards.execute(f.scope,{...input,confirm:false}));
 await assert.rejects(f.cards.execute(f.scope,{...input,params:{name:'missing'}}));assert.equal(calls,0);
 const started=await f.cards.execute(f.scope,input);assert.equal(started.state,'running');assert.equal(await f.cards.pending('codex'),true);assert.equal(calls,1);
 assert.equal((await f.cards.execute(f.scope,input)).state,'running');assert.equal(calls,1);
 await assert.rejects(f.cards.execute(f.scope,{...input,requestId:randomUUID()}));
 finish({code:0,stdout:'https://auth.test/?code=SECRET',stderr:'SECRET'});
 let r;for(let i=0;i<50;i++){r=await f.cards.result(f.scope,input.requestId);if(r.state!=='running')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(r.state,'succeeded');assert.equal(r.needsReconnect,true);assert.ok(!JSON.stringify(r).includes('SECRET'));assert.equal(await f.cards.pending('codex'),false);
});

test('MCP authentication failures and timeouts do not claim success or expose callback data',()=>{
 const failure=commandResult('claude','mcp-login',{code:1,stdout:'secret URL',stderr:'secret code'});assert.equal(failure.failed,true);assert.ok(!JSON.stringify(failure).includes('secret'));
 assert.match(commandResult('claude','mcp-login',{code:0,stdout:'secret'}).summary,/인증/);
});

test('MCP list preserves spaced and namespaced CLI names without exposing server URLs',()=>{
 const r=commandResult('claude','mcp-list',{code:0,stdout:'claude.ai Slack: https://example.test/?secret=hidden - ✓ Connected\nplugin:demo: /fixture - Needs authentication\n'});
 assert.deepEqual(r.rows.map(r=>r.name),['claude.ai Slack','plugin:demo']);assert.ok(!JSON.stringify(r).includes('hidden'));
 assert.deepEqual(commandArgs('claude','mcp-login',{name:'plugin:demo'}),['mcp','login','plugin:demo']);
});
