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
 if(flavor==='claude'){models=[null,...(current.model&&!claudeModels.includes(current.model)?[current.model]:[]),...claudeModels].map(option);efforts=[null,...claudeEfforts].map(option);}
 if(flavor==='codex'&&catalog?.success&&Array.isArray(catalog.models)){
  const valid=catalog.models.filter(m=>typeof m.id==='string'&&m.id.length>0);
  models=[option(null),...valid.map(m=>({value:m.id,label:m.displayName||m.id}))];
  const chosen=current.model?valid.find(m=>m.id===current.model):valid.find(m=>m.isDefault);
  if(Array.isArray(chosen?.supportedReasoningEfforts))efforts=[null,...chosen.supportedReasoningEfforts.filter(v=>typeof v==='string')].map(option);
 }
 return {flavor,current,editable,models,efforts,permissionModes:(permissionOptions[flavor]??[]).map(([value,label,description])=>({value,label,description})),source:flavor==='claude'?'HAPI 0.33.3 프리셋 · 계정/모델별 사용 가능 여부는 실행 시 확인':'실행 에이전트의 모델 목록 · 선택한 모델의 추론 수준',scope:'이 세션의 다음 요청부터 사용합니다. 자동 값은 실제 모델·추론 수준을 확정하지 않습니다.'};
}
export function settingChange(session,catalog,input){
 const v=settingsView(session,catalog);
 const access=input?.field==='permissionMode';
 if(!input||Object.keys(input).some(k=>!['field','value','expected'].includes(k))||!['model','effort','permissionMode'].includes(input.field)||!Object.hasOwn(input,'value')||!input.expected)throw Error('Invalid setting request');
 const keys=Object.keys(input.expected).sort().join(',');
 if(access?keys!=='effort,flavor,model,permissionMode':!['effort,model','effort,model,permissionMode'].includes(keys))throw Error('Invalid setting snapshot');
 if(!v.editable||input.expected.model!==v.current.model||input.expected.effort!==v.current.effort||(Object.hasOwn(input.expected,'permissionMode')&&input.expected.permissionMode!==v.current.permissionMode)||(access&&input.expected.flavor!==v.flavor))throw Error('Settings changed or session is busy');
 const options=access?v.permissionModes:input.field==='model'?v.models:v.efforts;
 if(!options.some(o=>o.value===input.value)||input.value===v.current[input.field])throw Error('Unsupported or unchanged setting');
 if(access)return {route:'permission-mode',body:{mode:input.value}};
 const field=input.field==='model'?'model':v.flavor==='codex'?'modelReasoningEffort':'effort';
 return {route:field==='modelReasoningEffort'?'model-reasoning-effort':field,body:{[field]:input.value}};
}
