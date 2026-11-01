import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {checkDataFormat} from './data-format.mjs';
test('format marker survives repeated launches without changing existing data',async t=>{
 const d=await mkdtemp(join(tmpdir(),'merry-format-'));t.after(()=>rm(d,{recursive:true,force:true}));
 await writeFile(join(d,'environment.json'),'existing settings');await checkDataFormat(d);
 const before=await readFile(join(d,'data-format.json'),'utf8');await checkDataFormat(d);
 assert.equal(await readFile(join(d,'data-format.json'),'utf8'),before);assert.equal(await readFile(join(d,'environment.json'),'utf8'),'existing settings');
});
test('newer or malformed formats fail without overwriting the marker or data',async t=>{
 const d=await mkdtemp(join(tmpdir(),'merry-format-'));t.after(()=>rm(d,{recursive:true,force:true}));
 for(const raw of ['{"product":"merry-development","version":2}','null','broken']){
  await writeFile(join(d,'data-format.json'),raw);await assert.rejects(checkDataFormat(d),/format/i);assert.equal(await readFile(join(d,'data-format.json'),'utf8'),raw);
 }
});
