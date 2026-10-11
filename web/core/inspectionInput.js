import * as THREE from 'three';

export function mountInspectionInput({ canvas, camera, inspection, tissue, onAction, preview = false }) {
  const layer=document.createElement('div');layer.className='inspection-overlay';
  layer.innerHTML=`<button class="part-handle" data-part="brain" aria-label="Move brain">＋</button><button class="part-handle" data-part="stem" aria-label="Move stem">＋</button><p class="activity-note" hidden>Simulated signal flow · actual layer and model values</p>`;
  document.body.append(layer);
  const handles=[...layer.querySelectorAll('.part-handle')],note=layer.querySelector('.activity-note');
  let enabled=!preview,drag=null,pending=null,lastSent=-Infinity,timer=0,down=null;
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),pos=new THREE.Vector3();
  const toolbar=document.createElement('div');toolbar.className='inspection-toolbar';
  if(!preview){toolbar.innerHTML=`<button data-selection="brain">Brain</button><button data-selection="stem">Stem</button><button data-selection="all">All</button><span></span><button data-arrange>Split up</button><button data-inspect>Inspect</button><button data-center>Center</button>`;document.body.append(toolbar);
    toolbar.querySelectorAll('[data-selection]').forEach(b=>b.onclick=()=>onAction({action:'select',part:b.dataset.selection}));
    toolbar.querySelector('[data-arrange]').onclick=()=>onAction({action:inspection.arrangement==='joined'?'split':'join'});
    toolbar.querySelector('[data-inspect]').onclick=()=>onAction({action:'inspect',part:inspection.selected});
    toolbar.querySelector('[data-center]').onclick=()=>onAction({action:'center'});
  }
  function flush(){clearTimeout(timer);timer=0;if(!pending||!enabled||document.hidden)return;const p=pending;pending=null;lastSent=performance.now();onAction(p);}
  function sendMove(p){pending=p;const wait=1000/30-(performance.now()-lastSent);if(wait<=0)flush();else if(!timer)timer=setTimeout(flush,wait);}
  function cancel(){pending=null;clearTimeout(timer);timer=0;if(drag){const d=drag;drag=null;if(d.el.hasPointerCapture(d.id))d.el.releasePointerCapture(d.id);}}
  for(const h of handles){
    h.onpointerdown=e=>{
      if(!enabled||drag||document.hidden)return;e.preventDefault();h.setPointerCapture(e.pointerId);
      pos.copy(inspection.handlePosition(h.dataset.part)).applyMatrix4(camera.matrixWorldInverse);
      drag={id:e.pointerId,el:h,part:h.dataset.part,x:e.clientX,y:e.clientY,base:inspection.targets[h.dataset.part].clone(),
        right:new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up:new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),
        unit:2*Math.abs(pos.z)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/canvas.clientHeight};
    };
    h.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();const d=drag;
      const p=d.base.clone().addScaledVector(d.right,(e.clientX-d.x)*d.unit).addScaledVector(d.up,-(e.clientY-d.y)*d.unit);
      sendMove({action:'move',part:d.part,position:p.toArray()});
    };
    h.onpointerup=e=>{if(drag?.id!==e.pointerId)return;drag=null;if(pending&&!timer)flush();};
    h.onpointercancel=cancel;h.onlostpointercapture=()=>{if(drag?.el===h)cancel();};
    h.onkeydown=e=>{const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(!enabled||!dirs[e.key])return;e.preventDefault();
      const [x,y]=dirs[e.key],p=inspection.targets[h.dataset.part].clone();p.add(new THREE.Vector3(x,y,0).applyQuaternion(camera.quaternion).multiplyScalar(.25));onAction({action:'move',part:h.dataset.part,position:p.toArray()});};
  }
  canvas.addEventListener('pointerdown',e=>{if(!e.isPrimary){down=null;return;}down={id:e.pointerId,x:e.clientX,y:e.clientY};},true);
  canvas.addEventListener('pointercancel',()=>down=null,true);
  canvas.addEventListener('pointerup',e=>{
    const d=down;down=null;if(!enabled||!d||d.id!==e.pointerId||Math.hypot(e.clientX-d.x,e.clientY-d.y)>5)return;
    const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(ndc,camera);
    const hit=ray.intersectObjects([tissue.parts.brain,tissue.parts.stem],false)[0];if(!hit)return;
    const part=hit.object===tissue.parts.brain?'brain':'stem';
    if(!preview&&part==='brain'&&inspection.selected==='brain')return;
    e.stopImmediatePropagation();onAction({action:'select',part});
  },true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});window.addEventListener('orientationchange',cancel);window.addEventListener('blur',cancel);
  return {
    cancel,
    setEnabled(v){enabled=Boolean(v);if(!enabled)cancel();},
    update(activityCount=0, caption){
      const r=canvas.getBoundingClientRect();
      for(const h of handles){
        pos.copy(inspection.handlePosition(h.dataset.part)).project(camera);
        h.hidden=!enabled||(inspection.selected!=='all'&&inspection.selected!==h.dataset.part)||pos.z>1||Math.abs(pos.x)>.96||Math.abs(pos.y)>.96;
        h.style.left=`${r.left+(pos.x*.5+.5)*r.width}px`;h.style.top=`${r.top+(-pos.y*.5+.5)*r.height}px`;
      }
      note.hidden=!activityCount; if(caption)note.textContent=caption;
      if(!preview){toolbar.querySelectorAll('[data-selection]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.selection===inspection.selected)));toolbar.querySelector('[data-arrange]').textContent=inspection.arrangement==='joined'?'Split up':'Join together';}
    },
  };
}
