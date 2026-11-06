import {PRODUCT_VERSION} from '../../../apps/mac-launcher/version.mjs';
import {questionDecision,requestQuestions} from './questions.mjs';
import {uploadPayload} from './attachments.mjs';
import {workspaceRequest} from './workspace-plans.mjs';
import {gitSummary} from './git-status.mjs';
import {serverIdentity} from './server-identity.mjs';
import {createRunnerSetup,runnerSetupReason} from './runner-setup.mjs';
import {machineOptions} from './machine-setup.mjs';
import {createAccountRegistration} from './account-registration.mjs';
import {createAccounts} from './accounts.mjs';
import {settingsView,settingChange} from './settings.mjs';
import http from 'node:http';
import {createTasks} from './tasks.mjs';
import {projectFilePath} from './files.mjs';
import {createFileLinks} from './file-stream.mjs';
import {listDirectory,readProjectFile} from './local-files.mjs';
import {projectChoices,selectProject} from './projects.mjs';
import {createHandoffs} from './handoff.mjs';
import { readFile,realpath } from 'node:fs/promises';
import {join} from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { relativePath } from './core.mjs';
import {requestSnapshot,permissionDecision} from './workflow.mjs';
import {createEnvironment,canUseMachine} from './environment.mjs';
import {randomBytes,createHash} from 'node:crypto';

async function readPresentationAsset(name) {
  const asset=await readFile(new URL(name,import.meta.url));
  return name.endsWith('.html')?asset.toString('utf8').replaceAll('{{PRODUCT_VERSION}}',PRODUCT_VERSION):asset;
}

export function allowedRoute(method,url,sessionId) {
  if(method==='POST'&&url.pathname==='/api/auth')return !url.search;
  if(Array.isArray(sessionId))return sessionId.some(id=>allowedRoute(method,url,id));
  const p=url.pathname,base=`/api/sessions/${sessionId}`;
  if(url.searchParams.has('token'))return false;
  if(method==='POST'&&p==='/api/auth')return true;
  if(method==='GET'&&p==='/api/events')return url.searchParams.get('sessionId')===sessionId&&!url.searchParams.has('all')&&!url.searchParams.has('machineId');
  if(method==='GET'&&p===base)return true;
  if(method==='GET'&&p===base+'/git-status')return !url.search;
  if(method==='GET'&&[base+'/slash-commands',base+'/skills'].includes(p))return !url.search;
  if(method==='GET'&&p===base+'/git-diff-numstat')return !url.search||url.search==='?staged=true';
  if(method==='GET'&&p===base+'/git-diff-file'){if([...url.searchParams.keys()].some(k=>!['path','staged'].includes(k))||!url.searchParams.get('path')||![null,'true'].includes(url.searchParams.get('staged')))return false;try{relativePath(url.searchParams.get('path'));return true;}catch{return false;}}
  if(['GET','POST'].includes(method)&&p===base+'/settings'&&!url.search)return true;
  // Project file search for @-mentions: query (and limit) only.
  if(method==='GET'&&p===base+'/files')return [...url.searchParams.keys()].every(k=>['query','limit'].includes(k))&&(url.searchParams.get('query')??'').length<=200&&/^\d{0,3}$/.test(url.searchParams.get('limit')??'');
  if(method==='GET'&&['/messages','/directory','/file','/file-link'].some(x=>p===base+x)) {
    if(p.endsWith('/file')||p.endsWith('/file-link')||p.endsWith('/directory')){try{relativePath(url.searchParams.get('path')??'');}catch{return false;}}
    return true;
  }
  if(method==='POST'&&p.startsWith(base+'/permissions/')&&/^\/api\/sessions\/[^/]+\/permissions\/(?:[A-Za-z0-9_-]|%3[Aa]|:)+\/(approve|deny)$/.test(p))return true;
  // Queued (not yet delivered) messages: cancel, or steer into the running Codex turn. HAPI refuses delivered ones.
  if(p!==base+'/messages/queued-state'&&/^\/messages\/[A-Za-z0-9_-]{1,80}(\/steer)?$/.test(p.slice(base.length))&&p.startsWith(base+'/messages/')&&!url.search)return p.endsWith('/steer')?method==='POST':method==='DELETE';
  return method==='POST'&&['/messages','/messages/queued-state','/resume','/archive','/upload','/fork','/abort'].some(x=>p===base+x);
}
export function createServer({cleanStart=false,appReset=null,pairing,deviceLogins,desktopAccess,upstream,sessionId,sessions=[{id:sessionId,label:"Codex 시험"}],origins=[],handoffTarget,taskTarget,accountConfig,accountCandidates={},environmentPath,runnerConfig,runnerService=runnerConfig?createRunnerSetup(runnerConfig):null,registrationService=accountConfig?createAccountRegistration(accountConfig,accountCandidates):null,accountsService=accountConfig?createAccounts(accountConfig):null}) {
  if(runnerConfig&&(runnerConfig.accountConfig!==accountConfig||new URL(runnerConfig.hubUrl).origin!==new URL(upstream).origin))throw Error('Runner must use the displayed account configuration and Hub');
  if(runnerConfig&&(handoffTarget||taskTarget))throw Error('Runner workspace cannot use a different fixed task target');
  const environment=environmentPath?createEnvironment(environmentPath):null;
  const setupNonce=randomBytes(32).toString('hex'),remoteStreams=new Set();
  const uploads=new Map(),fileLinks=createFileLinks();
  const target=new URL(upstream),decisions=new Set(),archives=new Set(),sessionMutations=new Set(),settingLocks=new Set(),handoffs=handoffTarget?createHandoffs(handoffTarget):null;
  if(!['127.0.0.1','localhost'].includes(target.hostname)||target.protocol!=='http:')throw Error('Loopback Hub required');
  if(taskTarget&&(!handoffTarget||taskTarget.machineId!==handoffTarget.machineId))throw Error('Task target must use the configured machine');
  const trialTasks=handoffTarget?createTasks({...handoffTarget,directory:handoffTarget.directory+'/tasks'}):null;
  const taskConfig=taskTarget??handoffTarget;
  const tasks=taskTarget?createTasks(taskTarget):trialTasks;
  const projectHandoffs=taskTarget?createHandoffs({...taskTarget,directory:taskTarget.directory+'/handoffs'}):null;
  const assets=new Map([['/manifest.webmanifest','manifest.webmanifest'],['/icon-192.png','icon-192.png'],['/icon-512.png','icon-512.png'],['/install','install.html'],['/install.mjs','install.mjs'],['/','index.html'],['/workspace','workspace/index.html'],['/workspace/','workspace/index.html'],['/workspace/style.css','workspace/style.css'],['/workspace/chat.css','workspace/chat.css'],['/workspace/vscode.css','workspace/vscode.css'],['/workspace.mjs','workspace.mjs'],['/git-status.mjs','git-status.mjs'],['/workspace-entry.mjs','workspace-entry.mjs'],['/design','design/index.html'],['/design/','design/index.html'],['/design/style.css','design/style.css'],['/design/app.js','design/app.js'],['/questions.mjs','questions.mjs'],['/question-form.mjs','question-form.mjs'],['/chat-render.mjs','chat-render.mjs'],['/chat-presentation.mjs','chat-presentation.mjs'],['/settings.mjs','settings.mjs'],['/git-review.mjs','git-review.mjs'],['/composer-commands.mjs','composer-commands.mjs'],['/cli-profile-ui.mjs','cli-profile-ui.mjs'],['/command-support.mjs','command-support.mjs'],['/turn-alerts.mjs','turn-alerts.mjs'],['/branch-pin-ui.mjs','branch-pin-ui.mjs'],['/branch-rules.mjs','branch-rules.mjs'],['/file-kinds.mjs','file-kinds.mjs'],['/file-viewer.mjs','file-viewer.mjs'],['/file-tree.mjs','file-tree.mjs'],['/file-mentions.mjs','file-mentions.mjs'],['/vendor/markdown-it.mjs','vendor/markdown-it.mjs'],['/vendor/highlight.mjs','vendor/highlight.mjs'],['/vendor/hljs-github-dark.css','vendor/hljs-github-dark.css'],['/icons.mjs','icons.mjs'],['/vendor/codicons/codicon.css','vendor/codicons/codicon.css'],['/vendor/vscode-elements/bundled.js','vendor/vscode-elements/bundled.js'],['/palette.mjs','palette.mjs'],['/attachments.mjs','attachments.mjs'],['/attachment-composer.mjs','attachment-composer.mjs'],['/app.mjs','app.mjs'],['/composer-input.mjs','composer-input.mjs'],['/claude-import-ui.mjs','claude-import-ui.mjs'],['/markdown.mjs','markdown.mjs'],['/device-login.mjs','device-login.mjs'],['/core.mjs','core.mjs'],['/quit-flow.mjs','quit-flow.mjs'],['/reconnect.mjs','reconnect.mjs'],['/workflow.mjs','workflow.mjs'],['/history.mjs','history.mjs'],['/style.css','style.css']]);
  const server=http.createServer(async(req,res)=>{
    const host=req.headers.host;
    const allowedOrigins=new Set(origins);
    const isLocal= /^127\.0\.0\.1:\d+$/.test(host??'');
    if(!isLocal&&!origins.some(o=>new URL(o).host===host)){res.writeHead(403).end();return;}
    if(isLocal)allowedOrigins.add(`http://${host}`);
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    let u,mutationId;
    try{u=new URL(req.url,'http://local');}catch{res.writeHead(400).end();return;}
    try {
    // Workspace protocol is opt-in for existing unversioned clients. Reject before any side effect.
    if(req.headers['x-merry-protocol']!==undefined&&req.headers['x-merry-protocol']!=='1'){res.writeHead(426,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,error:'workspace-update-required'}));return;}
    if(u.pathname==='/desktop-connect'){
      const ownHost=`127.0.0.1:${server.address().port}`;
      const local=req.headers.host===ownHost&&['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&!req.headers.forwarded&&!Object.keys(req.headers).some(k=>k.startsWith('x-forwarded-')||k.startsWith('tailscale-'));
      if(!desktopAccess||!environment||!local||u.search||req.method!=='POST'||req.headers.origin!=='null'||req.headers['content-type']!=='application/x-www-form-urlencoded'||req.headers['sec-fetch-mode']!=='navigate'||req.headers['sec-fetch-dest']!=='document'||!canUseMachine(await environment.read(),true)){res.writeHead(403).end();return;}
      let body='';for await(const part of req){body+=part;if(body.length>128){res.writeHead(413).end();return;}}
      const form=new URLSearchParams(body);if([...form.keys()].length!==1||!/^code=[a-f0-9]{64}$/.test(body)){res.writeHead(400).end();return;}
      try{
        const issued=await desktopAccess.exchange(form.get('code'));
        const credential=JSON.stringify(issued).replaceAll('<','\\u003c');
        const page=(await readPresentationAsset('workspace/index.html')).replace('</body>',`<script type="application/json" id="desktop-credential">${credential}</script></body>`);
        res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);
      }catch{res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8'}).end('연결이 만료됐거나 이미 사용되었습니다. Mac 앱에서 작업 화면 연결을 다시 누르세요.');}
      return;
    }
    // Media links carry their own one-file capability (see file-stream.mjs); media elements send no token.
    const rawFile=/^\/file-raw\/([0-9a-f]{64})$/.exec(u.pathname);
    if(rawFile&&!req.headers.origin&&!u.search){await fileLinks.serve(req,res,rawFile[1]);return;}
    const grammar=/^\/vendor\/hljs-languages\/([a-z0-9-]{1,40})\.mjs$/.exec(u.pathname);
    if(grammar&&req.method==='GET'&&!u.search){try{const code=await readFile(new URL(`vendor/hljs-languages/${grammar[1]}.mjs`,import.meta.url));res.setHeader('Content-Type','text/javascript');res.end(code);}catch{res.writeHead(404).end();}return;}
    if(u.pathname==='/vendor/codicons/codicon.ttf'&&req.method==='GET'&&!u.search){res.setHeader('Content-Type','font/ttf');res.setHeader('Cache-Control','max-age=86400');res.end(await readFile(new URL('vendor/codicons/codicon.ttf',import.meta.url)));return;}
    const fileIcon=/^\/vendor\/(file-icons)\/([a-z0-9_-]{1,40})\.svg$/.exec(u.pathname);
    if(fileIcon&&req.method==='GET'&&!u.search){try{const svg=await readFile(new URL(`vendor/${fileIcon[1]}/${fileIcon[2]}.svg`,import.meta.url));res.setHeader('Content-Type','image/svg+xml');res.setHeader('Cache-Control','max-age=86400');res.end(svg);}catch{res.writeHead(404).end();}return;}
    if(req.headers.origin&&!allowedOrigins.has(req.headers.origin)){res.writeHead(403).end();return;}
    if(req.method==='POST'&&(!allowedOrigins.has(req.headers.origin)||req.headers['content-type']!=='application/json')){res.writeHead(403).end();return;}
    if(req.method==='DELETE'&&!allowedOrigins.has(req.headers.origin)){res.writeHead(403).end();return;}
      // Public presentation assets contain no machine state or credentials.
      const sharedStyles=new Map([['/theme.css','theme.css'],['/settings.css','settings.css']]);
      if(sharedStyles.has(u.pathname)){
        if(req.method!=='GET'||u.search){res.writeHead(405).end();return;}
        res.setHeader('Content-Type','text/css; charset=utf-8');
        res.end(await readFile(new URL(sharedStyles.get(u.pathname),import.meta.url)));return;
      }
      if(environment){
        // Setup belongs to the execution machine, never to a remote browser claiming it.
        const local=(!req.headers.origin||req.headers.origin===`http://${host}`)&&host===`127.0.0.1:${server.address().port}`&&!req.headers.forwarded&&!Object.keys(req.headers).some(k=>k.startsWith('x-forwarded-'));
        if(u.pathname==='/api/environment/runner'){
          if(!local||u.search||req.headers['x-setup-nonce']!==setupNonce||!canUseMachine(await environment.read(),true)){res.writeHead(403).end();return;}
          if(!runnerService){res.writeHead(503).end();return;}
          try{
            if(req.method==='POST'){
              if(req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
              let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>128){res.writeHead(413).end();return;}}
              const input=JSON.parse(body);
              if(!input||Object.keys(input).join(',')!=='action'||!['prepare','start','stop','reprepare'].includes(input.action)){res.writeHead(400).end();return;}
              await runnerService[input.action]();
            }else if(req.method!=='GET'){res.writeHead(405).end();return;}
            res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await runnerService.status()));
          }catch{res.writeHead(409).end();}return;
        }
        if(u.pathname==='/api/environment/accounts/registration'){
          if(!local||u.search||req.headers['x-setup-nonce']!==setupNonce||!canUseMachine(await environment.read(),true)){res.writeHead(403).end();return;}
          if(!registrationService){res.writeHead(503).end();return;}
          try{
            if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await registrationService.list()));return;}
            if(req.method!=='POST'||req.headers.origin!==`http://${host}`){res.writeHead(405).end();return;}
            let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){res.writeHead(413).end();return;}}
            const result=await registrationService.register(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
          }catch{res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'등록 결과를 확정하지 못했습니다. 목록을 다시 확인하세요.'}));}return;
        }
        if(u.pathname.startsWith('/api/environment/accounts')){
          if(!local||u.search||req.headers['x-setup-nonce']!==setupNonce||!canUseMachine(await environment.read(),true)){res.writeHead(403).end();return;}
          if(!accountsService){res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'이 머신의 CLI 경로가 아직 등록되지 않았습니다.'}));return;}
          if(req.method==='GET'&&u.pathname==='/api/environment/accounts'){
            const providers=await Promise.all(['claude','codex'].map(async agent=>({agent,...await accountsService.status(agent)})));
            res.setHeader('Content-Type','application/json');res.end(JSON.stringify({providers}));return;
          }
          const match=/^\/api\/environment\/accounts\/(claude|codex)\/login$/.exec(u.pathname);
          if(req.method==='POST'&&match&&req.headers.origin===`http://${host}`){
            let body='';for await(const chunk of req){body+=chunk;if(body.length>128){res.writeHead(413).end();return;}}
            const input=JSON.parse(body);if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length){res.writeHead(400).end();return;}
            const before=await accountsService.status(match[1]);
            if(before.state!=='signed-out'||before.loginPending){res.writeHead(409).end();return;}
            const result=await accountsService.start(match[1]);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
          }
          res.writeHead(405).end();return;
        }
        const setupAssets=new Map([['/setup','setup/index.html'],['/setup/','setup/index.html'],['/setup/app.mjs','setup/app.mjs'],['/setup/progress.mjs','setup/progress.mjs'],['/setup/style.css','setup/style.css']]);
        if(u.pathname==='/api/environment/reset'&&appReset){
          // Local settings only: the reset itself runs on the next app start, before Hub/Runner.
          if(!local||u.search||req.method!=='POST'||req.headers['x-setup-nonce']!==setupNonce||req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
          let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>256){res.writeHead(413).end();return;}}
          let input;try{input=JSON.parse(body);}catch{res.writeHead(400).end();return;}
          if(input?.cancel===true)await appReset.cancel();else if(input?.confirm==='초기화')await appReset.request();else{res.writeHead(400).end();return;}
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({resetRequested:await appReset.requested()}));return;
        }
        if(setupAssets.has(u.pathname)||u.pathname==='/api/environment'){
          if(!local||u.search){res.writeHead(403).end();return;}
          if(req.method==='GET'&&setupAssets.has(u.pathname)){
            const name=setupAssets.get(u.pathname);res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript');res.end(await readPresentationAsset(name));return;
          }
          if(u.pathname==='/api/environment'){
            if(req.method==='POST'){
              if(req.headers['x-setup-nonce']!==setupNonce||req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
              let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2048){res.writeHead(413).end();return;}}
              try{await environment.save(JSON.parse(body));for(const stream of remoteStreams)stream.destroy();remoteStreams.clear();}
              catch{res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'설정을 저장하지 못했습니다. 현재 설정을 다시 조회하세요.'}));return;}
            }else if(req.method!=='GET'){res.writeHead(405).end();return;}
            res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...await environment.read(),nonce:setupNonce,cleanStart:cleanStart===true,appReset:appReset?.reset===true,resetRequested:appReset?await appReset.requested():false,resetAvailable:!!appReset,aiConfigurationRegistered:!!accountsService,aiRegistrationAvailable:!!registrationService,runnerSetupAvailable:!!runnerService,remoteEndpointConfigured:origins.length>0}));return;
          }
          res.writeHead(405).end();return;
        }
        const state=await environment.read();
        if(!canUseMachine(state,local)){
          if(local&&req.method==='GET'&&['/','/workspace','/workspace/'].includes(u.pathname)){res.writeHead(303,{Location:'/setup'}).end();return;}
          res.writeHead(403,{'Content-Type':'application/json'}).end(JSON.stringify({error:'이 머신의 역할 설정에서 작업 연결을 허용하지 않습니다.'}));return;
        }
        if(u.pathname==='/api/server-identity'){
          if(req.method!=='GET'||u.search){res.writeHead(405).end();return;}
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({serverId:await serverIdentity(environmentPath+'.identity.json')}));return;
        }
        if(req.headers['x-merry-server-id']&&req.headers['x-merry-server-id']!==await serverIdentity(environmentPath+'.identity.json')){res.writeHead(403).end();return;}
        if(!local&&u.pathname==='/api/events'){remoteStreams.add(res);res.on('close',()=>remoteStreams.delete(res));}
      }
      // A device revoked at this server loses its current token here too, before HAPI's own 4-hour expiry.
      if(deviceLogins&&req.headers.authorization?.startsWith('Bearer ')&&await deviceLogins.revoked(req.headers.authorization.slice(7))){res.writeHead(401).end();return;}
      const children=handoffs?await handoffs.list():[];
      let available=[...sessions,...children,...(trialTasks?await trialTasks.list():[]),...(taskTarget?[...await tasks.list(),...await projectHandoffs.list()].map(r=>({...r,project:r.project??taskTarget.project,scope:'personal'})):[])];
      const runnerWorkspace=typeof runnerService?.workspace==='function';
      const localImport=isLocal&&host===`127.0.0.1:${server.address().port}`&&['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&!req.headers.forwarded&&!Object.keys(req.headers).some(k=>k.startsWith('x-forwarded-')||k.startsWith('tailscale-'));
      if(pairing&&u.pathname==='/api/pairing-code'){
        // Only the server Mac's own signed-in app may show or cancel a code.
        if(!localImport||u.search||!['GET','POST'].includes(req.method)){res.writeHead(403).end();return;}
        try{const check=await fetch(new URL('/api/sessions',target),{headers:{authorization:req.headers.authorization??''},redirect:'error',signal:AbortSignal.timeout(5000)});if(!check.ok){res.writeHead(check.status===401?401:403).end();return;}}catch{res.writeHead(503).end();return;}
        let action='status';if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>256){res.writeHead(413).end();return;}}try{action=JSON.parse(raw).action;}catch{res.writeHead(400).end();return;}}
        const result=action==='issue'?pairing.issue():action==='cancel'?(pairing.cancel(),{active:false}):action==='status'?pairing.status:null;
        if(!result){res.writeHead(400).end();return;}
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));return;
      }
      if(pairing&&u.pathname==='/api/pair'){
        if(req.method!=='POST'||u.search){res.writeHead(405).end();return;}
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>256){res.writeHead(413).end();return;}}
        // Staying signed in registers this device for refresh; the name is checked before the one-time code is spent.
        let input;try{input=JSON.parse(raw);if(input.device!==undefined&&(!deviceLogins||typeof input.device!=='string'||!input.device.trim()||input.device.length>60||/[\u0000-\u001f]/.test(input.device)))throw Error();}catch{res.writeHead(400).end();return;}
        try{const token=await pairing.redeem(input.code);if(typeof token!=='string'||!token)throw Error('Login unavailable');const device=input.device===undefined?undefined:await deviceLogins.register(input.device,token);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({token,...(device?{device}:{})}));}
        catch(error){res.writeHead(error.status===401?401:503,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:error.status===401,error:error.status===401?error.message:'로그인을 발급하지 못했습니다. 서버 Mac의 상태를 확인하세요.'}));}
        return;
      }
      if(deviceLogins&&u.pathname==='/api/device-refresh'){
        if(req.method!=='POST'||u.search){res.writeHead(405).end();return;}
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>512){res.writeHead(413).end();return;}}
        let input;try{input=JSON.parse(raw);if(typeof input.id!=='string'||input.id.length>64||typeof input.secret!=='string'||input.secret.length>128||![undefined,'forget'].includes(input.action))throw Error();}catch{res.writeHead(400).end();return;}
        try{const out=input.action==='forget'?(await deviceLogins.forget(input.id,input.secret),{forgotten:true}):await deviceLogins.refresh(input.id,input.secret);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(out));}
        catch(error){const status=[401,409].includes(error.status)?error.status:503;res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:status!==503,error:status===503?'로그인을 갱신하지 못했습니다. 서버 Mac의 상태를 확인하세요.':error.message}));}
        return;
      }
      if(deviceLogins&&u.pathname==='/api/devices'){
        // Like the pairing code: only the server Mac's own signed-in app may list or revoke devices.
        if(!localImport||u.search||!['GET','POST'].includes(req.method)){res.writeHead(403).end();return;}
        try{const check=await fetch(new URL('/api/sessions',target),{headers:{authorization:req.headers.authorization??''},redirect:'error',signal:AbortSignal.timeout(5000)});if(!check.ok){res.writeHead(check.status===401?401:403).end();return;}}catch{res.writeHead(503).end();return;}
        if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>256){res.writeHead(413).end();return;}}
         let input;try{input=JSON.parse(raw);if(input.action!=='revoke'||typeof input.id!=='string'||input.id.length>64)throw Error();}catch{res.writeHead(400).end();return;}
         await deviceLogins.revoke(input.id);}
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({devices:await deviceLogins.list()}));return;
      }
      if(u.pathname==='/api/conversations/prepare'){
        if(req.method!=='POST'||u.search||!runnerService?.generalChat){res.writeHead(405).end();return;}
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>128){res.writeHead(413).end();return;}}
        if(raw.trim()!=='{}'){res.writeHead(400).end();return;}
        try{const result=await runnerService.generalChat(req.headers.authorization);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));}
        catch(error){res.writeHead([401,403].includes(error.status)?error.status:409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'일반 대화 공간을 준비하지 못했습니다. 연결과 파일 접근 권한을 확인하세요.'}));}return;
      }
      // Same session in the official terminal UI (this Mac's screen only). Never reopened automatically.
      if(u.pathname==='/api/session-terminal'){
        if(!localImport||u.search||!['GET','POST'].includes(req.method)||!runnerService?.openSessionTerminal){res.writeHead(403).end();return;}
        try{
          let raw='';if(req.method==='POST')for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1024){res.writeHead(413).end();return;}}
          const result=req.method==='GET'?await runnerService.sessionTerminalStatus(req.headers.authorization):await runnerService.openSessionTerminal(req.headers.authorization,JSON.parse(raw));
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));
        }catch(error){res.writeHead([401,403].includes(error.status)?error.status:409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:error.rejected===true,error:error.rejected?error.message:'터미널 실행 상태를 확인하지 못했습니다. 터미널 창을 먼저 확인하세요. 자동으로 다시 열지 않습니다.'}));}
        return;
      }
      if(u.pathname==='/api/account-profiles'&&runnerService?.accountProfiles){
        // Adding or switching accounts restarts this computer's Runner; only the local app may do it.
        if(u.search||!['GET','POST'].includes(req.method)||req.method==='POST'&&!localImport){res.writeHead(403).end();return;}
        try{
          let raw='';if(req.method==='POST')for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096){res.writeHead(413).end();return;}}
          const result=req.method==='GET'?await runnerService.accountProfiles(req.headers.authorization):await runnerService.accountProfile(req.headers.authorization,JSON.parse(raw));
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));
        }catch(error){res.writeHead([401,403].includes(error.status)?error.status:409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:error.rejected===true,error:error.rejected?(error.userMessage??error.message):'계정 전환 결과를 확인하지 못했습니다. AI 계정 상태를 다시 확인하세요.'}));}
        return;
      }
      const importRoute=/^\/api\/(claude|codex)-import(\/list|\/check)?$/.exec(u.pathname);
      if(importRoute){
        const importer=runnerService?.[importRoute[1]+'Import'];
        if(!localImport||!importer){res.writeHead(403).end();return;}
        if(req.method!=='POST'||u.search){res.writeHead(405).end();return;}
        try{
          let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192){res.writeHead(413).end();return;}}
          const result=await importer.call(runnerService,req.headers.authorization,JSON.parse(raw),u.pathname.endsWith('/list')?'list':u.pathname.endsWith('/check')?'check':'import');
          res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
        }catch(error){res.writeHead([401,403].includes(error.status)?error.status:409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:error.rejected===true,reason:error.reason,error:error.userMessage??'가져오기 결과를 확인하지 못했습니다. 원본은 변경하지 않았습니다. 결과 확인 후 폴더·기록 변경 여부와 실행기 상태를 확인하세요.'}));}return;
      }
      if(runnerWorkspace){
        if(!runnerService.target&&/^\/api\/sessions\/[^/]+\/(file|file-link|directory|files)$/.test(u.pathname)){res.writeHead(403).end();return;}
        available=[];
        if(u.pathname==='/config'||u.pathname.startsWith('/api/sessions/')||u.pathname==='/api/events'){
          if(!req.headers.authorization?.startsWith('Bearer ')){res.writeHead(401).end();return;}
          try{available=await runnerService.workspace(req.headers.authorization);}catch(error){res.writeHead([401,403].includes(error.status)?error.status:503).end();return;}
        }
      }
      const importHistory=/^\/api\/sessions\/([a-f0-9-]{36})\/import-history$/.exec(u.pathname);
      if(importHistory&&runnerService?.claudeImportHistory){
        if(!localImport||req.method!=='GET'||[...u.searchParams.keys()].some(k=>k!=='before')){res.writeHead(403).end();return;}
        try{const before=u.searchParams.has('before')?Number(u.searchParams.get('before')):undefined;
          const result=await runnerService.claudeImportHistory(req.headers.authorization,importHistory[1],before);
          res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
        }catch{res.writeHead(409).end();}return;
      }
      if(runnerWorkspace&&runnerService.manage&&u.pathname==='/api/navigation'){
        if(u.search){res.writeHead(400).end();return;}
        try{let result;
          if(req.method==='GET')result=await runnerService.navigation(req.headers.authorization);
          else if(req.method==='POST'){
            let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048){res.writeHead(413).end();return;}}
            result=await runnerService.manage(req.headers.authorization,JSON.parse(raw));
          }else{res.writeHead(405).end();return;}
          res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
        }catch(error){res.writeHead([401,403].includes(error.status)?error.status:409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,error:error.message}));}return;
      }
      if(runnerWorkspace&&runnerService.branches&&['/api/branches','/api/branch-pin'].includes(u.pathname)){
        try{let result;
          if(req.method==='GET'&&u.pathname==='/api/branches'){const id=u.searchParams.get('session');if([...u.searchParams.keys()].some(k=>k!=='session')||!/^[a-f0-9-]{36}$/.test(id??'')){res.writeHead(400).end();return;}result=await runnerService.branches(req.headers.authorization,id);}
          else if(req.method==='POST'&&u.pathname==='/api/branch-pin'&&!u.search){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048){res.writeHead(413).end();return;}}result=await runnerService.branchPin(req.headers.authorization,JSON.parse(raw));}
          else{res.writeHead(405).end();return;}
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));
        }catch(error){res.writeHead([401,403].includes(error.status)?error.status:409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,error:error.message}));}return;
      }
      if(runnerWorkspace&&runnerService.workspaceChoices&&u.pathname==='/api/workspace-choices'){
        if(req.method!=='GET'||[...u.searchParams.keys()].some(k=>k!=='project')){res.writeHead(400).end();return;}
        try{const choices=await runnerService.workspaceChoices(req.headers.authorization,u.searchParams.get('project')??'');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(choices));}
        catch(error){res.writeHead([400,401,403].includes(error.status)?error.status:409).end(JSON.stringify({error:'작업 폴더 정보를 확인하지 못했습니다.'}));}return;
      }
      if(runnerWorkspace&&runnerService.task&&['/api/projects','/api/tasks','/api/tasks/check'].includes(u.pathname)){
        if(u.search){res.writeHead(400).end();return;}
        try{
          let result;
          if(req.method==='GET'&&u.pathname==='/api/projects'){
            if(runnerService.projects)result={projects:await runnerService.projects(req.headers.authorization)};else{const t=await runnerService.target(req.headers.authorization);result={projects:[{key:'',label:t.project}]};}
          }else if(req.method==='POST'&&u.pathname!=='/api/projects'){
            let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048){res.writeHead(413).end();return;}}
            if(!u.pathname.endsWith('/check')&&runnerService.ready){
              // No spawn record exists at this point. Authentication and AI setup precede mutation.
              await runnerService.projects(req.headers.authorization);
              const input=JSON.parse(raw);
              if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['requestId','agent','project','workspace','handoffFrom'].includes(k))||!/^[a-f0-9-]{36}$/.test(input.requestId??'')||!['codex','claude'].includes(input.agent)||(input.project!==undefined&&typeof input.project!=='string')){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,error:'새 세션 요청 형식을 확인해 주세요.'}));return;}
              if(input.workspace)workspaceRequest(input);
              if(accountsService&&(await accountsService.status(input.agent)).state!=='connected'){res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,reason:'AI_SETUP',error:'선택한 AI의 설치·구독 로그인을 먼저 연결하세요.'}));return;}
              if(!input.workspace)try{await runnerService.ready(req.headers.authorization,input.project,input.agent);
                for(let attempt=0;attempt<15;attempt++){if((await runnerService.status(input.project)).workspaceAvailable)break;if(attempt===14)throw Error();await new Promise(resolve=>setTimeout(resolve,300));}}
              catch(error){const reason=runnerSetupReason(error);
                const message=reason==='RUNNER_ACTIVE'?'새 프로젝트나 AI를 적용하려면 이 컴퓨터의 기존 세션 실행을 먼저 종료해 주세요. 기존 작업은 유지했고 새 세션은 만들지 않았습니다. 종료 후 다시 만들기를 누르면 자동으로 준비합니다.':reason==='RUNNER_UNCONFIRMED'?'이전 세션 생성 결과를 먼저 확인해 주세요. 실행 환경을 바꾸거나 새 세션을 만들지 않았습니다.':'실행 환경의 준비를 확인하지 못했습니다. 컴퓨터 설정에서 실행 상태를 확인해 주세요. 새 세션 생성 요청은 보내지 않았습니다.';
                res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,reason,error:message}));return;}
            }
            result=await runnerService.task(JSON.parse(raw),req.headers.authorization,u.pathname.endsWith('/check'));
          }else{res.writeHead(405).end();return;}
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
        }catch(error){res.writeHead([400,401,403].includes(error.status)?error.status:409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:error.rejected===true,reason:error.reason,error:error.reason==='RUNNER_ACTIVE'?'작업 폴더 선택은 보존했습니다. 새 프로젝트 폴더를 쓰려면 실행기를 다시 시작해야 하는데, 이 컴퓨터에서 실행 중인 세션이 있어 시작하지 않았습니다. 실행 중인 세션을 종료한 뒤 생성 결과 확인을 누르면 같은 요청으로 계속합니다.':error.reason==='RUNNER_UNCONFIRMED'?'작업 폴더 선택은 보존했습니다. 이전 세션 생성 결과를 먼저 확인해 주세요.':error.reason==='RUNNER_SETUP'?'작업 폴더 선택은 보존했습니다. 실행 환경 준비를 확인하지 못했습니다. 생성 결과 확인을 눌러 같은 요청으로 계속하세요.':error.rejected?error.message:'결과를 확인하지 못했습니다. 같은 요청의 결과 확인을 눌러 주세요.'}));}return;
      }
      if(req.method==='GET'&&u.pathname==='/config') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sessionId:available[0]?.id??null,sessions:available,pairing:localImport&&!!pairing&&(!environment||(await environment.read()).roles.server===true),sessionTerminal:localImport&&!!runnerService?.openSessionTerminal,claudeImport:localImport&&!!runnerService?.claudeImport,codexImport:localImport&&!!runnerService?.codexImport,fileRead:runnerWorkspace?!!runnerService.target:!!handoffTarget,newHandoff:!runnerWorkspace&&!!handoffs,navigation:!!runnerService?.manage,newTask:runnerWorkspace&&runnerService.target?{generalChat:!!runnerService.generalChat,workspaceChoices:!!runnerService.workspaceChoices,project:runnerService.projects?'':(await runnerService.target(req.headers.authorization)).project}:!runnerWorkspace&&tasks?{project:taskConfig.project}:null}));return;}
      if(req.method==='GET'&&assets.has(u.pathname)) {
        const name=assets.get(u.pathname);res.setHeader('Content-Type',name.endsWith('.webmanifest')?'application/manifest+json':name.endsWith('.png')?'image/png':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript');
        let asset=await readPresentationAsset(name);
        if(name==='workspace/index.html'){
          const machineSetup=!!environment&&isLocal&&(!req.headers.origin||req.headers.origin===`http://${host}`)&&!req.headers.forwarded&&!Object.keys(req.headers).some(k=>k.startsWith('x-forwarded-'));
          asset=asset.toString();
          if(machineSetup)asset=asset.replace('<body ','<body data-machine-setup="true" ');
          else asset=asset.replace(/<a\b[^>]*href="\/setup"[^>]*>[\s\S]*?<\/a>/g,'').replace(/<p>\s*<\/p>/g,'');
        }
        res.end(asset);return;
      }
      const handoffSource=handoffs&&!u.search&&available.find(s=>(req.method==='GET'||req.method==='POST')&&u.pathname===`/api/sessions/${s.id}/handoff`||req.method==='POST'&&u.pathname===`/api/sessions/${s.id}/handoff/check`);
      const taskRoute=tasks&&req.method==='POST'&&!u.search&&['/api/tasks','/api/tasks/check'].includes(u.pathname);
      const creation=handoffSource;
      const personalCreation=creation?.scope==='personal';
      const creationTarget=personalCreation?{...taskTarget,project:creation.project}:handoffTarget?{...handoffTarget,project:creation?.project??handoffTarget.project}:null;
      const creationHandoffs=creationTarget?createHandoffs({...creationTarget,directory:personalCreation?taskTarget.directory+'/handoffs':handoffTarget.directory}):null;
      const accountsRoute=accountsService&&(handoffTarget||runnerWorkspace)&&!u.search&&((req.method==='GET'&&u.pathname==='/api/accounts')||(req.method==='POST'&&/^\/api\/accounts\/(claude|codex)\/login$/.test(u.pathname)));
      const projectsRoute=tasks&&req.method==='GET'&&u.pathname==='/api/projects'&&!u.search;
      if(!accountsRoute&&!projectsRoute&&!taskRoute&&!creation&&!allowedRoute(req.method,u,available.map(s=>s.id))){res.writeHead(403).end();return;}
      // Credentials are supplied by the client. This proxy has no stored Hub token.
      if(u.pathname!=='/api/auth'&&!req.headers.authorization?.startsWith('Bearer ')){res.writeHead(401).end();return;}
      const controller=new AbortController();res.on('close',()=>controller.abort());
      const headers={};if(req.headers.authorization)headers.Authorization=req.headers.authorization;
      let body;
      if(req.method==='POST') {
        const parts=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>(u.pathname.endsWith('/upload')?7*1024*1024+2048:65536)){res.writeHead(413).end();return;}parts.push(chunk);}
        body=Buffer.concat(parts);JSON.parse(body.toString());headers['Content-Type']='application/json';
      }
      const sessionRead=req.method==='GET'&&/^\/api\/sessions\/([^/]+)$/.exec(u.pathname);
      const changingSession=req.method==='POST'&&/^\/api\/sessions\/([^/]+)\/(messages|upload|resume|archive|fork|settings|permissions\/[^/]+\/(approve|deny))$/.exec(u.pathname);
      let resumeUnconfirmed=false;
      if((sessionRead||changingSession)&&runnerWorkspace&&runnerService.reconcileResume){
        resumeUnconfirmed=!await runnerService.reconcileResume((sessionRead||changingSession)[1],req.headers.authorization);
        if(resumeUnconfirmed&&changingSession){res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,reason:'RESUME_UNCONFIRMED',error:'재개 결과를 아직 확인하지 못했습니다. 상태만 다시 조회하며 재개 요청은 반복하지 않습니다.'}));return;}
      }
      if(changingSession){
        mutationId=changingSession[1];
        if(sessionMutations.has(mutationId)){mutationId=null;res.writeHead(409,{'Content-Type':'application/json'}).end('{"rejected":true}');return;}
        sessionMutations.add(mutationId);
      }
      if(req.method==='POST'&&u.pathname.endsWith('/upload')){
        let payload,input;try{input=JSON.parse(body.toString());payload=uploadPayload(input);}catch{res.writeHead(400).end();return;}
        const id=u.pathname.split('/')[3];
        const check=await fetch(new URL(`/api/sessions/${id}`,target),{headers,signal:controller.signal,redirect:'error'});
        if(!check.ok){res.writeHead(check.status).end();return;}
        if((await check.json()).session?.active!==true){res.writeHead(409).end();return;}
        const key=id+':'+input.requestId,digest=createHash('sha256').update(body).digest('hex'),prior=uploads.get(key);
        if(prior){if(prior.digest!==digest||!prior.result){res.writeHead(409).end();return;}res.writeHead(prior.status,{'Content-Type':'application/json'}).end(JSON.stringify(prior.result));return;}
        if(uploads.size>=100){res.writeHead(503).end();return;}
        const record={digest};uploads.set(key,record);
        // An ambiguous upload is never automatically reissued. The browser only
        // sends locally selected bytes, never a caller-selected destination path.
        try{const result=await fetch(new URL(u.pathname,target),{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(60000),redirect:'error'});
          record.result=await result.json();record.status=result.status;res.writeHead(result.status,{'Content-Type':'application/json'}).end(JSON.stringify(record.result));
        }catch{res.writeHead(502,{'Content-Type':'application/json'}).end('{"error":"Upload result unconfirmed"}');}
        return;
      }
      if(accountsRoute){
        const localLogin=isLocal&&!['x-forwarded-for','x-forwarded-host','x-forwarded-proto','tailscale-user-login'].some(h=>req.headers[h])&&(!req.headers.origin||req.headers.origin===`http://${host}`)&&['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress);
        if(req.method==='POST'&&!localLogin){res.writeHead(403).end();return;}
        if(req.method==='POST'&&body.toString()!=='{}'){res.writeHead(400).end();return;}
        let m;
        if(runnerWorkspace){await (runnerService.projects??runnerService.workspace).call(runnerService,req.headers.authorization);m={host:'이 실행 컴퓨터'};}
        else {
        const access=await fetch(new URL(`/api/sessions/${sessions[0].id}`,target),{headers,signal:controller.signal,redirect:'error'});
        if(!access.ok){res.writeHead(access.status).end();return;}
        m=(await access.json()).session?.metadata;
        if(m?.machineId!==handoffTarget.machineId||m?.path!==handoffTarget.project){res.writeHead(403).end();return;}
        }
        const result=req.method==='POST'?await accountsService.start(u.pathname.split('/')[3]):{host:m.host??'실행 머신',localLogin,providers:await Promise.all(['claude','codex'].map(async agent=>({agent,...await accountsService.status(agent)})))};
        if(req.method==='GET'&&localLogin&&runnerService?.status){try{const r=await runnerService.status();result.runner={phase:r.phase,hub:r.hub,agents:r.agents};}catch{result.runner={phase:'unknown'};}}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
      }
      if(taskRoute||projectsRoute){
        const input=taskRoute?JSON.parse(body.toString()):null;
        if(taskRoute&&(!input||Object.keys(input).some(k=>!['requestId','agent','project'].includes(k))||!['codex','claude'].includes(input.agent)||!/^[a-f0-9-]{36}$/.test(input.requestId??'')||(input.project!==undefined&&typeof input.project!=='string'))){res.writeHead(400).end();return;}
        // Authorize against the configured project session, never a caller-selected host/path.
        const access=await fetch(new URL(`/api/sessions/${sessions[0].id}`,target),{headers,signal:controller.signal,redirect:'error'});
        if(!access.ok){res.writeHead(access.status).end();return;}
        const anchor=(await access.json()).session;
        if(anchor?.metadata?.machineId!==handoffTarget.machineId||anchor?.metadata?.path!==handoffTarget.project){res.writeHead(403).end();return;}
        if(projectsRoute){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({projects:await projectChoices(taskConfig.project)}));return;}
        let selectedProject=taskConfig.project;
        try{if(input.project)selectedProject=await selectProject(taskConfig.project,input.project);}catch{res.writeHead(403).end();return;}
        const selectedTasks=createTasks({...taskConfig,directory:taskTarget?taskConfig.directory:taskConfig.directory+'/tasks',project:selectedProject,legacyProject:taskConfig.project});
        const request={requestId:input.requestId,agent:input.agent};
        const lookup=async id=>{
          const r=await fetch(new URL(`/api/sessions/${id}`,target),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
          if(!r.ok)throw Error('Readback unavailable');
          return {...(await r.json()).session,id};
        };
        try{
          const record=u.pathname.endsWith('/check')?await selectedTasks.check(request,lookup):await selectedTasks.create(request,async agent=>{
            const r=await fetch(new URL(`/api/machines/${taskConfig.machineId}/spawn`,target),{method:'POST',headers,body:JSON.stringify({directory:selectedProject,agent,startingMode:'remote',sessionType:'simple',yolo:false}),signal:AbortSignal.timeout(120000),redirect:'error'});
            const result=await r.json();if(!r.ok||result.type!=='success')throw Error('Unknown outcome');return result.sessionId;
          },lookup);
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:record.state,session:record.state==='created'?record:null}));
        }catch{res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'작업 생성 결과가 불확실합니다. 같은 요청의 결과 확인을 사용하세요. 자동으로 다시 생성하지 않습니다.'}));}
        return;
      }
      if(creation){
        if(req.method==='POST'&&body.toString()!=='{}'){res.writeHead(400).end();return;}
        const sourceResponse=await fetch(new URL(`/api/sessions/${creation.id}`,target),{headers,signal:controller.signal,redirect:'error'});
        if(!sourceResponse.ok){res.writeHead(sourceResponse.status).end();return;}
        const source={...(await sourceResponse.json()).session,id:creation.id};
        const lookup=async id=>{
          const check=await fetch(new URL(`/api/sessions/${id}`,target),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
          if(!check.ok)throw Error('생성 결과 불확실');
          return {...(await check.json()).session,id};
        };
        try{
          const child=req.method==='GET'?await creationHandoffs.status(source):u.pathname.endsWith('/check')?await creationHandoffs.check(source,lookup):await creationHandoffs.create(source,async agent=>{
            // Do not cancel an in-flight spawn when the browser disconnects; record its outcome.
            const spawned=await fetch(new URL(`/api/machines/${creationTarget.machineId}/spawn`,target),{method:'POST',headers,body:JSON.stringify({directory:creationTarget.project,agent,startingMode:'remote',sessionType:'simple',yolo:false}),signal:AbortSignal.timeout(120000),redirect:'error'});
            const result=await spawned.json();
            if(!spawned.ok||result.type!=='success'||!/^[-a-f0-9]{36}$/.test(result.sessionId??''))throw Error('생성 결과 불확실');
            return result.sessionId;
          },lookup);
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:child.state,session:child.state==='created'?child:null}));
        }catch{res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'생성 결과를 확인하지 못했습니다. 자동 재생성하지 않습니다. 상태를 확인한 뒤 다시 조회해 주세요.'}));}
        return;
      }
      if(req.method==='POST'&&u.pathname.endsWith('/archive')){
        const id=u.pathname.split('/')[3],input=JSON.parse(body.toString()),expected=input?.expected;
        const reply=(status,rejected)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify({rejected}));};
        if(u.search||!input||Object.keys(input).some(k=>!['requestId','expected'].includes(k))||!/^[a-f0-9-]{36}$/.test(input.requestId??'')||!expected||Object.keys(expected).length!==2||!Number.isInteger(expected.metadataVersion)||!Number.isInteger(expected.agentStateVersion)){reply(400,true);return;}
        const key=id+':'+input.requestId;
        // A repeated request never acquires a fresh execution, even after an acknowledgement was lost.
        if(archives.has(key)){reply(409,false);return;}
        if(settingLocks.has(id)||archives.size>=500){reply(409,true);return;}
        let forwarded=false;
        try{
          const perform=async()=>{
            const check=await fetch(new URL(`/api/sessions/${id}`,target),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
            if(!check.ok){reply(check.status,true);return;}
            const state=(await check.json()).session;
            if(state?.active!==true||state.thinking!==false||state.agentState?.controlledByUser!==false||Object.keys(state.agentState?.requests??{}).length||state.metadataVersion!==expected.metadataVersion||state.agentStateVersion!==expected.agentStateVersion){reply(409,true);return;}
            archives.add(key);forwarded=true;
            // Finish the owned mutation even when the browser disconnects.
            const result=await fetch(new URL(`/api/sessions/${id}/archive`,target),{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(15000),redirect:'error'});
            if(!result.ok||(await result.json()).ok!==true)throw Error('Archive outcome unknown');
            res.setHeader('Content-Type','application/json');res.end('{"ok":true}');
          };
          if(runnerWorkspace&&runnerService.runSessionMutation)await runnerService.runSessionMutation(perform,{session:id});else await perform();
        }catch{reply(502,!forwarded);}
        return;
      }
      if(u.pathname.endsWith('/settings')){
        const id=u.pathname.split('/')[3];
        const load=async()=>{
          const r=await fetch(new URL(`/api/sessions/${id}`,target),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
          if(!r.ok){const error=Error('Session unavailable');error.status=r.status;throw error;}
          const state=(await r.json()).session;let catalog=null;
          if(state?.metadata?.flavor==='codex'){
            try{const r=await fetch(new URL(`/api/sessions/${id}/codex-models`,target),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});if(r.ok)catalog=await r.json();}catch{}
          }
          else if(state?.metadata?.flavor==='claude'&&typeof state.metadata.machineId==='string'){
            try{const r=await fetch(new URL(`/api/machines/${encodeURIComponent(state.metadata.machineId)}/claude-models`,target),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});if(r.ok)catalog=await r.json();}catch{}
          }
          return {state,catalog};
        };
        const changing=req.method==='POST';
        if(changing&&settingLocks.has(id)){res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true}));return;}
        if(changing)settingLocks.add(id);
        let forwarded=false;
        try{
          let {state,catalog}=await load();
          if(changing){
            const change=settingChange(state,catalog,JSON.parse(body.toString()));
            forwarded=true;
            const r=await fetch(new URL(`/api/sessions/${id}/${change.route}`,target),{method:'POST',headers,body:JSON.stringify(change.body),signal:AbortSignal.timeout(15000),redirect:'error'});
            if(!r.ok||(await r.json()).ok!==true)throw Error('Setting outcome unknown');
            ({state,catalog}=await load());
          }
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify(settingsView(state,catalog)));
        }catch(error){res.writeHead(error.status??409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:changing&&!forwarded,error:'설정 결과를 확인하지 못했습니다. 재전송하지 말고 설정을 다시 조회하세요.'}));}
        finally{if(changing)settingLocks.delete(id);}
        return;
      }
      const permission=/^\/api\/sessions\/([^/]+)\/permissions\/((?:[A-Za-z0-9_-]|%3[Aa]|:)+)\/(approve|deny)$/.exec(u.pathname);
      if(permission){
        const reject=(status,error)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,error}));
        const payload=JSON.parse(body.toString());
        if(!payload||Object.keys(payload).some(k=>!['expected','scope','engine','answers'].includes(k))||typeof payload.expected?.tool!=='string'||!Object.hasOwn(payload.expected,'arguments')){reject(400,'승인 요청 형식이 올바르지 않습니다.');return;}
        const [,id,encodedRequestId,action]=permission,requestId=decodeURIComponent(encodedRequestId),key=id+':'+requestId;
        const check=await fetch(new URL(`/api/sessions/${id}`,target),{headers,signal:controller.signal,redirect:'error'});
        if(!check.ok){reject(check.status,'요청 상태를 확인하지 못했습니다. 다시 조회해 주세요.');return;}
        const session=(await check.json()).session,request=session?.agentState?.requests?.[requestId];
        if(!session?.active||!request||requestSnapshot(request)!==requestSnapshot(payload.expected)){reject(409,'요청이 바뀌었습니다. 새 내용을 확인해 주세요.');return;}
        if(decisions.has(key)){res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:false,error:'이미 전달한 승인 결과를 확인 중입니다.'}));return;}
        if(payload.engine!==undefined&&payload.engine!==session.metadata?.flavor||payload.scope==='session'&&!payload.engine){reject(409,'AI와 승인 범위를 다시 확인해 주세요.');return;}
        const question=['AskUserQuestion','request_user_input'].includes(request.tool);
        if(question&&(!requestQuestions(session.metadata?.flavor,request)||payload.scope&&payload.scope!=='once')){reject(400,'Unsupported question');return;}
        if(!question&&payload.answers!==undefined){reject(400,'Unexpected answers');return;}
        let decision;try{decision=question&&action==='approve'?questionDecision(session.metadata?.flavor,request,payload.answers):permissionDecision(session.metadata?.flavor,request,action,payload.scope??'once');}catch(error){reject(400,error.message);return;}
        if(decisions.size>=500){reject(503,'승인 처리 한도에 도달했습니다.');return;}
        decisions.add(key); // Do not replay even if the upstream acknowledgement is lost.
        body=JSON.stringify(decision);
      }
      if(req.method==='GET'&&/\/api\/sessions\/[^/]+\/(file|file-link|directory|files)$/.test(u.pathname)&&(handoffTarget||(runnerWorkspace&&runnerService.target))){
        // A stopped Runner cannot list files; this Mac's own sessions are then read from disk with the same checks.
        let fileTarget,localRead=false;const fileScope={session:u.pathname.split('/')[3]};try{if(runnerWorkspace&&runnerService.status&&!(await runnerService.status(fileScope)).workspaceAvailable){if(!runnerService.localMachine)throw Object.assign(Error('Runner offline'),{status:409});fileTarget={machineId:await runnerService.localMachine(fileScope)};localRead=true;}else fileTarget=runnerWorkspace?await runnerService.target(req.headers.authorization,fileScope):handoffTarget;}catch(error){res.writeHead(error.status===401?401:409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,reason:'RUNNER_OFFLINE',error:'이 컴퓨터의 실행 환경에 연결되지 않았습니다. 컴퓨터 설정에서 실행 환경을 시작한 뒤 다시 읽어 주세요. 대화와 파일은 그대로 남아 있습니다.'}));return;}
        const id=u.pathname.split('/')[3];
        const check=await fetch(new URL(`/api/sessions/${id}`,target),{headers,signal:controller.signal,redirect:'error'});
        if(!check.ok){res.writeHead(check.status).end();return;}
        const m=(await check.json()).session?.metadata;
        if(m?.machineId!==fileTarget.machineId||m?.path!==(available.find(s=>s.id===id)?.project??fileTarget.project)){res.writeHead(403).end();return;}
        // Search runs on the Runner (ripgrep) inside the session folder; it has no path to rewrite and no offline fallback.
        if(u.pathname.endsWith('/files')){if(localRead){res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,reason:'RUNNER_OFFLINE',error:'실행 환경이 꺼져 있어 파일을 검색하지 못했습니다. 메시지를 보내면 실행 환경이 켜집니다.'}));return;}}
        else try{u.searchParams.set('path',await projectFilePath(m.path,u.searchParams.get('path')??''));}
        catch{res.writeHead(403,{'Content-Type':'application/json'}).end(JSON.stringify({error:'프로젝트 밖의 링크이거나 접근할 수 없는 경로입니다.'}));return;}
        if(u.pathname.endsWith('/file-link')){
          // The Runner of this file route is this Mac, so the checked path is read from this disk.
          try{const url=await fileLinks.issue(join(await realpath(m.path),u.searchParams.get('path')));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url}));}
          catch(error){res.writeHead(error.status===415?415:403,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.status===415?'이 형식은 바로 재생할 수 없습니다.':'파일을 열 수 없습니다.'}));}
          return;
        }
        if(localRead){
          try{const root=await realpath(m.path),rel=u.searchParams.get('path');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.pathname.endsWith('/directory')?await listDirectory(root,rel):await readProjectFile(root,rel)));}
          catch{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:'파일을 읽지 못했습니다.'}));}
          return;
        }
      }
      let resumeSource;
      if(runnerWorkspace&&runnerService.ready&&runnerService.projects&&req.method==='POST'&&u.pathname.endsWith('/resume')){
        // A user's explicit resume includes preparing its existing execution
        // environment. Reads never start a Runner or an AI session.
        try{
          if(body.toString()!=='{}')throw Error('Invalid resume payload');
          const id=u.pathname.split('/')[3],row=available.find(s=>s.id===id);
          const check=await fetch(new URL(`/api/sessions/${id}`,target),{headers,signal:controller.signal,redirect:'error'});
          if(!check.ok)throw Error('Session unavailable');
          const current=(await check.json()).session,m=current?.metadata;
          if(!current||current.active||m?.path!==row?.project||!['claude','codex'].includes(m?.flavor))throw Error('Session changed');
          resumeSource={...current,id};
          const project=(await runnerService.projects(req.headers.authorization)).find(p=>p.path===m.path&&p.available!==false);
          if(!project)throw Error('Project unavailable');
          await runnerService.ready(req.headers.authorization,project.key,m.flavor);
          for(let attempt=0;attempt<40;attempt++){
            if((await runnerService.status(project.key)).workspaceAvailable)break;
            if(attempt===39)throw Error('Runner unavailable');
            await new Promise(resolve=>setTimeout(resolve,250));
          }
        }catch{res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({rejected:true,reason:'RUNNER_SETUP',error:'기존 세션의 실행 환경을 준비하지 못했습니다. 재개 요청은 보내지 않았습니다. 폴더 접근·AI 연결과 컴퓨터 설정의 실행 상태를 확인해 주세요.'}));return;}
      }
      const forward=async()=>{
        // Once sent, a resume belongs to the server operation, not the browser
        // connection. Read the complete acknowledgement under the lifecycle lock.
        const result=await fetch(new URL(u.pathname+u.search,target),{method:req.method,headers,body,signal:resumeSource?AbortSignal.timeout(120000):controller.signal,redirect:'error'});
        if(!resumeSource)return result;
        const bytes=await result.arrayBuffer(),ack=JSON.parse(Buffer.from(bytes).toString());
        if(!result.ok||ack.sessionId!==resumeSource.id||ack.type==='error'||ack.ok===false)throw Error('Resume acknowledgement unconfirmed');
        return new Response(bytes,{status:result.status,headers:{'Content-Type':'application/json'}});
      };
      let r;
      try{r=runnerWorkspace&&runnerService.runSessionMutation&&req.method==='POST'&&u.pathname.endsWith('/resume')?await runnerService.runSessionMutation(forward,{resume:resumeSource}):await forward();}
      catch(error){res.writeHead(error.status===409?409:502,{'Content-Type':'application/json'}).end(JSON.stringify(error.reason==='ACCOUNT_MISMATCH'?{rejected:true,reason:error.reason,error:error.message}:error.status===409?{rejected:true,reason:'RUNNER_OFFLINE',error:'실행 환경이 꺼져 있습니다. 컴퓨터 설정에서 실행 환경을 시작한 뒤 같은 세션을 재개해 주세요.'}:{error:'응답을 확인하지 못했습니다. 다시 보내기 전에 상태를 조회해 주세요.'}));return;}
      if(sessionRead&&r.ok&&resumeUnconfirmed){const data=await r.json();res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({...data,session:{...data.session,resumeUnconfirmed:true}}));return;}
      if(req.method==='GET'&&u.pathname.endsWith('/git-status')){
        res.writeHead(r.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify(r.ok?gitSummary(await r.json()):{state:'unavailable'}));return;
      }
      if(req.method==='GET'&&/\/git-diff-(numstat|file)$/.test(u.pathname)){
        const j=r.ok?await r.json():null;res.writeHead(r.ok?200:r.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify(j?.success===true&&(j.exitCode==null||j.exitCode===0)&&typeof j.stdout==='string'?{state:'ready',stdout:j.stdout.slice(0,2_000_000)}:{state:'unavailable'}));return;
      }
      res.statusCode=r.status;res.setHeader('Content-Type',r.headers.get('content-type')??'application/json');
      if(u.pathname==='/api/events'){res.setHeader('X-Accel-Buffering','no');res.flushHeaders();}
      if(req.method==='POST'){res.end(Buffer.from(await r.arrayBuffer()));return;}
      if(r.body)Readable.fromWeb(r.body).on('error',()=>res.destroy()).pipe(res);else res.end();
    }catch {if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'}).end('{"error":"연결 요청을 완료하지 못했습니다."}');else res.destroy();}
    finally{if(mutationId)sessionMutations.delete(mutationId);}
  });
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const sessionId=process.env.D1_SESSION_ID;
  const sessions=process.env.D1_SESSIONS?JSON.parse(process.env.D1_SESSIONS):[{id:sessionId,label:'Codex 시험'}];
  if(!sessions.length||sessions.some(s=>!s.id||!/^[a-f0-9-]{36}$/.test(s.id)))throw Error('Trial session IDs required');
  const port=Number(process.env.D1_PORT??61165);
  if(process.env.D3_MACHINE_DIRECTORY&&(process.env.D2_ACCOUNT_CONFIG||process.env.D3_ACCOUNT_CANDIDATES))throw Error('Choose one machine account configuration');
  const machine=process.env.D3_MACHINE_DIRECTORY?await machineOptions(process.env.D3_MACHINE_DIRECTORY):{accountConfig:process.env.D2_ACCOUNT_CONFIG,accountCandidates:process.env.D3_ACCOUNT_CANDIDATES?JSON.parse(process.env.D3_ACCOUNT_CANDIDATES):{}};
  createServer({upstream:'http://127.0.0.1:61164',sessions,runnerConfig:process.env.D3_RUNNER_CONFIG?JSON.parse(await readFile(process.env.D3_RUNNER_CONFIG,'utf8')):undefined,environmentPath:process.env.D3_ENVIRONMENT_PATH,...machine,taskTarget:process.env.D2_TASK_TARGET?JSON.parse(process.env.D2_TASK_TARGET):undefined,handoffTarget:process.env.D2_HANDOFF_TARGET?JSON.parse(process.env.D2_HANDOFF_TARGET):undefined,origins:(process.env.D1_ORIGINS??'').split(',').filter(Boolean)}).listen(port,'127.0.0.1',()=>console.log(`Development client listening on loopback port ${port}`));
}
