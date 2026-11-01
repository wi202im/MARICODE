import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('native connection helper refuses local mode, changed address and insecure token files',{skip:process.platform!=='darwin'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'merry-native-'));
 try{
 await writeFile(join(dir,'main.swift'),`
import Foundation
let root = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("data")
try FileManager.default.createDirectory(at: root.appendingPathComponent("hub"), withIntermediateDirectories: true)
func put(_ name: String, _ value: String) throws { try Data(value.utf8).write(to: root.appendingPathComponent(name)) }
func denied(_ action: () throws -> Void) { do { try action(); fatalError("should reject") } catch {} }
try put("remote.json", #"{"version":1,"origin":"https://mini.tail123.ts.net:8445"}"#)
try put("environment.json", #"{"version":1,"roles":{"server":false}}"#)
try put("backend.json", #"{"version":1}"#)
denied { _ = try RemoteConnection.read(directory: root.path) }
try put("environment.json", #"{"version":1,"roles":{"server":true}}"#)
let info = try RemoteConnection.read(directory: root.path)
assert(info.address == "https://mini.tail123.ts.net:8445")
try put("hub/token.private", String(repeating:"a",count:64))
try FileManager.default.setAttributes([.posixPermissions:0o600], ofItemAtPath:root.appendingPathComponent("hub/token.private").path)
let token = try info.token(); assert(token == String(repeating:"a",count:64))
try FileManager.default.setAttributes([.posixPermissions:0o644], ofItemAtPath:root.appendingPathComponent("hub/token.private").path)
denied { _ = try info.token() }
try FileManager.default.setAttributes([.posixPermissions:0o600], ofItemAtPath:root.appendingPathComponent("hub/token.private").path)
try put("remote.json", #"{"version":1,"origin":"https://other.tail123.ts.net:8445"}"#)
denied { _ = try info.token() }
print("native boundary checks passed")
`);
 execFileSync('/usr/bin/swiftc',[resolve('apps/mac-launcher/RemoteConnection.swift'),join(dir,'main.swift'),'-o',join(dir,'test')],{stdio:'pipe'});
 execFileSync(join(dir,'test'),[dir],{stdio:'pipe'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
