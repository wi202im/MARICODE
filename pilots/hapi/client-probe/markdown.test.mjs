import test from 'node:test';import assert from 'node:assert/strict';
import {parseMarkdown,inlineTokens,safeLink,pathTarget} from './markdown.mjs';
test('developer replies preserve code and separate headings, lists and tables',()=>{
 const blocks=parseMarkdown('## Result\n\n**Done**\n\n- one\n- two\n\n```js\nconst x = "<script>";\n```\n\n| Input | Output |\n|---|---|\n| 1 | 2 |');
 assert.deepEqual(blocks.map(b=>b.type),['heading','paragraph','list','code','table']);
 assert.equal(blocks[3].text,'const x = "<script>";');assert.deepEqual(blocks[4].rows,[['1','2']]);
 assert.deepEqual(inlineTokens('**Done** and `x`').map(t=>t.type),['strong','text','code']);
});
test('untrusted markdown never creates active HTML, images or unsafe links',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,x','//evil.test','file:///secret','https://user:pass@host.test','https://host.test/\n'])assert.equal(safeLink(url),null);
 assert.equal(safeLink('https://example.com/path'),'https://example.com/path');
 assert.equal(parseMarkdown('<script>alert(1)</script>')[0].text,'<script>alert(1)</script>');
 assert.equal(inlineTokens('[run](javascript:alert(1))').some(t=>t.type==='link'),false);
 assert.equal(inlineTokens('![tracking](https://example.com/img)').some(t=>t.type==='image'),false);
});
test('incomplete streaming fences remain code and escaped delimiters remain literal',()=>{
 assert.equal(parseMarkdown('```ts\nconst a = 1')[0].type,'code');
 assert.equal(inlineTokens('\\*literal\\*').map(t=>t.text).join(''),'*literal*');
});
test('replies make bare URLs, project paths and path-like code clickable',()=>{
 const t=inlineTokens('See https://example.com/a. and docs/handoff.md에 or `src/app.mjs:12` and [dir](pilots/hapi/) but `npm test` and v1.1.1');
 assert.deepEqual(t.filter(x=>x.type==='link').map(x=>x.href),['https://example.com/a']);
 assert.deepEqual(t.filter(x=>x.path).map(x=>[x.type,x.path]),[['path','docs/handoff.md'],['code','src/app.mjs'],['path','pilots/hapi/']]);
 assert.equal(pathTarget('/Users/me/x/theme.css#L3'),'/Users/me/x/theme.css');
 for(const v of ['npm test','1.1.1','--content-width','https://x.test/a.js','a<b>.js'])assert.equal(pathTarget(v),null);
});
