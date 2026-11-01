const compare=(a,b)=>(a.invokedAt??a.createdAt??0)-(b.invokedAt??b.createdAt??0)||(a.seq??0)-(b.seq??0);
export function createHistory(limit=1000){
 let messages=[],epoch=null,cursor=null,hasMore=false,limited=false;
 function merge(items){const byId=new Map(items.map(m=>[m.id,m]));const ordered=[...byId.values()].sort(compare);if(ordered.length>limit)limited=true;messages=ordered.slice(-limit);}
 function reset(page){messages=[];limited=false;epoch=page.page.epoch;cursor={at:page.page.nextBeforeAt,seq:page.page.nextBeforeSeq};hasMore=page.page.hasMore;merge(page.messages);}
 return {get messages(){return messages;},get epoch(){return epoch;},get cursor(){return cursor;},get hasMore(){return hasMore;},get limited(){return limited;},
 latest(page){
  const ids=new Set(messages.map(m=>m.id));const changed=epoch!==null&&(epoch!==page.page.epoch||messages.length>0&&!page.messages.some(m=>ids.has(m.id)));
  if(epoch===null||changed)reset(page);else merge([...messages,...page.messages]);
  return changed;
 },
 older(page){if(epoch!==page.page.epoch)return false;merge([...page.messages,...messages]);cursor={at:page.page.nextBeforeAt,seq:page.page.nextBeforeSeq};hasMore=page.page.hasMore;return true;},
 event(message){merge([...messages,message]);}
 };
}
