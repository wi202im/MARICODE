import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDmg} from './dmg.mjs';
test('DMG packaging rejects incomplete bundles and preserves an existing destination',async t=>{
 const root=await mkdtemp(join(tmpdir(),'maricode-dmg-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const app=join(root,'MARICODE.app'),out=join(root,'output');await mkdir(app);
 await assert.rejects(createDmg(app,out));await assert.rejects(readFile(join(out,'MARICODE-1.0.0-arm64.dmg')));
 await mkdir(out);await writeFile(join(out,'keep'),'existing');
 await assert.rejects(createDmg(app,out));assert.equal(await readFile(join(out,'keep'),'utf8'),'existing');
});
