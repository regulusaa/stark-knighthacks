// Real relay/renderer checks, isolated from Ray's physical preview room.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.argv[2]||'http://localhost:3004';
const browser=await chromium.launch({args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const errors=[];
const display=await browser.newPage({viewport:{width:1920,height:1080}});
const host=await browser.newPage({viewport:{width:1180,height:820},hasTouch:true});
const guest=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
for(const p of[display,host,guest]){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())})}
const dstate=()=>display.evaluate(()=>window.__stark.api.state);
const updates=[];
const network=await guest.context().newCDPSession(guest);await network.send('Network.enable');
network.on('Network.webSocketFrameSent',e=>{try{if(e.response.payloadData.startsWith('42')){const [event,payload]=JSON.parse(e.response.payloadData.slice(2));if(event==='steer-update')updates.push({event,payload,time:Date.now()})}}catch{}});
const active=beat=>host.waitForFunction(id=>document.querySelector(`[data-demo-beat="${id}"]`).getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-demo-beat][aria-busy="true"]'),beat);
try{
await display.goto(`${base}/display?room=STRK7&image=clean_retriever&pulseAt=done`);await display.waitForFunction(()=>window.__starkReady&&window.__stark.relay.room);
await host.goto(`${base}/controller?room=STRK7&role=host&key=test`);await host.waitForSelector('#app[data-state="host"]');
for(const [beat,id,mode]of[['retriever','clean_retriever','normal'],['handover','clean_retriever','normal'],['stability','ambig_cat','stability'],['adversarial','adv_retriever','normal'],['xray','med_xray_pneumonia','normal'],['steer','ambig_cat','normal'],['close','clean_retriever','normal']]){
 await host.locator(`[data-demo-beat="${beat}"]`).click();await active(beat);
 await display.waitForFunction(({id,mode})=>window.__stark.api.state.image.id===id&&window.__stark.api.state.mode===mode,{id,mode});
 if(beat==='stability')await display.waitForFunction(()=>window.__stark.api.state.stability?.run>=1,null,{timeout:5000});
 if(beat==='steer')await host.waitForSelector('.steer-row input');
 console.log(`ok real demo rail: ${beat} → ${id} / ${mode}`);
}
// Compare the documented wolf set with the server's visible slider groups.
await display.evaluate(async()=>{await window.__stark.api.loadImage('ambig_wolf',{autoplay:false});window.__stark.api.jumpToEnd()});
await display.waitForFunction(()=>window.__stark.api.state.capabilities.steer);
await guest.goto(`${base}/controller?room=STRK7`);await guest.waitForSelector('#app[data-state="guest-viewing"]');await guest.locator('#take-control-center').tap();await guest.waitForSelector('#app[data-state="guest-driving"]');await guest.locator('[data-panel="steer"]').tap();await guest.waitForSelector('.steer-row input');
const visible=await guest.locator('.steer-group').first().locator('input').evaluateAll(es=>es.map(e=>Number(e.closest('[data-channel]').dataset.channel)));
const review=await guest.evaluate(async()=>{const r=await fetch('/assets/ambig_wolf/steer.json');return(await r.json()).flip});
console.log(`wolf review ${JSON.stringify(review)}; visible first group ${JSON.stringify(visible)}`);
const original=(await dstate()).top1.classId;
for(let i=0;i<4;i++){
 const slider=guest.locator('.steer-group').first().locator('input').nth(i);await slider.scrollIntoViewIfNeeded();const b=await slider.boundingBox();
 await guest.mouse.move(b.x+b.width/3,b.y+b.height/2);await guest.mouse.down();await guest.mouse.move(b.x+1,b.y+b.height/2,{steps:8});await guest.mouse.up();
 await display.waitForFunction(n=>window.__stark.api.state.steer?.changedCount===n,i+1);await guest.waitForTimeout(90);
 assert.equal(updates.at(-1).payload.set.length,i+1);
 assert.ok(updates.at(-1).payload.set.every(item=>item.scale===0));
 if(i<3)assert.equal((await dstate()).top1.classId,original);
}
assert.notEqual((await dstate()).top1.classId,original);
console.log(`ok real wolf slider drag: cumulative sets 1→2→3→4, flip to ${(await dstate()).top1.label}, final probe:null`);assert.equal(updates.at(-1).payload.probe,null);
await guest.locator('.steer-reset').tap();await display.waitForFunction(()=>!window.__stark.api.state.steer?.active);
await guest.locator('[data-input-mode="code"]').tap();await guest.locator('#steer-code-input').fill(`channel[${review.channels.join(', ')}] = 0`);await guest.waitForTimeout(200);await guest.locator('.steer-run').tap();
await display.waitForFunction(id=>window.__stark.api.state.top1.classId===id,review.to);console.log(`ok exact review set flips at n=${review.n} to ${(await dstate()).top1.label}; missing slider channels ${JSON.stringify(review.channels.filter(c=>!visible.includes(c)))}`);
await host.locator('[data-demo-beat="steer"]').click();await active('steer');await host.waitForSelector('.steer-row input');
await host.locator('.steer-group').first().locator('input').first().evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}))});await display.waitForFunction(()=>window.__stark.api.state.top1.classId===282);console.log('ok real cat demo: one channel flips tabby → tiger cat');
// A nondefault, focused camera must survive both directions of the pair switch.
await host.locator('[data-demo-beat="retriever"]').click();await active('retriever');await display.waitForFunction(()=>window.__stark.api.state.capabilities.steer);
await display.evaluate(()=>window.__stark.api.focusTip(208));await display.waitForFunction(()=>!window.__stark.rig.moving);await display.evaluate(()=>{window.__stark.api.orbit(.22,.08);window.__stark.rig.update(10)});
const camera=()=>display.evaluate(()=>({position:window.__stark.camera.position.toArray(),target:window.__stark.rig.state.spherical}));const before=await camera();
await host.locator('[data-pair-image="adv_retriever"]').click();await display.waitForFunction(()=>window.__stark.api.state.image.id==='adv_retriever');assert.deepEqual(await camera(),before);
await host.locator('[data-pair-image="clean_retriever"]').click();await display.waitForFunction(()=>window.__stark.api.state.image.id==='clean_retriever');assert.deepEqual(await camera(),before);console.log('ok pair switch preserves an orbited, focused camera in both directions');
// Real Socket.io disconnect + reconnect in the same document (physical radio checks are separate).
await guest.evaluate(()=>window.dispatchEvent(new Event('offline')));await guest.context().setOffline(true);await guest.waitForTimeout(1200);await guest.context().setOffline(false);await guest.waitForSelector('#app[data-state="guest-viewing"]', {timeout:15000});await guest.locator('#take-control-center').tap();await guest.waitForSelector('#app[data-state="guest-driving"]');assert.equal(await guest.locator('#first-drive-help').isVisible(),false);console.log('ok real relay network loss recovers without reload; fresh driver confirmation and onboarding stays suppressed');
await host.goto(`${base}/ui/dev/hud.html?scene=steering`);await host.setViewportSize({width:1920,height:1080});await host.waitForFunction(()=>window.__starkReady);
const overlap=await host.evaluate(()=>{const a=document.querySelector('[data-field="steeringBadge"]').getBoundingClientRect(),b=document.querySelector('.hud-qr').getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top});assert.equal(overlap,false);console.log('ok full HUD Steering badge and QR do not overlap at 1920×1080');
assert.deepEqual(errors,[]);console.log('PASS CX-9 real relay/display; no console errors');
}finally{await browser.close()}
