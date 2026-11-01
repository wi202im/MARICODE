import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('release and development data locations are fixed, distinct and independent of app version', {skip:process.platform!=='darwin'},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'maricode-location-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'main.swift'),'import Foundation\nlet support=URL(fileURLWithPath: "/test/Library/Application Support")\nprint(defaultDataDirectory(support: support, release: false))\nprint(defaultDataDirectory(support: support, release: true))\n');
 execFileSync('/usr/bin/swiftc',[resolve('apps/mac-launcher/DataLocation.swift'),join(dir,'main.swift'),'-o',join(dir,'check')]);
 assert.equal(execFileSync(join(dir,'check'),{encoding:'utf8'}),'/test/Library/Application Support/Merry Development\n/test/Library/Application Support/MARICODE\n');
});
