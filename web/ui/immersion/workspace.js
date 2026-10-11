// One private 3D workspace per controller. No Socket.io events are emitted here.
export function createImmersion({workbench,panel,notify}) {
 const stage=document.createElement('section');stage.className='immersion-stage';stage.hidden=true;stage.setAttribute('aria-label','Private 3D Immersion workspace');workbench.prepend(stage);
 stage.innerHTML='<div class="immersion-loading" role="status">Open Immersion to load your 3D workspace.</div>';
 panel.innerHTML=`<div class="immersion-heading"><span class="eyebrow">YOUR WORKSPACE</span><h2>Immersion</h2><p class="immersion-image"></p></div><p class="immersion-help">Drag empty space to orbit. Pinch to zoom. Tap a node to inspect it, or drag it out to edit. Drop it anywhere on the brain to return it. On phones, rotate to landscape for more room.</p><div class="immersion-view-actions"><button type="button" data-command="home">Reset view</button><button type="button" data-command="return-all">Return all nodes</button></div><p class="immersion-count" role="status">No nodes extracted</p><div class="immersion-extracted" role="group" aria-label="Extracted nodes"></div><section class="immersion-editor" hidden aria-label="Selected node editor"><span class="eyebrow">NODE DETAILS</span><h3 class="immersion-original"></h3><p class="immersion-score"></p><p class="immersion-source"></p><label>Display name<input class="immersion-name" type="text" maxlength="80" autocomplete="off" autocorrect="off" spellcheck="false"></label><label>Your notes<textarea class="immersion-notes" rows="3" maxlength="600" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="What would you investigate?"></textarea></label><div class="immersion-node-actions"><button type="button" data-command="extract">Extract node</button><button type="button" data-command="find">Find in 3D</button><button type="button" data-command="return">Return to flow</button></div><button type="button" data-command="features" class="immersion-features-button">Explore local features</button><p class="immersion-feature-status" role="status"></p><p class="immersion-local-result" role="status"></p><div class="immersion-features"></div><button type="button" data-command="reset-features" hidden>Reset local features</button></section><details class="immersion-catalog"><summary>Find a node</summary><label>Search nodes<input class="immersion-search" type="search" placeholder="Class or layer name"></label><div class="immersion-node-list"></div></details><p class="immersion-caveat">Names and notes are your annotations. Feature controls recompute this image locally from its original activations. The shared screen is unchanged.</p>`;
 let active=false,frame=null,ready=false,context=null,selected=null,lastImage=null,loadingTimer=null,disposed=false;
 const post=(type,payload)=>{if(frame&&ready)frame.contentWindow.postMessage({type,payload},location.origin);};
 const command=action=>post('immersion-command',{action,key:selected?.key});
 const loading=stage.querySelector('.immersion-loading');
 function start(){
  if(disposed||frame||!context?.display?.image?.id)return;
  ready=false;window.__immersionControllerReady=false;panel.dataset.ready='false';loading.hidden=false;loading.textContent='Loading your 3D workspace…';
  frame=document.createElement('iframe');frame.title='Immersion · private brain exploration';frame.src='/ui/immersion/scene.html?preview=1&pr=1';stage.prepend(frame);
  clearTimeout(loadingTimer);loadingTimer=setTimeout(()=>{if(frame&&!loading.hidden)retryLoading('Still loading 3D.')},15000);
 }
 function retryLoading(text){loading.hidden=false;loading.replaceChildren(document.createTextNode(text+' '));const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>{stop();start()};loading.append(retry);}
 function stop(){clearTimeout(loadingTimer);ready=false;frame?.remove();frame=null;}
 function selectTab(name){active=name==='immersion';stage.hidden=!active;if(active)start();else stop();}
 function sendContext(){if(active)start();post('immersion-state',context?.display);post('immersion-active',!document.hidden&&active);}
 function setContext(next){context=next;panel.querySelector('.immersion-image').textContent=next.display?.image?.name??'Waiting for the screen…';if(next.display?.image?.id!==lastImage){selected=null;panel.querySelector('.immersion-editor').hidden=true;lastImage=next.display?.image?.id;}sendContext();}
 function render(summary){
  const previousKey=selected?.key;selected=summary.selected;panel.classList.toggle('has-selection',Boolean(selected));
  panel.querySelector('.immersion-count').textContent=summary.detached.length?`${summary.detached.length} node${summary.detached.length===1?'':'s'} extracted`:'No nodes extracted';
  const extracted=panel.querySelector('.immersion-extracted');extracted.replaceChildren(...summary.detached.map(n=>{const b=document.createElement('button');b.textContent=n.name;b.dataset.nodeKey=n.key;b.setAttribute('aria-pressed',String(n.key===selected?.key));b.onclick=()=>post('immersion-command',{action:'select',key:n.key});return b;}));
  const editor=panel.querySelector('.immersion-editor');editor.hidden=!selected;if(selected&&editor.previousElementSibling!==panel.querySelector('.immersion-heading'))panel.querySelector('.immersion-heading').after(editor);
  if(selected){
   panel.querySelector('.immersion-original').textContent=selected.original;
   panel.querySelector('.immersion-score').textContent=selected.score==null?'Saved layer activation':`${selected.independent?'Independent':'Model'} score ${(selected.score*100).toFixed(1)}%${summary.localModel?' · local intervention':''}`;
   panel.querySelector('.immersion-source').textContent=selected.detail;
   for(const [selector,value]of [['.immersion-name',selected.name],['.immersion-notes',selected.notes]]){const e=panel.querySelector(selector);if(previousKey!==selected.key||document.activeElement!==e)e.value=value;}
   panel.querySelector('[data-command="extract"]').hidden=selected.detached;
   panel.querySelector('[data-command="return"]').hidden=!selected.detached;
   panel.querySelector('[data-command="features"]').hidden=selected.classId==null||selected.independent;
   panel.querySelector('.immersion-feature-status').textContent=summary.featureStatus||'';panel.querySelector('.immersion-local-result').textContent=summary.result?`Local answer: ${summary.result.label} · model score ${(summary.result.score*100).toFixed(1)}%`:'';panel.querySelector('[data-command="reset-features"]').hidden=!summary.localModel;
   const features=panel.querySelector('.immersion-features');
   const ids=selected.channels.map(c=>c.channel).join(',');
   if(features.dataset.channels!==`${selected.key}:${ids}`){features.dataset.channels=`${selected.key}:${ids}`;features.replaceChildren(...selected.channels.map(c=>{const label=document.createElement('label');label.className='immersion-channel';label.innerHTML='<span></span><output></output><input type="range" min="0" max="3" step="0.01">';label.querySelector('span').textContent=`Feature #${c.channel}`;const range=label.querySelector('input'),out=label.querySelector('output');range.setAttribute('aria-label',`Feature ${c.channel} local scale`);range.value=c.scale;out.textContent=`${c.scale.toFixed(2)}×`;range.oninput=()=>{out.textContent=`${Number(range.value).toFixed(2)}×`;post('immersion-command',{action:'scale',channel:c.channel,scale:Number(range.value)});};return label;}));}
   for(const c of selected.channels){const row=[...features.children].find(e=>e.querySelector('input')?.getAttribute('aria-label')===`Feature ${c.channel} local scale`);if(row&&document.activeElement!==row.querySelector('input')){row.querySelector('input').value=c.scale;row.querySelector('output').textContent=`${c.scale.toFixed(2)}×`;}}
  }
  panel.dataset.ready='true';window.__immersionControllerReady=true;
  const query=panel.querySelector('.immersion-search').value.trim().toLowerCase();
  const list=panel.querySelector('.immersion-node-list');list.replaceChildren(...summary.nodes.filter(n=>`${n.original} ${n.name}`.toLowerCase().includes(query)).map(n=>{const b=document.createElement('button');b.textContent=`${n.name}${n.detached?' · extracted':''}`;b.dataset.nodeKey=n.key;b.onclick=()=>post('immersion-command',{action:'select',key:n.key});return b;}));
  panel.__summary=summary;
 }
 function message(event){if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;const {type,payload}=event.data??{};if(type==='immersion-ready'){ready=true;sendContext();}else if(type==='immersion-rendered'){loading.hidden=true;clearTimeout(loadingTimer);}else if(type==='immersion-failed'){clearTimeout(loadingTimer);retryLoading(payload);}else if(type==='immersion-summary')render(payload);else if(type==='immersion-notice')notify(payload);}
 window.addEventListener('message',message);
 for(const b of panel.querySelectorAll('[data-command]'))b.onclick=()=>command(b.dataset.command);
 const edit=()=>post('immersion-command',{action:'annotate',key:selected?.key,name:panel.querySelector('.immersion-name').value,notes:panel.querySelector('.immersion-notes').value});
 panel.querySelector('.immersion-name').oninput=edit;panel.querySelector('.immersion-notes').oninput=edit;
 panel.querySelector('.immersion-search').oninput=()=>{if(panel.__summary)render(panel.__summary)};
 const visibility=()=>post('immersion-active',!document.hidden&&active);document.addEventListener('visibilitychange',visibility);
 return {selectTab,setContext,destroy(){disposed=true;stop();window.removeEventListener('message',message);document.removeEventListener('visibilitychange',visibility);stage.remove();panel.replaceChildren();}};
}
