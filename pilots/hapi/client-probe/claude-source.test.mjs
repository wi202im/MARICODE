import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverClaudeSource} from './claude-source.mjs';
async function home(t){const p=await mkdtemp(join(tmpdir(),'claude-source-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
test('explicit choice wins, then exported environment, then one literal shell profile path',async t=>{
 const h=await home(t);await writeFile(join(h,'.zshrc'),'export CLAUDE_CONFIG_DIR="$HOME/.custom-profile"\n');
 assert.equal((await discoverClaudeSource({home:h,environment:{},source:'~/chosen'})).source,join(h,'chosen'));
 assert.equal((await discoverClaudeSource({home:h,environment:{CLAUDE_CONFIG_DIR:join(h,'exported')}})).source,join(h,'exported'));
 const found=await discoverClaudeSource({home:h,environment:{}});assert.equal(found.source,join(h,'.custom-profile'));assert.equal(found.origin,'shell-file');
});
test('ambiguous and computed shell settings ask for a folder, never execute shell code',async t=>{
 const h=await home(t);await writeFile(join(h,'.zshrc'),'export CLAUDE_CONFIG_DIR="$HOME/one"\n');await writeFile(join(h,'.zprofile'),'export CLAUDE_CONFIG_DIR="$HOME/two"\n');
 assert.equal((await discoverClaudeSource({home:h,environment:{}})).origin,'unresolved');
 await rm(join(h,'.zprofile'));await writeFile(join(h,'.zshrc'),'export CLAUDE_CONFIG_DIR="$(touch SHOULD-NOT-EXIST)"\n');
 assert.equal((await discoverClaudeSource({home:h,environment:{}})).origin,'unresolved');
 await rm(join(h,'.zshrc'));assert.equal((await discoverClaudeSource({home:h,environment:{}})).source,join(h,'.claude'));
});
test('conditional assignments and aliases require manual selection rather than guessed CLI state',async t=>{
 const h=await home(t);
 for(const text of ['if true; then\nexport CLAUDE_CONFIG_DIR="$HOME/one"\nfi','alias claude=\'CLAUDE_CONFIG_DIR="$HOME/one" claude\'']){
  await writeFile(join(h,'.zshrc'),text);assert.equal((await discoverClaudeSource({home:h,environment:{}})).origin,'unresolved');
 }
});
