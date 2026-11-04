import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {icons,icon} from './vendor/lucide.mjs';

test('the Lucide icons the app uses are vendored, and icon() builds an inline SVG',()=>{
 // Names used by app.mjs, file-tree, file-viewer, attachment-composer and chat-render.
 for(const name of ['x','plus','folder','layers','chevron-down','chevron-right','ellipsis','git-branch','paperclip','circle-check','circle-dot','circle'])assert.ok(icons[name]?.length,name);
 for(const name of ['chevron-right','ellipsis','sparkles'])assert.ok(existsSync(new URL(`vendor/lucide/${name}.svg`,import.meta.url)),name);
 const doc={createElementNS:(ns,tag)=>({ns,tag,attrs:{},children:[],setAttribute(k,v){this.attrs[k]=v;},append(c){this.children.push(c);}})};
 const svg=icon('x',doc);assert.equal(svg.tag,'svg');assert.equal(svg.attrs.class,'glyph');assert.equal(svg.attrs['aria-hidden'],'true');
 assert.deepEqual(svg.children.map(c=>c.attrs.d),['M18 6 6 18','m6 6 12 12']);
});
