// File type decisions shared by the viewer and the media streaming route. Browser-safe.
const media={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',ico:'image/x-icon',avif:'image/avif',
 mp4:'video/mp4',m4v:'video/x-m4v',mov:'video/quicktime',webm:'video/webm',
 mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav',ogg:'audio/ogg',oga:'audio/ogg',opus:'audio/ogg',flac:'audio/flac',
 pdf:'application/pdf'};
const ext=name=>{const base=String(name).split('/').pop().toLowerCase(),i=base.lastIndexOf('.');return i>0?base.slice(i+1):'';};
// Only these types are ever streamed raw; SVG/HTML stay text so their scripts never run.
export const mediaType=name=>media[ext(name)]??null;
export function fileKind(name){
 const type=mediaType(name);if(type)return type==='application/pdf'?'pdf':type.split('/')[0];
 if(['md','markdown','mdown','mkd'].includes(ext(name)))return 'markdown';
 return 'text';
}
const aliases={js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',mts:'typescript',cts:'typescript',py:'python',rb:'ruby',rs:'rust',kt:'kotlin',kts:'kotlin',
 sh:'bash',zsh:'bash',bash:'bash',yml:'yaml',htm:'xml',html:'xml',svg:'xml',plist:'xml',vue:'xml',h:'c',hpp:'cpp',cc:'cpp',cxx:'cpp',m:'objectivec',mm:'objectivec',cs:'csharp',ex:'elixir',exs:'elixir',
 erl:'erlang',hs:'haskell',ml:'ocaml',fs:'fsharp',ps1:'powershell',tf:'ini',toml:'ini',conf:'ini',env:'bash',gradle:'gradle',proto:'protobuf',sc:'scala',clj:'clojure',pl:'perl',jl:'julia',tex:'latex',md:'markdown',txt:'plaintext',log:'plaintext'};
const names={dockerfile:'dockerfile',makefile:'makefile',gemfile:'ruby',rakefile:'ruby',podfile:'ruby','.gitignore':'bash','.env':'bash','.zshrc':'bash','.bashrc':'bash'};
// highlight.js language name to try; the viewer falls back to plain text when it has no such grammar.
export function highlightLanguage(name){
 const base=String(name).split('/').pop().toLowerCase();
 return names[base]??(ext(name)?aliases[ext(name)]??ext(name):'plaintext');
}
// Text bigger than this is read but not coloured; bigger than the read limit is not read at all.
export const highlightLimit=512*1024,textReadLimit=8*1024*1024;
