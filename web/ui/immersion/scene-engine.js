// Controller-local adapter. It reuses the renderer and exact model maths without a relay.
import * as THREE from 'three';
import { layoutBrain } from '/core/brainLayout.js';

const percent = v => `${(v * 100).toFixed(1)}%`;
const fetchBytes = async url => {const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.arrayBuffer();};
export function mountImmersionScene(stark,{send}) {
 const {api,scene,camera,renderer,tips,labels,veins,trunk,activity,inspection,rig,tissue,panel}=stark;
 const canvas=renderer.domElement, records=new Map(),edges=new Map(),detachedGroup=new THREE.Group();scene.add(detachedGroup);
 let pickedPosition=null,summaryPending=false,lastScoreSignature='',failedImage=null;
 let selected=null,imageId=null,latest=null,loading=false,active=true,engine=null,engineLoad=null,classNames=null,featureStatus='',scales=new Map(),saved={},lastSummary=0;
 const pulses=new Map(),clones=new Map(),ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
 const pointers=new Map();let candidate=null,drag=null,orbitX=0,orbitY=0,zoom=0,lastFlush=0;
 const layerMask=new Float32Array(49),layerGlow=new Float32Array(49);
 const originalTrunk=trunk.mesh.material;
 const trunkMaterial=originalTrunk.clone();trunkMaterial.uniforms={...originalTrunk.uniforms,uLocalMask:{value:layerMask},uLocalGlow:{value:layerGlow}};
 trunkMaterial.fragmentShader='uniform float uLocalMask[49];uniform float uLocalGlow[49];\n'+trunkMaterial.fragmentShader.replace('gl_FragColor = vec4(col, 1.0);',`int li=int(clamp(floor(vY/uHeight*uLayers),0.0,48.0));
 col=mix(col,vec3(.035),uLocalMask[li]);col+=vec3(1.,.62,.12)*uLocalGlow[li];gl_FragColor=vec4(col,1.0);`);
 trunk.mesh.material=trunkMaterial;
 // Own cloned shaders share live uniforms with the reused scene, but add local masks/glow.
 function cloneMaterial(source){
  if(clones.has(source))return clones.get(source);
  const m=source.clone();m.uniforms=source.uniforms;
  m.vertexShader='attribute vec2 aImmersion;varying vec2 vImmersion;\n'+m.vertexShader.replace('void main() {','void main() {\n vImmersion=aImmersion;');
  m.fragmentShader='varying vec2 vImmersion;\n'+m.fragmentShader.replace('gl_FragColor = vec4(col * uFade, 1.0);','col=mix(col,vec3(.045),vImmersion.x);col+=vec3(1.,.62,.12)*vImmersion.y*1.5;gl_FragColor=vec4(col*uFade,1.0);');
  clones.set(source,m);return m;
 }
 const keyForClass=id=>`class:${id}`;
 const storageKey=()=>`stark:immersion:${imageId}`;
 function persist(){if(!imageId)return;const nodes={};for(const r of records.values())if(r.name!==r.original||r.notes||r.detached)nodes[r.key]={name:r.name,notes:r.notes,position:r.detached?r.object.position.toArray():null};try{sessionStorage.setItem(storageKey(),JSON.stringify({nodes,scales:[...scales]}));}catch{/* Browsers may disable session storage. */}}
 function restore(){try{saved=JSON.parse(sessionStorage.getItem(storageKey())||'{}')}catch{saved={}}scales=new Map(saved.scales??[]);}
 function labelSprite(text){
  const c=document.createElement('canvas'),ctx=c.getContext('2d');c.width=384;c.height=64;
  const texture=new THREE.CanvasTexture(c);texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,transparent:true}));sprite.renderOrder=40;
  const paint=text=>{ctx.clearRect(0,0,384,64);ctx.fillStyle='#050208e8';ctx.fillRect(0,0,384,64);ctx.font='500 32px system-ui';ctx.fillStyle='#f3eef7';let t=text;while(ctx.measureText(t).width>356)t=t.slice(0,-2)+'…';ctx.fillText(t,14,42);texture.needsUpdate=true;};paint(text);return {sprite,paint};
 }
 function objectFor(r){
  const group=new THREE.Group();group.userData.nodeKey=r.key;
  const material=new THREE.MeshStandardMaterial({color:0xfbb61a,roughness:.4,metalness:.25,emissive:0x781c1a,emissiveIntensity:.3});
  const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(.22,2),material);mesh.userData.nodeKey=r.key;group.add(mesh);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.3,.013,6,48),new THREE.MeshBasicMaterial({color:0x9ef0ff}));ring.visible=Boolean(r.tip?.node.isTrueLabel);group.add(ring);
  const name=labelSprite(r.name);group.add(name.sprite);group.visible=false;detachedGroup.add(group);
  return {group,mesh,ring,label:name};
 }
 function addRecord(data){
  const stored=saved.nodes?.[data.key];const r={...data,name:stored?.name??data.original,notes:stored?.notes??'',packets:[],detached:false,channels:[]};
  const obj=objectFor(r);Object.assign(r,{object:obj.group,mesh:obj.mesh,ring:obj.ring,label:obj.label});records.set(r.key,r);summaryPending=true;
  if(stored?.position?.length===3&&stored.position.every(Number.isFinite)){r.detached=true;r.object.visible=true;r.object.position.fromArray(stored.position);}
  if(r.tip){r.visibility={mesh:r.tip.mesh.visible,twin:r.tip.twin.visible,halo:r.tip.halo?.visible};r.tip.node.label=r.name;}
  return r;
 }
 function buildRecords(){
  const layout=layoutBrain(api.assets.tree);edges.clear();
  layout.edges.forEach((e,i)=>{
   const mesh=veins.group.children[i*2],hidden=veins.group.children[i*2+1];if(!mesh)return;
   const attr=new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count*2),2);mesh.geometry.setAttribute('aImmersion',attr);
   mesh.material=cloneMaterial(mesh.material);hidden.material=cloneMaterial(hidden.material);edges.set(e.to,{edge:e,attr});
  });
  for(const tip of tips.list)if(!tip.isOther)addRecord({key:keyForClass(tip.classId),original:tip.node.label,classId:tip.classId,nodeId:tip.node.id,tip,score:tip.score,independent:api.state.scoreKind==='independent',detail:'Original class identity is preserved. Annotations belong to this workspace.'});
  discoverPackets();
 }
 function discoverPackets(){
  for(const p of [...activity.packets]){
   if(p.__immersionRecord)continue;
   let r;
   if(p.nodeId!=null)r=[...records.values()].find(r=>r.nodeId===p.nodeId);
   else if(p.index!=null){const key=`layer:${p.index}`;r=records.get(key)??addRecord({key,original:p.name,index:p.index,classId:null,score:null,detail:p.details.join(' · '),independent:false});}
   else if(api.state?.scoreKind==='independent'){const a=api.assets.tree.topK[Math.round(p.phase*api.assets.tree.topK.length)];r=records.get(keyForClass(a?.classId));}
   if(!r)continue;p.__immersionRecord=r;r.packets.push(p);if(p.name!=null)p.name=r.name;
   if(r.detached){activity.packets.splice(activity.packets.indexOf(p),1);p.sprite.visible=false;}
  }
 }
 // Restore removed packets before the renderer disposes an image; otherwise their textures leak.
 function restorePackets(){for(const r of records.values())for(const p of r.packets)if(!activity.packets.includes(p))activity.packets.push(p);}
 function clearRecords(){restorePackets();for(const r of records.values()){detachedGroup.remove(r.object);r.mesh.geometry.dispose();r.mesh.material.dispose();r.ring.geometry.dispose();r.ring.material.dispose();r.label.sprite.material.map.dispose();r.label.sprite.material.dispose();}records.clear();edges.clear();pulses.clear();selected=null;}
 function summary(){const view=r=>({key:r.key,original:r.original,name:r.name,notes:r.notes,score:r.classId==null?null:engine?engine.probs[r.classId]:r.tip?.target??r.score,independent:r.independent,detail:r.detail,classId:r.classId,detached:r.detached,channels:r.channels.map(c=>({channel:c,scale:scales.get(c)??1}))});send('immersion-summary',{selected:selected?view(selected):null,detached:[...records.values()].filter(r=>r.detached).map(view),nodes:[...records.values()].map(view),localModel:Boolean(engine),result:engine?api.state.top1:null,featureStatus});lastSummary=performance.now();}
 function originalPosition(r){if(r.tip)return tips.worldPosition(r.classId,new THREE.Vector3());const p=r.packets.find(p=>p.sprite.visible)??r.packets[0];return p?p.curve.getPoint(.65).add(inspection.groups[p.part].position):new THREE.Vector3(0,0,0);}
 function freezeCamera(){inspection.cancelCamera();rig.snapTo(camera.position.clone(),rig.state.target.clone());}
 function extract(r,pos){if(!r||r.detached)return;stark.focus.clearFocus({resetView:false});freezeCamera();if(r.tip)r.visibility={mesh:r.tip.mesh.visible,twin:r.tip.twin.visible,halo:r.tip.halo?.visible};r.detached=true;if(!pos){const origin=originalPosition(r),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),origin);setRay(canvas.clientWidth*.13,canvas.clientHeight*.68);pos=ray.ray.intersectPlane(plane,new THREE.Vector3())??origin;}r.object.position.copy(pos);r.object.visible=true;for(const p of r.packets){const i=activity.packets.indexOf(p);if(i>=0)activity.packets.splice(i,1);p.sprite.visible=false;}persist();summary();}
 function returnNode(r){if(!r?.detached)return;r.detached=false;r.object.visible=false;if(r.tip&&r.visibility){r.tip.mesh.visible=r.visibility.mesh;r.tip.twin.visible=r.visibility.twin;if(r.tip.halo)r.tip.halo.visible=r.visibility.halo;r.tip.pick.visible=true;if(r.tip.node.isTrueLabel)tips.ring.visible=true;}for(const p of r.packets)if(!activity.packets.includes(p))activity.packets.push(p);if(r.nodeId!=null){for(let id=r.nodeId;edges.has(id);id=edges.get(id).edge.from)pulses.set(id,performance.now());}else if(r.index!=null)pulses.set(`layer:${r.index}`,performance.now());persist();summary();}
 function select(r,focus=false){if(!r)return;selected=r;if(engine&&r.classId!=null)r.channels=engine.topChannels(r.classId,3).map(c=>c.channel);if(focus&&r.classId!=null&&!r.detached)api.focusTip(r.classId);summary();}
 function projectPoint(p){const v=p.clone().project(camera);return {x:(v.x+1)/2*canvas.clientWidth,y:(1-v.y)/2*canvas.clientHeight,z:v.z};}
 function setRay(x,y){ndc.set(x/canvas.clientWidth*2-1,1-y/canvas.clientHeight*2);ray.setFromCamera(ndc,camera);}
 function hit(x,y){
  setRay(x,y);pickedPosition=null;
  // Detached objects and moving labels take precedence over stationary tips.
  const spheres=ray.intersectObjects([...records.values()].filter(r=>r.detached).map(r=>r.mesh),false);
  if(spheres.length){const r=records.get(spheres[0].object.userData.nodeKey);pickedPosition=r.object.position.clone();return r;}
  const floating=ray.intersectObjects([...records.values()].filter(r=>r.detached).map(r=>r.label.sprite),false);if(floating.length){const r=[...records.values()].find(r=>r.label.sprite===floating[0].object);pickedPosition=r.object.position.clone();return r;}
  // A direct tap on a tip should not be stolen by a nearby floating label.
  let direct=null,directDistance=12;for(const r of records.values())if(r.tip&&!r.detached){const p=projectPoint(originalPosition(r)),d=Math.hypot(p.x-x,p.y-y);if(p.z<1&&p.z> -1&&d<directDistance){direct=r;directDistance=d;}}if(direct)return direct;
  const packets=ray.intersectObjects(activity.packets.filter(p=>p.sprite.visible).map(p=>p.sprite),false);
  if(packets.length){const p=activity.packets.find(p=>p.sprite===packets[0].object);pickedPosition=p.sprite.position.clone();return p?.__immersionRecord??null;}
  const staticLabels=ray.intersectObjects(labels.list.filter(l=>l.sprite.visible&&!records.get(keyForClass(l.classId))?.detached).map(l=>l.sprite),false);
  if(staticLabels.length)return records.get(keyForClass(labels.list.find(l=>l.sprite===staticLabels[0].object).classId));
  let best=null,distance=24;
  for(const r of records.values())if(r.tip&&!r.detached){const p=projectPoint(originalPosition(r));if(p.z>1||p.z< -1)continue;const d=Math.hypot(p.x-x,p.y-y);if(d<distance){distance=d;best=r;}}
  return best;
 }
 function brainHit(x,y){setRay(x,y);return ray.intersectObject(tissue.parts.brain,false).length>0;}
 function freezeInput(){pointers.clear();candidate=null;drag=null;orbitX=orbitY=zoom=0;document.querySelector('.drop-hint').hidden=true;persist();}
 function coordinates(e){const b=canvas.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top};}
 function down(e){if(!active||loading)return;e.preventDefault();const p=coordinates(e);pointers.set(e.pointerId,p);canvas.setPointerCapture(e.pointerId);if(pointers.size===1){const r=hit(p.x,p.y);if(r)freezeCamera();candidate={r,start:p,pos:pickedPosition?.clone()};}else{candidate=null;drag=null;document.querySelector('.drop-hint').hidden=true;}}
 function move(e){if(!pointers.has(e.pointerId))return;e.preventDefault();const next=coordinates(e),prev=pointers.get(e.pointerId),before=[...pointers.values()];pointers.set(e.pointerId,next);
  if(pointers.size===2){const after=[...pointers.values()];const a=Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y),b=Math.hypot(after[0].x-after[1].x,after[0].y-after[1].y);if(a>2&&b>2)zoom+=Math.log(b/a);return;}
  if(pointers.size!==1)return;
  if(candidate?.r&&!drag&&Math.hypot(next.x-candidate.start.x,next.y-candidate.start.y)>7){const r=candidate.r,pos=r.detached?r.object.position.clone():candidate.pos??originalPosition(r);select(r);extract(r,pos);freezeCamera();const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),pos);setRay(candidate.start.x,candidate.start.y);const intersection=ray.ray.intersectPlane(plane,new THREE.Vector3())??pos;drag={r,plane,offset:pos.clone().sub(intersection)};}
  if(drag){setRay(next.x,next.y);const pos=ray.ray.intersectPlane(drag.plane,new THREE.Vector3());if(pos)drag.r.object.position.copy(pos.add(drag.offset));const hint=document.querySelector('.drop-hint');hint.hidden=false;hint.textContent=brainHit(next.x,next.y)?'Release to return to its original stream':'Drop anywhere on the brain to return';hint.classList.toggle('ready',brainHit(next.x,next.y));}
  else if(!candidate?.r){orbitX+=(next.x-prev.x)/canvas.clientWidth;orbitY+=(next.y-prev.y)/canvas.clientHeight;}
 }
 function up(e){if(!pointers.has(e.pointerId))return;e.preventDefault();const p=coordinates(e);if(pointers.size===1){if(drag){if(brainHit(p.x,p.y))returnNode(drag.r);persist();}else if(candidate?.r&&Math.hypot(p.x-candidate.start.x,p.y-candidate.start.y)<8)select(candidate.r,true);candidate=null;drag=null;document.querySelector('.drop-hint').hidden=true;}pointers.delete(e.pointerId);if(pointers.size===1)candidate=null;}
 canvas.style.touchAction='none';canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',freezeInput);canvas.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))freezeInput();});
 canvas.addEventListener('wheel',e=>{if(!active)return;e.preventDefault();zoom-=e.deltaY*.001;},{passive:false});
 for(const type of ['gesturestart','contextmenu','selectstart','dblclick'])canvas.addEventListener(type,e=>e.preventDefault(),{passive:false});
 window.addEventListener('resize',freezeInput);document.addEventListener('visibilitychange',()=>setActive(!document.hidden));
 // Core refreshes sprites each frame. Apply local suppression immediately before the GPU draw.
 const originalBefore=scene.onBeforeRender;
 scene.onBeforeRender=function(...args){originalBefore?.apply(this,args);if(!active||loading)return;const now=performance.now();discoverPackets();
  if(now-lastFlush>=1000/30){if(orbitX||orbitY)api.orbit(orbitX,orbitY);if(zoom)api.zoom(zoom);orbitX=orbitY=zoom=0;lastFlush=now;}
  for(const r of records.values()){
   if(r.detached){if(r.tip){r.tip.mesh.visible=r.tip.twin.visible=r.tip.pick.visible=false;if(r.tip.halo)r.tip.halo.visible=false;if(r.tip.node.isTrueLabel)tips.ring.visible=false;}for(const l of labels.list)if(l.classId===r.classId)l.sprite.visible=false;for(const p of r.packets)p.sprite.visible=false;}
   
   if(r.detached){const depth=Math.max(.2,r.object.position.distanceTo(camera.position)),unit=2*depth*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/canvas.clientHeight;r.mesh.scale.setScalar(Math.max(.6,unit*26/.22));r.ring.scale.copy(r.mesh.scale);r.ring.quaternion.copy(camera.quaternion);r.label.sprite.scale.set(192*unit,32*unit,1);const screen=projectPoint(r.object.position),labelX=Math.max(104,Math.min(canvas.clientWidth-104,screen.x)),offset=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion).multiplyScalar((labelX-screen.x)*unit);offset.addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),unit*48);r.label.sprite.position.copy(offset);}
  }
  for(const [id,e]of edges){const r=[...records.values()].find(r=>r.nodeId===id),mask=r?.detached?1:0,start=pulses.get(id),glow=start==null?0:Math.max(0,1-(now-start)/1000);if(start!=null&&!glow)pulses.delete(id);if(e.attr.array[0]!==mask||e.attr.array[1]!==glow){for(let i=0;i<e.attr.array.length;i+=2){e.attr.array[i]=mask;e.attr.array[i+1]=glow;}e.attr.needsUpdate=true;}}
  layerMask.fill(0);layerGlow.fill(0);for(const r of records.values())if(r.index!=null)layerMask[r.index]=r.detached?1:0;for(const [key,start]of pulses)if(typeof key==='string'&&key.startsWith('layer:')){const index=Number(key.split(':')[1]);layerGlow[index]=Math.max(0,1-(now-start)/1000);if(!layerGlow[index])pulses.delete(key);}
  if(summaryPending&&now-lastSummary>100){summaryPending=false;summary();}
 };
 async function receive(state){latest=state;if(!state?.image?.id||state.image.id===failedImage)return;failedImage=null;if(loading)return;if(state.image.id===imageId){if(!engine)syncScores(state);return;}
  loading=true;freezeInput();persist();clearRecords();engine=null;engineLoad=null;featureStatus='';api.attachHeatProvider(null);api.steerAnswer=()=>null;imageId=state.image.id;restore();
  try{const ok=await api.loadImage(imageId,{autoplay:false});if(!ok||!api.assets.tree)throw new Error('Image data unavailable');api.jumpToEnd();veins.setRevealed();buildRecords();syncScores(state);inspection.initial();send('immersion-rendered');summary();}
  catch(e){failedImage=imageId;send('immersion-failed',`Could not load this image: ${e.message}.`);imageId=null;}
  finally{loading=false;if(latest?.image?.id&&latest.image.id!==imageId&&imageId!==null)receive(latest);}
 }
 function syncScores(state){if(!api.state)return;const signature=JSON.stringify([state.top1,state.answers,state.scene?.values]);if(signature!==lastScoreSignature){lastScoreSignature=signature;summaryPending=true;}api.patchState({image:state.image,answers:state.answers??api.state.answers,top1:state.top1??api.state.top1,trueClass:state.trueClass??api.state.trueClass,scoreKind:state.scoreKind??api.state.scoreKind});if(state.scene?.values)veins.setValues(new Map(state.scene.values),state.scene.litLeaf,100);const scores=new Map((state.answers??[]).map(a=>[a.classId,a.score])),values=new Map(state.scene?.values??[]);tips.setScores(id=>scores.get(id)??values.get(tips.get(id)?.node.id),state.top1?.classId);if(state.top1)labels.setTop1(state.top1.classId);}
 async function features(){if(!selected||selected.classId==null||selected.independent)return;if(engine){select(selected);return;}if(engineLoad)return;const mine=imageId;featureStatus='Loading original activations for local edits…';summary();
  engineLoad=(async()=>{try{const mod=await import('/core/steer/engine.js');const [head,conv,classes]=await Promise.all([fetchBytes('/assets/steer/head.bin'),fetchBytes(api.assets.base+'conv5.bin'),fetch('/assets/steer/classes.json').then(r=>{if(!r.ok)throw new Error('Class names unavailable');return r.json()})]);if(imageId!==mine)return;const next=mod.createEngine(mod.parseHead(head));next.setImage(mine,mod.parseConv5(conv));if(next.identityError(api.assets.tree)>mod.ENGINE.identityTol)throw new Error('Original scores did not match');engine=next;classNames=classes.classes.map(c=>c.label);featureStatus='Local features · starts from original activations';api.attachHeatProvider((id,instant)=>{const pixels=new Uint8Array(224*224);if(!engine.cam(id,scales,pixels)){panel.setHeat(null,null,instant);panel.setCaption('No positive heatmap for this class');return null;}panel.setLiveHeat(pixels,`immersion:${mine}:${id}:${[...scales]}`);panel.setCaption('Grad-CAM · local feature edits');return true;});applyFeatures();select(selected);}catch(e){if(imageId===mine){featureStatus=`Local features unavailable: ${e.message}. Tap Explore local features to retry.`;summary();}}finally{if(imageId===mine)engineLoad=null;}})();await engineLoad;
 }
 function applyFeatures(){if(!engine)return;const probabilities=engine.apply(scales),tree=api.assets.tree,byId=new Map(tree.nodes.map(n=>[n.id,n]));const values=new Map();
  const total=id=>{const n=byId.get(id);if(!n)return 0;if(n.isLeaf){const value=n.isOther?Math.max(0,1-[...new Set(tree.nodes.filter(n=>n.isLeaf&&!n.isOther).map(n=>n.classId))].reduce((s,id)=>s+probabilities[id],0)):probabilities[n.classId];values.set(id,value);return value;}const value=n.children.reduce((s,id)=>s+total(id),0);values.set(id,value);return value;};total(tree.rootId);
  const best=engine.argmax(),leaf=tree.nodes.find(n=>n.isLeaf&&n.classId===best),other=tree.nodes.find(n=>n.isOther);veins.setValues(values,leaf?.id??other?.id);tips.setScores(id=>probabilities[id],best);labels.setTop1(best);
  const answer=id=>{const known=tree.topK.find(a=>a.classId===id);return known?{...known,score:probabilities[id],rank:engine.ranked(1000).indexOf(id)+1}:null;};api.steerAnswer=answer;const answers=tree.topK.map(a=>answer(a.classId)).sort((a,b)=>a.rank-b.rank);api.patchState({answers,top1:answer(best)??{classId:best,label:classNames?.[best]??`Class ${best}`,score:probabilities[best],rank:1}});if(selected?.classId!=null)api.showHeatmap(selected.classId,{instant:true});persist();summary();
 }
 function command(p){if(!active||loading)return;const r=records.get(p.key)??selected;switch(p.action){case 'select':select(r);break;case 'extract':select(r);extract(r);break;case 'return':returnNode(r);break;case 'return-all':for(const n of records.values())returnNode(n);break;case 'home':api.clearFocus();api.resetView();break;case 'find':if(r){select(r);if(r.detached){inspection.cancelCamera();rig.flyTo(new THREE.Box3().setFromCenterAndSize(r.object.position,new THREE.Vector3(3,3,3)),350);}else if(r.classId!=null)api.focusTip(r.classId);else api.sceneAction({action:'inspect',part:'stem'});}break;case 'annotate':if(r){r.name=String(p.name??r.name).slice(0,80)||r.original;r.notes=String(p.notes??'').slice(0,600);r.label.paint(r.name);if(r.tip)r.tip.node.label=r.name;for(const packet of r.packets){if(packet.name!=null)packet.name=r.name;else packet.setText([r.name,`Independent score ${percent(r.tip.score)}`]);}persist();summary();}break;case 'features':features();break;case 'reset-features':scales.clear();applyFeatures();break;case 'scale':if(engine&&Number.isInteger(p.channel)&&p.channel>=0&&p.channel<2048&&Number.isFinite(p.scale)){scales.set(p.channel,Math.min(3,Math.max(0,p.scale)));applyFeatures();}break;}}
 function setActive(value){active=value;if(!active)freezeInput();}
 window.addEventListener('pagehide',persist);
 return {receive,command,setActive,records,edges,pulses,get imageId(){return imageId},get localEngine(){return engine},get selected(){return selected},project(key){const r=records.get(key);return r?projectPoint(r.detached?r.object.position:originalPosition(r)):null;},brainPoint(){tissue.parts.brain.updateWorldMatrix(true,false);return projectPoint(tissue.parts.brain.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(tissue.parts.brain.matrixWorld));}};
}
