import {execFile} from 'node:child_process';
import {readdir,realpath,stat} from 'node:fs/promises';
import {join} from 'node:path';
export {pinMismatches,newBranches,pinFrom,validPin,validBranch} from './branch-rules.mjs';

// A pinned session remembers, per Git repository, the branches it may run on. Repositories are the
// session folder itself and its direct sub-folders (company layout: workspace/api, workspace/web).
// Read-only git only; the app never switches or deletes branches.
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
