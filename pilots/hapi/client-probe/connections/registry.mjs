// Browser-owned directory. Never stores or relays authentication credentials.
export function serverAddress(value){
 if(typeof value!=='string'||value.length>300||value!==value.trim()||/[\\\s@%]/.test(value))throw Error('서버의 기본 주소만 입력하세요.');
 const u=new URL(value),host=u.hostname;
 if(u.username||u.password||u.search||u.hash||value.includes('?')||value.includes('#')||u.pathname!=='/'||!['http:','https:'].includes(u.protocol))throw Error('경로·인증정보 없는 서버 기본 주소가 필요합니다.');
 const rawHost=/^https?:\/\/([^/:]+)(?::\d+)?\/?$/i.exec(value)?.[1]?.toLowerCase();
 if(!rawHost||rawHost!==host)throw Error('정규 형식의 주소를 입력하세요.');
 const parts=host.split('.');const ipv4=parts.length===4&&parts.every(p=>/^(0|[1-9]\d{0,2})$/.test(p)&&Number(p)<=255);
 const [a,b]=parts.map(Number),loop=host==='localhost'||host==='127.0.0.1';
 const privateIP=ipv4&&(a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127));
 const privateName=/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:local|ts\.net)$/.test(host);
 if(!loop&&!privateIP&&!privateName)throw Error('LAN 사설 IP, .local 또는 Tailscale .ts.net 주소를 사용하세요.');
 if(!loop&&u.protocol!=='https:')throw Error('원격 서버는 HTTPS가 필요합니다.');
 return u.origin;
}
function entry(input){
 if(!input||Object.keys(input).sort().join(',')!=='address,name'||typeof input.name!=='string'||!input.name.trim()||input.name.length>60||/[\u0000-\u001f]/.test(input.name))throw Error('서버 이름과 주소를 확인하세요.');
 return {name:input.name.trim(),address:serverAddress(input.address)};
}
export function addServer(list,input){const next=entry(input);if(list.length>=20)throw Error('최대 20개 서버를 등록할 수 있습니다.');if(list.some(s=>s.address===next.address))throw Error('이미 등록된 서버 주소입니다.');return [...list,next];}
export function readServers(raw){if(raw===null)return [];const data=JSON.parse(raw);if(!Array.isArray(data))throw Error('저장된 서버 목록을 읽지 못했습니다.');return data.reduce((list,row)=>addServer(list,row),[]);}
