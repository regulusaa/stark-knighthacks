// A startup problem must produce a next step rather than an empty black canvas.
const startup = document.getElementById('display-startup');
const title = startup.querySelector('h1'), message = startup.querySelector('p'), retry = startup.querySelector('button');
let failed = false, graphicsPaused = false;
function showFailure(error) {
  failed = true; startup.hidden = false; retry.hidden = false;
  title.textContent = 'The scene could not start';
  message.textContent = /WebGL|context/i.test(error?.message ?? '')
    ? 'The browser could not start 3D graphics. Close another 3D tab, then retry.'
    : 'A scene file could not load. Check the connection, then retry.';
  window.__starkStartupError = error?.message ?? String(error);
}
retry.onclick = () => location.reload();
const canvas=document.getElementById('stage');
canvas.addEventListener('webglcontextlost', () => {
  graphicsPaused=true;startup.hidden=false;retry.hidden=false;
  title.textContent='3D graphics paused';message.textContent='The browser is restoring the scene. You can wait or retry.';
});
canvas.addEventListener('webglcontextrestored', () => {graphicsPaused=false;if(!failed)startup.hidden=true;});
window.addEventListener('error', e => { if(e.error)showFailure(e.error); });
window.addEventListener('unhandledrejection', e => showFailure(e.reason));
const slow = setTimeout(() => { if(!window.__starkReady&&!failed){message.textContent='Still loading the scene. You can wait or retry.';retry.hidden=false;} },15000);
const ready = setInterval(() => { if(window.__starkReady&&!failed&&!graphicsPaused){startup.hidden=true;clearTimeout(slow);clearInterval(ready);} },100);
try { await import('./main.js'); } catch(error) { showFailure(error); console.error('[stark] display startup:', error); }
