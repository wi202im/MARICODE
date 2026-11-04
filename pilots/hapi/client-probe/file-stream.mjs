import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {mediaType} from './file-kinds.mjs';

// <video>/<img>/<iframe> cannot send the bearer token, so an authorised file read mints a
// short-lived link to exactly one checked media file. The link reads that file with Range support.
export function createFileLinks({ttl=15*60*1000,max=200,now=Date.now}={}){
 const links=new Map();
 const prune=()=>{for(const [k,v] of links)if(v.expires<=now())links.delete(k);while(links.size>=max)links.delete(links.keys().next().value);};
 return {
  // file must already be the real path of a file inside the session folder.
  async issue(file){
   const type=mediaType(file);if(!type)throw Object.assign(Error('Not a media file'),{status:415});
   if(!(await stat(file)).isFile())throw Object.assign(Error('Not a file'),{status:403});
   prune();const token=randomBytes(32).toString('hex');links.set(token,{file,type,expires:now()+ttl});return '/file-raw/'+token;
  },
  async serve(req,res,token){
   const link=links.get(token);
   if(!link||link.expires<=now()){links.delete(token);res.writeHead(404).end();return;}
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
   link.expires=now()+ttl;
   let size;try{if(await realpath(link.file)!==link.file)throw Error('moved');const s=await stat(link.file);if(!s.isFile())throw Error('not file');size=s.size;}
   catch{links.delete(token);res.writeHead(404).end();return;}
   // Framed only by the app page; a PDF needs its viewer, everything else gets a script-less sandbox.
   res.setHeader('Content-Security-Policy',link.type==='application/pdf'?"default-src 'none'; frame-ancestors 'self'":"default-src 'none'; frame-ancestors 'self'; sandbox");
   res.setHeader('Content-Type',link.type);res.setHeader('Accept-Ranges','bytes');
   let start=0,end=size-1;const range=req.headers.range;
   if(range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(m&&(m[1]||m[2])){start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));end=m[1]&&m[2]?Math.min(Number(m[2]),size-1):size-1;}
    if(!m||!(m[1]||m[2])||start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
    res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});
   }else res.writeHead(200,{'Content-Length':size});
   if(req.method==='HEAD'||size===0){res.end();return;}
   const stream=createReadStream(link.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }
 };
}
