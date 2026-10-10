// End-to-end contract/interaction checks; no production model output is fabricated here.
// Run: node web/ui/dev/steer.verify.mjs [http://localhost:3002]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';
import { readFile } from 'node:fs/promises';
const base=process.argv[2]||'http://localhost:3002';
const browser=await chromium.launch({headless:true});
const errors=[];
let checks=0;
const pass=(message)=>{checks++;console.log(`ok ${message}`)};
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const open=async scene=>{await page.goto(`${base}/ui/dev/steer.html?mock=1&scene=${scene}`);await page.waitForFunction(()=>window.__starkReady)};
const updates=()=>page.evaluate(()=>window.__steerLab.transport.log.filter(e=>e.event==='steer-update'));
const edit=async value=>{await page.locator('#steer-code-input').fill(value);await page.waitForTimeout(220)};
try {
await open('idle');
assert.equal(await page.locator('.steer-row').count(),10);assert.equal(await page.locator('.steer-panel').getAttribute('data-steer-state'),'idle');
const order=await page.locator('.steer-row').evaluateAll(rows=>rows.map(r=>r.dataset.channel));
const first=page.locator('.steer-row input').first();await first.scrollIntoViewIfNeeded();
const box=await first.boundingBox();
await page.mouse.move(box.x+box.width/3,box.y+24);await page.mouse.down();
for(let i=0;i<55;i++){await page.mouse.move(box.x+box.width*(.1+i*.012),box.y+24);await page.waitForTimeout(23)}
const held=Number(await first.inputValue());
await page.evaluate(()=>{const lab=window.__steerLab;const v=lab.transport.result;v.seq=901;v.scales=[];lab.transport.inject(v)});
assert.equal(Number(await first.inputValue()),held);
await page.mouse.up();await page.waitForTimeout(110);
const events=await updates();assert.ok(events.length>=10);
for(let i=1;i<events.length;i++){assert.ok(events[i].payload.seq>events[i-1].payload.seq);assert.ok(events[i].time-events[i-1].time>=66)}
for(const e of events)assert.ok(events.filter(x=>x.time>=e.time&&x.time<e.time+1000).length<=15);
assert.ok(events.slice(0,-1).every(e=>e.payload.probe!==null));assert.equal(events.at(-1).payload.probe,null);
assert.equal(await page.evaluate(()=>window.scrollX),0);
pass('drag: strictly increasing seq, ≤15/s, complete snapshots, probe then null, finger wins over incoming result');
// Touch a real range with Chromium touch dispatch, and prove no page scroll.
await first.scrollIntoViewIfNeeded();const touchBox=await first.boundingBox();const y=await page.evaluate(()=>window.scrollY);const scale=await page.evaluate(()=>visualViewport.scale);
const cdp=await page.context().newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchBox.x+touchBox.width/3,y:touchBox.y+24,id:1}]});
for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchBox.x+touchBox.width/3+i*8,y:touchBox.y+24+i*2,id:1}]});await page.waitForTimeout(20)}
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
assert.equal(await page.evaluate(()=>window.scrollY),y);assert.equal(await page.evaluate(()=>visualViewport.scale),scale);
pass('touch slider drag does not scroll or zoom Chromium mobile viewport');
await open('unclaimed');await page.locator('.steer-row input').first().evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}))});await page.waitForTimeout(160);
const claim=await page.evaluate(()=>window.__steerLab.transport.log);assert.equal(claim[0].event,'take-control');assert.equal(claim[1].event,'steer-update');assert.deepEqual(claim[1].payload.set,[{channel:1187,scale:0}]);assert.equal(claim[1].payload.probe,null);
pass('unclaimed slider: takeover before final complete intervention');
await open('flipped');assert.equal(await page.locator('.steer-flip').isVisible(),true);assert.match(await page.locator('.steer-flip').innerText(),/golden retriever → Labrador retriever/);assert.deepEqual(await page.locator('.steer-row').evaluateAll(rows=>rows.map(r=>r.dataset.channel)),order);
await page.locator('.steer-reset').click();await page.waitForTimeout(100);assert.equal(await page.locator('.steer-flip').isVisible(),false);assert.equal(await page.locator('.steer-reset').isVisible(),false);
pass('flip banner, stable groups and reset');
await open('outside-brain');const extra=await page.evaluate(()=>window.__steerLab.panel.state.scales);assert.ok(extra.some(c=>c.channel===1730));
await page.locator('.steer-row input').first().evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));el.value='.5';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}))});await page.waitForTimeout(160);
assert.ok((await updates()).at(-1).payload.set.some(c=>c.channel===1730&&c.scale===3));
pass('complete replacement retains changed channels outside slider groups');
await open('viewer');await page.locator('.steer-row input').first().evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,cancelable:true}));el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}))});
assert.equal((await updates()).length,0);assert.match(await page.locator('#notice').innerText(),/Guest 2 is driving · Take control in a moment/);
await page.locator('[data-input-mode="code"]').click();assert.equal(await page.locator('#steer-code-input').getAttribute('readonly'),'');
pass('read-only viewer: no control emits, driver toast and read-only code');
await open('code-ready');const editor=page.locator('#steer-code-input');assert.equal(await editor.evaluate(e=>getComputedStyle(e).fontSize),'16px');
await editor.focus();const focusedScale=await page.evaluate(()=>visualViewport.scale);await editor.fill('');await page.locator('[data-chip="channel"]').click();assert.equal(await editor.inputValue(),'channel[]');assert.equal(await editor.evaluate(e=>e.selectionStart),8);
await page.keyboard.type('87');await page.locator('[data-chip="zero"]').click();assert.equal(await editor.inputValue(),'channel[87] = 0');
await editor.fill('channel[]');await editor.evaluate(e=>e.setSelectionRange(8,8));await page.locator('[data-chip="top"]').click();assert.equal(await editor.inputValue(),'channel[top(5, "")]');assert.equal(await editor.evaluate(e=>e.selectionStart),16);
await page.keyboard.type('golden retriever');await page.locator('[data-chip="zero"]').click();await page.waitForTimeout(220);
assert.equal(await page.locator('.steer-code-status').innerText(),'Ready');assert.equal(await page.evaluate(()=>visualViewport.scale),focusedScale);await page.locator('.steer-run').click();await page.waitForTimeout(110);assert.match((await updates()).at(-1).payload.code,/channel\[top/);assert.equal((await updates()).at(-1).payload.probe,null);
pass('16px editor, persistent keyboard focus, bracket/quote cursor insertion, Ready and code Run');
await edit('channel[87] = 0\nchannel[3000] = 0');assert.equal(await page.locator('.steer-run').isDisabled(),true);assert.match(await page.locator('.steer-code-status').innerText(),/Line 2, col 9/);assert.equal(await page.locator('.steer-error-line').isVisible(),true);
await edit('#'.repeat(501));assert.equal(await page.locator('.steer-counter').isVisible(),true);await edit('#'.repeat(601));assert.equal(await page.locator('.steer-run').isDisabled(),true);
pass('syntax error line/column, underline, counter and 600-character limit');
await edit('channel[top(5, "golden retrievee")] = 0');await page.locator('.steer-run').click();await page.waitForTimeout(110);assert.match(await page.locator('.steer-code-status').innerText(),/Did you mean "golden retriever"/);
pass('display resolve error with contract-generated suggestion');
await page.evaluate(()=>window.__steerLab.transport.changeImage('ambig_cat'));assert.equal(await page.locator('.steer-code').isVisible(),false);assert.equal(await page.locator('.steer-flip').isVisible(),false);assert.equal(await editor.inputValue(),'');
await page.evaluate(()=>window.__steerLab.transport.setConnection(false));assert.equal(await page.locator('.steer-panel').getAttribute('data-steer-state'),'offline');await page.evaluate(()=>window.__steerLab.transport.setConnection(true));assert.equal(await page.locator('.steer-panel').getAttribute('data-steer-state'),'idle');
pass('image change clears code/errors; disconnect drops work and reconnect shows cached result');
await open('idle');
await page.evaluate(()=>{
 const inputs=document.querySelectorAll('.steer-row input');
 inputs[0].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));
 inputs[0].value='.04';inputs[0].dispatchEvent(new Event('input',{bubbles:true}));
 inputs[0].dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));
 inputs[1].value='.5';inputs[1].dispatchEvent(new Event('input',{bubbles:true}));
});
await page.waitForTimeout(190);
const rapid=(await updates()).at(-1);assert.deepEqual(rapid.payload.set,[{channel:311,scale:.5},{channel:1187,scale:0}]);
assert.equal(await page.locator('[data-channel="1187"] input').nth(1).inputValue(),'0');
await page.locator('[data-channel="1187"] .steer-readout').first().dblclick();await page.waitForTimeout(110);
assert.ok(!(await updates()).at(-1).payload.set.some(c=>c.channel===1187));
await page.locator('.steer-row input').first().evaluate(el=>{el.value='1.04';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(110);
assert.equal(await page.locator('.steer-row input').first().inputValue(),'1');
pass('rapid edits survive older acknowledgments; duplicate channels share scale; snap and double-tap reset');
const beforeLoss=(await updates()).length;
await page.evaluate(()=>{
 const input=document.querySelector('.steer-row input');input.value='.4';input.dispatchEvent(new Event('input',{bubbles:true}));
 window.__steerLab.transport.setDriver({id:'c_other',label:'Guest 2',isHost:false});
 const incoming=window.__steerLab.transport.result;incoming.seq=0;incoming.scales=[{channel:1187,scale:2}];window.__steerLab.transport.inject(incoming);
});
await page.waitForTimeout(180);assert.ok((await updates()).length<=beforeLoss+1);
assert.deepEqual(await page.evaluate(()=>window.__steerLab.panel.state.scales),[{channel:1187,scale:2}]);
pass('lost control cancels pending work; another controller’s lower sequence is accepted');
for(const scene of ['idle','mid-drag','flipped','code-syntax-error','code-ready','resolve-error','viewer','unavailable','loading','offline']){
 await open(scene);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.evaluate(()=>document.querySelector('.steer-panel').scrollWidth<=document.querySelector('.steer-panel').clientWidth),true);
}
await page.setViewportSize({width:375,height:667});await open('code-ready');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
pass('all designed states and 375×667: no horizontal overflow');
await page.goto(`${base}/controller?room=7KQ2M&mock=1&steer=1&scene=idle`);await page.waitForSelector('#app[data-state="guest-driving"]');await page.locator('[data-panel="steer"]').click();assert.equal(await page.locator('#steer-panel').isVisible(),true);assert.equal(await page.locator('#answers-panel').isVisible(),false);await page.locator('[data-panel="answers"]').click();assert.equal(await page.locator('#answer-list').isVisible(),true);
await page.goto(`${base}/controller?room=7KQ2M&mock=1&steer=1&scene=unavailable`);await page.waitForFunction(()=>window.__starkReady);assert.equal(await page.locator('#explore-tabs').isVisible(),false);assert.equal(await page.locator('#steer-medical-note').innerText(),'Steer works on the ImageNet model only');
await page.setViewportSize({width:1180,height:820});await page.goto(`${base}/controller?room=7KQ2M&role=host&key=test&mock=1&steer=1&scene=idle`);await page.waitForSelector('#app[data-state="host"]');await page.locator('[data-panel="steer"]').click();assert.equal(await page.locator('#steer-panel').isVisible(),true);assert.equal(await page.locator('#trackpad').isVisible(),true);
await page.screenshot({path:'web/ui/.shots/cx7-controller-host-1180x820.png'});
await page.setViewportSize({width:390,height:844});await page.goto(`${base}/controller?room=7KQ2M&mock=1&steer=1&scene=idle`);await page.waitForSelector('#app[data-state="guest-driving"]');await page.locator('[data-panel="steer"]').click();await page.screenshot({path:'web/ui/.shots/cx7-controller-guest-390x844.png'});
await open('outside-brain');await page.locator('.steer-result-heading').scrollIntoViewIfNeeded();await page.screenshot({path:'web/ui/.shots/cx7-results-390x844.png'});
await page.locator('.steer-group').nth(1).scrollIntoViewIfNeeded();await page.screenshot({path:'web/ui/.shots/cx7-second-group-390x844.png'});
pass('controller guest/host tabs, answers preserved, medical gating, camera preserved');
const displaySocket=io(base,{transports:['websocket'],reconnection:false});
try {
 await new Promise((resolve,reject)=>{displaySocket.once('connect',resolve);displaySocket.once('connect_error',reject)});
 const registered=await displaySocket.emitWithAck('register',{role:'display',room:null});assert.equal(registered.ok,true);
 const fixture=JSON.parse(await readFile(new URL('../../../contract/fixtures/display-state.json',import.meta.url),'utf8'));
 fixture.capabilities.steer=false;displaySocket.emit('display-state',fixture);await page.waitForTimeout(60);
 const requests=[];const record=request=>requests.push(request.url());page.on('request',record);
 await page.goto(`${base}/controller?room=${registered.room}`);await page.waitForSelector('#app[data-state="guest-viewing"]');
 assert.equal(await page.locator('#explore-tabs').isVisible(),false);assert.equal(await page.locator('#steer-panel').isVisible(),false);
 assert.ok(!requests.some(url=>url.includes('steer-engine.js')));page.off('request',record);
 pass('real Socket.io connection: capability false hides Steer and never loads synthetic engine');
} finally {displaySocket.disconnect()}
assert.deepEqual(errors,[]);pass('no console/page errors');
console.log(`Steer verification: ${checks} groups passed. Physical iPhone validation is still pending.`);
} finally {await browser.close()}
