import test from 'node:test';
import assert from 'node:assert/strict';
import {permissionDisclosureKey,restoreDisclosures} from './disclosure.mjs';

test('live repaint keeps only the same inspected request open',()=>{
 const request={id:'req-1',tool:'Bash',details:'{"command":"echo test"}'};
 const key=permissionDisclosureKey('session-1',request);
 const old=[{open:true,dataset:{permissionKey:key}}];
 const current=[request,{...request,id:'req-2'},{...request,details:'{"command":"write file"}'}]
   .map(r=>({open:false,dataset:{permissionKey:permissionDisclosureKey('session-1',r)}}));
 current.push({open:false,dataset:{permissionKey:permissionDisclosureKey('session-2',request)}});
 restoreDisclosures(old,current);
 assert.deepEqual(current.map(d=>d.open),[true,false,false,false]);
 restoreDisclosures([{open:false,dataset:{permissionKey:key}}],current);
 assert.deepEqual(current.map(d=>d.open),[false,false,false,false]);
 restoreDisclosures([],current);
 assert.equal(current[0].open,false);
});
