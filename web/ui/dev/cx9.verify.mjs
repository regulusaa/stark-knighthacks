import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.argv[2]||'http://localhost:3002';
const browser=await chromium.launch();
const errors=[];
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const open=async(role='guest')=>{await page.goto(`${base}/controller?room=7KQ2M&mock=1&v3=1&scene=idle&role=${role}&key=test`);await page.waitForFunction(()=>window.__starkReady)};
const log=()=>page.evaluate(()=>window.__v3Mock.log);
const active=async beat=>page.waitForFunction(id=>document.querySelector(`[data-demo-beat="${id}"]`).getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-demo-beat][aria-busy="true"]'),beat);
const overflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
try{
await open();
assert.equal(await page.locator('.first-visit').count(),1);
assert.equal(await page.locator('button:visible').count(),1);
assert.equal(await page.locator('#first-drive-help').innerText(),'Drag to turn · pinch to zoom · tap an answer · Steer to edit the model');
for(const [width,height]of[[320,667],[390,844],[844,390]]){await page.setViewportSize({width,height});await overflow();const b=await page.locator('#take-control-center').boundingBox();assert.ok(b.width>=48&&b.height>=64)}
await page.setViewportSize({width:390,height:844});
await page.locator('#take-control-center').tap();await page.waitForSelector('#app[data-state="guest-driving"]');
assert.equal(await page.locator('.first-visit').count(),0);
await page.reload();await page.waitForFunction(()=>window.__starkReady);
assert.equal(await page.locator('.first-visit').count(),0);assert.equal(await page.locator('#first-drive-help').isVisible(),false);
console.log('ok first visit has one large control, exact wrapping copy, session suppression and 320px/landscape bounds');
await page.goto(`${base}/controller?room=7KQ2M&mock=1&scene=waiting-for-display`);await page.waitForFunction(()=>window.__starkReady);
assert.equal(await page.locator('#app').getAttribute('data-state'),'waiting-for-display');assert.equal(await page.locator('#state-title').innerText(),'Waiting for the screen…');assert.equal(await page.locator('#retry-button').isVisible(),false);
console.log('ok connected waiting screen is calm, animated and has no error');
await page.setViewportSize({width:1180,height:820});await open('host');
const setups=[['retriever','clean_retriever','normal'],['handover','clean_retriever','normal'],['stability','clean_retriever','stability'],['adversarial','adv_retriever','normal'],['xray','med_xray_pneumonia','normal'],['steer','ambig_cat','normal'],['close','clean_retriever','normal']];
for(const [beat,imageId,mode]of setups){
  const start=(await log()).length;await page.locator(`[data-demo-beat="${beat}"]`).click();await active(beat);await page.waitForTimeout(400);
  const emits=(await log()).slice(start).map(e=>[e.event,e.payload]);
  assert.deepEqual(emits,[...(beat==='stability'?[]:[['select-image',{imageId}]]),['set-mode',{mode}],...(beat==='close'?[['reset-view',{}]]:[])]);
  const rail=await page.locator('#demo-rail').boundingBox();assert.ok(rail.y>=0&&rail.y+rail.height<820);
  const current=await page.locator(`[data-demo-beat="${beat}"]`).boundingBox();const strip=await page.locator('.demo-beats').boundingBox();assert.ok(current.x>=strip.x-2&&current.x+current.width<=strip.x+strip.width+2);
  await overflow();
}
console.log('ok Stability keeps the selected image; other beats emit image then mode; rail stays visible; Close resets view');
await page.locator('.demo-cue-toggle').click();assert.equal(await page.locator('.demo-cue').isVisible(),false);await page.locator('.demo-cue-toggle').click();assert.equal(await page.locator('.demo-cue').isVisible(),true);
const reset=page.locator('.demo-reset');const b=await reset.boundingBox();
let start=(await log()).length;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(450);
const fill=await page.locator('.demo-hold-ring').evaluate(e=>Number(e.style.getPropertyValue('--hold')));assert.ok(fill>.3&&fill<.8);await page.mouse.up();await page.waitForTimeout(200);assert.equal((await log()).length,start);
await page.mouse.down();await page.waitForTimeout(1200);await page.mouse.up();await active('retriever');await page.waitForTimeout(500);
assert.deepEqual((await log()).slice(start).map(e=>[e.event,e.payload]),[['select-image',{imageId:'clean_retriever'}],['set-mode',{mode:'normal'}],['steer-reset',{}],['reset-view',{}]]);
await reset.click();await page.waitForTimeout(1100);assert.equal((await log()).length,start+4);
console.log('ok partial hold cancels, ring fills, 1s hold emits exactly four reset events and clicks never reset');
await page.locator('[data-demo-beat="steer"]').click();await active('steer');await page.waitForSelector('.steer-row input');
const input=page.locator('.steer-row input').first();await input.evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(140);
assert.equal((await page.evaluate(()=>window.__v3Mock.state)).top1.classId,282);
console.log('ok synthetic cat beat flips after one channel; production metadata selection is tested separately');
start=(await log()).length;
await page.evaluate(()=>{
 Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));
 const input=document.querySelector('.steer-row input');input.value='.4';input.dispatchEvent(new Event('input',{bubbles:true}));
 document.querySelector('[data-mode-field="bloom"]').click();
});await page.waitForTimeout(250);assert.equal((await log()).length,start);
await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))});await input.evaluate(e=>{e.value='.5';e.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(140);assert.ok((await log()).length>start);
console.log('ok hidden tab drops control events/cancels work, then sends fresh input on return');
await page.evaluate(()=>window.__v3Mock.setConnection(false));await page.waitForTimeout(120);assert.equal(await page.locator('[data-demo-beat][aria-busy="true"]').count(),0);
await page.evaluate(()=>window.__v3Mock.setConnection(true));await page.waitForSelector('#app[data-state="host"]');
for(const [width,height]of[[320,667],[390,844],[820,1180],[1180,820],[844,390]]){
 await page.setViewportSize({width,height});await overflow();
 const small=await page.locator('button:visible,input[type="range"]:visible').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect();return r.width<48||r.height<48}).map(e=>({text:e.textContent.trim(),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
 assert.deepEqual(small,[],`targets at ${width}×${height}`);
}
console.log('ok reconnect keeps controller usable; all visible targets ≥48px and no overflow across five layouts');
await page.setViewportSize({width:390,height:844});await open();await page.locator('#take-control-center').tap();await page.waitForSelector('#app[data-state="guest-driving"]');
const cdp=await page.context().newCDPSession(page);const pad=await page.locator('#trackpad').boundingBox();const initialY=await page.evaluate(()=>scrollY);
const touch=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
await touch('touchStart',[{x:pad.x+30,y:pad.y+80,id:1}]);await touch('touchMove',[{x:pad.x+100,y:pad.y+110,id:1}]);await page.waitForTimeout(90);
await touch('touchStart',[{x:pad.x+100,y:pad.y+110,id:1},{x:pad.x+190,y:pad.y+180,id:2},{x:pad.x+240,y:pad.y+230,id:3}]);
await touch('touchMove',[{x:pad.x+70,y:pad.y+90,id:1},{x:pad.x+230,y:pad.y+210,id:2},{x:pad.x+245,y:pad.y+230,id:3}]);await page.waitForTimeout(90);await touch('touchEnd',[]);
assert.ok((await log()).some(e=>e.event==='control-orbit'));assert.ok((await log()).some(e=>e.event==='control-zoom'));assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert.equal(await page.evaluate(()=>scrollY),initialY);
await touch('touchStart',[{x:pad.x+50,y:pad.y+70,id:1}]);await page.setViewportSize({width:844,height:390});await touch('touchEnd',[]);await page.waitForTimeout(90);
assert.equal(await page.locator('.touch-indicator:visible').count(),0);
const next=await page.locator('#trackpad').boundingBox();start=(await log()).length;
await touch('touchStart',[{x:next.x+5,y:next.y+60,id:1}]);await touch('touchMove',[{x:next.x+100,y:next.y+70,id:1}]);await page.waitForTimeout(90);await touch('touchEnd',[]);assert.ok((await log()).length>start);
assert.equal(await page.locator('#trackpad').evaluate(e=>e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))),false);
console.log('ok one/two/three-finger touch, no page zoom/scroll, rotation mid-drag and edge-start recovery in Chromium');
assert.deepEqual(errors,[]);console.log('PASS CX-9 UI interactions; no console errors. Physical Safari/iPad checks are separate.');
}finally{await browser.close()}
