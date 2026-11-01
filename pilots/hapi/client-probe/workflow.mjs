const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export function requestSnapshot(request){return JSON.stringify(canonical({tool:request?.tool,arguments:request?.arguments}));}
// Never accept an upstream policy supplied by the browser. Both ends derive the
// supported choices from the same exact request and provider identity.
export function permissionChoices(engine,request){
 const tool=request?.tool,args=request?.arguments??{};
 const choices=[{scope:'once',action:'approve',label:engine==='codex'&&tool==='CodexPermission'?'이번 응답 동안 허용':'이번만 허용'}];
 const command=args.command;
 if(engine==='claude'&&tool==='Bash'&&typeof command==='string'&&command.trim()&&command.length<=2000&&!/[\r\n()]/.test(command)&&!command.endsWith(':*'))choices.push({scope:'session',action:'approve',label:'같은 명령을 이 세션에서 허용',detail:command});
 if(engine==='claude'&&['Read','Glob','Grep'].includes(tool))choices.push({scope:'session',action:'approve',label:`${tool} 도구를 이 세션에서 허용`,detail:'이 파일에 한정되지 않고, 이 세션의 해당 도구 전체에 적용됩니다.'});
 if(engine==='codex'&&tool==='CodexPermission'&&args.permissions&&typeof args.permissions==='object')choices.push({scope:'session',action:'approve',label:'표시된 권한을 이 세션에서 허용',detail:JSON.stringify(args.permissions)});
 choices.push({scope:'once',action:'deny',label:'거절'});return choices;
}
export function permissionDecision(engine,request,action,scope='once'){
 if(!permissionChoices(engine,request).some(c=>c.action===action&&c.scope===scope))throw Error('이 요청에서 지원하지 않는 승인 범위입니다.');
 if(action==='deny')return {decision:'denied'};
 if(scope==='once')return {decision:'approved'};
 return engine==='claude'?{decision:'approved',allowTools:[request.tool==='Bash'?`Bash(${request.arguments.command})`:request.tool]}:{decision:'approved_for_session'};
}
export function toolViews(messages){
 const cards=new Map();
 const call=(id,name,input)=>{if(id)cards.set(id,{...cards.get(id),id,name,input,state:cards.get(id)?.state??'waiting'});};
 const result=(id,output,error)=>{if(id)cards.set(id,{...cards.get(id),id,output,state:error?'error':'result'});};
 for(const m of messages){
  if(m.content?.role!=='agent')continue;const d=m.content?.content?.data;
  if(d?.type==='tool-call')call(d.callId,d.name,d.input);
  if(d?.type==='tool-call-result')result(d.callId,d.output,d.is_error===true||d.output?.is_error===true||d.output?.status==='failed'||(typeof d.output?.exit_code==='number'&&d.output.exit_code!==0));
  if(m.content?.content?.type==='output'&&Array.isArray(d?.message?.content))for(const b of d.message.content){
   if(b.type==='tool_use')call(b.id,b.name,b.input);
   if(b.type==='tool_result')result(b.tool_use_id,b.content,b.is_error===true);
  }
 }
 return [...cards.values()];
}
export function createPermissionActions({post,save,pending=null}){
 let locked=false;
 return {get pending(){return pending;},reconcile(requests){if(pending&&!Object.hasOwn(requests,pending)){pending=null;save(null);}},async decide(id,request,action,scope='once',engine,answers){
  if(locked||pending)throw Error('이전 승인 요청의 결과를 확인 중입니다.');
  if(!['approve','deny'].includes(action)||!id)throw Error('Invalid decision');
  locked=true;pending=id;save(pending);
  try{return await post(id,action,{expected:{tool:request.tool,arguments:request.arguments},...(scope==='once'?{}:{scope}),...(engine?{engine}:{}),...(answers?{answers}:{})});}catch(error){if(error.rejected===true){pending=null;save(null);}throw error;}finally{locked=false;}
 }};
}
