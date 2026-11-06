export function questionForm(questions,draft,disabled,onSubmit,onError,onDeny){
 const form=document.createElement('form');form.className='question-form';
 for(const q of questions){
  const field=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=q.question;field.append(legend);field.disabled=disabled;
  const selected=draft[q.key]??[];const note=document.createElement('input');note.type='text';note.maxLength=2000;note.placeholder='직접 답변 입력';note.setAttribute('aria-label',q.question+' 직접 답변');
  note.value=selected.find(s=>!q.options.some(o=>o.label===s))??'';const inputs=[];
  for(const option of q.options){const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');input.type=q.multiple?'checkbox':'radio';input.name=q.key;input.value=option.label;input.checked=selected.includes(option.label);text.textContent=option.label;label.append(input,text);
   if(option.description){const desc=document.createElement('small');desc.textContent=option.description;label.append(desc);}
   input.onchange=()=>{note.value='';draft[q.key]=inputs.filter(i=>i.checked).map(i=>i.value);sync();};inputs.push(input);field.append(label);
  }
  note.oninput=()=>{for(const input of inputs)input.checked=false;draft[q.key]=note.value.trim()?[note.value.trim()]:[];sync();};field.append(note);form.append(field);
 }
 // HAPI takes either answers to every question or one refusal of the whole request, so refusing is a choice before the single submit.
 const deny=document.createElement('label'),denyBox=document.createElement('input'),denyText=document.createElement('span');deny.className='question-deny';denyBox.type='checkbox';denyBox.disabled=disabled;denyText.textContent='답하지 않고 거절';deny.append(denyBox,denyText);
 const denyHint=document.createElement('small');denyHint.textContent='AI는 답 없이 다음으로 넘어갑니다.';deny.append(denyHint);denyBox.onchange=sync;form.append(deny);
 const send=document.createElement('button');send.type='submit';send.className='question-submit';send.textContent='제출';form.append(send);
 // Sendable once every question has a choice or a typed answer, or the refusal is chosen.
 function sync(){for(const f of form.querySelectorAll('fieldset'))f.disabled=disabled||denyBox.checked;send.disabled=disabled||!denyBox.checked&&questions.some(q=>!(draft[q.key]?.length));send.title=send.disabled&&!disabled?'모든 질문에 답하거나 거절을 고른 뒤 제출할 수 있습니다.':'';}
 sync();
 form.onsubmit=e=>{e.preventDefault();try{if(denyBox.checked)onDeny();else onSubmit(structuredClone(draft));}catch(error){onError(error.message);}};return form;
}
