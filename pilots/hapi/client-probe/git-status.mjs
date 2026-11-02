// HAPI's read-only Git status is porcelain v2. Never expose paths or stderr here.
export function gitSummary(result){
 const unavailable={state:'unavailable'};
 if(result?.success!==true||typeof result.stdout!=='string'||(result.exitCode!=null&&result.exitCode!==0))return unavailable;
 const summary={state:'ready',branch:null,commit:null,changed:0,staged:0,unstaged:0,untracked:0,conflicts:0,ahead:null,behind:null};
 let oid=false;
 for(const line of result.stdout.split('\n')){
  if(!line)continue;
  if(line.startsWith('# branch.oid ')){const value=line.slice(13);if(value==='(initial)')oid=true;else if(/^[a-f0-9]{40,64}$/.test(value)){summary.commit=value;oid=true;}else return unavailable;}
  else if(line.startsWith('# branch.head '))summary.branch=line.slice(14)==='(detached)'?'분리된 HEAD':line.slice(14);
  else if(line.startsWith('# branch.ab ')){const m=/^# branch.ab \+(\d+) -(\d+)$/.exec(line);if(!m)return unavailable;summary.ahead=Number(m[1]);summary.behind=Number(m[2]);}
  else if(line.startsWith('# '))continue;
  else if(line.startsWith('? ')){summary.changed++;summary.untracked++;}
  else if(line.startsWith('! '))continue;
  else if(/^[12u] [\.MADRCUT?!]{2} /.test(line)){
   summary.changed++;
   if(line[0]==='u')summary.conflicts++;
   else {summary.staged+=Number(line[2]!=='.');summary.unstaged+=Number(line[3]!=='.');}
  }else return unavailable;
 }
 return oid&&summary.branch?summary:unavailable;
}
export function worktreePresentation(metadata){
 const w=metadata?.worktree;
 if(!w||typeof w.name!=='string'||!w.name||typeof w.basePath!=='string'||!w.basePath||typeof metadata.path!=='string'||w.worktreePath&&w.worktreePath!==metadata.path)return null;
 return {name:w.name,base:w.basePath,path:metadata.path,branch:typeof w.branch==='string'?w.branch:''};
}
// `git diff --numstat` rows from HAPI's read-only git-diff-numstat RPC; '-' marks binary files.
export function numstatRows(stdout,staged=false){
 return String(stdout??'').split('\n').flatMap(line=>{const m=/^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);if(!m)return [];const binary=m[1]==='-';return [{path:m[3],added:binary?0:Number(m[1]),removed:binary?0:Number(m[2]),binary,staged}];});
}
export function diffLines(text){
 return String(text??'').split('\n').filter((l,i,a)=>l||i<a.length-1).map(text=>({text,kind:/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |Binary )/.test(text)?'meta':text.startsWith('@@')?'hunk':text.startsWith('+')?'add':text.startsWith('-')?'del':'context'}));
}
