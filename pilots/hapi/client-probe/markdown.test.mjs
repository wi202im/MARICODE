import test from 'node:test';import assert from 'node:assert/strict';
import {parseMarkdown,inlineTokens,safeLink} from './markdown.mjs';
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
