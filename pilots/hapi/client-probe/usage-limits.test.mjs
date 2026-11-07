import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,utimes,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claudeLimitEvent,latestClaudeLimit,limitLabel,windowLabel,limitText,formatReset} from './usage-limits.mjs';
import {readCodexLimits} from './codex-limits.mjs';
import {chatTimeline} from './chat-presentation.mjs';
import {createServer} from './server.mjs';

const agentText=(seq,text)=>({id:'m'+seq,seq,createdAt:1000+seq,content:{role:'agent',content:{type:'output',data:{type:'assistant',message:{content:[{type:'text',text}]}}}}});
const tz={timeZone:'Asia/Seoul'};

test('Claude usage limit events from HAPI are parsed, never shown as raw pipe text',()=>{
 assert.deepEqual(claudeLimitEvent('Claude AI usage limit warning|1762837200|85|seven_day'),{agent:'claude',state:'warning',percent:85,resetsAt:1762837200000,limitType:'seven_day',label:'주간 한도'});
 assert.deepEqual(claudeLimitEvent('Claude AI usage limit reached|1762837200|five_hour'),{agent:'claude',state:'reached',percent:null,resetsAt:1762837200000,limitType:'five_hour',label:'5시간 한도'});
 assert.equal(claudeLimitEvent('Claude AI usage limit reached|1762837200').label,'사용량 한도');
 for(const text of ['Claude AI usage limit warning|abc|85|x','hello Claude AI usage limit reached|1|x','Claude AI usage limit warning|1762837200|85',null])assert.equal(claudeLimitEvent(text),null);
 const rows=chatTimeline([agentText(1,'답변'),agentText(2,'Claude AI usage limit warning|1762837200|85|seven_day')]);
 assert.equal(rows.length,2);assert.equal(rows[1].kind,'limit');assert.equal(rows[1].limit.percent,85);
 assert.ok(!JSON.stringify(rows).includes('|1762837200|'));
 assert.equal(latestClaudeLimit([agentText(1,'Claude AI usage limit warning|1762830000|80|five_hour'),agentText(2,'x'),agentText(3,'Claude AI usage limit reached|1762837200|seven_day')]).state,'reached');
 assert.equal(latestClaudeLimit([agentText(1,'x')]),null);
});

test('limit labels and reset text are readable Korean and mark past resets',()=>{
 assert.equal(limitLabel('seven_day_opus'),'주간 Opus 한도');assert.equal(limitLabel('mystery'),'사용량 한도');
 assert.equal(windowLabel(300),'5시간 한도');assert.equal(windowLabel(10080),'주간 한도');assert.equal(windowLabel(60),'1시간 한도');assert.equal(windowLabel(undefined),'사용량 한도');
 const now=Date.UTC(2026,10,7,3,0);// 2026-11-07 12:00 KST
 assert.equal(formatReset(Date.UTC(2026,10,7,5,30),now,tz),'오늘 14:30 (약 2시간 30분 후)');
 assert.equal(formatReset(Date.UTC(2026,10,9,5,0),now,tz),'11월 9일 (월) 14:00 (약 2일 2시간 후)');
 assert.equal(formatReset(now-60000,now,tz),'이미 지났습니다 · 다시 확인 필요');
 assert.equal(limitText({state:'warning',percent:85,label:'주간 한도',resetsAt:Date.UTC(2026,10,7,5,30)},now,tz),'Claude 주간 한도 85% 사용 · 초기화 오늘 14:30 (약 2시간 30분 후)');
 assert.equal(limitText({state:'reached',percent:null,label:'5시간 한도',resetsAt:Date.UTC(2026,10,7,5,30)},now,tz),'Claude 5시간 한도에 도달했습니다 · 초기화 오늘 14:30 (약 2시간 30분 후)');
});

const tokenCount=(at,primary,extra={})=>JSON.stringify({timestamp:at,type:'event_msg',payload:{type:'token_count',info:null,rate_limits:{limit_id:'codex',limit_name:null,primary,secondary:null,credits:{has_credits:false,unlimited:false,balance:null},plan_type:'plus',...extra}}});
async function codexHome(t){const home=await mkdtemp(join(tmpdir(),'codex-limits-'));t.after(()=>rm(home,{recursive:true,force:true}));return home;}
async function rollout(home,day,name,lines,mtime){const dir=join(home,'sessions',...day);await mkdir(dir,{recursive:true});const f=join(dir,name);await writeFile(f,lines.join('\n')+'\n');if(mtime)await utimes(f,mtime/1000,mtime/1000);return f;}

test('Codex limits come from the newest rollout record and expose no paths or conversation text',async t=>{
 const home=await codexHome(t);
 await rollout(home,['2026','11','05'],'rollout-old.jsonl',[tokenCount('2026-11-05T01:00:00.000Z',{used_percent:10,window_minutes:10080,resets_at:1762900000})],Date.UTC(2026,10,5));
 await rollout(home,['2026','11','07'],'rollout-new.jsonl',[
  JSON.stringify({timestamp:'2026-11-07T02:00:00.000Z',type:'response_item',payload:{type:'message',content:[{type:'input_text',text:'secret prompt'}]}}),
  tokenCount('2026-11-07T02:01:00.000Z',{used_percent:41.5,window_minutes:10080,resets_at:1763000000},{secondary:{used_percent:7,window_minutes:300,resets_at:1762500000}}),
  JSON.stringify({timestamp:'2026-11-07T02:02:00.000Z',type:'event_msg',payload:{type:'token_count',info:null,rate_limits:null}}),
  '{broken json'],Date.UTC(2026,10,7));
 const r=await readCodexLimits(home);
 assert.deepEqual(r,{state:'ok',plan:'plus',observedAt:Date.parse('2026-11-07T02:01:00.000Z'),windows:[{name:'primary',usedPercent:41.5,windowMinutes:10080,resetsAt:1763000000000},{name:'secondary',usedPercent:7,windowMinutes:300,resetsAt:1762500000000}],credits:{hasCredits:false,unlimited:false,balance:null}});
 assert.ok(!JSON.stringify(r).includes(home));assert.ok(!JSON.stringify(r).includes('secret'));
});

test('Codex limits report missing or invalid records instead of zero usage',async t=>{
 const home=await codexHome(t);
 assert.deepEqual(await readCodexLimits(home),{state:'no-records'});
 await rollout(home,['2026','11','07'],'rollout-a.jsonl',[tokenCount('2026-11-07T02:01:00.000Z',{used_percent:'lots',window_minutes:300,resets_at:1})]);
 assert.deepEqual(await readCodexLimits(home),{state:'no-records'});
 const outside=await codexHome(t);await rollout(outside,['x'],'rollout-z.jsonl',[tokenCount('2026-11-07T02:01:00.000Z',{used_percent:5,window_minutes:300,resets_at:1762500000})]);
 await symlink(join(outside,'sessions','x','rollout-z.jsonl'),join(home,'sessions','2026','11','07','rollout-link.jsonl'));
 assert.deepEqual(await readCodexLimits(home),{state:'no-records'},'symlinked rollouts are not followed');
 assert.deepEqual(await readCodexLimits(join(home,'missing')),{state:'no-records'});
});

test('usage limit route requires Hub authorization and returns only the normalized Codex limits',async t=>{
 const directory=await codexHome(t);let reads=0;
 const upstream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(401).end('{}');return;}res.end(JSON.stringify({session:{metadata:{machineId:'machine',path:'/trial',host:'test-machine'}}}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=createServer({upstream:`http://127.0.0.1:${upstream.address().port}`,sessionId:'10000000-0000-4000-8000-000000000001',handoffTarget:{directory,machineId:'machine',project:'/trial'},accountsService:{status:async()=>({state:'connected'})},usageService:{codex:async()=>{reads++;return {state:'ok',plan:'plus',observedAt:1,windows:[],credits:null};}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(origin+'/api/usage-limits')).status,401);
 assert.equal((await fetch(origin+'/api/usage-limits',{headers:{Authorization:'Bearer bad'}})).status,401);assert.equal(reads,0);
 assert.equal((await fetch(origin+'/api/usage-limits?path=/etc',{headers:{Authorization:'Bearer synthetic'}})).status,403);
 assert.equal((await fetch(origin+'/api/usage-limits',{method:'POST',headers:{Authorization:'Bearer synthetic',Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,403);
 const r=await fetch(origin+'/api/usage-limits',{headers:{Authorization:'Bearer synthetic'}});assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{codex:{state:'ok',plan:'plus',observedAt:1,windows:[],credits:null}});assert.equal(reads,1);
});

test('session info lines keep source, observation time and unknown states explicit',async()=>{
 const {usageLines}=await import('./usage-panel.mjs');
 const now=Date.UTC(2026,10,7,3,0),reset=Date.UTC(2026,10,7,5,30);
 const codex={state:'ok',plan:'plus',observedAt:Date.UTC(2026,10,7,2,0),windows:[{name:'primary',usedPercent:41.6,windowMinutes:10080,resetsAt:reset},{name:'secondary',usedPercent:90,windowMinutes:300,resetsAt:now-1000}],credits:null};
 const v=usageLines({claude:null,codex,now,timeZone:'Asia/Seoul'});
 assert.deepEqual(v.claude,{lines:[],note:'Claude는 한도에 가까워지거나 도달했을 때만 알려 줍니다. 이 대화에서 받은 한도 알림이 없습니다.'});
 assert.deepEqual(v.codex.lines,[{text:'주간 한도 42% 사용 · 초기화 오늘 14:30 (약 2시간 30분 후)',tone:''},{text:'5시간 한도 · 기록 이후 초기화 시각이 지나 지금 사용량은 확인 안 됨',tone:'stale'}]);
 assert.equal(v.codex.note,'이 Mac의 최근 Codex 기록 기준 · 요금제 plus · 기록 시각 오늘 11:00');
 const warn=usageLines({claude:{state:'warning',percent:85,label:'주간 한도',resetsAt:reset,at:now-60000},codex:{state:'no-records'},now,timeZone:'Asia/Seoul'});
 assert.deepEqual(warn.claude.lines,[{text:'주간 한도 85% 사용 · 초기화 오늘 14:30 (약 2시간 30분 후)',tone:'high'}]);
 assert.equal(warn.claude.note,'이 대화의 마지막 Claude 한도 알림 · 받은 시각 오늘 11:59');
 assert.match(warn.codex.note,/찾지 못했습니다/);assert.deepEqual(warn.codex.lines,[]);
 assert.match(usageLines({codex:{state:'connection-required'},now}).codex.note,/연결/);
 assert.match(usageLines({codex:null,now}).codex.note,/확인 안 함|불러오지/);
 assert.equal(usageLines({claude:{state:'reached',percent:null,label:'5시간 한도',resetsAt:reset,at:now},codex:null,now,timeZone:'Asia/Seoul'}).claude.lines[0].tone,'reached');
});
