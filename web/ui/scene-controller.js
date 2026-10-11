// Part selection controls the real display through the controller's existing relay.
// The controller intentionally mounts no 3D renderer.
export function createSceneController({ pane, controls, onAction }) {
  let pendingSeq = -1, optimistic = null;
  let context = { display: null, driving: false, connected: false, clientId: null };
  pane.innerHTML = `<p class="eyebrow">FOCUS</p><div class="part-selection" role="group" aria-label="Focus a part on the display">${[['brain','Brain'],['stem','Stem'],['all','Complete']].map(([part,label])=>`<button data-part="${part}" type="button" aria-pressed="false"><img src="/ui/icons/${part}.svg" alt=""><span>${label}</span></button>`).join('')}</div>`;
  controls.innerHTML = `<p class="eyebrow">VIEW</p><button data-arrange type="button">Split up</button><div class="part-actions"><button data-inspect type="button">Focus selected part</button><button data-center type="button">Center view</button></div><p class="scene-status" role="status">Assembled · Complete selected</p><p class="scene-help">Choose Brain, Stem, or Complete beside the pad. Drag the pad to turn the view; pinch to zoom.</p>`;
  function request(action) {
    if(!context.connected||!context.display?.capabilities?.inspection)return;
    const payload=onAction(action);
    if(payload) {
      pendingSeq=payload.seq; optimistic={...(optimistic??context.display?.scene)};
      if(action.action==='select'||action.action==='inspect')optimistic.selected=action.part;
      if(action.action==='split'||action.action==='join')optimistic.arrangement=action.action==='split'?'split':'joined';
      renderScene(optimistic);controls.dataset.pending=pane.dataset.pending='true';
    }
  }
  for(const b of pane.querySelectorAll('[data-part]'))b.onclick=()=>request({action:'inspect',part:b.dataset.part});
  controls.querySelector('[data-arrange]').onclick=()=>request({action:(optimistic??context.display?.scene)?.arrangement==='joined'?'split':'join'});
  controls.querySelector('[data-inspect]').onclick=()=>request({action:'inspect',part:(optimistic??context.display?.scene)?.selected??'all'});
  controls.querySelector('[data-center]').onclick=()=>request({action:'center'});
  function renderScene(s) {
    if(!s)return;
    const part=['brain','stem'].includes(s.selected)?s.selected:'all';
    for(const b of pane.querySelectorAll('[data-part]'))b.setAttribute('aria-pressed',String(b.dataset.part===part));
    controls.querySelector('[data-arrange]').textContent=s.arrangement==='joined'?'Split up':'Join together';
    controls.querySelector('.scene-status').textContent=`${s.arrangement==='joined'?'Assembled':s.arrangement==='split'?'Separated':'Manually positioned'} · ${part==='all'?'Complete':part==='brain'?'Brain':'Stem'} selected`;
  }
  return {
    setContext(next) {
      context=next;
      const available=next.display?.capabilities?.inspection===true;
      controls.hidden=pane.hidden=!available;
      pane.parentElement.classList.toggle('without-parts',!available);
      const confirmed=next.display?.scene;
      if(!next.driving||!next.connected||(confirmed?.ack?.clientId===next.clientId&&confirmed.ack.seq>=pendingSeq)) { optimistic=null;pendingSeq=-1; }
      renderScene(optimistic??confirmed);
      controls.dataset.pending=pane.dataset.pending=String(pendingSeq>=0);
      for(const b of [...controls.querySelectorAll('button'),...pane.querySelectorAll('button')])b.disabled=!next.connected;
      window.__inspectionControllerReady=Boolean(next.connected&&next.display);
    },
    cancel(){optimistic=null;pendingSeq=-1;renderScene(context.display?.scene);controls.dataset.pending=pane.dataset.pending='false';},
    destroy(){pane.replaceChildren();},
  };
}
