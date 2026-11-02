import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';
test('updates accept only stable releases and exact official assets; numeric versions and hashes are checked',{skip:process.platform!=='darwin'},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'maricode-update-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'main.swift'),`import Foundation
import CryptoKit
assert(AppVersion("1.10.0")! > AppVersion("1.9.9")!)
assert(AppVersion("1.0.0-beta") == nil)
assert(AppVersion("01.0.0") == nil)
let sha = String(repeating:"a",count:64)
var raw:[String:Any] = ["tag_name":"v1.2.0","draft":false,"prerelease":false,"body":"changes","assets":[["name":"MARICODE-1.2.0-arm64.dmg","size":123,"digest":"sha256:"+sha,"browser_download_url":"https://github.com/wi202im/MARICODE/releases/download/v1.2.0/MARICODE-1.2.0-arm64.dmg"]]]
func parse(_ raw:[String:Any]) -> UpdateRelease? { try? UpdateRelease(data:JSONSerialization.data(withJSONObject:raw)) }
assert(parse(raw)?.version == AppVersion("1.2.0"))
raw["prerelease"] = true; assert(parse(raw) == nil); raw["prerelease"] = false
raw["draft"] = true; assert(parse(raw) == nil); raw["draft"] = false
let good = raw
var assets = raw["assets"] as! [[String:Any]]
assets[0]["browser_download_url"] = "https://evil.example/update.dmg"; raw["assets"] = assets; assert(parse(raw) == nil)
raw = good; assets = raw["assets"] as! [[String:Any]]; assets[0]["digest"] = "sha256:bad";raw["assets"] = assets;assert(parse(raw) == nil)
let bytes = Data("fixture".utf8), file=URL(fileURLWithPath:CommandLine.arguments[1]);try bytes.write(to:file)
let valid = try verifyUpdateFile(file,size:7,sha256:SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined()); assert(valid)
let wrongSize = try verifyUpdateFile(file,size:8,sha256:sha); assert(!wrongSize)
let wrongHash = try verifyUpdateFile(file,size:7,sha256:sha); assert(!wrongHash)
let digest = SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined()
let flow = UpdateInstallFlow(); var opened = 0
func begin() -> Bool { flow.begin(file:file,size:7,sha256:digest) }
func finish(_ normal:Bool) -> Bool { flow.finish(normalShutdown:normal){ _ in opened += 1; return true } }
assert(begin()); assert(!begin()); assert(flow.pending)
flow.cancel(); assert(!flow.pending); assert(finish(true)); assert(opened == 0)
assert(begin()); assert(!finish(false)); assert(opened == 0); assert(!flow.pending)
assert(begin()); try Data("changed".utf8).write(to:file)
assert(!finish(true)); assert(opened == 0); assert(!flow.pending)
try bytes.write(to:file); assert(begin()); assert(finish(true)); assert(opened == 1)
assert(finish(true)); assert(opened == 1)
assert(begin()); assert(!flow.finish(normalShutdown:true){ _ in false }); assert(!flow.pending)
print("PASS")
`);
 execFileSync('/usr/bin/swiftc',[resolve('apps/mac-launcher/AppUpdate.swift'),join(dir,'main.swift'),'-framework','AppKit','-o',join(dir,'check')],{stdio:'pipe'});
 assert.equal(execFileSync(join(dir,'check'),[join(dir,'fixture')],{encoding:'utf8'}).trim(),'PASS');
});
