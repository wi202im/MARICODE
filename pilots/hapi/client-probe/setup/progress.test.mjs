import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupProgress} from './progress.mjs';
test('first launch and remote-only setup do not imply local AI readiness',()=>{
 assert.equal(setupProgress(null).next.href,'#roles');
 const remote=setupProgress({configured:true,roles:{remote:true,local:false}});
 assert.equal(remote.next.href,'/connections');assert.equal(remote.steps.length,2);
});
test('registered paths and login alone never mean a runnable workspace',()=>{
 const env={configured:true,roles:{local:true},aiConfigurationRegistered:true,runnerSetupAvailable:true};
 assert.equal(setupProgress(env).next.href,'#ai');
 assert.equal(setupProgress(env,[{state:'connected'}]).next.href,'#runner');
 assert.equal(setupProgress(env,[{state:'connected'}],{phase:'running',hub:'unknown',workspaceAvailable:false}).ready,false);
 const ready=setupProgress(env,[{state:'connected'}],{phase:'running',hub:'connected',workspaceAvailable:true});
 assert.equal(ready.next.href,'/workspace');assert.equal(ready.ready,true);
});
test('one connected provider is sufficient, failed recheck and missing launcher remain explicit',()=>{
 const env={configured:true,roles:{local:true},aiConfigurationRegistered:false,runnerSetupAvailable:false};
 assert.equal(setupProgress(env,[{state:'unknown'}]).ready,false);
 const result=setupProgress(env,[{state:'connected'},{state:'signed-out'}]);
 assert.equal(result.ready,false);assert.equal(result.next.href,'#ai');
 assert.match(result.note,/실행 프로그램/);
});
