import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {projectRegistry} from './project-registry.mjs';
import {workspaceChoices,createWorkspacePlans} from './workspace-plans.mjs';
test('workspace choices and creation keep root, branch and reused worktree bound to one request',async t=>{
 const root=await mkdtemp(join(tmpdir(),'maricode-workspace-'));t.after(()=>rm(root,{recursive:true,force:true}));const repo=join(root,'repo');await mkdir(repo);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});git('init','-b','main');git('-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','fixture');git('branch','topic');
 const registry=projectRegistry(join(root,'projects.json')),project=await registry.add(repo),plans=createWorkspacePlans({directory:join(root,'plans'),worktreeDirectory:join(root,'worktrees'),registry});
 const choices=await workspaceChoices(repo);assert.equal(choices.kind,'git');assert.deepEqual(choices.branches,['main','topic']);
 const input={requestId:'10000000-0000-0000-0000-000000000001',agent:'codex',project:project.id,workspace:{mode:'new',branch:'main',name:'feature/ui'}};
 let guards=0;const guard=async()=>{guards++;};const result=await plans.prepare(input,project,guard);assert.notEqual(result.project,project.id);assert.equal(git('branch','--show-current').trim(),'main');
 assert.deepEqual(await plans.prepare(input,project,guard),result);assert.equal(guards,1);
 await assert.rejects(plans.prepare({...input,workspace:{...input.workspace,name:'other'}},project,guard));
 const updated=await workspaceChoices(repo);assert.equal(updated.worktrees.length,2);
 const wt=updated.worktrees.find(w=>w.branch==='feature/ui');assert.ok(wt);
 const reused=await plans.prepare({...input,requestId:'20000000-0000-0000-0000-000000000001',workspace:{mode:'existing',key:wt.key}},project,guard);assert.equal(reused.project,result.project);
 await writeFile(join(repo,'dirty.txt'),'keep');await assert.rejects(plans.prepare({...input,requestId:'30000000-0000-0000-0000-000000000001',workspace:{mode:'branch',branch:'topic'}},project,guard),/변경/);assert.equal(git('branch','--show-current').trim(),'main');
 await assert.rejects(plans.prepare({...input,requestId:'40000000-0000-0000-0000-000000000001',workspace:{mode:'existing',key:'/outside'}},project,guard));
});
test('current-folder request cannot become a Git mutation and an interrupted preparation is never replayed',async t=>{
 const root=await mkdtemp(join(tmpdir(),'maricode-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));const repo=join(root,'repo');await mkdir(repo);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});git('init','-b','main');git('-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','fixture');git('branch','topic');
 const registry=projectRegistry(join(root,'projects.json')),p=await registry.add(repo),options={directory:join(root,'plans'),worktreeDirectory:join(root,'worktrees'),registry};
 const plans=createWorkspacePlans(options),input={requestId:'50000000-0000-0000-0000-000000000001',agent:'claude',project:p.id,workspace:{mode:'current'}};
 await plans.prepare(input,p,async()=>{});await assert.rejects(plans.prepare({...input,workspace:{mode:'branch',branch:'topic'}},p,async()=>{}));assert.equal(git('branch','--show-current').trim(),'main');
 const switched=await plans.prepare({...input,requestId:'60000000-0000-0000-0000-000000000001',workspace:{mode:'branch',branch:'topic'}},p,async()=>{});assert.equal(switched.branch,'topic');assert.equal(git('branch','--show-current').trim(),'topic');
 const broken=createWorkspacePlans({...options,registry:{...registry,add:async()=>{throw Error('interrupted after worktree creation');}}}),next={...input,requestId:'70000000-0000-0000-0000-000000000001',workspace:{mode:'new',branch:'main',name:'interrupted'}};
 await assert.rejects(broken.prepare(next,p,async()=>{}));await assert.rejects(broken.prepare(next,p,async()=>{}));assert.equal((await workspaceChoices(repo)).worktrees.filter(w=>w.branch==='interrupted').length,1);
});
