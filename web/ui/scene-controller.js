// One relay connection lives in controller.js. The iframe is only a renderer of its confirmed state.
export function createSceneController({ pane, controls, onAction, notify }) {
  let pendingSeq = -1, optimistic = null;
  let context = { display: null, driving: false, connected: false, clientId: null }, frame = null, ready = false;
  const loading = pane.querySelector('.scene-loading');
  const diagram=document.createElement('figure');diagram.className='part-diagram';diagram.innerHTML='<img src="/ui/icons/all.svg" alt="Brain and brainstem diagram"><figcaption>COMPLETE</figcaption>';pane.append(diagram);
  controls.innerHTML = `<p class="eyebrow">SELECT A PART</p><div class="part-selection"><button data-part="brain" type="button">Brain</button><button data-part="stem" type="button">Stem</button><button data-part="all" type="button">All</button></div><button data-arrange type="button">Split up</button><div class="part-actions"><button data-inspect type="button">Inspect</button><button data-center type="button">Center view</button></div><p class="scene-status" role="status">Assembled · All selected</p><p class="scene-help">Select a part, then drag its handle to move it. Use the pad below to turn the view.</p>`;
  const post = (type,payload) => { if(ready)frame.contentWindow.postMessage({type,payload},location.origin); };
  function sync() {
    post('stark-scene-context',{driving:context.driving&&context.connected,clientId:context.clientId});
    if(context.display)post('stark-scene-state',context.display);
  }
  function request(action) {
    if(!context.connected||!context.display?.capabilities?.inspection)return;
    const payload=onAction(action);
    if(payload) {
      pendingSeq=payload.seq; optimistic={...(optimistic??context.display?.scene)};
      if(action.action==='select'||action.action==='inspect')optimistic.selected=action.part;
      if(action.action==='split'||action.action==='join')optimistic.arrangement=action.action==='split'?'split':'joined';
      post('stark-scene-local',payload); controls.dataset.pending='true';renderScene(optimistic);
    }
  }
  for(const b of controls.querySelectorAll('[data-part]'))b.onclick=()=>request({action:'select',part:b.dataset.part});
  controls.querySelector('[data-arrange]').onclick=()=>request({action:(optimistic??context.display?.scene)?.arrangement==='joined'?'split':'join'});
  controls.querySelector('[data-inspect]').onclick=()=>request({action:'inspect',part:(optimistic??context.display?.scene)?.selected??'all'});
  controls.querySelector('[data-center]').onclick=()=>request({action:'center'});
  function renderScene(s) {
    if(!s)return;
    const part=['brain','stem'].includes(s.selected)?s.selected:'all';
    diagram.querySelector('img').src=`/ui/icons/${part}.svg`;
    diagram.querySelector('img').alt=part==='all'?'Brain and brainstem diagram':`${part==='brain'?'Brain':'Brainstem'} diagram`;
    diagram.querySelector('figcaption').textContent=part==='all'?'COMPLETE':part==='brain'?'BRAIN':'BRAINSTEM';
    for(const b of controls.querySelectorAll('[data-part]'))b.setAttribute('aria-pressed',String(b.dataset.part===s.selected));
    controls.querySelector('[data-arrange]').textContent=s.arrangement==='joined'?'Split up':'Join together';
    controls.querySelector('.scene-status').textContent=`${s.arrangement==='joined'?'Assembled':s.arrangement==='split'?'Separated':'Manually positioned'} · ${s.selected==='all'?'All':s.selected==='brain'?'Brain':'Stem'} selected`;
  }
  function onMessage(event) {
    if(event.source!==frame?.contentWindow||event.origin!==location.origin)return;
    if(event.data?.type==='stark-scene-ready'){ready=true;sync();}
    if(event.data?.type==='stark-scene-rendered'){loading.hidden=true;window.__inspectionControllerReady=true;}
    if(event.data?.type==='stark-scene-action')request(event.data.payload);
  }
  window.addEventListener('message',onMessage);
  return {
    setContext(next) {
      const before=context;context=next;
      const available=next.display?.capabilities?.inspection===true;
      controls.hidden=!available;
      if(available&&!frame){frame=document.createElement('iframe');frame.title='Live brain and stem preview';frame.id='scene-preview';frame.src='/display?preview=1&offline=1&pr=1';pane.prepend(frame);}
      if(!available&&!frame)loading.textContent=next.display?'The live preview will appear when the display is updated.':'Waiting for the scene…';
      const confirmed=next.display?.scene;
      if(!next.driving||!next.connected||(confirmed?.ack?.clientId===next.clientId&&confirmed.ack.seq>=pendingSeq)) { optimistic=null;pendingSeq=-1; }
      renderScene(optimistic??confirmed);
      controls.dataset.pending=String(pendingSeq>=0);
      for(const b of controls.querySelectorAll('button'))b.disabled=!next.connected;
      if(before.driving&&!next.driving)post('stark-scene-cancel');
      sync();
    },
    cancel(){optimistic=null;pendingSeq=-1;post('stark-scene-cancel');},
    destroy(){window.removeEventListener('message',onMessage);frame?.remove();},
    get frame(){return frame;},
  };
}
