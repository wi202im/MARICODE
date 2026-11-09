import {execFile} from 'node:child_process';
import {readdir,realpath,stat} from 'node:fs/promises';
import {join} from 'node:path';
export {pinMismatches,newBranches,pinFrom,validPin,validBranch} from './branch-rules.mjs';

// A pinned session remembers, per Git repository, the branches it may run on. Repositories are the
// session folder itself and its direct sub-folders (company layout: workspace/api, workspace/web).
// Git is read-only except, after the user confirms, fetching the remote and a fast-forward pull of a pinned branch.
// The app never switches, deletes, merges or rebases branches.
const git=(cwd,args)=>new Promise(resolve=>execFile('git',args,{cwd,timeout:5000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',PATH:`${process.env.PATH??''}:/usr/bin:/opt/homebrew/bin:/usr/local/bin`}},(error,stdout)=>resolve(error?null:stdout.trim())));

async function repoState(dir,key,run){
 const top=await run(dir,['rev-parse','--show-toplevel']);if(top===null)return null;
 if(await realpath(top).catch(()=>top)!==await realpath(dir).catch(()=>dir))return null;
 const head=await run(dir,['symbolic-ref','--short','-q','HEAD']),sha=head?null:await run(dir,['rev-parse','--short','HEAD']);
 const refs=await run(dir,['for-each-ref','--format=%(refname:short)','refs/heads']);
 return {repo:key,current:head||null,detached:head?null:sha||'unknown',branches:(refs??'').split('\n').filter(Boolean)};
}
export async function repoStates(root,run=git){
 const states=[],self=await repoState(root,'.',run);if(self)states.push(self);
 let entries=[];try{entries=await readdir(root,{withFileTypes:true});}catch{}
 // Sub-folders may be symlinks to repositories kept elsewhere (workspace/kona -> ~/Documents/GitHub/kona).
 for(const e of entries.filter(e=>!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name))){
  const dir=join(root,e.name);if(!e.isDirectory()&&!(e.isSymbolicLink()&&await stat(dir).then(s=>s.isDirectory(),()=>false)))continue;
  const s=await repoState(dir,e.name,run);if(s)states.push(s);
 }
 return states;
}

// Remote checks never prompt for credentials; a failed fetch is reported, never retried.
const gitNet=(cwd,args,timeout)=>new Promise(resolve=>execFile('git',args,{cwd,timeout,env:{...process.env,GIT_TERMINAL_PROMPT:'0',SSH_ASKPASS_REQUIRE:'never',PATH:`${process.env.PATH??''}:/usr/bin:/opt/homebrew/bin:/usr/local/bin`}},
 (error,stdout,stderr)=>resolve(error?{ok:false,error:((stderr||'').trim().split('\n').slice(-3).join(' ')||error.message).slice(0,400)}:{ok:true,out:stdout.trim()})));
const fetchedAt=new Map(),fetchEvery=5*60*1000;
async function counts(dir,run){const c=await run(dir,['rev-list','--left-right','--count','HEAD...@{u}'],5000);if(!c.ok)return c;const [ahead,behind]=c.out.split(/\s+/).map(Number);return {ok:true,ahead,behind};}
// How far the current branch is from its upstream. Fetches at most every 5 minutes per repository.
export async function remoteState(dir,{run=gitNet,now=Date.now}={}){
 const up=await run(dir,['rev-parse','--abbrev-ref','--symbolic-full-name','@{u}'],5000);if(!up.ok)return {upstream:null};
 const key=await realpath(dir).catch(()=>dir);let error;
 if(!(now()-(fetchedAt.get(key)??-Infinity)<fetchEvery)){const f=await run(dir,['fetch','--quiet','--no-tags'],15000);if(f.ok)fetchedAt.set(key,now());else error=f.error;}
 const c=await counts(dir,run);if(!c.ok)return {upstream:up.out,error:c.error};
 return {upstream:up.out,ahead:c.ahead,behind:c.behind,...(error?{error}:{})};
}
// Fast-forward only, against the refs fetched by remoteState. Git itself refuses to overwrite local changes.
export async function pullFastForward(dir,run=gitNet){
 const c=await counts(dir,run);if(!c.ok)return {ok:false,error:c.error};
 if(c.ahead)return {ok:false,error:`원격과 갈라졌습니다(이 컴퓨터에만 있는 커밋 ${c.ahead}개). 직접 정리한 뒤 다시 시도하세요.`};
 if(!c.behind)return {ok:true};
 const m=await run(dir,['merge','--ff-only','--quiet','@{u}'],30000);return m.ok?{ok:true}:{ok:false,error:m.error};
}
