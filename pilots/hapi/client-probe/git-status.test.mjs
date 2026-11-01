import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gitSummary,worktreePresentation} from './git-status.mjs';
test('porcelain v2 counts paths once, preserves HEAD and distinguishes index/worktree/conflicts',()=>{
 const oid='a'.repeat(40);
 const result=gitSummary({success:true,exitCode:0,stdout:`# branch.oid ${oid}\n# branch.head feature/sidebar\n# branch.upstream origin/feature/sidebar\n# branch.ab +2 -1\n1 MM N... 100644 100644 100644 a b edited.txt\n2 R. N... 100644 100644 100644 a b R100 new.txt\told.txt\nu UU N... 100644 100644 100644 100644 a b c conflict.txt\n? untracked.txt\n`});
 assert.deepEqual(result,{state:'ready',branch:'feature/sidebar',commit:oid,changed:4,staged:2,unstaged:1,untracked:1,conflicts:1,ahead:2,behind:1});
 assert.equal(JSON.stringify(result).includes('edited.txt'),false);
});
test('unborn, detached and unavailable are not mistaken for a clean branch',()=>{
 assert.equal(gitSummary({success:true,stdout:'# branch.oid (initial)\n# branch.head main\n'}).commit,null);
 assert.equal(gitSummary({success:true,stdout:'# branch.oid '+ 'b'.repeat(40)+'\n# branch.head (detached)\n'}).branch,'분리된 HEAD');
 for(const result of [{success:false,stderr:'private path'}, {success:true,stdout:''},{success:true,stdout:'# branch.head main\nunexpected'}])assert.deepEqual(gitSummary(result),{state:'unavailable'});
});
test('worktree labels require explicit metadata and do not infer a worktree from a branch name',()=>{
 assert.equal(worktreePresentation({path:'/project'}),null);
 assert.deepEqual(worktreePresentation({path:'/project-wt',worktree:{name:'sidebar',basePath:'/project',branch:'feature/sidebar',worktreePath:'/project-wt'}}),{name:'sidebar',base:'/project',path:'/project-wt',branch:'feature/sidebar'});
 assert.equal(worktreePresentation({path:'/project',worktree:{name:'stale',basePath:'/other',worktreePath:'/different'}}),null);
});

test('actual Git linked worktree has its own branch and changes while sharing the base commit',async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process');
 const root=await mkdtemp(join(tmpdir(),'maricode-git-')),base=join(root,'base'),linked=join(root,'sidebar');
 t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(base);
 const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git(base,'init','-b','main');await writeFile(join(base,'demo.txt'),'base\n');git(base,'add','.');git(base,'-c','user.name=MARICODE Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');
 git(base,'worktree','add','-b','feature/sidebar',linked);await writeFile(join(linked,'demo.txt'),'worktree change\n');await writeFile(join(linked,'new.txt'),'new\n');
 const status=cwd=>gitSummary({success:true,exitCode:0,stdout:git(cwd,'status','--porcelain=v2','--branch','--untracked-files=all')});
 const original=status(base),worktree=status(linked);
 assert.equal(original.branch,'main');assert.equal(original.changed,0);assert.equal(worktree.branch,'feature/sidebar');assert.equal(worktree.changed,2);assert.equal(worktree.commit,original.commit);
});
