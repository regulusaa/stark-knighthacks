// Part selection controls the real display through the controller's existing relay.
// The controller intentionally mounts no 3D renderer.
export function createSceneController({ pane, controls, onAction }) {
  let pendingSeq = -1, optimistic = null;
  let lastTap = null;
  let context = { display: null, driving: false, connected: false, clientId: null };
  pane.innerHTML = `<p class="eyebrow">FOCUS</p><div class="part-selection" role="group" aria-label="Focus a part on the display">${[['brain','Brain'],['stem','Stem'],['all','Complete']].map(([part,label])=>`<button data-part="${part}" type="button" aria-pressed="false"><img src="/ui/icons/${part}.svg" alt=""><span>${label}</span></button>`).join('')}</div>`;
  controls.innerHTML = `<p class="eyebrow">VIEW</p><button data-arrange type="button">Split up</button><div class="part-actions"><button data-inspect type="button">Focus selected part</button><button data-center type="button">Center view</button></div><p class="scene-status" role="status">Assembled · Complete selected</p><p class="scene-help">Tap a part to focus it. Double-tap Brain or Stem to separate that part. Drag the pad to turn the view; pinch to zoom.</p>`;
  function request(action) {
    if(!context.connected||!context.display?.capabilities?.inspection)return;
    const payload=onAction(action);
    if(payload) {
      pendingSeq=payload.seq; optimistic={...(optimistic??context.display?.scene)};
      for (const item of Array.isArray(action) ? action : [action]) {
        if(item.action==='select'||item.action==='inspect')optimistic.selected=item.part;
        if(item.action==='split'||item.action==='join')optimistic.arrangement=item.action==='split'?'split':'joined';
        if(item.action==='join')optimistic.offsets={brain:[0,0,0],stem:[0,0,0]};
        if(item.action==='move') {
          optimistic.arrangement='custom';
          optimistic.offsets={...optimistic.offsets,[item.part]:item.position};
        }
      }
      renderScene(optimistic);controls.dataset.pending=pane.dataset.pending='true';
    }
  }
  function separate(part) {
    const scene = optimistic ?? context.display?.scene;
    if (!scene) return;
    const other = scene.offsets?.[part === 'brain' ? 'stem' : 'brain'] ?? [0,0,0];
    const back = scene.camera?.back ?? [0,0,1];
    const length = Math.hypot(back[0],back[2]);
    const right = length > 1e-6 ? [back[2]/length,0,-back[0]/length] : [1,0,0];
    const direction = part === 'brain' ? -1 : 1;
    const position = other.map((n,i) => Math.max(-16,Math.min(16,n + direction * (i === 1 ? 3.2 : right[i] * 8.6))));
    // A single permission check queues the whole operation until control is confirmed.
    request([{action:'move',part,position},{action:'select',part},{action:'center'}]);
  }
  for(const b of pane.querySelectorAll('[data-part]')) {
    const part = b.dataset.part;
    if (part !== 'all') {
      b.title = `Tap to focus ${part}; double-tap to separate it`;
      b.setAttribute('aria-label',`${part === 'brain' ? 'Brain' : 'Stem'}: tap to focus, double-tap to separate`);
    }
    b.onclick = event => {
      const now = performance.now();
      const twice = part !== 'all' && event.detail > 0 && lastTap?.part === part &&
        (event.detail === 2 || now - lastTap.at <= 400);
      lastTap = twice || event.detail === 0 ? null : {part,at:now};
      if (twice) separate(part); else request({action:'inspect',part});
    };
  }
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
      if (!next.connected || next.display?.image?.id !== context.display?.image?.id || (context.driving && !next.driving)) lastTap = null;
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
    cancel(){lastTap=null;optimistic=null;pendingSeq=-1;renderScene(context.display?.scene);controls.dataset.pending=pane.dataset.pending='false';},
    destroy(){pane.replaceChildren();},
  };
}
