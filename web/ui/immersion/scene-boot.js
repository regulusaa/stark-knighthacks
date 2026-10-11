let workspace=null,pending=null,active=true;
const send=(type,payload)=>parent.postMessage({type,payload},location.origin);
window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin)return;const {type,payload}=e.data??{};if(type==='immersion-state'){pending=payload;workspace?.receive(payload)}else if(type==='immersion-command')workspace?.command(payload);else if(type==='immersion-active'){active=Boolean(payload);workspace?.setActive(active)}});
const fail=()=>{document.querySelector('#scene-error').hidden=false;send('immersion-failed','Immersion could not start.');};
document.querySelector('#scene-error button').onclick=()=>location.reload();
document.querySelector('#stage').addEventListener('webglcontextlost',fail);
try{await import('/core/main.js');const {mountImmersionScene}=await import('./scene-engine.js');workspace=mountImmersionScene(window.__stark,{send});workspace.setActive(active);window.__immersion=workspace;send('immersion-ready');if(pending)await workspace.receive(pending);}catch(e){fail();console.error('[immersion] startup:',e)}
