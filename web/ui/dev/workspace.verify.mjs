import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.BASE??'http://localhost:3004';
const browser=await chromium.launch({args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const errors=[];
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});};
try {
 const d=await browser.newPage({viewport:{width:1920,height:1080}});watch(d);
 await d.goto(base+'/display?image=clean_retriever&pulseAt=done&t=4');
 await d.waitForFunction(()=>window.__starkReady&&window.__stark.relay?.room,null,{timeout:45000});
 const room=await d.evaluate(()=>window.__stark.relay.room);
 const h=await browser.newPage({viewport:{width:1180,height:820}});watch(h);
 await h.goto(`${base}/controller?room=${room}&role=host&key=test`);
 await h.waitForFunction(()=>window.__inspectionControllerReady,null,{timeout:45000});
 assert.equal(await h.locator('iframe,canvas').count(),0,'controller has no second display');
 assert.equal(await h.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('/vendor/three/')||r.name.includes('/core/'))),false,'controller downloads no renderer');
 assert.equal(await h.locator('#modify-workspace').isVisible(),true);
 assert.equal(await h.locator('#usage-workspace').isVisible(),false);
 const tabY=await h.locator('.workspace-tabs').evaluate(e=>e.getBoundingClientRect().y);
 await h.locator('#modify-workspace').evaluate(e=>e.scrollTop=e.scrollHeight);
 assert.equal(await h.locator('.workspace-tabs').evaluate(e=>e.getBoundingClientRect().y),tabY);
 await h.locator('[data-workspace="usage"]').click();
 for(const selector of ['#inspection-controls','#playback-panel','#modes-panel','.sensitivity-control'])assert.equal(await h.locator(selector).isVisible(),true);
 for(const part of ['brain','stem','all']){
  await h.locator(`#scene-pane [data-part="${part}"]`).click();
  await d.waitForFunction(p=>window.__stark.api.state.scene.selected===p,part);
  await h.waitForFunction(p=>document.querySelector(`#scene-pane [data-part="${p}"]`).getAttribute('aria-pressed')==='true',part);
 }
 assert.equal(await h.locator('#scene-pane img').count(),3);
 await h.waitForFunction(()=>[...document.querySelectorAll('#scene-pane img')].every(e=>e.complete&&e.naturalWidth>0));
 await h.screenshot({path:'web/ui/.shots/workspace-usage-ipad.png'});
 await h.locator('[data-workspace="modify"]').click();
 await h.locator('.demo-tutorial summary').click();await h.locator('.demo-tutorial').scrollIntoViewIfNeeded();
 assert.match(await h.locator('.demo-tutorial').innerText(),/channel\[956\] = 0/);
 await h.screenshot({path:'web/ui/.shots/workspace-tutorial-ipad.png'});
 // The walkthrough invokes the production DSL and the real display model.
 const parsed=await d.evaluate(async()=>{const {parse}=await import('/contract/steer-dsl.js');return parse('channel[956] = 0');});assert.equal(parsed.ok,true);
 await d.evaluate(()=>window.__stark.api.loadImage('ambig_cat'));
 await d.waitForFunction(()=>window.__stark.steer.session.ready);
 await h.waitForFunction(()=>document.getElementById('image-name').textContent==='Tabby cat');
 await h.locator('[data-panel="steer"]').click();await h.locator('[data-input-mode="code"]').click();
 await h.locator('textarea').fill('channel[956] = 0');await h.waitForTimeout(200);
 await h.locator('.steer-run').click();await d.waitForFunction(()=>window.__stark.api.state.top1.label==='tiger cat');
 await h.locator('.steer-reset').click();await d.waitForFunction(()=>window.__stark.api.state.top1.label==='tabby');
 console.log('tabs, SVG selection, real tutorial flip and Reset passed');
 const measurements=[];
 for(const image of await d.evaluate(()=>window.__stark.api.manifest.map(m=>m.id))){
  await d.evaluate(async id=>{const s=window.__stark;await s.api.loadImage(id,{autoplay:false});s.api.jumpToEnd();s.veins.setRevealed();s.api.setMode({mode:'normal'});},image);
  await d.waitForFunction(id=>{const a=window.__stark.activity;return a.imageId===id&&a.packets.some(p=>p.part==='stem')},image);
  const values=await d.evaluate(()=>({brain:window.__stark.activity.packets.filter(p=>p.part==='brain').length,stem:window.__stark.activity.packets.filter(p=>p.part==='stem').length,caption:window.__stark.activity.caption,examples:window.__stark.activity.packets.filter(p=>p.part==='stem').slice(0,3).map(p=>p.text)}));
  assert.ok(values.brain>=6&&values.stem>=10);
  if(image.startsWith('med_'))assert.match(values.caption,/no layer atlas/);else assert.match(values.examples[0],/activation|grid/);
  for(const part of ['brain','stem']){
   await d.evaluate(part=>window.__stark.api.sceneAction({action:'inspect',part}),part);await d.waitForTimeout(1400);
   const visible=await d.evaluate(part=>window.__stark.activity.packets.filter(p=>p.part===part&&p.sprite.visible).length,part);
   assert.ok(visible>=1,`${image} ${part} activity is visible`);
   await d.screenshot({path:`web/ui/.shots/workspace-${image}-${part}.png`});
  }
  measurements.push({image,...values});
 }
 console.log('all nine images have brain + stem activity',JSON.stringify(measurements));
 await d.evaluate(async()=>{const s=window.__stark;await s.api.loadImage('clean_retriever',{autoplay:false});s.api.jumpToEnd();s.veins.setRevealed();s.inspection.center();});await d.waitForTimeout(1600);
 // Measure real canvas differences with the scene frozen, so animation cannot fake a Glow result.
 const pixels=await d.evaluate(()=>{
  const s=window.__stark;s.renderer.setAnimationLoop(null);const gl=s.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
  const capture=()=>{const a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
  s.api.setMode({bloom:false});s.glow.render(0);const off=capture();s.api.setMode({bloom:true});s.glow.render(0);const on=capture();
  let changed=0,total=0;for(let i=0;i<on.length;i+=4){const delta=Math.abs(on[i]-off[i])+Math.abs(on[i+1]-off[i+1])+Math.abs(on[i+2]-off[i+2]);if(delta>3)changed++;total+=delta;}
  return {changed,total};
 });assert.ok(pixels.changed>1000,'Glow visibly changes lit paths');console.log('Glow pixel comparison',pixels);

 await d.screenshot({path:'web/ui/.shots/workspace-glow-on.png'});
 await h.locator('[data-workspace="usage"]').click();await h.locator('[data-mode-field="bloom"]').click();
 await d.waitForFunction(()=>window.__stark.glow.on===false);
 await d.screenshot({path:'web/ui/.shots/workspace-glow-off.png'});
 console.log('host Glow confirms and updates display');
 for(const [width,height] of [[1180,820],[844,390],[390,844],[320,667]]){
  await h.setViewportSize({width,height});await h.waitForTimeout(300);
  for(const tab of ['modify','usage']){
   await h.locator(`[data-workspace="${tab}"]`).click();
   assert.equal(await h.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await h.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
   assert.equal(await h.locator('#side-panel').evaluate(e=>e.scrollTop),0);
   const pad=await h.locator('#trackpad').boundingBox();assert.ok(pad.height>=height*.65,'pad fills controller height');
   const parts=await h.locator('#scene-pane [data-part]').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}));
   assert.equal(parts.length,3);assert.ok(parts.every(r=>r.w>=48&&r.h>=48));assert.ok(parts[0].y<parts[1].y&&parts[1].y<parts[2].y&&parts.every(r=>r.x===parts[0].x));
   assert.equal(await h.locator('iframe,canvas').count(),0);
   const targets=await h.locator('.workspace-tabs button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert.ok(targets.every(h=>h>=48));
   await h.screenshot({path:`web/ui/.shots/workspace-${tab}-${width}x${height}.png`});
  }
 }
 assert.deepEqual(errors,[]);console.log('workspace: all checks passed; no console errors');
}finally{await browser.close();}
