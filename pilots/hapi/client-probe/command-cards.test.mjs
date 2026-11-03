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
