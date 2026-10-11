const records=new Map(), images=new Map();
const knownImages=new Set(['clean_retriever','adv_retriever','ambig_cat','ambig_wolf','clean_sportscar','clean_monarch','ambig_chihuahua','med_xray_pneumonia','med_xray_normal']);
async function recordFor(id) {
 if(!knownImages.has(id))return null;
 if(!records.has(id))records.set(id,fetch(`/ui/evidence/${id}.json`).then(r=>r.ok?r.json():null).catch(()=>null));
 return records.get(id);
}
function imageFor(url) {
 if(!images.has(url))images.set(url,new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=url;}));
 return images.get(url);
}
const ramp=[[0,0,4],[50,10,94],[120,28,109],[188,55,84],[237,105,37],[251,182,26],[252,255,164]];
const evidencePercent=(value,digits)=>`${(value*100).toFixed(digits)}%`;
function color(value) {
 const v=Math.max(0,Math.min(255,value))/255*6,i=Math.min(5,Math.floor(v)),t=v-i;
 return ramp[i].map((n,k)=>Math.round(n+(ramp[i+1][k]-n)*t));
}
function peakRegion(data,size) {
 const max=Math.max(...data);if(!(max>0))return null;
 let sx=0,sy=0,n=0;
 // Centroid of the strongest 10% band, avoiding an arbitrary first pixel on a plateau.
 data.forEach((v,i)=>{if(v>=max*.9){sx+=(i%size+.5)/size;sy+=(Math.floor(i/size)+.5)/size;n++;}});
 const x=Math.min(2,Math.floor(sx/n*3)),y=Math.min(2,Math.floor(sy/n*3));
 return [['upper left','upper centre','upper right'],['middle left','centre','middle right'],['lower left','lower centre','lower right']][y][x];
}
export function mountFocusEvidence(root,{enabled=true}={}) {
 const href=new URL('./styles/focus-evidence.css',import.meta.url).href;
 if(![...document.querySelectorAll('link[rel="stylesheet"]')].some(l=>l.href===href)){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.append(l);}
 root.classList.add('focus-evidence');
 root.innerHTML='<div class="focus-evidence-map" hidden><img class="focus-map-image" width="224" height="224" alt=""><div><strong>Where it responds</strong><p class="focus-region"></p><small>Each map uses its own brightness scale.</small></div></div><div class="focus-evidence-why"><strong>Why this score</strong><p></p></div><p class="focus-evidence-edit" hidden></p>';
 const map=root.querySelector('.focus-evidence-map'),preview=root.querySelector('.focus-map-image'),canvas=document.createElement('canvas');
 canvas.width=canvas.height=224;const ctx=canvas.getContext('2d');
 const why=root.querySelector('.focus-evidence-why'),edit=root.querySelector('.focus-evidence-edit');
 let signature='',ticket=0,disposed=false,lastData=null,lastImage=null,mapKey=null;
 async function update(state,answer) {
  root.hidden=!enabled||!answer;
  if(root.hidden){signature='';ticket++;return;}
  root.dataset.hasMap=String(Boolean(answer.heatmapSource));
  const id=state?.image?.id,heat=state?.scene?.heat;
  const matching=answer.heatmapSource==='live'&&heat?.key===`cam:${answer.classId}`&&Array.isArray(heat.data)&&heat.data.length===784;
  const next=JSON.stringify([id,answer.classId,answer.score,answer.heatmapSource,state?.steer?.active,matching?heat.data:null]);
  if(next===signature)return;signature=next;const mine=++ticket;
  const nextMapKey=`${id}:${answer.classId}:${answer.heatmapSource}`;
  if(mapKey!==nextMapKey||!matching&&answer.heatmapSource==='live')map.hidden=true;
  mapKey=nextMapKey;edit.hidden=true;why.querySelector('p').textContent='Loading this class’s evidence…';
  const record=await recordFor(id);
  if(disposed||mine!==ticket)return;
  const item=record?.classes.find(c=>c.classId===answer.classId);
  if(item?.support&&item.removal) {
   const s=item.support;
   const minimum=Math.min(item.baselineScore,item.removal.score),digits=minimum<.001?3:minimum<.01?2:1;
   why.querySelector('p').textContent=`Original activation test: turning off feature #${s.channel} changes this class’s model score from ${evidencePercent(item.baselineScore,digits)} to ${evidencePercent(item.removal.score,digits)}.`;
   const delta=(answer.score-item.baselineScore)*100;
   if(state?.steer?.active&&Number.isFinite(delta)) {
    edit.hidden=false;edit.textContent=`Your edits: ${delta>=0?'+':'−'}${Math.abs(delta).toFixed(1)} score points from the original response.`;
   }
  } else why.querySelector('p').textContent=record?.model==='medical'?(answer.heatmapSource?'This map localizes regions associated with the selected finding. Each finding has its own independent score · not a diagnosis.':'Spatial evidence is unavailable for this finding. Independent scores · not a diagnosis.'):'Feature-removal evidence is unavailable for this answer.';
  let data,size;
  if(matching){data=heat.data;size=28;}
  else if(answer.heatmapSource==='precomputed'&&item?.heatmapFile&&/^gradcam\/[0-9]+\.png$/.test(item.heatmapFile)) {
   const heatImage=await imageFor(`/assets/${id}/${item.heatmapFile}`);
   if(disposed||mine!==ticket)return;
   if(heatImage){const sampling=document.createElement('canvas');sampling.width=sampling.height=28;const sc=sampling.getContext('2d');sc.drawImage(heatImage,0,0,28,28);const rgba=sc.getImageData(0,0,28,28).data;data=Array.from({length:784},(_,i)=>rgba[i*4]);size=28;}
  }
  if(!data){lastData=null;return;}
  const crop=await imageFor(`/assets/${id}/crop.png`);
  if(disposed||mine!==ticket)return;
  if(lastImage!==id||JSON.stringify(data)!==lastData) {
   ctx.clearRect(0,0,224,224);if(crop)ctx.drawImage(crop,0,0,224,224);
   const small=document.createElement('canvas');small.width=small.height=size;
   const sc=small.getContext('2d'),pixels=sc.createImageData(size,size);
   data.forEach((v,i)=>{const rgb=color(v);pixels.data.set([...rgb,Math.round(v/255*180)],i*4);});sc.putImageData(pixels,0,0);
   ctx.imageSmoothingEnabled=true;ctx.drawImage(small,0,0,224,224);
   lastImage=id;lastData=JSON.stringify(data);
  }
  preview.alt=`Image regions associated with ${answer.label}`;preview.src=canvas.toDataURL();
  const region=peakRegion(data,size);
  root.querySelector('.focus-region').textContent=region?`Strongest region: ${region} of the crop.`:'No positive highlighted region.';
  map.hidden=false;
 }
 return {update:(...args)=>update(...args).catch(()=>{if(!disposed){map.hidden=true;why.querySelector('p').textContent='Evidence is unavailable for this answer.';}}),destroy(){disposed=true;ticket++;root.replaceChildren();}};
}
