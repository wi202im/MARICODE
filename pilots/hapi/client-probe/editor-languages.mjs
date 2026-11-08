// File name → CodeMirror language module (vendor/codemirror). Lezer grammars where CodeMirror has one,
// legacy stream modes for common config/script files; anything else edits as plain text.
const lezer=(module,fn,options)=>({kind:'lezer',module,fn,options});
const legacy=(module,name)=>({kind:'legacy',module:'legacy-'+module,name});
const byExtension={
 js:lezer('lang-javascript','javascript',{}),mjs:lezer('lang-javascript','javascript',{}),cjs:lezer('lang-javascript','javascript',{}),
 jsx:lezer('lang-javascript','javascript',{jsx:true}),ts:lezer('lang-javascript','javascript',{typescript:true}),mts:lezer('lang-javascript','javascript',{typescript:true}),
 cts:lezer('lang-javascript','javascript',{typescript:true}),tsx:lezer('lang-javascript','javascript',{jsx:true,typescript:true}),
 json:lezer('lang-json','json'),jsonc:lezer('lang-json','json'),webmanifest:lezer('lang-json','json'),
 css:lezer('lang-css','css'),scss:lezer('lang-css','css'),less:lezer('lang-css','css'),
 html:lezer('lang-html','html'),htm:lezer('lang-html','html'),
 md:lezer('lang-markdown','markdown'),markdown:lezer('lang-markdown','markdown'),
 py:lezer('lang-python','python'),yml:lezer('lang-yaml','yaml'),yaml:lezer('lang-yaml','yaml'),
 sh:legacy('shell','shell'),bash:legacy('shell','shell'),zsh:legacy('shell','shell'),command:legacy('shell','shell'),
 env:legacy('properties','properties'),properties:legacy('properties','properties'),ini:legacy('properties','properties'),cfg:legacy('properties','properties'),conf:legacy('properties','properties'),
 toml:legacy('toml','toml'),go:legacy('go','go'),rs:legacy('rust','rust'),swift:legacy('swift','swift'),sql:legacy('sql','standardSQL')
};
const byName={dockerfile:legacy('dockerfile','dockerFile'),'.bashrc':legacy('shell','shell'),'.zshrc':legacy('shell','shell'),'.profile':legacy('shell','shell'),'.zprofile':legacy('shell','shell'),'.gitignore':legacy('properties','properties'),'.npmrc':legacy('properties','properties'),'.editorconfig':legacy('properties','properties')};
export function editorLanguage(path){
 const name=String(path??'').split('/').pop().toLowerCase();
 if(byName[name])return byName[name];
 // .env, .env.local, .env.production …
 if(/^\.env(\..+)?$/.test(name)||name.endsWith('.env'))return byExtension.env;
 if(name.startsWith('dockerfile.')||name.endsWith('.dockerfile'))return byName.dockerfile;
 const dot=name.lastIndexOf('.');return dot>0||dot===0&&name.length>1?byExtension[name.slice(dot+1)]??null:null;
}
