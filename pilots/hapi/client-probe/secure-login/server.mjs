import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createBroker} from './broker.mjs';

export function createTrialServer(){
  const browsers=new Map(),targets=new Set();
  const broker=createBroker({execute:async({requestId},values)=>{
    // Fixed internal fixture only: no user-controlled URL, browser, script or command.
    if(values.password!=='demo-only'||values.otp!=='123456')return false;
    targets.add(requestId);return true;
  }});
  const server=http.createServer(async(req,res)=>{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
    if(req.headers.host!==new URL(origin).host||req.headers['x-forwarded-for']||req.headers['x-forwarded-host']||req.headers['forwarded'])return reply(403,{error:'Local trial only'});
    if(req.headers.origin&&req.headers.origin!==origin)return reply(403,{error:'Origin rejected'});
    if(req.headers['sec-fetch-site']==='cross-site'&&!(req.method==='GET'&&req.url==='/'&&req.headers['sec-fetch-mode']==='navigate'))return reply(403,{error:'Cross-site rejected'});
    if(req.url.includes('?'))return reply(400,{error:'Query not allowed'});
    let cookie=/\btrial=([a-f0-9]{64})\b/.exec(req.headers.cookie??'')?.[1];
    try{
      if(req.method==='GET'&&['/','/app.js','/style.css'].includes(req.url)){
        if(req.url==='/'&&!browsers.has(cookie)){
          if(browsers.size>=200)return reply(429,{error:'Trial capacity reached'});
          cookie=randomBytes(32).toString('hex');browsers.set(cookie,{session:randomBytes(12).toString('hex'),csrf:randomBytes(32).toString('hex'),requests:new Map()});
          res.setHeader('Set-Cookie',`trial=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
        }
        const name=req.url==='/'?'index.html':req.url.slice(1);
        res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript':'text/css');
        return res.end(await readFile(new URL(name,import.meta.url)));
      }
      const browser=browsers.get(cookie);if(!browser)return reply(401,{error:'Open the trial page first'});
      if(req.method==='GET'&&req.url==='/target'){
        const completed=[...browser.requests].filter(([id])=>targets.has(id));
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>내장 시험 사이트</title><link rel="stylesheet" href="/style.css"><main><h1>${completed.length?'시험 로그인 완료':'시험 로그인 대기'}</h1><p>이 브라우저에서 완료된 시험 요청: ${completed.length}개</p><p>실제 외부 사이트나 AI 계정의 로그인 상태가 아닙니다.</p><a href="/">보안 입력 시험으로 돌아가기</a></main></html>`);
      }
      if(req.method==='GET'&&req.url==='/state')return reply(200,{csrf:browser.csrf,requests:[...browser.requests].map(([id,b])=>({...broker.status(id,b.engine,b.session),targetSignedIn:targets.has(id)}))});
      const supplied=Buffer.from(req.headers['x-trial-csrf']??'');const expected=Buffer.from(browser.csrf);
      if(req.method!=='POST'||req.headers.origin!==origin||req.headers['content-type']!=='application/json'||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply(403,{error:'Request rejected'});
      let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>1024)return reply(413,{error:'Too large'});body+=chunk;}
      const data=JSON.parse(body);body='';
      if(req.url==='/start'){
        if(Object.keys(data).join(',')!=='engine'||!['claude','codex'].includes(data.engine))return reply(400,{error:'Invalid engine'});
        const session=`trial-${data.engine}`;const r=broker.start(data.engine,`${session}-${browser.session}`);
        browser.requests.set(r.id,{engine:r.engine,session:r.session});return reply(200,r);
      }
      const binding=browser.requests.get(data.id);if(!binding)return reply(404,{error:'Unknown request'});
      if(req.url==='/submit'&&Object.keys(data).sort().join(',')==='id,otp,password'){
        const values={password:data.password,otp:data.otp};delete data.password;delete data.otp;
        const result=await broker.submit(data.id,binding.engine,binding.session,values);values.password='';values.otp='';return reply(200,result);
      }
      if(req.url==='/cancel'&&Object.keys(data).join(',')==='id')return reply(200,broker.cancel(data.id,binding.engine,binding.session));
      reply(400,{error:'Invalid request'});
    }catch{reply(409,{error:'요청이 만료되었거나 처리 중입니다. 시험 입력값과 현재 상태를 확인하세요.'});}
  });
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  createTrialServer().listen(61170,'127.0.0.1',()=>process.stdout.write('Secure login trial: http://127.0.0.1:61170/\n'));
}
