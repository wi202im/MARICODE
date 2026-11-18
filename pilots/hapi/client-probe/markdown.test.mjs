import test from 'node:test';import assert from 'node:assert/strict';
import {renderMarkdown,safeLink,pathTarget} from './markdown.mjs';
// Minimal DOM: elements are plain objects, so any HTML string in the output would stay inert text.
const text=v=>({text:String(v)});
class El{constructor(tag){this.tag=tag;this.tagName=tag.toUpperCase();this.kids=[];this.attrs={};this.dataset={};}append(...n){this.kids.push(...n.map(x=>typeof x==='string'?text(x):x));}setAttribute(k,v){this.attrs[k]=String(v);}set textContent(v){this.kids=[text(v)];}get textContent(){return this.kids.map(k=>k.text??k.textContent).join('');}}
const doc={createElement:t=>new El(t),createTextNode:text};
const html=n=>n.text!==undefined?n.text:`<${n.tag}${n.attrs.start?' start='+n.attrs.start:''}${n.href?' href='+n.href:''}${n.dataset.path?' path='+n.dataset.path:''}>${n.kids.map(html).join('')}</${n.tag}>`;
const render=s=>html(renderMarkdown(s,doc));
const all=(n,tag,out=[])=>{if(n.tag===tag)out.push(n);for(const k of n.kids??[])all(k,tag,out);return out;};

test('developer replies keep headings, emphasis, lists, code blocks and tables',()=>{
 const root=renderMarkdown('## Result\n\n**Done** and `x`\n\n- one\n- two\n\n```js\nconst x = "<script>";\n```\n\n| Input | Output |\n|---|---|\n| 1 | 2 |',doc);
 assert.deepEqual(root.kids.map(k=>k.tag),['h3','p','ul','section','div']);
 assert.equal(html(root.kids[1]),'<p><strong>Done</strong> and <code>x</code></p>');
 assert.equal(all(root,'code').at(-1).textContent,'const x = "<script>";');assert.equal(all(root,'span')[0].textContent,'js');
 assert.equal(root.kids[4].className,'markdown-table');assert.deepEqual(all(root,'td').map(td=>td.textContent),['1','2']);
});
test('untrusted markdown never creates active HTML, images or unsafe links',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,x','//evil.test','file:///secret','https://user:pass@host.test','https://host.test/\n'])assert.equal(safeLink(url),null);
 assert.equal(safeLink('https://example.com/path'),'https://example.com/path');
 assert.equal(render('<script>alert(1)</script>'),'<div><p><script>alert(1)</script></p></div>');assert.equal(all(renderMarkdown('<script>x</script>',doc),'script').length,0);
 assert.equal(all(renderMarkdown('[run](javascript:alert(1)) <a href="x">y</a>',doc),'a').length,0);
 const image=renderMarkdown('![tracking](https://example.com/img)',doc);assert.equal(all(image,'img').length,0);
});
test('incomplete streaming fences remain code and escaped delimiters remain literal',()=>{
 assert.equal(renderMarkdown('```ts\nconst a = 1',doc).kids[0].className,'code-block');
 assert.equal(render('\\*literal\\*'),'<div><p>*literal*</p></div>');
});
test('replies make http links, project paths and path-like code clickable',()=>{
 const root=renderMarkdown('See https://example.com/a. and docs/handoff.md에 or `src/app.mjs:12` and [dir](pilots/hapi/) but `npm test`, v1.1.1 and handoff.md',doc),links=all(root,'a');
 assert.deepEqual(links.filter(a=>a.target).map(a=>[a.href,a.rel]),[['https://example.com/a','noopener noreferrer']]);
 assert.deepEqual(links.filter(a=>a.dataset.path).map(a=>[a.textContent,a.dataset.path]),[['docs/handoff.md','docs/handoff.md'],['src/app.mjs:12','src/app.mjs'],['dir','pilots/hapi/']]);
 assert.equal(pathTarget('/Users/me/x/theme.css#L3'),'/Users/me/x/theme.css');
 for(const v of ['npm test','1.1.1','--content-width','https://x.test/a.js','a<b>.js'])assert.equal(pathTarget(v),null);
});
test('numbered items split by blank lines or bullet details keep their own numbers',()=>{
 assert.deepEqual(all(renderMarkdown('1. **First**\n\n- detail\n\n2. **Second**\n\n- detail\n\n3. Third\n4. Fourth',doc),'ol').map(o=>o.attrs.start??'1'),['1','2','3']);
});
test('AI reply shapes: nested lists, code in lists, rules, nested emphasis, table pipes and breaks',()=>{
 assert.equal(render('1. 항목\n   - 하위 A\n   - 하위 B\n2. 다음'),'<div><ol><li>항목<ul><li>하위 A</li><li>하위 B</li></ul></li><li>다음</li></ol></div>');
 const listCode=renderMarkdown('1. 실행:\n   ```bash\n   npm test\n   ```\n2. 확인',doc);assert.equal(all(listCode,'ol').length,1);assert.equal(all(listCode,'code')[0].textContent,'npm test');
 assert.equal(render('- 첫 줄\n  이어지는 줄\n- 둘째'),'<div><ul><li>첫 줄\n이어지는 줄</li><li>둘째</li></ul></div>');
 assert.equal(all(renderMarkdown('위\n\n---\n\n아래',doc),'hr').length,1);
 assert.equal(render('**`npm test` 통과** ~~취소~~'),'<div><p><strong><code>npm test</code> 통과</strong> <s>취소</s></p></div>');
 const table=renderMarkdown('| 명령 | 설명 |\n|---|---|\n| `a \\| b` | 줄1<br>줄2 |',doc);
 assert.deepEqual(all(table,'td').map(html),['<td><code>a | b</code></td>','<td>줄1<br></br>줄2</td>']);
 assert.equal(render('2 * 3 * 4 = 24'),'<div><p>2 * 3 * 4 = 24</p></div>');
});
