import {test} from 'node:test';import assert from 'node:assert/strict';
import {fitPanelWidths} from './panel-layout.mjs';
test('panel widths keep the conversation usable and restore requested sizes after widening',()=>{
 assert.deepEqual(fitPanelWidths({left:300,right:350},1400,true,true),{left:300,right:350});
 const small=fitPanelWidths({left:440,right:520},800,true,true);
 assert.ok(small.left>=200&&small.right>=240);assert.ok(small.left+small.right<=480);
 assert.equal(fitPanelWidths({left:440,right:520},800,false,true).right,480);
 assert.deepEqual(fitPanelWidths({left:NaN,right:-1},1400,true,true),{left:260,right:240});
 assert.deepEqual(fitPanelWidths({left:300,right:350},1400,true,true),{left:300,right:350});
});
