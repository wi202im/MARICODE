// Guidance only: never starts a process, logs in, or changes a role.
export function setupProgress(environment,providers=null,runner=null){
 const configured=environment?.configured===true;
 const steps=[{label:'작업 방식 선택',done:configured}];
 if(!configured)return {steps,next:{label:'작업 방식 선택하기',href:'#roles'},ready:false,note:'이 컴퓨터에서 어떻게 작업할지 먼저 선택하세요.'};
 if(!environment.roles.local){
  steps.push({label:'서버 연결',done:false});
  return {steps,next:{label:'작업할 서버 연결하기',href:'/connections'},ready:false,note:'원격 전용입니다. 이 컴퓨터에 AI를 설치하지 않고 서버에 로그인해 작업합니다.'};
 }
 const connected=providers?.some(p=>p.state==='connected')===true;
 const running=runner?.hub==='connected'&&runner?.workspaceAvailable===true;
 steps.push({label:'AI 연결 확인',done:connected},{label:'실행 환경 확인',done:running});
 if(!connected)return {steps,next:{label:environment.aiConfigurationRegistered?'AI 연결 상태 확인하기':'AI 실행 경로 준비하기',href:'#ai'},ready:false,note:'사용할 AI 하나의 로그인 상태를 확인하세요. 경로 등록만으로 연결 완료가 되지는 않습니다.'};
 if(!environment.runnerSetupAvailable)return {steps,next:{label:'실행 환경 안내 보기',href:'#ai'},ready:false,note:'AI 로그인은 확인했습니다. 이 실행 프로그램에는 Runner 준비 기능이 없어 작업 준비 완료를 확인할 수 없습니다.'};
 if(!running)return {steps,next:{label:'실행 환경 확인하기',href:'#runner'},ready:false,note:'아래 실행 환경에서 상태 조회 → 환경 준비 → 시작 순서로 진행하세요. 이미 실행 중이면 상태만 확인합니다.'};
 return {steps,next:{label:'작업 공간에서 첫 작업 시작하기',href:'/workspace'},ready:true,note:'AI 로그인과 Runner 연결을 확인했습니다. 작업 공간에서 프로젝트와 AI를 선택하세요. 실제 모델 응답은 작업 후 확인합니다.'};
}
