import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('native quit keeps the main queue responsive until owned runtime shutdown completes',{skip:process.platform!=='darwin'},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'maricode-quit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=await readFile('apps/mac-launcher/Merry.swift','utf8');
 await writeFile(join(dir,'Merry.swift'),source.slice(0,source.indexOf('@main\n')));
 await writeFile(join(dir,'main.swift'),`import AppKit
final class Harness:NSObject,NSApplicationDelegate {
 let product=MerryDelegate(); let pipe=Pipe(); var sent=0
 func applicationDidFinishLaunching(_ notification:Notification) {
  // Exercise the actual product delegate without starting a Hub or user app.
  product.process=Process();product.input=pipe
  pipe.fileHandleForReading.readabilityHandler={handle in
   let data=handle.availableData
   guard !data.isEmpty else{return}
   DispatchQueue.main.async {
    self.sent += 1;assert(String(data:data,encoding:.utf8)=="quit\\n")
    // A second click while waiting must not enqueue another runtime quit.
    NSApp.terminate(nil)
    assert(self.sent==1)
    self.product.process=nil;self.product.runtimeExitIsSafe=true
    NSApp.terminate(nil)
   }
  }
  DispatchQueue.main.async{NSApp.terminate(nil)}
 }
 func applicationShouldTerminate(_ app:NSApplication)->NSApplication.TerminateReply {product.applicationShouldTerminate(app)}
 func applicationWillTerminate(_ notification:Notification){assert(sent==1);print("NORMAL_QUIT");fflush(stdout)}
}
let app=NSApplication.shared;let harness=Harness();app.delegate=harness;app.setActivationPolicy(.prohibited)
DispatchQueue.global().asyncAfter(deadline:.now()+4){print("MAIN_QUEUE_BLOCKED");fflush(stdout);exit(2)}
app.run()
`);
 const files=['AppUpdate.swift','DesktopNavigation.swift','DataLocation.swift','AgentDiscovery.swift','RemoteConnection.swift'].map(f=>resolve('apps/mac-launcher',f));
 execFileSync('/usr/bin/swiftc',[join(dir,'Merry.swift'),...files,join(dir,'main.swift'),'-framework','AppKit','-framework','WebKit','-o',join(dir,'check')],{stdio:'pipe'});
 assert.equal(execFileSync(join(dir,'check'),{encoding:'utf8',timeout:10000}).trim(),'NORMAL_QUIT');
});
