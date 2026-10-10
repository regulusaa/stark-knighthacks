// Combined renderer/UI checks after integrating Claude's viewport framing.
// Run with the local server: node web/ui/dev/display.verify.mjs [http://localhost:3002]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.argv[2]||'http://localhost:3002';
const browser=await chromium.launch({args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const errors=[];
const display=await browser.newPage({viewport:{width:2560,height:1440}});
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())})};
watch(display);
const waitHome=async()=>{await display.waitForFunction(()=>!window.__stark.rig.moving);await display.waitForTimeout(350)};
const bounds=()=>display.evaluate(async()=>{
 const {Vector3}=await import('/vendor/three/build/three.module.js');const s=window.__stark;
 const limits={brain:[Infinity,-Infinity,Infinity,-Infinity],photo:[Infinity,-Infinity,Infinity,-Infinity]};
 const include=(out,v)=>{v.project(s.camera);out[0]=Math.min(out[0],v.x);out[1]=Math.max(out[1],v.x);out[2]=Math.min(out[2],v.y);out[3]=Math.max(out[3],v.y)};
 s.scene.updateMatrixWorld(true);const tissue=s.tissue.mesh;const a=tissue.geometry.attributes.position;
 for(let i=0;i<a.count;i+=23)include(limits.brain,new Vector3().fromBufferAttribute(a,i).applyMatrix4(tissue.matrixWorld));
 s.panel.group.traverse(o=>{if(!o.visible||!o.geometry)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)include(limits.photo,new Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld))});
 return limits;
});
const quiet=async width=>{
 assert.equal(await display.locator('.hud-compact').count(),1);
 assert.equal(await display.locator('.stark-hud header,.hud-qr,.hud-room,.hud-status,.hud-legend,.hud-focus,.hud-truth').count(),0);
 assert.equal(await display.locator('.hud-answer').evaluate(e=>getComputedStyle(e).fontSize),width<1200?'18px':'28px');
 assert.equal(await display.locator('.hud-result').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
 assert.match(await display.locator('.hud-secondary').innerText(),/^Model score \d+\.\d%$/);
 const b=await bounds();for(const [name,v]of Object.entries(b))assert.ok(v[0]>=-.99&&v[1]<=.99&&v[2]>=-.99&&v[3]<=.99,`${name} clipped: ${JSON.stringify(b)}`);
};
try {
 await display.goto(`${base}/display?image=clean_retriever&pulseAt=done`);
 await display.waitForFunction(()=>window.__starkReady&&window.__stark.relay?.room);
 for(const [width,height]of [[2560,1440],[1180,820],[390,844]]){
  await display.setViewportSize({width,height});await display.waitForTimeout(200);await quiet(width);
  const before=await display.evaluate(()=>window.__stark.rig.state.spherical.theta);
  // Drag starts inside the HUD footprint: the transparent overlay must pass it to the scene.
  await display.mouse.move(50,50);await display.mouse.down();await display.mouse.move(150,70,{steps:8});await display.mouse.up();await display.waitForTimeout(350);
  assert.ok(Math.abs(await display.evaluate(()=>window.__stark.rig.state.spherical.theta)-before)>.04);
  await display.evaluate(()=>window.__stark.api.resetView());await waitHome();await quiet(width);
  await display.screenshot({path:`web/ui/.shots/final-reset-${width}x${height}.png`});
 }
 console.log('ok initial/resize/reset framing, 18/28px two-line HUD, hidden room/QR, overlay passes dragging');
 await display.setViewportSize({width:2560,height:1440});await display.waitForTimeout(200);
 const ids=await display.evaluate(()=>window.__stark.api.manifest.map(m=>m.id));
 for(const id of ids){
  await display.evaluate(async id=>{const s=window.__stark;await s.api.loadImage(id,{autoplay:false});s.api.jumpToEnd()},id);
  await display.waitForTimeout(1000);await quiet(2560);
  await display.screenshot({path:`web/ui/.shots/final-gallery-${id}-2560x1440.png`});
 }
 console.log(`ok ${ids.length} gallery images retain full brain/photo and quiet HUD`);
 await display.evaluate(async()=>{await window.__stark.api.loadImage('clean_retriever',{autoplay:false});window.__stark.api.jumpToEnd()});
 const room=await display.evaluate(()=>window.__stark.relay.room);
 const guest=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});watch(guest);
 await guest.goto(`${base}/controller?room=${room}`);await guest.waitForSelector('#app[data-state="guest-viewing"]');
 await guest.locator('#take-control-center').tap();await guest.waitForSelector('#app[data-state="guest-driving"]');
 const initial=await display.evaluate(()=>({theta:window.__stark.rig.state.spherical.theta,radius:window.__stark.rig.state.spherical.radius}));
 const cdp=await guest.context().newCDPSession(guest);const b=await guest.locator('#trackpad').boundingBox();
 const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
 await touch('touchStart',[{x:b.x+60,y:b.y+100,id:1}]);
 for(let i=1;i<=12;i++){await touch('touchMove',[{x:b.x+60+i*12,y:b.y+100,id:1}]);await guest.waitForTimeout(25)}await touch('touchEnd',[]);await display.waitForTimeout(400);
 assert.ok(Math.abs(await display.evaluate(()=>window.__stark.rig.state.spherical.theta)-initial.theta)>.2);
 const cx=b.x+b.width/2,cy=b.y+b.height/2;const pts=d=>[{x:cx-d/2,y:cy,id:1},{x:cx+d/2,y:cy,id:2}];
 await touch('touchStart',pts(70));for(let i=1;i<=8;i++){await touch('touchMove',pts(70+i*10));await guest.waitForTimeout(30)}await touch('touchEnd',[]);await display.waitForTimeout(400);
 assert.ok(await display.evaluate(()=>window.__stark.rig.state.spherical.radius)<initial.radius-.2);
 await guest.locator('#answer-list [data-class-id="208"]').tap();
 await display.waitForFunction(()=>window.__stark.api.state.focus?.classId===208&&window.__stark.panel.heatClass===208);await waitHome();
 await display.screenshot({path:'web/ui/.shots/final-focused-2560x1440.png'});
 await guest.locator('#reset-view').tap();await waitHome();await quiet(2560);
 console.log('ok real phone-sized controller: takeover, touch orbit, pinch, focus/heatmap and reset through Socket.io');
 const longLabel=await display.evaluate(async()=>{
  const {mountHud}=await import('/ui/hud.js');const s=window.__stark.api.state;
  const host=document.createElement('div');document.body.append(host);
  const mounted=mountHud(host,{onState(cb){cb({...s,top1:{...s.top1,label:'A very long answer label '.repeat(12)}})},onFocus(cb){cb(null)}});
  const el=host.querySelector('.hud-result');const result={height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),overflow:el.scrollWidth>el.clientWidth};
  mounted.destroy();host.remove();return result;
 });assert.ok(longLabel.height<=longLabel.line*2+1&&!longLabel.overflow);
 await guest.close();assert.deepEqual(errors,[]);console.log('ok long labels remain two lines; no console/page errors');
} finally {await browser.close()}
