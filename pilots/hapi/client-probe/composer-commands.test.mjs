import test from 'node:test';
import assert from 'node:assert/strict';
import {commandQuery,commandMatches} from './composer-commands.mjs';
test('suggestions open only for a single leading / or $ token',()=>{
 assert.deepEqual(commandQuery('/com'),{prefix:'/',term:'com'});assert.deepEqual(commandQuery('$'),{prefix:'$',term:''});
 for(const text of ['','hello /com','/compact now','$ x','//'])assert.equal(commandQuery(text),null);
});
test('commands come from / and skills from $, prefix matches first',()=>{
 const lists={commands:[{name:'compact',description:'요약'},{name:'clear'},{name:'autocompact'}],skills:[{name:'review'},{name:'code-review',description:'검토'}]};
 assert.deepEqual(commandMatches(lists,commandQuery('/comp')).map(i=>i.text),['/compact','/autocompact']);
 assert.deepEqual(commandMatches(lists,commandQuery('$rev')).map(i=>i.text),['$review','$code-review']);
 assert.equal(commandMatches(lists,commandQuery('/')).length,3);assert.equal(commandMatches(null,commandQuery('/')).length,0);
 assert.equal(commandMatches({commands:[{name:'bad name'},{name:''}]},commandQuery('/')).length,0);
});
