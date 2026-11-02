import test from 'node:test';
import assert from 'node:assert/strict';
import {paletteMatches,findRanges} from './palette.mjs';
const items=[{id:'new',label:'새 대화',group:'동작'},{id:'s1',label:'hello.txt 파일 내용',detail:'test-project',group:'대화'},{id:'s2',label:'이번 대화에서 기억할 단어는 GRAPE31',detail:'test-project',group:'대화'},{id:'imp',label:'기존 대화 가져오기',group:'동작',keywords:'import'}];
test('palette ranks label prefix, then word and substring matches, and searches details and keywords',()=>{
 assert.deepEqual(paletteMatches(items,'').map(i=>i.id),['new','s1','s2','imp']);
 assert.deepEqual(paletteMatches(items,'대화').map(i=>i.id),['new','s2','imp']);assert.deepEqual(paletteMatches(items,'새').map(i=>i.id),['new']);
 assert.deepEqual(paletteMatches(items,'grape').map(i=>i.id),['s2']);
 assert.deepEqual(paletteMatches(items,'import').map(i=>i.id),['imp']);
 assert.deepEqual(paletteMatches(items,'test-proj').map(i=>i.id),['s1','s2']);
 assert.equal(paletteMatches(items,'없는말').length,0);
});
test('find ranges are case-insensitive, non-overlapping and empty for blank queries',()=>{
 assert.deepEqual(findRanges('Hello hello HELLO','hello'),[[0,5],[6,11],[12,17]]);
 assert.deepEqual(findRanges('aaaa','aa'),[[0,2],[2,4]]);
 assert.deepEqual(findRanges('abc',' '),[]);assert.deepEqual(findRanges('abc',''),[]);
});
