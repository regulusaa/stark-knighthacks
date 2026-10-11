// Disposable interaction study: validates geometry ownership, connected deformation and shared easing.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createTissue,TISSUE} from '/core/brainTissue.js';
import {FOLDS} from '/core/brainTissueBuild.js';
import {layoutBrain} from '/core/brainLayout.js';
import {create as gestures} from '/ui/gestures.js';
import {fitView} from '/core/framing.js';

const canvas=document.querySelector('#scene'),pane=document.querySelector('#pane');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0x050505);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.03,120);
scene.add(new THREE.HemisphereLight(0xffffff,0x111111,2));
const light=new THREE.DirectionalLight(0xffffff,3.2);light.position.set(-5,15,12);scene.add(light);
const rim=new THREE.DirectionalLight(0xffffff,1.5);rim.position.set(8,5,-12);scene.add(rim);
TISSUE.color=0x777777;TISSUE.sheenColor=0xaaaaaa;TISSUE.alphaFace=.16;TISSUE.alphaEdge=.55;TISSUE.glowStrength=0;
const [tissue,tree,atlas]=await Promise.all([createTissue(),fetch('/assets/clean_retriever/tree.json').then(r=>r.json()),fetch('/assets/clean_retriever/atlas.json').then(r=>r.json())]);
const layout=layoutBrain(tree);
const brain=new THREE.Group(),stem=new THREE.Group();scene.add(brain,stem);
const whole=tissue.mesh.geometry,stemIndices=FOLDS.stem.rings*FOLDS.stem.sides*6,cut=whole.index.count-stemIndices;
const brainGeo=whole.clone();brainGeo.setIndex(new THREE.BufferAttribute(whole.index.array.slice(0,cut),1));
const stemGeo=whole.clone();stemGeo.setIndex(new THREE.BufferAttribute(whole.index.array.slice(cut),1));
function part(geometry,parent){
  const mesh=new THREE.Mesh(geometry,tissue.material);mesh.renderOrder=11;
  const depth=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({colorWrite:false,transparent:true}));depth.renderOrder=10;
  parent.add(mesh,depth);return mesh;
}
const brainMesh=part(brainGeo,brain),stemMesh=part(stemGeo,stem);
const pointsOf=(g)=>{const p=g.attributes.position,out=[];for(let i=0;i<g.index.count;i+=31){const j=g.index.getX(i);out.push(new THREE.Vector3(p.getX(j),p.getY(j),p.getZ(j)));}return out;};
const brainPts=pointsOf(brainGeo),stemPts=pointsOf(stemGeo);
const targets={brain:new THREE.Vector3(),stem:new THREE.Vector3()},offsets={brain:brain.position,stem:stem.position};
const units=[];
function tube(points,radius,weight,lit){
 const curve=new THREE.CatmullRomCurve3(points.map(p=>p.isVector3?p:new THREE.Vector3(...p)));
 const g=new THREE.TubeGeometry(curve,Math.max(20,Math.round(curve.getLength()*7)),radius,5,false);
 const attr=new Float32Array(g.attributes.position.count),color=new Float32Array(attr.length*3);
 for(let i=0;i<attr.length;i++){const y=g.attributes.position.getY(i);attr[i]=weight===null?THREE.MathUtils.smoothstep(y,5.8,9.25):weight;color.set([lit,lit,lit],i*3);}
 g.setAttribute('aBrain',new THREE.BufferAttribute(attr,1));g.setAttribute('color',new THREE.BufferAttribute(color,3));units.push(g);return curve;
}
for(const e of layout.edges.filter(e=>!e.isStem)) for(let k=0;k<3;k++){
 const path=e.points.map((p,i)=>{const t=i/(e.points.length-1),a=k*2.094;return [p[0]+Math.sin(Math.PI*t)*Math.cos(a)*.06,p[1],p[2]+Math.sin(Math.PI*t)*Math.sin(a)*.06];});
 tube(path,e.onTop1Path?.026:.012,1,e.onTop1Path?1:.25);
}
const core=layout.edges.find(e=>e.isStem).points.at(-1),connections=[];
for(let i=0;i<54;i++){
 const a=i*2.39996,r=.55+(i%7)*.22;
 const pts=[[Math.cos(a)*r,.3+(i%5)*.16,Math.sin(a)*r],[Math.cos(a)*r*1.2,2,Math.sin(a)*r*1.2],[Math.cos(a)*.34,5.2,Math.sin(a)*.34],[Math.cos(a)*.24,6.5,Math.sin(a)*.24],core];
 connections.push(tube(pts,i%7===0?.018:.01,null,i%7===0?.85:.38));
 stemPts.push(new THREE.Vector3(...pts[0]));
}
const geometry=mergeGeometries(units);units.forEach(g=>g.dispose());
const uniforms={uBrain:{value:brain.position},uStem:{value:stem.position},uTime:{value:0}};
const material=new THREE.ShaderMaterial({vertexColors:true,uniforms,vertexShader:`attribute float aBrain;uniform vec3 uBrain;uniform vec3 uStem;varying vec3 vColor;varying float vFlow;void main(){vColor=color;vFlow=position.y;vec3 p=position+mix(uStem,uBrain,aBrain);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,fragmentShader:`uniform float uTime;varying vec3 vColor;varying float vFlow;void main(){float p=pow(.5+.5*sin(vFlow*3.-uTime*2.8),16.);gl_FragColor=vec4(vColor*(.7+p*.8),1.);}`});
const fibers=new THREE.Mesh(geometry,material);fibers.frustumCulled=false;scene.add(fibers);
const packets=[];
function textSprite(text){
 const c=document.createElement('canvas'),g=c.getContext('2d');g.font='32px ui-monospace, monospace';
 c.width=Math.ceil(g.measureText(text).width)+24;c.height=56;g.font='32px ui-monospace, monospace';
 g.fillStyle='rgba(5,5,5,.82)';g.fillRect(0,0,c.width,c.height);g.fillStyle='#fff';g.fillText(text,12,38);
 const tex=new THREE.CanvasTexture(c),mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,depthTest:false});
 const s=new THREE.Sprite(mat);s.userData.aspect=c.width/c.height;s.renderOrder=30;scene.add(s);return s;
}
for(let i=0;i<12;i++){const layer=atlas.layers[Math.floor(i*atlas.layers.length/12)];packets.push({sprite:textSprite(`${layer.name}  ${layer.width}×${layer.height}`),curve:connections[i*4],brain:false,phase:i/12});}
for(let i=0;i<8;i++){const edge=layout.edges.filter(e=>!e.isStem)[i*3% (layout.edges.length-1)];const node=layout.nodes.get(edge.to).node;packets.push({sprite:textSprite(`${node.label??node.id} · ${(100*(node.value??0)).toFixed(1)}%`),curve:new THREE.CatmullRomCurve3(edge.points.map(p=>new THREE.Vector3(...p))),brain:true,phase:i/8});}

let selected='all',split=false,inspect=false,autoFit=true,theta=.55,phi=1.18,distance=25,target=new THREE.Vector3(0,7,0),goalTarget=target.clone(),goalDistance=25,drag=null;
const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches,clock=new THREE.Clock(),back=new THREE.Vector3(),tmp=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3();
const choose=(name)=>{selected=name;document.querySelectorAll('[data-select]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.select===name)));document.querySelector('#status').textContent=`${split?'Separated':'Assembled'} · ${name==='all'?'All':name==='brain'?'Brain':'Stem'} selected`;};
document.querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>choose(b.dataset.select));
document.querySelector('#split').onclick=()=>{split=!split;inspect=false;autoFit=true;const b=split?[-3.8,0,0]:[0,0,0],s=split?[4.8,3.2,0]:[0,0,0];targets.brain.fromArray(b);targets.stem.fromArray(s);document.querySelector('#split').textContent=split?'Join together':'Split up';choose(selected);};
document.querySelector('#inspect').onclick=()=>{inspect=true;autoFit=true;document.querySelector('#caption').textContent='Simulated signal flow · actual layer and class values';};
document.querySelector('#center').onclick=()=>{inspect=false;autoFit=true;document.querySelector('#caption').textContent='Select a part to inspect it';};
const pad=gestures(document.querySelector('#pad'),{sensitivity:1});pad.onOrbit(({dx,dy})=>{theta-=dx*Math.PI;phi=THREE.MathUtils.clamp(phi-dy*1.4,.15,2.8);});pad.onZoom(dz=>{autoFit=false;goalDistance=THREE.MathUtils.clamp(goalDistance*Math.exp(-dz),1.2,60);inspect=true;});
const dot=document.querySelector('#touch'),padEl=document.querySelector('#pad');padEl.onpointerdown=padEl.onpointermove=e=>{if(e.buttons){const r=padEl.getBoundingClientRect();dot.style.display='block';dot.style.left=`${e.clientX-r.left}px`;dot.style.top=`${e.clientY-r.top}px`;}};padEl.onpointerup=padEl.onpointercancel=()=>dot.style.display='none';
for(const h of document.querySelectorAll('[data-handle]')){
 h.onpointerdown=e=>{e.preventDefault();h.setPointerCapture(e.pointerId);drag={part:h.dataset.handle,x:e.clientX,y:e.clientY};autoFit=false;};
 h.onpointermove=e=>{if(!drag||drag.part!==h.dataset.handle)return;right.set(1,0,0).applyQuaternion(camera.quaternion);up.set(0,1,0).applyQuaternion(camera.quaternion);const k=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/pane.clientHeight;targets[drag.part].addScaledVector(right,(e.clientX-drag.x)*k).addScaledVector(up,-(e.clientY-drag.y)*k);drag.x=e.clientX;drag.y=e.clientY;};
 h.onpointerup=h.onpointercancel=()=>{drag=null;};
}
const ray=new THREE.Raycaster();canvas.onclick=e=>{const r=canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects([brainMesh,stemMesh])[0];if(hit)choose(hit.object===brainMesh?'brain':'stem');};
new ResizeObserver(()=>{renderer.setSize(pane.clientWidth,pane.clientHeight,false);camera.aspect=pane.clientWidth/pane.clientHeight;camera.updateProjectionMatrix();autoFit=true;}).observe(pane);
document.querySelector('#values').innerHTML=tree.topK.slice(0,3).map(a=>`<div class="data-row"><span>${a.label}</span><span>${(a.score*100).toFixed(1)}%</span></div>`).join('');
let time=0;renderer.setAnimationLoop(()=>{
 const dt=Math.min(clock.getDelta(),.1);if(document.hidden)return;time+=dt;uniforms.uTime.value=time;
 const k=reduced?1:1-Math.pow(.92,dt*60);brain.position.lerp(targets.brain,k);stem.position.lerp(targets.stem,k);
 back.setFromSphericalCoords(1,phi,theta);
 if(autoFit){const pts=[];if(!inspect||selected!=='stem')for(const p of brainPts)pts.push(p.clone().add(targets.brain).toArray());if(!inspect||selected!=='brain')for(const p of stemPts)pts.push(p.clone().add(targets.stem).toArray());const f=fitView(pts,{back:back.toArray(),fov:camera.fov,aspect:camera.aspect,safe:{x0:-.85,x1:.85,y0:-.84,y1:.83}});goalTarget.fromArray(f.target);goalDistance=f.radius*(inspect?.82:1);}
 target.lerp(goalTarget,k);distance+=(goalDistance-distance)*k;camera.position.copy(back).multiplyScalar(distance).add(target);camera.lookAt(target);
 const occupied=[];let count=0;
 for(const p of packets){
  const t=(time*.04+p.phase)%1;p.sprite.position.copy(p.curve.getPoint(t));
  const blend=p.brain?1:THREE.MathUtils.smoothstep(p.sprite.position.y,5.8,9.25);
  p.sprite.position.addScaledVector(stem.position,1-blend).addScaledVector(brain.position,blend);
  const d=p.sprite.position.distanceTo(camera.position),alpha=inspect?THREE.MathUtils.clamp((22-d)/8,0,1):0;
  // Constant pixel text size, with a bounded set and a projected collision check.
  const viewZ=p.sprite.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
  const px=32,worldPerPixel=2*Math.abs(viewZ)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/pane.clientHeight;
  p.sprite.scale.set(px*p.sprite.userData.aspect*worldPerPixel,px*worldPerPixel,1);
  tmp.copy(p.sprite.position).project(camera);const x=(tmp.x*.5+.5)*pane.clientWidth,y=(-tmp.y*.5+.5)*pane.clientHeight;
  const w=px*p.sprite.userData.aspect,rect={x:x-w/2,y:y-px/2,w,h:px};
  const allowed=alpha>0&&viewZ<0&&count<5&&(selected==='all'||p.brain===(selected==='brain'))&&x-w/2>12&&x+w/2<pane.clientWidth-12&&y>54&&y<pane.clientHeight-54&&!occupied.some(r=>Math.abs((r.x+r.w/2)-x)<(r.w+w)/2+12&&Math.abs((r.y+r.h/2)-y)<(r.h+px)/2+24);
  p.sprite.visible=allowed;p.sprite.material.opacity=alpha;if(allowed){occupied.push(rect);count++;}
 }
 for(const h of document.querySelectorAll('[data-handle]')){h.hidden=selected!=='all'&&selected!==h.dataset.handle;tmp.set(h.dataset.handle==='brain'?-1.2:0,h.dataset.handle==='brain'?10:4.5,0).add(offsets[h.dataset.handle]).project(camera);h.style.left=`${(tmp.x*.5+.5)*pane.clientWidth}px`;h.style.top=`${(-tmp.y*.5+.5)*pane.clientHeight}px`;}
 renderer.render(scene,camera);
});
document.querySelector('#loading').hidden=true;window.__starkReady=true;window.__study={brain,stem,targets,camera,renderer,packets,connections,get selected(){return selected},get split(){return split}};

const studyQuery=new URLSearchParams(location.search);
if(studyQuery.has('split'))document.querySelector('#split').click();
if(['brain','stem','all'].includes(studyQuery.get('part')))choose(studyQuery.get('part'));
if(studyQuery.has('inspect'))document.querySelector('#inspect').click();
window.__studySettled=false;setTimeout(()=>window.__studySettled=true,1600);
