// Applies this device's theme before the first paint. A separate file because the CSP allows no inline script.
(function(){var t='dark';try{if(localStorage.getItem('maricode-theme')==='light')t='light';}catch(e){}document.documentElement.dataset.theme=t;})();
