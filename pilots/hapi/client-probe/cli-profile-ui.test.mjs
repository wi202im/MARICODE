import test from 'node:test';import assert from 'node:assert/strict';
import {cliProfileControls} from './cli-profile-ui.mjs';
test('CLI discovery never links or switches implicitly; changed source invalidates review; registration requires sharing consent',async()=>{
 const nodes=[],doc={createElement(tag){const n={tag,children:[],value:'',checked:false,append(...v){this.children.push(...v);},setAttribute(){}};nodes.push(n);return n;}};
 const calls=[];let linked=0;
 cliProfileControls({agent:'claude',local:true,document:doc,api:async(path,{body})=>{calls.push(body);return body.action==='discover'?{source:body.source||'/fixture/cli',origin:'selected',mode:'explicit',exists:true,binary:'/bin/fixture',current:'/fixture/app'}:{id:'linked'};},linked:()=>{linked++;}});
 const find=nodes.find(n=>n.textContent==='기존 CLI 설정 찾기'),source=nodes.find(n=>n.tag==='input'&&n.type==='text'),consent=nodes.find(n=>n.type==='checkbox'),link=nodes.find(n=>n.textContent==='이 CLI로 연결');
 await find.onclick();assert.equal(calls.length,1);assert.equal(link.disabled,true);
 consent.checked=true;consent.onchange();assert.equal(link.disabled,false);
 source.value='/fixture/other';source.oninput();assert.equal(consent.checked,false);assert.equal(link.disabled,true);
 await link.onclick();assert.equal(calls.length,1);
 await find.onclick();consent.checked=true;consent.onchange();await link.onclick();assert.equal(linked,1);
 assert.deepEqual(calls.at(-1),{action:'connect',agent:'claude',source:'/fixture/other',confirm:true,create:false,mode:'explicit'});assert.equal(calls.some(c=>c.action==='switch'),false);
});
