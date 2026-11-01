import {randomUUID} from 'node:crypto';

// Synthetic credentials only. This is not a production secret vault or browser driver.
export function createBroker({execute,now=Date.now,ttl=120_000}) {
  const requests=new Map();
  function get(id,engine,session){
    const r=requests.get(id);
    if(!r||r.engine!==engine||r.session!==session)throw Error('Unknown request');
    if(r.state==='pending'&&now()>=r.expiresAt)r.state='expired';
    return r;
  }
  function view(r){return {id:r.id,engine:r.engine,session:r.session,machine:'Mac mini 시험',target:'내장 시험 사이트',state:r.state,expiresAt:r.expiresAt};}
  return {
    start(engine,session){
      if(!['claude','codex'].includes(engine)||typeof session!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(session))throw Error('Invalid binding');
      for(const r of requests.values())if(r.engine===engine&&r.session===session&&['pending','submitting','unknown'].includes(get(r.id,engine,session).state))return view(r);
      if(requests.size>=200)throw Error('Trial capacity reached');
      const r={id:randomUUID(),engine,session,state:'pending',expiresAt:now()+ttl};requests.set(r.id,r);return view(r);
    },
    status(id,engine,session){return view(get(id,engine,session));},
    cancel(id,engine,session){const r=get(id,engine,session);if(r.state!=='pending')throw Error('Request not pending');r.state='cancelled';return view(r);},
    submit(id,engine,session,values){
      const r=get(id,engine,session);if(r.state!=='pending')throw Error('Request not pending');
      if(!values||Object.keys(values).sort().join(',')!=='otp,password'||values.password!=='demo-only'||values.otp!=='123456')throw Error('Only published trial values accepted');
      r.state='submitting';
      return (async()=>{
        try{r.state=(await execute({requestId:r.id,engine,session},{password:values.password,otp:values.otp}))===true?'completed':'failed';}
        catch{r.state='unknown';} // Never propagate executor errors or retry ambiguous outcomes.
        return view(r);
      })();
    }
  };
}
