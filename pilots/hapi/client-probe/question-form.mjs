export function questionForm(questions,draft,disabled,onSubmit,onError){
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
 const send=document.createElement('button');send.type='submit';send.textContent='답변 보내기';form.append(send);
 // Sendable only once every question has a choice or a typed answer.
 function sync(){send.disabled=disabled||questions.some(q=>!(draft[q.key]?.length));send.title=send.disabled&&!disabled?'모든 질문에 답한 뒤 보낼 수 있습니다.':'';}
 sync();
 form.onsubmit=e=>{e.preventDefault();try{onSubmit(structuredClone(draft));}catch(error){onError(error.message);}};return form;
}
