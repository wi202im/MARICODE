import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {repoStates,pinMismatches,newBranches,pinFrom,validPin,validBranch} from './branch-pin.mjs';

const g=(cwd,...args)=>execFileSync('git',args,{cwd,stdio:'pipe',env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@t',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@t'}});
async function repo(dir,branch){await mkdir(dir,{recursive:true});g(dir,'init','-q','-b',branch);await writeFile(join(dir,'a'),'a');g(dir,'add','a');g(dir,'commit','-qm','a');}

test('finds the folder and its direct sub-folder repositories with their current and local branches',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pin-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await repo(join(root,'api'),'feature/x');g(join(root,'api'),'branch','main');await repo(join(root,'web'),'main');
 await mkdir(join(root,'docs'));await repo(join(root,'deep/nested'),'main');await repo(join(root,'.hidden'),'main');
 const elsewhere=await mkdtemp(join(tmpdir(),'pin-linked-'));t.after(()=>rm(elsewhere,{recursive:true,force:true}));await repo(elsewhere,'dev');await symlink(elsewhere,join(root,'linked'));
 const states=await repoStates(root);
 assert.deepEqual(states.map(s=>[s.repo,s.current,s.branches.sort()]),[['api','feature/x',['feature/x','main']],['linked','dev',['dev']],['web','main',['main']]]);
 assert.deepEqual(pinFrom(states),{repos:{api:['feature/x'],linked:['dev'],web:['main']}});
 g(join(root,'web'),'checkout','-q','--detach');assert.match((await repoStates(root)).find(s=>s.repo==='web').detached,/^[0-9a-f]+$/);
});
test('only pinned repositories are checked; a branch outside the list or a detached HEAD is a mismatch',()=>{
 const pin={repos:{api:['feature/x','feature/x-1'],web:['main']}};
 const states=[{repo:'api',current:'feature/x-1',branches:[]},{repo:'web',current:'dev',branches:[]},{repo:'other',current:'dev',branches:[]},{repo:'.',current:null,detached:'abc',branches:[]}];
 assert.deepEqual(pinMismatches(pin,states),[{repo:'web',current:'dev',allowed:['main']}]);
 assert.deepEqual(pinMismatches({repos:{'.':['main']}},states),[{repo:'.',current:'(분리된 HEAD abc)',allowed:['main']}]);
 assert.deepEqual(pinMismatches(null,states),[]);
});
test('a branch is new to the turn only when it did not exist at the start and is checked out now',()=>{
 const before=[{repo:'api',current:'feature/x',branches:['feature/x','main']},{repo:'web',current:'main',branches:['main','old']}];
 const after=[{repo:'api',current:'feature/x-1',branches:['feature/x','feature/x-1','main']},{repo:'web',current:'old',branches:['main','old']},{repo:'new',current:'main',branches:['main']}];
 assert.deepEqual(newBranches(before,after),[{repo:'api',branch:'feature/x-1',base:'feature/x'}]);
});
test('stored pins and branch names are validated',()=>{
 assert.equal(validPin({repos:{api:['feature/x'],'.':['main']}}),true);
 for(const bad of [null,[],{repos:[]},{repos:{'../x':['a']}},{repos:{api:['bad name']}},{repos:{api:'main'}},{repos:{}, extra:1}])assert.equal(validPin(bad),false);
 assert.equal(validBranch('feature/x-1'),true);for(const b of ['-x','a..b','a b','',null,'a:b'])assert.equal(validBranch(b),false);
});
