import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('release builder includes every local runtime import in its explicit launcher copy list',async()=>{
 const build=await readFile(new URL('./build.mjs',import.meta.url),'utf8'),seen=new Set();
 async function visit(name){if(seen.has(name))return;seen.add(name);assert.ok((build.includes("'"+name+"'")||build.includes("/"+name+"'")),`Release builder omits runtime dependency: ${name}`);const source=await readFile(new URL(name,import.meta.url),'utf8');for(const [,next] of source.matchAll(/(?:from\s*|import\s*\()['"]\.\/([^'"/]+\.mjs)['"]/g))await visit(next);}
 await visit('runtime.mjs');
});
test('the unused secure-login prototype is not copied into the app bundle',async()=>{
 const build=await readFile(new URL('./build.mjs',import.meta.url),'utf8');
 const list=/\[('connections'[^\]]*)\]\.includes\(item\.name\)/.exec(build)?.[1];
 assert.ok(list,'directory copy list found');assert.ok(!list.includes("'secure-login'"));assert.ok(list.includes("'setup'")&&list.includes("'workspace'"));
});
