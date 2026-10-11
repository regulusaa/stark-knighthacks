// Moving labels illustrate flow; their values come from the current image's saved outputs.
// Medical images have no layer atlas: carry their independent findings instead of inventing activations.
import * as THREE from 'three';
import { STEM_AXIS } from './brainShape.js';
export function createSignalActivity({ scene, camera, inspection, veins, labels }) {
  let packets = [], token = 0, imageId = null, lastTextTime = -Infinity, caption = '';
  const hud=document.getElementById('hud');
  const point = new THREE.Vector3(), projected = new THREE.Vector3(), camPoint = new THREE.Vector3();
  const occupied = [];
  const percent = score => score > 0 && score < .001 ? '<0.1%' : `${(score*100).toFixed(1)}%`;
  function dispose() {
    for (const p of packets) { scene.remove(p.sprite); p.sprite.material.map.dispose(); p.sprite.material.dispose(); }
    packets = [];
  }
  function label(lines, reserveLines = []) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font='500 26px system-ui, sans-serif';const firstWidth=g.measureText(lines[0]).width;
    g.font='400 22px ui-monospace, monospace';const secondWidth=Math.max(...[lines[1]??'',...reserveLines].map(t=>g.measureText(t).width));
    c.width=Math.ceil(Math.max(firstWidth,secondWidth))+24;c.height=76;
    // Canvas textures keep fixed dimensions once uploaded to the GPU.
    const paint = lines => {
      g.fillStyle = 'rgba(5,5,5,.88)'; g.fillRect(0,0,c.width,c.height);
      g.font = '500 26px system-ui, sans-serif'; g.fillStyle = '#fff'; g.fillText(lines[0],12,30);
      g.font = '400 22px ui-monospace, monospace'; g.fillStyle = '#ccc'; g.fillText(lines[1] ?? '',12,60);
    };
    paint(lines);
    const tex = new THREE.CanvasTexture(c); tex.minFilter=THREE.LinearFilter; tex.generateMipmaps=false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,fog:false}));
    sprite.renderOrder=32; sprite.visible=false; scene.add(sprite);
    return {sprite,text:lines.join(' · '),aspect:c.width/c.height,setText(next){const text=next.join(' · ');if(text===this.text)return;this.text=text;paint(next);tex.needsUpdate=true;this.aspect=c.width/c.height;}};
  }
  async function build(layout, assets) {
    const mine=++token; dispose(); imageId=assets.entry.id; lastTextTime=-Infinity;
    const medical=assets.tree.scoreKind==='independent';
    caption=medical?'Illustrative flow · saved independent findings · no layer atlas':'Illustrative flow · saved layer activations and current model scores';
    const edges=layout.edges.filter(e=>!e.isStem&&!e.isOther&&layout.nodes.get(e.to).isLeaf), n=Math.min(24,edges.length);
    for(let i=0;i<n;i++){
      const edge=edges[Math.floor(i*edges.length/n)], node=layout.nodes.get(edge.to).node;
      const name=node.label??node.id, kind=medical?'Independent score':'Model score';
      const score=veins.valueOf(node.id)??node.value??0;
      packets.push({...label([name,`${kind} ${percent(score)}`],[`${kind} 100.0%`]),part:'brain',nodeId:node.id,name,independent:medical,
        curve:new THREE.CatmullRomCurve3(edge.points.map(p=>new THREE.Vector3(...p))),phase:i/n});
    }
    const axis=STEM_AXIS.slice().reverse().map(p=>new THREE.Vector3(...p));
    if(medical){
      const answers=assets.tree.topK;
      for(let i=0;i<answers.length;i++){
        const a=answers[i];
        packets.push({...label([`Finding ${a.rank??i+1} · ${a.label}`,`Independent score ${(a.score*100).toFixed(1)}%`]),part:'stem',phase:i/answers.length,
          curve:new THREE.CatmullRomCurve3(axis)});
      }
      return;
    }
    if(!assets.entry.files?.atlas)return;
    try {
      const [res,bytes]=await Promise.all([fetch(assets.base+'atlas.json'),fetch(assets.base+'atlas.bin')]);
      if(!res.ok||!bytes.ok)return;
      const atlas=await res.json(), bin=new Uint8Array(await bytes.arrayBuffer());if(mine!==token)return;
      for(let i=0;i<atlas.layers.length;i++){
        const layer=atlas.layers[i], data=bin.subarray(layer.offset,layer.offset+layer.length);
        let sum=0, peak=0;for(let j=0;j<data.length;j++){sum+=data[j];if(data[j]>data[peak])peak=j;}
        const name=layer.name.replace('_block',' b').replace('_relu','').replace('_out',' out');
        const details=[`Peak activation ${layer.maxRaw.toFixed(2)}`,`Mean activation ${(sum/data.length*layer.maxRaw/255).toFixed(2)}`,`${layer.width}×${layer.height} grid · peak at ${peak%layer.width},${Math.floor(peak/layer.width)}`];
        packets.push({...label([name,details[i%3]],details),part:'stem',phase:i/atlas.layers.length,details,name,index:i,
          curve:new THREE.CatmullRomCurve3(axis)});
      }
    } catch { /* The scene remains usable without an atlas. */ }
  }
  return {
    build,dispose,get packets(){return packets},get imageId(){return imageId},get caption(){return caption},
    update(time,width,height) {
      occupied.length=0;let count=0;
      const reserve=r=>occupied.push({x:(r[0]+r[2])/2,y:(r[1]+r[3])/2,w:r[2]-r[0],h:r[3]-r[1]});
      // Answer labels sit just above their bright tip; protect the tip halo too.
      for(const l of labels?.list??[])if(l.sprite.visible&&l.rect){
        const r=l.rect;reserve([r[0]-20,r[1]-12,r[2]+20,r[3]+50]);
      }
      for(const el of document.querySelectorAll('.part-handle:not([hidden])')){
        if(!el.getClientRects().length)continue;
        const r=el.getBoundingClientRect();reserve([r.left-12,r.top-12,r.right+12,r.bottom+12]);
      }
      for(const el of hud?.querySelectorAll('.hud-result,.hud-medical,.hud-focus')??[]){
        if(el.getAttribute('aria-hidden')==='true'||!el.getClientRects().length)continue;
        const r=el.getBoundingClientRect();reserve([r.left,r.top,r.right,r.bottom]);
      }
      const detailed=inspection.detail, selection=inspection.selected;
      const px=detailed?(width>=1400?58:42):(width>=1400?46:34), max=width<500?3:detailed?7:4;
      const refresh=time-lastTextTime>=.25;if(refresh)lastTextTime=time;
      for(const p of packets)p.sprite.visible=false;
      // Rotate priority, so overlapping tracks reveal different actual values over time.
      const offset=Math.floor(time/3)%Math.max(1,packets.length);
      for(let i=0;i<packets.length;i++){
        const p=packets[(i+offset)%packets.length];
        if(selection!=='all'&&selection!==p.part)continue;
        p.curve.getPoint((time*.06+p.phase)%1,point);point.add(inspection.groups[p.part].position);
        if(refresh&&p.part==='brain'){
          const score=veins.valueOf(p.nodeId);
          if(score!==null)p.setText([p.name,`${p.independent?'Independent score':'Model score'} ${percent(score)}`]);
        } else if(refresh&&p.details)p.setText([p.name,p.details[(Math.floor(time/6)+p.index)%p.details.length]]);
        if(count>=max)continue;
        camPoint.copy(point).applyMatrix4(camera.matrixWorldInverse);if(camPoint.z>=-.1)continue;
        projected.copy(point).project(camera);if(projected.z>1||projected.z< -1)continue;
        const x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height,w=px*p.aspect;
        if(x-w/2<12||x+w/2>width-12||y<72||y>height-90)continue;
        if(occupied.some(r=>Math.abs(r.x-x)<(r.w+w)/2+12&&Math.abs(r.y-y)<((r.h??px)+px)/2+16))continue;
        occupied.push({x,y,w,h:px});count++;
        const k=2*Math.abs(camPoint.z)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/height;
        p.sprite.position.copy(point);p.sprite.scale.set(w*k,px*k,1);p.sprite.material.opacity=detailed?1:.8;p.sprite.visible=true;
      }
      return count;
    },
  };
}
