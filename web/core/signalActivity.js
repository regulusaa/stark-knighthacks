// Illustrative signal flow carrying real loaded layer metadata and current branch scores.
// Bounded readable labels, shared by display and preview. No sentences claiming hidden reasoning.
import * as THREE from 'three';
import { STEM_AXIS } from './brainShape.js';

export function createSignalActivity({ scene, camera, inspection, veins }) {
  let packets = [], token = 0, imageId = null, lastTextTime = -Infinity;
  const point = new THREE.Vector3(), projected = new THREE.Vector3(), camPoint = new THREE.Vector3();
  const occupied = [];
  function dispose() {
    for (const p of packets) { scene.remove(p.sprite); p.sprite.material.map.dispose(); p.sprite.material.dispose(); }
    packets = [];
  }
  function label(text) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    const paint = text => {
      g.font = '500 32px ui-monospace, monospace'; c.width = Math.ceil(g.measureText(text).width)+24; c.height=56;
      g.font='500 32px ui-monospace, monospace'; g.fillStyle='rgba(5,5,5,.84)';g.fillRect(0,0,c.width,c.height);
      g.fillStyle='#fff';g.fillText(text,12,38);
    };
    paint(text);
    const tex = new THREE.CanvasTexture(c);tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,fog:false}));
    sprite.renderOrder=32;sprite.visible=false;scene.add(sprite);
    return {sprite,text,aspect:c.width/c.height,setText(next){if(next===this.text)return;this.text=next;paint(next);tex.needsUpdate=true;this.aspect=c.width/c.height;}};
  }
  async function build(layout, assets) {
    const mine=++token;dispose();imageId=assets.entry.id;
    const edges=layout.edges.filter(e=>!e.isStem&&!e.isOther);
    // Spread packets among categories and leaves; values are refreshed from the actual animated edge values.
    for(let i=0;i<Math.min(12,edges.length);i++){
      const edge=edges[Math.floor(i*edges.length/Math.min(12,edges.length))],node=layout.nodes.get(edge.to).node;
      const p=label(node.label??node.id);
      packets.push({...p,part:'brain',nodeId:node.id,name:node.label??node.id,
        curve:new THREE.CatmullRomCurve3(edge.points.map(p=>new THREE.Vector3(...p))),phase:i/12});
    }
    if(!assets.entry.files?.atlas)return;
    try {
      const res=await fetch(assets.base+'atlas.json');if(!res.ok)return;const atlas=await res.json();
      if(mine!==token)return;
      const axis=STEM_AXIS.slice().reverse().map(p=>new THREE.Vector3(...p));
      for(let i=0;i<12;i++){
        const layer=atlas.layers[Math.floor(i*atlas.layers.length/12)];if(!layer)continue;
        packets.push({...label(`${layer.name} · ${layer.width}×${layer.height}`),part:'stem',phase:i/12,
          curve:new THREE.CatmullRomCurve3(axis)});
      }
    } catch { /* Anatomy still works if activity metadata is unavailable. */ }
  }
  return {
    build,dispose,get packets(){return packets},get imageId(){return imageId},
    update(time,width,height) {
      occupied.length=0;let count=0;
      if(!inspection.detail){for(const p of packets)p.sprite.visible=false;return 0;}
      const selection=inspection.selected, px=width>=1400?42:32;
      const refreshText=time-lastTextTime>=.2;if(refreshText)lastTextTime=time;
      for(const p of packets){
        p.sprite.visible=false;
        if(selection!=='all'&&selection!==p.part)continue;
        p.curve.getPoint((time*.035+p.phase)%1,point);
        point.add(inspection.groups[p.part].position);
        if(p.part==='brain'&&refreshText){
          const score=veins.valueOf(p.nodeId);
          if(score!==null)p.setText(`${p.name} · model score ${(score*100).toFixed(1)}%`);
        }
        const distance=point.distanceTo(camera.position);
        const alpha=inspection.view==='brain'||inspection.view==='stem'?1:THREE.MathUtils.clamp((24-distance)/8,0,1);
        if(alpha<.05||count>=5)continue;
        camPoint.copy(point).applyMatrix4(camera.matrixWorldInverse);if(camPoint.z>=-.1)continue;
        projected.copy(point).project(camera);
        const x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height,w=px*p.aspect;
        if(x-w/2<16||x+w/2>width-16||y<64||y>height-64)continue;
        if(occupied.some(r=>Math.abs(r.x-x)<(r.w+w)/2+16&&Math.abs(r.y-y)<px+20))continue;
        occupied.push({x,y,w});count++;
        const k=2*Math.abs(camPoint.z)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/height;
        p.sprite.position.copy(point);p.sprite.scale.set(w*k,px*k,1);p.sprite.material.opacity=alpha;p.sprite.visible=true;
      }
      return count;
    },
  };
}
