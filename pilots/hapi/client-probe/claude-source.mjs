import {readFile,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {claudeSourcePath} from './claude-import.mjs';

// Read literal profile declarations only. Never source shell files or execute
// aliases/functions: they may run unrelated commands or select other accounts.
export const discoverClaudeSource=options=>discoverCliSource('claude',options);
export async function discoverCliSource(agent,{source='',home=homedir(),environment=process.env}={}){
 if(!['claude','codex'].includes(agent))throw Error('지원하지 않는 AI입니다.');
 const key=agent==='claude'?'CLAUDE_CONFIG_DIR':'CODEX_HOME',mentions=new RegExp('\\b'+key+'\\b');
 const selected=(value,origin)=>({source:claudeSourcePath(value,home),origin});
 if(typeof source!=='string')throw Error('기록 저장 위치를 확인하세요.');
 if(source.trim())return selected(source,'selected');
 if(environment[key]?.trim())return selected(environment[key],'environment');
 const candidates=new Set();let uncertain=false;
 const zhome=environment.ZDOTDIR?claudeSourcePath(environment.ZDOTDIR,home):home;
 const files=[...['.zshenv','.zprofile','.zshrc','.zlogin'].map(name=>join(zhome,name)),...['.bash_profile','.bash_login','.bashrc','.profile'].map(name=>join(home,name))];
 for(const file of files){
  let text;try{if((await stat(file)).size>256*1024){uncertain=true;continue;}text=await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')uncertain=true;continue;}
  const lines=text.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
  if(!lines.some(line=>mentions.test(line)))continue;
  // Conditional/function scopes cannot be interpreted without executing shell.
  if(lines.some(line=>/^(if\b|elif\b|else\b|case\b|for\b|while\b|until\b|function\b|[\w-]+\s*\(\s*\)|[{}])/.test(line))){uncertain=true;continue;}
  for(const line of lines.filter(line=>mentions.test(line))){
   const match=new RegExp(String.raw`^(?:export\s+)?${key}=(?:"([^"\n]*)"|'([^'\n]*)'|([^\s'";]+))\s*(?:#.*)?$`).exec(line);
   if(!match){uncertain=true;continue;}
   let value=match[1]??match[2]??match[3];
   if(match[2]===undefined)value=value.replace(/^\$(?:HOME|\{HOME\})(?=\/)/,home);
   if(/[\$`\\;|&<>\n]/.test(value)||!value){uncertain=true;continue;}
   try{candidates.add(claudeSourcePath(value,home));}catch{uncertain=true;}
  }
 }
 if(uncertain||candidates.size>1)return {source:null,origin:'unresolved'};
 if(candidates.size===1)return {source:[...candidates][0],origin:'shell-file'};
 return selected(join(home,agent==='claude'?'.claude':'.codex'),'default');
}
