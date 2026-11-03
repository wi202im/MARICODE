import {cleanStart110} from './clean-start.mjs';
import {resetLegacyCliProfiles,addCliUser} from './cli-profile-reset.mjs';
import {acquireRuntimeLock} from './runtime-lock.mjs';
import {resolveHapiBinary} from './bundled-hapi.mjs';
import {createHttpsForward} from './https-forward.mjs';
import {createEnvironment} from '../../pilots/hapi/client-probe/environment.mjs';
import {readRemoteOrigin} from './remote-config.mjs';
import http from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from '../../pilots/hapi/client-probe/server.mjs';
import {createPairing} from '../../pilots/hapi/client-probe/pairing.mjs';
import {startBackend} from './backend.mjs';
import {createDesktopAccess} from './desktop-access.mjs';
import {checkDataFormat} from './data-format.mjs';
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
export async function startDesktopWeb({directory,port=61192,beforeClose=async()=>{},onForwardExit=()=>{},cleanInstall=false}){
 if(!isAbsolute(directory)||!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid launcher configuration');
 await mkdir(directory,{recursive:true,mode:0o700});
 const ownership=await acquireRuntimeLock(directory);
 const forward=createHttpsForward({onExit:onForwardExit});let remoteBusy=false;
 let stage='format';
 let web,unconfiguredHub,backend,desktopAccess,connecting=false,closed=false,closing=null;
 try{
  await checkDataFormat(directory);
  stage=cleanInstall?'transition':'configuration';
  const cleanStart=cleanInstall?await cleanStart110(directory):{reset:false};
  stage='configuration';
  if(!cleanInstall)await resetLegacyCliProfiles(directory);
  await addCliUser(directory);
  const remote=await readRemoteOrigin(directory);
  let config;
  try{config=JSON.parse(await readFile(join(directory,'backend.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(config){
   if(!config||config.version!==1||Object.keys(config).some(k=>!['version','binary','accountConfig','port'].includes(k)))throw Error('Unsupported backend configuration');
   stage='backend';
   backend=await startBackend({...config,binary:resolveHapiBinary(config.binary),directory,ownership});
  }
  // Unconfigured installations do not connect to or adopt an existing Hub.
  if(!backend){
  unconfiguredHub=http.createServer((req,res)=>res.writeHead(503,{'Content-Type':'application/json'}).end('{"error":"Hub is not configured in this development launcher"}'));
  await listen(unconfiguredHub);
  }
  if(backend)desktopAccess=createDesktopAccess({directory,authenticate:()=>backend.authenticate()});
  stage='web';
  web=createServer({cleanStart:cleanStart.reset,origins:remote?[remote]:[],desktopAccess,pairing:backend?createPairing({authenticate:()=>backend.authenticate()}):undefined,...(backend?{upstream:backend.upstream,accountConfig:backend.accountConfig,runnerService:backend.runnerService}:{upstream:`http://127.0.0.1:${unconfiguredHub.address().port}`}),sessions:[],environmentPath:join(directory,'environment.json')});
  await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${web.address().port}`,get remotePhase(){return forward.phase;},
  async startRemote(expected){
   if(closed||closing||remoteBusy||!backend||!remote||expected!==remote)throw Error('Remote start unavailable');
   remoteBusy=true;
   try{
    const state=await createEnvironment(join(directory,'environment.json')).read();
    if(!state.roles.server||await readRemoteOrigin(directory)!==expected)throw Error('Server settings changed');
    ownership.remoteStarting();
    await forward.start({origin:remote,target:`http://127.0.0.1:${web.address().port}`});
   }finally{if(forward.phase==='stopped')ownership.remoteStopped();remoteBusy=false;}
  },
  async stopRemote(){
   if(closed||closing||remoteBusy)throw Error('Remote operation pending');
   remoteBusy=true;try{await forward.stop();ownership.remoteStopped();}finally{remoteBusy=false;}
  },
  async connect(){
   if(closed||closing||connecting||!desktopAccess)throw Error('Local backend unavailable');
   connecting=true;try{await desktopAccess.prepare(`http://127.0.0.1:${web.address().port}`);}finally{connecting=false;}
  },async close(){
   if(closed)return;
   if(remoteBusy)throw Error('Remote operation pending');
   if(connecting)throw Error('Local connection preparation pending');
   if(closing)return closing;
   closing=(async()=>{
    // A denied or unknown shutdown must leave the UI available for recovery.
    await beforeClose();
    await backend?.close();await forward.stop();ownership.remoteStopped();await desktopAccess?.close();
    await close(web);if(unconfiguredHub)await close(unconfiguredHub);await ownership.release();closed=true;
   })();
   try{await closing;}finally{closing=null;}
  }};
 }catch(error){error.startupKind=error.code==='EADDRINUSE'?'port':stage;if(web?.listening)await close(web);if(unconfiguredHub?.listening)await close(unconfiguredHub);try{await backend?.close();}catch{error.cleanupUnconfirmed=true;}if(!error.cleanupUnconfirmed)await ownership.release();else error.startupKind='cleanup';throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let runtime;
 try{
  runtime=await startDesktopWeb({directory:process.argv[2],port:Number(process.argv[3]??61192),cleanInstall:process.argv[4]==='--clean-start-1.1.0',onForwardExit:()=>process.stdout.write('REMOTE_UNKNOWN\n')});
  process.stdout.write('READY '+runtime.url+'\n');
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;try{await runtime.close();process.exit(0);}catch{stopping=false;process.stdout.write('STOP_BLOCKED\n');}};
  process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',chunk=>{input+=chunk;let i;while((i=input.indexOf('\n'))!==-1){const command=input.slice(0,i);input=input.slice(i+1);if(command==='quit')void stop();else if(command.startsWith('remote-start ')&&!stopping)void runtime.startRemote(command.slice(13)).then(()=>process.stdout.write('REMOTE_ON\n'),()=>process.stdout.write(runtime.remotePhase==='unknown'?'REMOTE_UNKNOWN\n':'REMOTE_FAILED\n'));else if(command==='remote-stop'&&!stopping)void runtime.stopRemote().then(()=>process.stdout.write('REMOTE_OFF\n'),()=>process.stdout.write('REMOTE_UNKNOWN\n'));else if(command==='connect'&&!stopping)void runtime.connect().then(()=>process.stdout.write('CONNECT_READY\n'),()=>process.stdout.write('CONNECT_FAILED\n'));}if(input.length>1024)input='';});process.stdin.on('end',()=>void stop());process.stdin.resume();
  process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
 }catch(error){process.stderr.write(error.startupKind==='transition'?'Clean start did not complete. Close previous work and resume the recorded transition.\n':'Launcher could not start. Existing data was preserved.\n');process.exitCode=({locked:21,port:22,format:23,configuration:24,cleanup:25,backend:26,storage:27,transition:28})[error.startupKind]??1;}
}
