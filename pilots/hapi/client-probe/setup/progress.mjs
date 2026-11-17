// Guidance only: never starts a process, logs in, or changes a role.
export function setupProgress(environment,providers=null,runner=null){
 const configured=environment?.configured===true;
 const steps=[{label:'작업 방식 저장',done:configured}];
 if(!configured)return {steps,next:{label:'작업 방식 저장하기',href:'#roles'},ready:false,note:'기본은 이 Mac에서 작업입니다. 다른 기기 접속은 나중에 켜도 됩니다.'};
 const connected=providers?.some(p=>p.state==='connected')===true;
 const running=runner?.hub==='connected'&&runner?.workspaceAvailable===true;
 steps.push({label:'AI 연결 확인',done:connected},{label:'실행 환경 확인',done:running});
 if(!connected)return {steps,next:{label:environment.aiConfigurationRegistered?'AI 연결 상태 확인하기':'AI 실행 경로 준비하기',href:'#ai'},ready:false,note:'사용할 AI 하나에 로그인되어 있는지 확인하세요.'};
 if(!environment.runnerSetupAvailable)return {steps,next:{label:'실행 환경 안내 보기',href:'#ai'},ready:false,note:'AI 로그인은 확인했습니다. 이 실행 프로그램에서는 실행 환경 준비를 확인할 수 없습니다.'};
 if(!running)return {steps,next:{label:'실행 환경 확인하기',href:'#runner'},ready:false,note:'아래 ‘고급 · 실행 환경’에서 상태 확인 → 실행 환경 준비 → 시작 순서로 진행하세요.'};
 return {steps,next:{label:'작업 공간에서 첫 작업 시작하기',href:'/workspace'},ready:true,note:'준비가 끝났습니다. 작업 공간에서 프로젝트와 AI를 골라 대화를 시작하세요.'};
}
