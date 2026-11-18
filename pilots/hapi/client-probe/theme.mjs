// Light/dark theme: a per-device display choice kept in this browser's storage (the Mac app's web views
// share one store; each remote browser or installed web app keeps its own). Never sent to the server.
export const themes=['dark','light'],themeKey='maricode-theme';
const barColour={dark:'#181818',light:'#f8f8f8'};
const normal=value=>themes.includes(value)?value:'dark';
export function readTheme(storage){try{return normal(storage?.getItem(themeKey));}catch{return 'dark';}}
// The Mac app also recolours its window frame; other browsers have no bridge.
const nativeBridge=()=>globalThis.window?.webkit?.messageHandlers?.maricode??null;
export function applyTheme(doc,theme,{bridge=nativeBridge()}={}){
 const t=normal(theme);doc.documentElement.dataset.theme=t;
 const meta=doc.querySelector('meta[name="theme-color"]');if(meta)meta.content=barColour[t];
 try{bridge?.postMessage('theme-'+t);}catch{}
 return t;
}
export function setTheme(doc,storage,theme,{bridge=nativeBridge(),Event=globalThis.CustomEvent}={}){
 const t=applyTheme(doc,theme,{bridge});
 try{storage?.setItem(themeKey,t);}catch{}
 doc.dispatchEvent(new Event('maricode-theme',{detail:t}));
 return t;
}
