import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createNotice} from './notice.mjs';
function clock(){let now=0,timers=[];return {setTimer:(fn,ms)=>{const t={fn,at:now+ms};timers.push(t);return t;},clearTimer:t=>{timers=timers.filter(x=>x!==t);},tick(ms){now+=ms;for(const t of timers.filter(t=>t.at<=now)){timers=timers.filter(x=>x!==t);t.fn();}},get pending(){return timers.length;}};}
test('plain notices stay until replaced; fading ones clear themselves after a few seconds',()=>{
 const el={textContent:''},c=clock(),notice=createNotice(el,{delay:6000,setTimer:c.setTimer,clearTimer:c.clearTimer});
 notice('결과를 확인하지 못했습니다.');c.tick(60000);assert.equal(el.textContent,'결과를 확인하지 못했습니다.','errors and checks stay');
 notice('이전 이력을 추가로 불러왔습니다.',{fade:true});c.tick(5999);assert.equal(el.textContent,'이전 이력을 추가로 불러왔습니다.');c.tick(1);assert.equal(el.textContent,'');
});
test('a newer notice is never wiped by an older fading one',()=>{
 const el={textContent:''},c=clock(),notice=createNotice(el,{delay:6000,setTimer:c.setTimer,clearTimer:c.clearTimer});
 notice('다시 연결했습니다.',{fade:true});c.tick(3000);notice('중지 요청을 확인하지 못했습니다.');c.tick(10000);assert.equal(el.textContent,'중지 요청을 확인하지 못했습니다.');assert.equal(c.pending,0);
 notice('A',{fade:true});el.textContent='other module wrote';c.tick(6000);assert.equal(el.textContent,'other module wrote');
});
test('while a notice is shown, the file tab keeps its bottom clear (video controls, PDF, editor)',async()=>{
 const css=await readFile(new URL('./workspace/style.css',import.meta.url),'utf8');
 // The notice floats one status-bar height above the bottom and is at most 48px tall (border-box).
 assert.match(css,/body:has\(\.live-notice:not\(:empty\)\) \.file-view\{padding-bottom:calc\(var\(--statusbar-height\) \+ 48px\)\}/);
 assert.match(css,/\.live-notice\{[^}]*max-height:48px/);assert.match(css,/\*\{box-sizing:border-box\}/);
});
