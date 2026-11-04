import {join} from 'node:path';
// HAPI CLI compatibility boundary. Callers validate paths/URLs and own process lifetime.
// Keep upgrades explicit: never let upstream replace a process behind the owner.
export function hubInvocation({directory,port,token}){
 const url=`http://127.0.0.1:${port}`;
 return {args:['hub'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:directory,LANG:'en_US.UTF-8',HAPI_HOME:directory,DB_PATH:join(directory,'data.db'),CLI_API_TOKEN:token,HAPI_LISTEN_HOST:'127.0.0.1',HAPI_LISTEN_PORT:String(port),HAPI_API_URL:url,HAPI_PUBLIC_URL:url,CORS_ORIGINS:url,HAPI_DISABLE_PEER_TOOLS:'1',HAPI_DISABLE_VERSION_HANDOFF:'1'}};
}
// The Runner's own identity (HAPI_HOME settings = machine id) and Hub; HAPI_API_URL also stops the CLI auto-starting a Hub.
function agentEnvironment({environment,home,hubUrl,token}){
 const env={...environment,HAPI_HOME:home,HAPI_API_URL:hubUrl,CLI_API_TOKEN:token,DB_PATH:join(home,'unused.db'),HAPI_DISABLE_VERSION_HANDOFF:'1'};
 delete env.HAPI_RUNNER_HANDOFF_FROM_PID;return env;
}
// `hapi resume <id>`: the same HAPI session in the official terminal UI. Claude takes control from the app until the
// app sends again; Codex (shared app-server) attaches alongside. Same machine only (HAPI checks the machine id).
export function resumeInvocation({environment,home,hubUrl,token,sessionId}){
 return {args:['resume',sessionId],env:agentEnvironment({environment,home,hubUrl,token})};
}
export function runnerInvocation({environment,home,hubUrl,token,cwd,workspaceRoots=[cwd]}){
 const env=agentEnvironment({environment,home,hubUrl,token});
 return {args:['runner','start-sync',...workspaceRoots.flatMap(root=>['--workspace-root',root])],env};
}
