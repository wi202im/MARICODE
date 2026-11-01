import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {isAbsolute} from 'node:path';
const run=promisify(execFile);
export function bonjourCandidates(text){
 if(typeof text!=='string'||text.length>1024*1024)throw Error('Invalid discovery output');
 const found=new Map();
 for(const line of text.split('\n')){
  const m=line.match(/^\S+\._merry\._tcp(?:\.local\.)?\s+(?:(?:\d+\s+)?IN\s+)?SRV\s+\d+\s+\d+\s+(\d{1,5})\s+([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local)\.(?:\s|$)/i);
  if(!m)continue;const port=Number(m[1]),host=m[2].toLowerCase();if(port<1||port>65535)continue;
  found.set(host+':'+port,{name:host.slice(0,-6),host,port});if(found.size>=50)break;
 }
 return [...found.values()];
}
export function createLanDiscovery({binary=process.platform==='darwin'?'/usr/bin/dns-sd':null,execute=run}={}){
 if(binary!==null&&(typeof binary!=='string'||!isAbsolute(binary)))throw Error('Absolute Bonjour executable required');
 let pending,last,checked=0;
 return {async find(){
  if(pending)return pending;if(last&&Date.now()-checked<5000)return last;
  pending=(async()=>{
   if(!binary)return {state:'not-installed',candidates:[]};
   try{
    let stdout;try{({stdout}=await execute(binary,['-Z','_merry._tcp','local.'],{timeout:3000,maxBuffer:1024*1024,encoding:'utf8',windowsHide:true}));}
    catch(e){if(e.killed&&e.signal==='SIGTERM'&&typeof e.stdout==='string')stdout=e.stdout;else throw e;}
    return {state:'ready',candidates:bonjourCandidates(stdout)};
   }catch(e){return {state:e.code==='ENOENT'?'not-installed':'unavailable',candidates:[]};}
  })();
  try{last=await pending;checked=Date.now();return last;}finally{pending=null;}
 }};
}
