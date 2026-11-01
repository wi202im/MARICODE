// HAPI v0.33.3 shared/src/models.ts fallback presets, not a live account catalog.
const claudeModels=['opus','fable','sonnet','haiku'];
const claudeEfforts=['low','medium','high','xhigh','max'];
const option=value=>({value,label:value??'자동 · 엔진 기본값'});
export function settingsView(session,catalog){
 const flavor=session?.metadata?.flavor,current={model:session?.model??null,effort:(flavor==='codex'?session?.modelReasoningEffort:session?.effort)??null};
 const editable=['codex','claude'].includes(flavor)&&session?.active===true&&!session.thinking&&session.agentState?.controlledByUser===false&&!Object.keys(session.agentState?.requests??{}).length;
 let models=[],efforts=[];
 if(flavor==='claude'){models=[null,...(current.model&&!claudeModels.includes(current.model)?[current.model]:[]),...claudeModels].map(option);efforts=[null,...claudeEfforts].map(option);}
 if(flavor==='codex'&&catalog?.success&&Array.isArray(catalog.models)){
  const valid=catalog.models.filter(m=>typeof m.id==='string'&&m.id.length>0);
  models=[option(null),...valid.map(m=>({value:m.id,label:m.displayName||m.id}))];
  const chosen=current.model?valid.find(m=>m.id===current.model):valid.find(m=>m.isDefault);
  if(Array.isArray(chosen?.supportedReasoningEfforts))efforts=[null,...chosen.supportedReasoningEfforts.filter(v=>typeof v==='string')].map(option);
 }
 return {flavor,current,editable,models,efforts,source:flavor==='claude'?'HAPI 0.33.3 프리셋 · 계정/모델별 사용 가능 여부는 실행 시 확인':'실행 에이전트의 모델 목록 · 선택한 모델의 추론 수준',scope:'이 세션의 다음 요청부터 사용합니다. 자동 값은 실제 모델·추론 수준을 확정하지 않습니다.'};
}
export function settingChange(session,catalog,input){
 const v=settingsView(session,catalog);
 if(!input||Object.keys(input).some(k=>!['field','value','expected'].includes(k))||!['model','effort'].includes(input.field)||!Object.hasOwn(input,'value')||!input.expected||Object.keys(input.expected).sort().join(',')!=='effort,model')throw Error('Invalid setting request');
 if(!v.editable||input.expected.model!==v.current.model||input.expected.effort!==v.current.effort)throw Error('Settings changed or session is busy');
 const options=input.field==='model'?v.models:v.efforts;
 if(!options.some(o=>o.value===input.value)||input.value===v.current[input.field])throw Error('Unsupported or unchanged setting');
 const field=input.field==='model'?'model':v.flavor==='codex'?'modelReasoningEffort':'effort';
 return {route:field==='modelReasoningEffort'?'model-reasoning-effort':field,body:{[field]:input.value}};
}
