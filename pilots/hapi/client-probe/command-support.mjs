// Maricode transport support, not the vendor CLI's complete command catalog.
// Expand only after an executable route and visible result exist. HAPI 0.33.3:
// cli/src/claude/claudeRemote.ts, cli/src/codex/utils/slashCommands.ts,
// cli/src/codex/{codexRemoteLauncher.ts,shared/root.ts}.
const supported={
 claude:new Set(['compact']),
 codex:new Set(['compact','status','plan','default','execute','model','reasoning','effort','personality','permissions','permission'])
};
const reserved=new Set([...Object.values(supported).flatMap(s=>[...s]),'clear','new','goal','agent','help','mcp','account','config','plugin','plugins','doctor','login','logout','fast','usage','stats','context','cost','resume','fork','quit','exit','review','diff','init','permissions','theme','hooks','memory','skills']);
const validName=name=>typeof name==='string'&&/^[a-zA-Z][\w.:-]{0,127}$/.test(name);
export function supportedChatCommands(agent,reported){
 if(!supported[agent]||!Array.isArray(reported))return [];
 const seen=new Set();return reported.flatMap(command=>{
  if(!validName(command?.name))return [];
  const name=command.name.toLowerCase();if(seen.has(name))return [];
  const builtin=command.source==='builtin'&&supported[agent].has(name);
  const custom=!reserved.has(name)&&['project','user','plugin'].includes(command.source)&&typeof command.content==='string'&&!!command.content.trim();
  if(!builtin&&!custom)return [];seen.add(name);
  return [{...command,description:custom?'사용자 정의 명령 · '+(command.description??command.name):command.description}];
 });
}
export function chatCommandName(text){const m=/^\s*\/([a-zA-Z][\w.:-]{0,127})(?=\s|$)/.exec(String(text??''));return m?m[1].toLowerCase():null;}
export function chatCommandSupported(agent,text,reported){const name=chatCommandName(text);return name!==null&&supportedChatCommands(agent,reported).some(c=>c.name.toLowerCase()===name);}
