// Pure branch-pin rules shared by the server and the browser.
const branchName=/^(?!-)[^\0\n\r\t ~^:?*[\\]{1,200}$/;
export const validBranch=b=>typeof b==='string'&&branchName.test(b)&&!b.includes('..');
// Pinned repositories whose current branch is outside the allowed list. Repositories not pinned are not checked.
export function pinMismatches(pin,states){
 if(!pin?.repos)return [];
 return states.filter(s=>Array.isArray(pin.repos[s.repo])&&!(s.current&&pin.repos[s.repo].includes(s.current)))
  .map(s=>({repo:s.repo,current:s.current??`(분리된 HEAD ${s.detached})`,allowed:pin.repos[s.repo]}));
}
// Branches that did not exist when the turn started and are checked out now: the session made them.
export function newBranches(before,after){
 return after.flatMap(a=>{const b=before.find(x=>x.repo===a.repo);return b&&a.current&&!b.branches.includes(a.current)?[{repo:a.repo,branch:a.current,base:b.current??null}]:[];});
}
export function pinFrom(states){return {repos:Object.fromEntries(states.filter(s=>s.current).map(s=>[s.repo,[s.current]]))};}
export function validPin(pin){
 return !!pin&&typeof pin==='object'&&!Array.isArray(pin)&&Object.keys(pin).every(k=>k==='repos')&&pin.repos&&typeof pin.repos==='object'&&!Array.isArray(pin.repos)
  &&Object.entries(pin.repos).every(([repo,list])=>(repo==='.'||/^[^/\0.][^/\0]{0,200}$/.test(repo))&&Array.isArray(list)&&list.length<=100&&list.every(validBranch));
}
