// The Mac app opens this page as /setup#setup=<key>; the fragment never reaches the server.
// Keep the key for this window only (reloads) and remove it from the address bar at once.
const name='maricode-setup-key';
export function takeSetupKey({location,storage,history}){
 const m=/^#setup=([a-f0-9]{64})$/.exec(location.hash??'');
 if(m){try{storage.setItem(name,m[1]);}catch{}history.replaceState(null,'',location.pathname+location.search);return m[1];}
 let saved=null;try{saved=storage.getItem(name);}catch{}
 return /^[a-f0-9]{64}$/.test(saved??'')?saved:null;
}
