import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopAccess} from './desktop-access.mjs';
test('native grant is single-use, expires and is never an URL credential',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'merry-access-'));t.after(()=>rm(directory,{recursive:true,force:true}));let now=1,calls=0;
 const access=createDesktopAccess({directory,authenticate:async()=>{calls++;return 'issued-synthetic';},now:()=>now});
 await access.prepare('http://127.0.0.1:12345');
 const html=await readFile(access.path,'utf8'),code=/name="code" value="([a-f0-9]+)"/.exec(html)[1];
 assert.match(html,/action="http:\/\/127.0.0.1:12345\/desktop-connect"/);
 assert.equal(await access.exchange(code),'issued-synthetic');await assert.rejects(access.exchange(code));assert.equal(calls,1);
 await access.prepare('http://127.0.0.1:12345');const next=/name="code" value="([a-f0-9]+)"/.exec(await readFile(access.path,'utf8'))[1];now+=31000;
 await assert.rejects(access.exchange(next));assert.equal(calls,1);await access.close();
});
