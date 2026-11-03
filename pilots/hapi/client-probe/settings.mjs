// HAPI v0.33.3 shared/src/models.ts fallback presets, not a live account catalog.
const claudeModels=['opus','fable','sonnet','haiku'];
const claudeEfforts=['low','medium','high','xhigh','max'];
const permissionOptions={
 claude:[['default','기본 승인','도구 실행 시 Claude의 기본 승인 정책을 따릅니다.'],['acceptEdits','편집 자동 허용','파일 편집은 자동 허용하고 다른 도구는 Claude 정책을 따릅니다.'],['auto','자동 판단','Claude가 도구 요청의 승인 여부를 자동 판단합니다. CLI·계정 지원 여부는 실행 시 확인합니다.'],['bypassPermissions','Bypass · 승인 생략','이 세션의 도구 승인 확인을 생략합니다. 파일 변경과 명령 실행도 개별 확인 없이 진행할 수 있습니다.'],['plan','계획 모드','Claude의 계획 모드로 전환합니다.']],
 codex:[['default','기본 승인','Codex의 기본 승인·샌드박스 정책을 따릅니다.'],['read-only','읽기 전용','Codex의 읽기 전용 샌드박스를 사용합니다.'],['autoReview','자동 검토','Codex가 요청을 자동 검토합니다. 실행기 지원 여부는 실행 시 확인합니다.'],['yolo','전체 접근 · 승인 생략','이 세션의 도구 승인과 Codex 샌드박스 제한을 해제합니다. 파일 변경과 명령 실행도 개별 확인 없이 진행할 수 있습니다.']]
};
const option=value=>({value,label:value??'자동 · 엔진 기본값'});
export function permissionLabel(flavor,value){return permissionOptions[flavor]?.find(([v])=>v===value)?.[1]??value;}
export function settingsView(session,catalog){
 const flavor=session?.metadata?.flavor,current={model:session?.model??null,effort:(flavor==='codex'?session?.modelReasoningEffort:session?.effort)??null,permissionMode:session?.permissionMode??null};
 const editable=['codex','claude'].includes(flavor)&&session?.active===true&&!session.thinking&&session.agentState?.controlledByUser===false&&!Object.keys(session.agentState?.requests??{}).length;
 let models=[],efforts=[];
 const listed=flavor==='claude'&&catalog?.success&&Array.isArray(catalog.availableModels)?catalog.availableModels.filter(m=>typeof m?.value==='string'&&m.value&&m.value!=='default'):null;
 // 'default' duplicates the null (engine default) choice, so it is not offered twice.
 if(listed?.length){
  models=[option(null),...(current.model&&!listed.some(m=>m.value===current.model)?[option(current.model)]:[]),...listed.map(m=>({value:m.value,label:m.displayName||m.value}))];
  const chosen=listed.find(m=>m.value===current.model);
  efforts=current.model&&!chosen?[]:Array.isArray(chosen?.effortLevels)?(chosen.effortLevels.length?[null,...chosen.effortLevels.filter(v=>typeof v==='string')].map(option):[]):[null,...claudeEfforts].map(option);
 }else if(flavor==='claude'){models=[null,...(current.model&&!claudeModels.includes(current.model)?[current.model]:[]),...claudeModels].map(option);efforts=[null,...claudeEfforts].map(option);}
 const extras=[];
 if(flavor==='codex'&&catalog?.success&&Array.isArray(catalog.models)){
  const valid=catalog.models.filter(m=>typeof m.id==='string'&&m.id.length>0);
  models=[option(null),...valid.map(m=>({value:m.id,label:m.displayName||m.id}))];
  const chosen=current.model?valid.find(m=>m.id===current.model):valid.find(m=>m.isDefault);
  if(Array.isArray(chosen?.supportedReasoningEfforts))efforts=[null,...chosen.supportedReasoningEfforts.filter(v=>typeof v==='string')].map(option);
  // Fast may use more of the plan's allowance; it is only offered when the model advertises it and never turned on implicitly.
  if(chosen?.serviceTiers?.includes('fast'))extras.push({field:'serviceTier',label:'속도',current:session.serviceTier==='fast'?'fast':'standard',options:[{value:'standard',label:'표준'},{value:'fast',label:'Fast · 사용량 더 소모'}]});
 }
 if(flavor==='codex')extras.push({field:'collaborationMode',label:'협업 방식',current:session?.collaborationMode==='plan'?'plan':'default',options:[{value:'default',label:'기본'},{value:'plan',label:'계획 먼저'}]});
 return {flavor,current,editable,models,efforts,extras,permissionModes:(permissionOptions[flavor]??[]).map(([value,label,description])=>({value,label,description})),source:flavor==='claude'?(listed?.length?'실행 컴퓨터의 Claude가 알려준 모델 목록 · 선택한 모델의 추론 수준':'HAPI 0.33.3 프리셋 · 계정/모델별 사용 가능 여부는 실행 시 확인'):'실행 에이전트의 모델 목록 · 선택한 모델의 추론 수준',scope:'이 세션의 다음 요청부터 사용합니다. 자동 값은 실제 모델·추론 수준을 확정하지 않습니다.'};
}
export function settingChange(session,catalog,input){
 const v=settingsView(session,catalog);
 const extra=v.extras.find(e=>e.field===input?.field),access=input?.field==='permissionMode'||!!extra;
 if(!input||Object.keys(input).some(k=>!['field','value','expected'].includes(k))||!['model','effort','permissionMode','serviceTier','collaborationMode'].includes(input.field)||!Object.hasOwn(input,'value')||!input.expected)throw Error('Invalid setting request');
 const keys=Object.keys(input.expected).sort().join(',');
 if(access?keys!=='effort,flavor,model,permissionMode':!['effort,model','effort,model,permissionMode'].includes(keys))throw Error('Invalid setting snapshot');
 if(!v.editable||input.expected.model!==v.current.model||input.expected.effort!==v.current.effort||(Object.hasOwn(input.expected,'permissionMode')&&input.expected.permissionMode!==v.current.permissionMode)||(access&&input.expected.flavor!==v.flavor))throw Error('Settings changed or session is busy');
 if(['serviceTier','collaborationMode'].includes(input.field)){
  if(!extra||!extra.options.some(o=>o.value===input.value)||input.value===extra.current)throw Error('Unsupported or unchanged setting');
  return input.field==='serviceTier'?{route:'service-tier',body:{serviceTier:input.value}}:{route:'collaboration-mode',body:{mode:input.value}};
 }
 const options=input.field==='permissionMode'?v.permissionModes:input.field==='model'?v.models:v.efforts;
 if(!options.some(o=>o.value===input.value)||input.value===v.current[input.field])throw Error('Unsupported or unchanged setting');
 if(input.field==='permissionMode')return {route:'permission-mode',body:{mode:input.value}};
 const field=input.field==='model'?'model':v.flavor==='codex'?'modelReasoningEffort':'effort';
 return {route:field==='modelReasoningEffort'?'model-reasoning-effort':field,body:{[field]:input.value}};
}

// The choices are not applied settings. Keep their menu readable when an engine has stopped.
export function settingsControls(session,{loaded=false,connected=false,busy=false,loading=false,pending=false,actionPending=false,permissionPending=false,editable=true}={}){
 const supported=['claude','codex'].includes(session?.metadata?.flavor);
 const locked=busy||loading||pending||actionPending||permissionPending||session?.resumeUnconfirmed;
 const browse=!!session&&supported&&loaded&&!locked;
 let reason='';
 if(!session)reason='설정을 볼 세션을 선택하세요.';
 else if(!supported)reason='이 AI의 설정 변경은 아직 지원하지 않습니다.';
 else if(pending||actionPending||permissionPending||session.resumeUnconfirmed)reason='앞선 요청 결과를 확인한 뒤 설정을 변경할 수 있습니다. 자동 재전송하지 않습니다.';
 else if(loading)reason='설정 목록을 확인하고 있습니다.';
 else if(busy)reason='현재 요청을 마친 뒤 설정을 적용할 수 있습니다.';
 else if(!connected)reason='연결 상태를 확인하세요. 표시된 목록은 마지막 조회 결과입니다.';
 else if(!loaded)reason='설정 새로 확인을 눌러 지원 목록을 불러오세요.';
 else if(!session.active)reason='세션 실행이 종료됐습니다. 목록은 미리 볼 수 있으며, 세션 재개 후 적용할 수 있습니다.';
 else if(session.thinking)reason='답변 작성 중입니다. 입력 대기 상태가 되면 적용할 수 있습니다.';
 else if(Object.keys(session.agentState?.requests??{}).length)reason='승인 요청을 먼저 처리하세요. 액세스 모드를 바꿔 대기 중 승인을 건너뛰지 않습니다.';
 else if(session.agentState?.controlledByUser!==false)reason='공식 CLI에서 제어 중이거나 제어 상태가 미확인입니다. 앱에서 제어 가능한 상태에서 적용하세요.';
 else if(!editable)reason='서버 설정을 다시 확인한 뒤 적용하세요.';
 return {browse,apply:!reason,resume:!!session&&supported&&!session.active&&connected&&!locked,reason};
}
export function settingsDraft(draft,view){
 return Object.fromEntries(Object.entries(draft).filter(([field,value])=>({model:view.models,effort:view.efforts,permissionMode:view.permissionModes})[field]?.some(o=>o.value===(value===''?null:value))));
}
// A requested alias is not a model version. Keep selected value and observed execution separate.
export function modelReadout(session,view,messages=[]){
 const selected=session?.model??null,flavor=session?.metadata?.flavor;
 const alias=flavor==='claude'&&/^(opus|fable|sonnet|haiku)(?:\[1m\])?$/.test(selected??'');
 const choice=view?.models?.find(o=>o.value===selected)?.label??selected??'자동 · 엔진 기본값';
 let report=null;
 if(flavor==='claude')for(let i=messages.length-1;i>=0;i--){
  const c=messages[i]?.content?.content,d=c?.data;
  if(messages[i]?.content?.role!=='agent'||c?.type!=='output'||d?.parent_tool_use_id||d?.parentToolUseId||d?.isSidechain)continue;
  const response=d?.type==='assistant',init=d?.type==='system'&&d.subtype==='init';
  const id=response?d.message?.model:init?d.model:null;
  if(typeof id==='string'&&/^claude-[a-zA-Z0-9][\w.-]*(?:\[1m\])?$/.test(id)&&id.length<=150){report={id,source:response?'최근 응답':'실행 보고'};break;}
 }
 const sameFamily=report&&(!selected||alias&&report.id.startsWith('claude-'+selected.replace(/\[1m\]$/,'' )+'-')||report.id===selected);
 const chip=sameFamily?`${report.id} · ${report.source}`:alias&&choice===selected?`${selected} · 버전 미확인`:choice;
 const detail=`선택: ${choice}${selected&&choice!==selected?' ('+selected+')':''}${alias?' · 별칭':''}\n${report?report.source+': '+report.id:'실제 실행 모델 ID: 아직 확인되지 않음'}\n실행 기록은 해당 시점의 보고값입니다. 다음 응답의 모델을 보장하지 않습니다.`;
 return {chip,detail,selected,report};
}
