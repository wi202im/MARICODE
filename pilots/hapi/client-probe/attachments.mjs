export const maxFileBytes=5*1024*1024;
export function selectedFiles(data){const items=Array.from(data?.items??[]).filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);return items.length?items:Array.from(data?.files??[]);}
export function validateFiles(files,existing=[]){
 if(files.length+existing.length>5)throw Error('첨부는 메시지당 5개까지 가능합니다.');
 if([...files,...existing].some(f=>!f.size||f.size>maxFileBytes))throw Error('빈 파일은 첨부할 수 없으며 파일당 최대 5MB입니다.');
 if([...files,...existing].reduce((sum,f)=>sum+f.size,0)>10*1024*1024)throw Error('첨부 전체 크기는 최대 10MB입니다.');
}
export function uploadPayload(value){
 if(!value||Object.keys(value).some(k=>!['requestId','filename','mimeType','content'].includes(k))||!/^[a-f0-9-]{36}$/.test(value.requestId??'')||typeof value.filename!=='string'||!value.filename||value.filename.length>255||/[\x00-\x1f/\\]/.test(value.filename)||typeof value.mimeType!=='string'||!value.mimeType||value.mimeType.length>255||typeof value.content!=='string'||!value.content||value.content.length>Math.ceil(maxFileBytes/3)*4||value.content.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.content)||value.content.length*3/4-(value.content.endsWith('==')?2:value.content.endsWith('=')?1:0)>maxFileBytes)throw Error('Invalid attachment');
 const {filename,mimeType,content}=value;return {filename,mimeType,content};
}
export function attachmentMetadata(file,result){
 if(result?.success!==true||typeof result.path!=='string'||!result.path)throw Error('첨부 업로드 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다.');
 return {id:file.id,filename:file.name,mimeType:file.type||'application/octet-stream',size:file.size,path:result.path};
}
export async function fileBase64(file){const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(raw);}
