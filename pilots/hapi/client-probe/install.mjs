// The QR link opens this page with a one-time pairing code in the fragment (never sent to the server).
// Show it for the installed app, offer a direct browser login, and drop it from the address and history.
const code=/^#code=([A-Z0-9]{4}-[A-Z0-9]{4})$/.exec(location.hash)?.[1];
if(code){
 window.history.replaceState(null,'',location.pathname);
 document.getElementById('pair-code').textContent=code;
 document.getElementById('pair-open').href='/workspace#code='+code;
 document.getElementById('pair').hidden=false;
}
