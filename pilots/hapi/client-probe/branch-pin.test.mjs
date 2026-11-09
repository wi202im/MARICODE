import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {repoStates,pinMismatches,newBranches,pinFrom,validPin,validBranch,remoteState,pullFastForward} from './branch-pin.mjs';
import {pinSummary} from './branch-rules.mjs';

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
test('sidebar summary lists shared branches once and otherwise per repository',()=>{
 assert.equal(pinSummary({repos:{kona:['feature/a','feature/a-1'],rails:['feature/a-1','feature/a']}}),'feature/a, feature/a-1');
 assert.equal(pinSummary({repos:{kona:['feature/a'],rails:['main'],'.':[]}}),'kona: feature/a · rails: main · 이 폴더: 없음');
 assert.equal(pinSummary(null),'');
});

// A bare origin, a working clone pinned to main, and a second clone that pushes new work.
async function remotes(t){
 const root=await mkdtemp(join(tmpdir(),'pin-remote-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const origin=join(root,'origin.git'),seed=join(root,'seed'),work=join(root,'work'),other=join(root,'other');
 g(root,'init','-q','--bare','-b','main',origin);await repo(seed,'main');g(seed,'remote','add','origin',origin);g(seed,'push','-q','origin','main');
 g(root,'clone','-q',origin,work);g(root,'clone','-q',origin,other);
 const push=async(name,body='x')=>{await writeFile(join(other,name),body);g(other,'add',name);g(other,'commit','-qm',name);g(other,'push','-q','origin','main');};
 return {work,other,push};
}
test('a pinned branch behind its remote is found after fetching, and a fast-forward pull brings it up to date',async t=>{
 const {work,push}=await remotes(t);let clock=0;
 assert.deepEqual(await remoteState(work,{now:()=>clock}),{upstream:'origin/main',ahead:0,behind:0});
 await push('b');await push('c');
 // Fetching is throttled per repository; local refs stay as they were until the next fetch.
 clock+=60000;assert.equal((await remoteState(work,{now:()=>clock})).behind,0);
 clock+=5*60000;assert.deepEqual(await remoteState(work,{now:()=>clock}),{upstream:'origin/main',ahead:0,behind:2});
 assert.deepEqual(await pullFastForward(work),{ok:true});
 assert.deepEqual(await remoteState(work,{now:()=>clock}),{upstream:'origin/main',ahead:0,behind:0});
 assert.equal(g(work,'log','-1','--format=%s').toString().trim(),'c');
});
test('a diverged branch or a local change the pull would overwrite is never merged; no upstream is reported as such',async t=>{
 const {work,push}=await remotes(t);
 await push('b');g(work,'fetch','-q');
 await writeFile(join(work,'b'),'mine');
 const blocked=await pullFastForward(work);assert.equal(blocked.ok,false);assert.match(blocked.error,/b/);
 assert.equal((await remoteState(work,{now:()=>1e12})).behind,1);
 await rm(join(work,'b'));await writeFile(join(work,'d'),'d');g(work,'add','d');g(work,'commit','-qm','d');
 assert.deepEqual(await remoteState(work,{now:()=>2e12}),{upstream:'origin/main',ahead:1,behind:1});
 const diverged=await pullFastForward(work);assert.equal(diverged.ok,false);assert.match(diverged.error,/갈라/);
 assert.equal(g(work,'log','-1','--format=%s').toString().trim(),'d');
 g(work,'checkout','-q','-b','local-only');assert.deepEqual(await remoteState(work,{now:()=>3e12}),{upstream:null});
});
