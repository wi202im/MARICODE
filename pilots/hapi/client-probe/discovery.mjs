import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {isAbsolute} from 'node:path';
const run=promisify(execFile);
export function tailscaleCandidates(data){
 if(!data||typeof data!=='object'||typeof data.BackendState!=='string')throw Error('Invalid status');
 if(data.BackendState!=='Running')return {state:'not-running',candidates:[]};
 if(data.Peer!==null&&data.Peer!==undefined&&(typeof data.Peer!=='object'||Array.isArray(data.Peer)))throw Error('Invalid peers');
 const hosts=new Set();
 for(const peer of Object.values(data.Peer??{})){
  if(peer?.Online!==true||typeof peer.DNSName!=='string')continue;
  const host=peer.DNSName.replace(/\.$/,'');
  if(host.length<=253&&/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$/.test(host))hosts.add(host);
 }
 return {state:'ready',candidates:[...hosts].sort().slice(0,50).map(host=>({name:host.split('.')[0],host}))};
}
export function createDiscovery({binary=process.platform==='darwin'?'/Applications/Tailscale.app/Contents/MacOS/Tailscale':null,execute=run}={}){
 if(binary!==null&&(typeof binary!=='string'||!isAbsolute(binary)))throw Error('Absolute Tailscale executable required');
 let pending,last,checked=0;
 return {async find(){
  if(pending)return pending;if(last&&Date.now()-checked<5000)return last;
  pending=(async()=>{try{if(!binary)return {state:'not-installed',candidates:[]};const {stdout}=await execute(binary,['status','--json'],{timeout:5000,maxBuffer:1024*1024,encoding:'utf8',windowsHide:true});return tailscaleCandidates(JSON.parse(stdout));}catch(e){return {state:e.code==='ENOENT'?'not-installed':'unavailable',candidates:[]};}})();
  try{last=await pending;checked=Date.now();return last;}finally{pending=null;}
 }};
}
