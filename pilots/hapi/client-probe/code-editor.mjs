// The file tab's editor: CodeMirror 6 (MIT, vendor/codemirror, see vendor/LICENSES.txt).
// Plain text edits immediately; the language grammar is loaded afterwards into a compartment.
import {EditorState,Compartment} from '/vendor/codemirror/state.js';
import {EditorView,keymap,lineNumbers,highlightActiveLine,highlightActiveLineGutter,drawSelection,highlightSpecialChars} from '/vendor/codemirror/view.js';
import {defaultKeymap,history,historyKeymap,indentWithTab} from '/vendor/codemirror/commands.js';
import {indentOnInput,bracketMatching,foldGutter,foldKeymap,StreamLanguage} from '/vendor/codemirror/language.js';
import {searchKeymap,highlightSelectionMatches} from '/vendor/codemirror/search.js';
import {oneDark} from '/vendor/codemirror/theme-one-dark.js';
import {editorLanguage} from '/editor-languages.mjs';

const layout=EditorView.theme({'&':{height:'100%',fontSize:'13px'},'.cm-scroller':{fontFamily:'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)',lineHeight:'1.6'}});
async function languageExtension(path){
 const l=editorLanguage(path);if(!l)return [];
 const m=await import(`/vendor/codemirror/${l.module}.js`);
 return l.kind==='lezer'?m[l.fn](l.options):StreamLanguage.define(m[l.name]);
}
export function create({parent,text,path,lineSeparator='\n',onChange,onSave}){
 const language=new Compartment();
 const save=()=>{onSave();return true;};
 const view=new EditorView({parent,state:EditorState.create({doc:text,extensions:[
  lineNumbers(),highlightActiveLineGutter(),foldGutter(),highlightSpecialChars(),history(),drawSelection(),indentOnInput(),bracketMatching(),highlightActiveLine(),highlightSelectionMatches(),
  EditorState.lineSeparator.of(lineSeparator),language.of([]),oneDark,layout,
  keymap.of([{key:'Mod-s',run:save,preventDefault:true},indentWithTab,...defaultKeymap,...historyKeymap,...searchKeymap,...foldKeymap]),
  EditorView.updateListener.of(u=>{if(u.docChanged)onChange();})
 ]})});
 let destroyed=false;
 languageExtension(path).then(ext=>{if(!destroyed)view.dispatch({effects:language.reconfigure(ext)});}).catch(()=>{});
 return {
  get text(){return view.state.doc.sliceString(0,view.state.doc.length,lineSeparator);},
  focus(){view.focus();},
  destroy(){if(!destroyed){destroyed=true;view.destroy();}}
 };
}
