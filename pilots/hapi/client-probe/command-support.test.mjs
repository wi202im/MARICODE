import test from 'node:test';import assert from 'node:assert/strict';
import {supportedChatCommands,chatCommandName,chatCommandSupported} from './command-support.mjs';
import {commandMatches,commandQuery} from './composer-commands.mjs';
const builtin=name=>({name,source:'builtin',description:name});
test('preview excludes CLI-only, unverified and not-yet-integrated cards for each provider',()=>{
 const all=['compact','status','model','mcp','config','plugin','doctor','clear','goal','help','plan'].map(builtin);
 assert.deepEqual(supportedChatCommands('claude',all).map(c=>c.name),['compact']);
 assert.deepEqual(supportedChatCommands('codex',all).map(c=>c.name),['compact','status','model','plan']);
 assert.deepEqual(supportedChatCommands('unknown',all),[]);
 assert.deepEqual(commandMatches({commands:supportedChatCommands('claude',all)},commandQuery('/mcp')),[]);
});
test('only reported custom commands with known source and content remain; unsupported builtins cannot masquerade as custom',()=>{
 const custom=[{name:'review-team',source:'project',content:'review carefully',description:'팀 검토'},{name:'plugin:check',source:'plugin',content:'check'},
 {name:'missing',source:'user'},{name:'invented',source:'engine',content:'x'}, {name:'mcp',source:'project',content:'not real MCP management'}, {name:'bad name',source:'project',content:'x'}];
 for(const agent of ['claude','codex']){
  const found=supportedChatCommands(agent,custom);assert.deepEqual(found.map(c=>c.name),['review-team','plugin:check']);assert.match(found[0].description,/사용자 정의/);
 }
});
test('typed commands use the same current catalog policy and preserve normal text and paths',()=>{
 for(const text of ['please /mcp','/Users/test/file','`/mcp`','hello','https://test','// comment'])assert.equal(chatCommandName(text),null);
 assert.equal(chatCommandName(' /MCP list'),'mcp');assert.equal(chatCommandName('/plugin:check'),'plugin:check');
 assert.equal(chatCommandSupported('claude','/compact summarize', [builtin('compact')]),true);
 assert.equal(chatCommandSupported('claude','/mcp',[builtin('mcp')]),false);
 assert.equal(chatCommandSupported('codex','/model sample',[builtin('model')]),true);
 assert.equal(chatCommandSupported('codex','/model sample',[]),false);
 assert.equal(chatCommandSupported('codex','/new',[builtin('new')]),false);
});
