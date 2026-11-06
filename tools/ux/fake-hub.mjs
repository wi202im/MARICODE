// Synthetic HAPI Hub for usability runs: example sessions, messages and a fixture project. No real data.
import http from 'node:http';
import {readFile,readdir,stat,mkdir,writeFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';

export const ids={claude:'11111111-1111-4111-8111-111111111111',codex:'22222222-2222-4222-8222-222222222222',busy:'33333333-3333-4333-8333-333333333333',question:'44444444-4444-4444-8444-444444444444'};
export const sessionList=[{id:ids.claude,label:'파일 뷰어 탭 만들기'},{id:ids.codex,label:'결제 API 리팩터링'},{id:ids.busy,label:'릴리스 노트 정리'},{id:ids.question,label:'배포 방식 정하기'}];

export async function createProject(root){
 const files={'src/app.mjs':"import {open} from './file-viewer.mjs';\nexport function start(){\n  open('README.md');\n}\n",'src/file-viewer.mjs':"// Center file tabs\nconst maxTabs=12;\nexport function open(path){ return path; }\n",
  'docs/viewer.md':'# 파일 뷰어\n\n가운데 탭으로 열립니다.\n\n- 코드 색 구분\n- 마크다운 보기\n','README.md':'# 예시 프로젝트\n\n[뷰어 문서](docs/viewer.md)\n\n```js\nstart();\n```\n','package.json':'{"name":"demo","version":"1.0.0"}\n'};
 for(const [p,c] of Object.entries(files)){await mkdir(join(root,p,'..'),{recursive:true});await writeFile(join(root,p),c);}
 return root;
}
const t0=Date.now()-15*60000;
const msg=(seq,role,content,at,extra={})=>({id:'m'+seq,seq,localId:null,createdAt:t0+at*1000,content:{role,content},...extra});
const out=(blocks)=>({type:'output',data:{type:'assistant',message:{content:blocks}}});
const result=(id,content='ok')=>({type:'output',data:{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content}]}}});
function claudeMessages(path){return [
 msg(1,'user',{type:'text',text:'오른쪽 파일 탭에서 연 파일을 가운데에서 새 탭으로 볼 수 있게 해줘'},0),
 msg(2,'agent',out([{type:'thinking',thinking:'파일 패널의 openPath 흐름을 먼저 보고, 가운데에 탭 줄을 넣을 자리를 찾자.'},{type:'text',text:'가운데에 **대화** 탭 옆으로 읽기 전용 파일 탭을 추가하겠습니다.'}]),20),
 msg(3,'agent',out([{type:'tool_use',id:'t1',name:'Read',input:{file_path:path+'/src/app.mjs'}}]),25),msg(4,'agent',result('t1'),26),
 msg(5,'agent',out([{type:'tool_use',id:'t2',name:'Edit',input:{file_path:path+'/src/file-viewer.mjs',old_string:'const maxTabs=8;',new_string:'// Center file tabs\nconst maxTabs=12;'}},{type:'tool_use',id:'t3',name:'Write',input:{file_path:path+'/docs/viewer.md',content:'# 파일 뷰어\n\n가운데 탭으로 열립니다.'}}]),40),
 msg(6,'agent',out([{type:'tool_result',tool_use_id:'t2',content:'ok'},{type:'tool_result',tool_use_id:'t3',content:'ok'}].map(x=>x)),41),
 msg(7,'agent',out([{type:'text',text:'파일 탭을 추가했습니다. 핵심은 `src/file-viewer.mjs:2`, 문서는 `docs/` 폴더에 있습니다.\n\n- 코드는 색 구분, 마크다운은 보기 모드\n- 이미지·영상·PDF는 바로 표시\n\n```js\nfileTabs.open(path,{size});\n```'}]),70),
 msg(8,'agent',{type:'event',data:{type:'ready'}},71)];}
function busyMessages(path){return [
 msg(1,'user',{type:'text',text:'릴리스 노트를 정리하고 검사를 돌려줘'},0),
 msg(2,'agent',out([{type:'text',text:'변경 내역을 확인하고 검사를 실행하겠습니다.'}]),10),
 msg(3,'agent',out([{type:'tool_use',id:'b1',name:'Read',input:{file_path:path+'/README.md'}}]),12),msg(4,'agent',result('b1'),13),
 msg(5,'agent',out([{type:'tool_use',id:'b2',name:'Bash',input:{command:'npm test'}}]),15),
 msg(6,'user',{type:'text',text:'끝나면 README에도 반영해줘'},30,{localId:'queued-1'})];}
const codexMessages=()=>[msg(1,'user',{type:'text',text:'결제 API의 오류 처리를 정리해줘'},0),
 msg(2,'agent',{type:'codex',data:{type:'reasoning',message:'**오류 경로 정리** 응답 코드별로 나눈다.'}},5),
 msg(3,'agent',{type:'codex',data:{type:'message',message:'오류 처리를 한 곳으로 모았습니다.'}},30),msg(4,'agent',{type:'event',data:{type:'ready'}},31)];

export async function startFakeHub({project,port=0}){
 const hits=[];let queued=new Set(['queued-1']);
 let question={q1:{tool:'AskUserQuestion',arguments:{questions:[{question:'어디에 배포할까요?',header:'배포',multiSelect:false,options:[{label:'스테이징',description:'먼저 확인'},{label:'운영'}]}]},createdAt:Date.now()}};
 const flavor=id=>id===ids.codex?'codex':'claude';
 const session=id=>({id,active:true,activeAt:Date.now(),updatedAt:Date.now(),thinking:id===ids.busy,metadata:{path:project,flavor:flavor(id),machineId:'ux-mac',host:'ux-mac',name:sessionList.find(s=>s.id===id)?.label},
  agentState:{requests:id===ids.question?question:{},controlledByUser:false},permissionMode:'default',modelMode:'default'});
 const messages=id=>id===ids.claude?claudeMessages(project):id===ids.busy?busyMessages(project):codexMessages();
 const inside=p=>{const full=resolve(project,p||'.');if(relative(project,full).startsWith('..'))throw Error('outside');return full;};
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x');res.setHeader('Content-Type','application/json');if(req.method!=='GET')hits.push(req.method+' '+u.pathname);
  const send=v=>res.end(JSON.stringify(v));
  try{
   if(u.pathname==='/api/auth')return send({token:'ux-token'});
   if(u.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': ok\n\n');return;}
   let m=/^\/api\/sessions\/([^/]+)(\/.*)?$/.exec(u.pathname);if(!m)return send({});
   const [,id,rest='']=m;
   if(!rest)return send({session:session(id)});
   if(rest==='/messages'&&req.method==='GET')return send({messages:messages(id),page:{hasMore:false}});
   if(rest==='/messages'&&req.method==='POST')return send({ok:true});
   if(rest==='/messages/queued-state')return send({queuedLocalIds:[...queued],indeterminateLocalIds:[],invokedLocalMessages:[]});
   if(req.method==='DELETE'&&rest.startsWith('/messages/')){queued=new Set();return send({status:'cancelled',localId:'queued-1'});}
   if(rest==='/abort')return send({ok:true});
   if(/^\/permissions\/[^/]+\/(approve|deny)$/.test(rest)){question={};return send({ok:true});}
   if(rest==='/git-diff-numstat')return send({success:true,exitCode:0,stdout:u.searchParams.get('staged')?'':'2\t1\tsrc/file-viewer.mjs\n'});
   if(rest==='/git-diff-file')return send({success:true,exitCode:0,stdout:'diff --git a/src/file-viewer.mjs b/src/file-viewer.mjs\n@@ -1,2 +1,3 @@\n-const maxTabs=8;\n+// Center file tabs\n+const maxTabs=12;\n export function open(path){ return path; }\n'});
   if(rest==='/slash-commands')return send({success:true,commands:[{name:'compact',source:'builtin',description:'대화 요약'},{name:'config',source:'builtin',description:'설정'},{name:'mcp',source:'builtin',description:'MCP 관리'}]});
   if(rest==='/skills')return send({success:true,skills:[]});
   if(rest==='/files'){const q=(u.searchParams.get('query')??'').toLowerCase(),all=['src/app.mjs','src/file-viewer.mjs','docs/viewer.md','README.md','package.json'];
    return send({success:true,files:all.filter(f=>f.toLowerCase().includes(q)).map(f=>({fileName:f.split('/').pop(),filePath:f.split('/').slice(0,-1).join('/'),fullPath:f,fileType:'file'}))});}
   if(rest==='/directory'){const dir=inside(u.searchParams.get('path'));const entries=await Promise.all((await readdir(dir,{withFileTypes:true})).map(async e=>({name:e.name,type:e.isDirectory()?'directory':'file',size:e.isFile()?(await stat(join(dir,e.name))).size:undefined})));
    entries.sort((a,b)=>(a.type==='directory')!==(b.type==='directory')?(a.type==='directory'?-1:1):a.name.localeCompare(b.name));return send({success:true,entries});}
   if(rest==='/file'){const f=inside(u.searchParams.get('path'));const b=await readFile(f);return send({success:true,content:b.toString('base64'),size:b.length});}
   return send({});
  }catch{res.writeHead(404).end('{}');}
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,hits,close:()=>{server.closeAllConnections();server.close();}};
}
