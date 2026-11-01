export function requestQuestions(engine,request){
 if(!((engine==='claude'&&request.tool==='AskUserQuestion')||(engine==='codex'&&request.tool==='request_user_input')))return null;
 const qs=request.arguments?.questions;
 if(request.arguments?.url||!Array.isArray(qs)||!qs.length||qs.length>4)return null;
 const rows=qs.map((q,i)=>{
  if(!q||q.isSecret||q.is_secret||q.secret||q.inputType==='password'||typeof q.question!=='string'||q.question.length>2000)return null;
  const key=engine==='claude'?String(i):q.id;if(typeof key!=='string'||!key||key.length>200||['__proto__','constructor','prototype'].includes(key))return null;
  if(q.options!==undefined&&(!Array.isArray(q.options)||q.options.length>12||q.options.some(o=>typeof o?.label!=='string'||!o.label||o.label.length>300)))return null;
  return {key,question:q.question,multiple:q.multiSelect===true||q.multiple===true,options:q.options??[]};
 });
 return rows.some(q=>!q)||new Set(rows.map(q=>q.key)).size!==rows.length?null:rows;
}
export function questionDecision(engine,request,answers){
 const qs=requestQuestions(engine,request);if(!qs||!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).length!==qs.length)throw Error('질문과 답변을 다시 확인해 주세요.');
 const result={};
 for(const q of qs){const a=answers[q.key];if(!Array.isArray(a)||!a.length||a.length>13||a.some(s=>typeof s!=='string'||!s.trim()||s.length>2000)||new Set(a).size!==a.length||(!q.multiple&&a.length>1))throw Error('각 질문에 답변을 선택하거나 입력해 주세요.');
  result[q.key]=engine==='codex'?{answers:a.map(s=>q.options.some(o=>o.label===s)?s:'user_note: '+s)}:a;
 }
 return {decision:'approved',answers:result};
}
