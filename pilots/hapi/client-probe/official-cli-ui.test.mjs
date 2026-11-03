import test from 'node:test';import assert from 'node:assert/strict';
import {needsOfficialCli,cliUiState} from './official-cli-ui.mjs';
test('Claude interactive settings are diverted before sending, without intercepting conversation or compact',()=>{
 for(const text of ['/mcp',' /mcp login ','/config'])assert.equal(needsOfficialCli('claude',text),true);
 for(const text of ['/compact','explain /mcp','/mcpx',''])assert.equal(needsOfficialCli('claude',text),false);
 assert.equal(needsOfficialCli('codex','/mcp'),false);
});
test('CLI UI does not re-enable launch on uncertain state or claim settings applied after shell exit',()=>{
 for(const phase of ['opening','running','unknown'])assert.equal(cliUiState({phase,supported:true},true).canOpen,false);
 assert.equal(cliUiState(null,true).canOpen,false);assert.equal(cliUiState({phase:'idle',supported:true},false).canOpen,false);
 assert.equal(cliUiState({phase:'idle',supported:false},true).canOpen,false);
 assert.equal(cliUiState({phase:'finished',supported:true},true).canOpen,true);
 assert.match(cliUiState({phase:'finished',supported:true},true).text,/자동 반영/);
});
test('CLI controls preserve target and prevent replay after lost launch response, with explicit status recovery',async()=>{
 const {officialCliControls}=await import('./official-cli-ui.mjs');
 const nodes=[];const doc={createElement(tag){const n={tag,children:[],dataset:{},value:'',append(...items){this.children.push(...items);},setAttribute(){}};nodes.push(n);return n;}};
 let posts=0,phase='opening';const box=officialCliControls({agent:'claude',profile:{active:'default',accounts:[{id:'default',alias:'Test'}]},local:true,state:{phase:'idle',supported:true},projects:[{key:'one',label:'Project',path:'/fixture'}],selected:'one',valid:()=>true,document:doc,api:async(path,options)=>{if(options){posts++;assert.deepEqual(options.body,{agent:'claude',accountId:'default',project:'one'});throw Error('lost');}return {claude:{phase,supported:true}};}});
 const [open,check]=nodes.filter(n=>n.tag==='button');assert.equal(open.disabled,false);await open.onclick();assert.equal(posts,1);assert.equal(open.disabled,true);
 await open.onclick();assert.equal(posts,1);await check.onclick();assert.equal(open.disabled,true);
 phase='finished';await check.onclick();assert.equal(open.disabled,false);assert.equal(posts,1);
 assert.ok(box.children.length>0);
});
