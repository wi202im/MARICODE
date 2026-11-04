// Usability run: synthetic Hub + the real app server + isolated headless Chrome, driving user tasks like a person.
// Writes .runtime/ux/<time>/report.md (+ JSON, screenshots). No real conversations, accounts or AI calls.
// Usage: npm run ux [-- <scenario name filter>]
import {mkdtemp,mkdir,rm,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../../pilots/hapi/client-probe/server.mjs';
import {startFakeHub,createProject,ids,sessionList} from './fake-hub.mjs';
import {launchChrome,openPage} from './browser.mjs';
import {auditScript} from './audit.mjs';
import {scenarios} from './scenarios.mjs';

const root=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const filter=process.argv[2]??'';
const stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const outDir=join(root,'.runtime','ux',stamp);await mkdir(outDir,{recursive:true});
const temp=await realpath(await mkdtemp(join(tmpdir(),'maricode-ux-')));
const project=await createProject(join(temp,'project'));
const hub=await startFakeHub({project});
const app=createServer({upstream:hub.url,sessionId:ids.claude,sessions:sessionList});await new Promise(r=>app.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${app.address().port}`;
const chrome=await launchChrome({profile:join(temp,'chrome'),port:9400+Math.floor(Math.random()*400)});
const results=[];
try{
 for(const [index,sc] of scenarios.entries()){
  if(filter&&!sc.name.includes(filter))continue;
  if(sc.needs){results.push({name:sc.name,goal:sc.goal,skipped:sc.needs,steps:[],findings:[],logs:[]});process.stdout.write(`- ${sc.name} (건너뜀: ${sc.needs})\n`);continue;}
  const page=await openPage(chrome),record={name:sc.name,goal:sc.goal,steps:[],findings:[],logs:[]};
  try{
   await page.goto(base+'/workspace');
   if(sc.session!==undefined){
    await page.evaluate(`sessionStorage.setItem('hapi-trial-selected-session',${JSON.stringify(sc.session)});true`);await page.login();await page.wait(1200);
   }
   for(const [si,[title,act]] of sc.steps.entries()){
    const step={title,ok:true};
    try{const r=await act(page);step.reacted=r?.changes===undefined?null:r.changes>0;step.feedbackMs=r?.first==null?null:Math.round(r.first);step.target=r?.label;}
    catch(e){step.ok=false;step.error=e.message;}
    step.shot=`${index+1}-${si+1}.png`;await page.screenshot(join(outDir,step.shot));record.steps.push(step);
    if(!step.ok)break;
   }
   record.findings=JSON.parse(await page.evaluate(auditScript));
  }catch(e){record.error=e.message;}
  record.logs=[...page.logs];await page.close();results.push(record);
  process.stdout.write(`${record.steps.every(s=>s.ok)&&!record.error?'✔':'✖'} ${sc.name}\n`);
 }
}finally{await chrome.close();app.closeAllConnections();app.close();hub.close();await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:300});}

const lines=[`# 사용성 점검 ${stamp}`,'',`합성 Hub(예시 데이터) + 앱 서버 + 헤드리스 Chrome. 클릭 = 실제 마우스 입력, 반응 = 1.5초 안의 화면 변화.`,'',
 '| 과업 | 단계 | 실패 | 반응 없음 | 화면 문제 | 오류 |','|---|---|---|---|---|---|',
 ...results.map(r=>r.skipped?`| ${r.name} | 건너뜀: ${r.skipped} | | | | |`:`| ${r.name} | ${r.steps.length} | ${r.steps.filter(s=>!s.ok).length+(r.error?1:0)} | ${r.steps.filter(s=>s.reacted===false).length} | ${r.findings.length} | ${r.logs.length} |`),''];
for(const r of results){
 lines.push(`## ${r.name}`,`목표: ${r.goal}`,'');
 for(const s of r.steps)lines.push(`- ${s.ok?(s.reacted===false?'⚠ 반응 없음':'✔'):'✖'} ${s.title}${s.feedbackMs!=null?` · ${s.feedbackMs}ms`:''}${s.error?` — ${s.error}`:''} ([화면](${s.shot}))`);
 if(r.error)lines.push(`- ✖ 진행 실패: ${r.error}`);
 if(r.findings.length){lines.push('','화면 문제:');for(const f of r.findings)lines.push(`- ${f.kind}: ${f.where}${f.detail?` (${f.detail})`:''}`);}
 if(r.logs.length){lines.push('','오류:');for(const l of r.logs)lines.push(`- ${l.level}: ${l.text}`);}
 lines.push('');
}
await writeFile(join(outDir,'report.md'),lines.join('\n'));await writeFile(join(outDir,'report.json'),JSON.stringify({stamp,results,hubCalls:hub.hits},null,1));
console.log(`\n보고서: ${join(outDir,'report.md')}`);
