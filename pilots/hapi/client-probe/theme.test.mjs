import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {themes,readTheme,applyTheme,setTheme,themeKey} from './theme.mjs';

const store=(v)=>{const m=new Map(v===undefined?[]:[[themeKey,v]]);return {getItem:k=>m.get(k)??null,setItem:(k,val)=>m.set(k,val),m};};
const page=()=>{const meta={content:'#10151d'},events=[],posted=[];return {documentElement:{dataset:{}},querySelector:s=>s==='meta[name="theme-color"]'?meta:null,dispatchEvent:e=>events.push(e),meta,events,posted,
 bridge:{postMessage:m=>posted.push(m)}};};

test('theme is a per-device choice: dark by default, light when chosen, anything else is dark',()=>{
 assert.deepEqual(themes,['dark','light']);
 assert.equal(readTheme(store()),'dark');assert.equal(readTheme(store('light')),'light');assert.equal(readTheme(store('neon')),'dark');
 assert.equal(readTheme({getItem(){throw Error('blocked');}}),'dark');assert.equal(readTheme(null),'dark');
});
test('applying a theme sets the page, the browser bar colour and tells the Mac app window',()=>{
 const p=page();applyTheme(p,'light',{bridge:p.bridge});
 assert.equal(p.documentElement.dataset.theme,'light');assert.equal(p.meta.content,'#f8f8f8');assert.deepEqual(p.posted,['theme-light']);
 applyTheme(p,'dark',{bridge:p.bridge});assert.equal(p.documentElement.dataset.theme,'dark');assert.equal(p.meta.content,'#181818');assert.deepEqual(p.posted,['theme-light','theme-dark']);
 applyTheme(p,'bogus');assert.equal(p.documentElement.dataset.theme,'dark');
});
test('choosing a theme stores it on this device and announces the change to open views (editor)',()=>{
 const p=page(),s=store();const Event=class{constructor(type,o){this.type=type;this.detail=o?.detail;}};
 setTheme(p,s,'light',{bridge:p.bridge,Event});
 assert.equal(s.m.get(themeKey),'light');assert.equal(p.documentElement.dataset.theme,'light');assert.equal(p.events.at(-1).type,'maricode-theme');assert.equal(p.events.at(-1).detail,'light');
 setTheme(p,{setItem(){throw Error('full');}},'dark',{Event});assert.equal(p.documentElement.dataset.theme,'dark','storage failure still switches this window');
});
test('the light palette redefines every colour the dark palette defines',async()=>{
 const css=await readFile(new URL('./theme.css',import.meta.url),'utf8');
 const block=sel=>{const i=css.indexOf(sel+'{');assert.ok(i>=0,sel);return css.slice(i,css.indexOf('}',i));};
 const colours=b=>new Set([...b.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\b/g)].map(m=>m[1]));
 const dark=colours(block(':root')),light=colours(block(':root[data-theme=light]'));
 assert.ok(dark.size>20);assert.deepEqual([...dark].filter(v=>!light.has(v)),[]);assert.match(block(':root[data-theme=light]'),/color-scheme:light/);
});
test('the early theme script is a plain file the CSP allows and every page loads it before styles',async()=>{
 const init=await readFile(new URL('./theme-init.js',import.meta.url),'utf8');assert.match(init,/maricode-theme/);assert.ok(!/import |export /.test(init));
 for(const name of ['workspace/index.html','setup/index.html','install.html']){const html=await readFile(new URL('./'+name,import.meta.url),'utf8');const s=html.indexOf('<script src="/theme-init.js"></script>'),l=html.indexOf('<link rel="stylesheet"');assert.ok(s>0&&s<l,name);}
});
