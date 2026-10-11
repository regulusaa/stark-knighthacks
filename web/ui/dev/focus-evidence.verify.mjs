import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base=process.env.BASE??'http://localhost:3004';
const browser=await chromium.launch({args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const errors=[];const watch=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});};
const evidence=JSON.parse(await readFile(new URL('../evidence/ambig_cat.json',import.meta.url),'utf8'));
try {
 const d=await browser.newPage({viewport:{width:1920,height:1080}});watch(d);
 await d.goto(base+'/display?image=ambig_cat&pulseAt=done&focus=282');
 await d.waitForFunction(()=>window.__starkReady&&window.__stark.steer.session.ready,null,{timeout:60000});
 await d.waitForFunction(()=>document.querySelector('.hud-focus .focus-evidence-why p').textContent.includes('#1353'));
 await d.waitForFunction(()=>document.querySelector('.hud-focus .focus-evidence-map').hidden===false);
 const card=d.locator('.hud-focus');
 assert.match(await card.innerText(),/41.9% to 39.7%/);
 assert.equal(await card.locator('.focus-evidence-edit').isVisible(),false);
 const originalMap=await card.locator('.focus-map-image').getAttribute('src');
 // Compare the exported removal to the authoritative model running on the display.
 await d.evaluate(()=>window.__stark.steer.session.setLocal(new Map([[1353,0]])));
 await d.waitForFunction(()=>window.__stark.api.state.steer?.active);
 const actual=await d.evaluate(()=>window.__stark.steer.session.answerFor(282).score);
 assert.ok(Math.abs(actual-evidence.classes.find(c=>c.classId===282).removal.score)<1e-7);
 await d.evaluate(()=>window.__stark.steer.session.setLocal(new Map([[956,0]])));
 await d.waitForFunction(()=>window.__stark.api.state.top1.classId===282);
 await d.waitForFunction(()=>document.querySelector('.hud-focus .focus-evidence-edit').textContent.includes('+4.8'));
 await d.waitForFunction(()=>!document.querySelector('.hud-focus .focus-evidence-map').hidden&&document.querySelector('.hud-focus .focus-map-image').alt.includes('tiger cat'));
 await d.waitForTimeout(4200); // Let the separate answer-change banner expire before inspecting the card.
 await d.screenshot({path:'web/ui/.shots/focus-why-tiger-1920x1080.png'});
 const tigerMap=await card.locator('.focus-map-image').getAttribute('src');
 await d.evaluate(()=>window.__stark.api.focusTip(620));
 await d.waitForFunction(()=>document.querySelector('.hud-focus .focus-evidence-why p').textContent.includes('#1706'));
 await d.waitForFunction(()=>document.querySelector('.hud-focus .focus-map-image').alt.includes('laptop')&&!document.querySelector('.hud-focus .focus-evidence-map').hidden);
 assert.match(await card.innerText(),/0.118% to 0.091%/);
 const laptopMap=await card.locator('.focus-map-image').getAttribute('src');
 assert.notEqual(laptopMap,tigerMap);assert.notEqual(tigerMap,originalMap);
 await d.screenshot({path:'web/ui/.shots/focus-why-laptop-1920x1080.png'});
 console.log('tiger cat vs laptop: different class maps and removal tests; live edits labelled separately; authoritative ablation matches exported evidence');
 const room=await d.evaluate(()=>window.__stark.relay.room);
 const g=await browser.newPage({viewport:{width:1180,height:820},hasTouch:true});watch(g);
 const requests=[];g.on('request',r=>requests.push(r.url()));
 await g.goto(`${base}/controller?room=${room}`);await g.waitForSelector('#app[data-state="guest-viewing"]');
 await g.locator('#take-control-center').tap();await g.waitForSelector('#app[data-state="guest-driving"]');
 await g.locator('#answer-list [data-class-id="282"]').tap();
 await g.waitForFunction(()=>document.querySelector('#focus-card .focus-evidence-why p').textContent.includes('#1353'));
 await g.waitForFunction(()=>document.querySelector('#focus-card .focus-map-image').alt.includes('tiger cat')&&!document.querySelector('#focus-card .focus-evidence-map').hidden);
 await g.screenshot({path:'web/ui/.shots/focus-why-controller-1180x820.png'});
 await g.setViewportSize({width:390,height:844});
 assert.equal(await g.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await g.locator('#focus-card .focus-evidence-why').scrollIntoViewIfNeeded();
 await g.screenshot({path:'web/ui/.shots/focus-why-controller-390x844.png'});
 assert.equal(requests.some(u=>u.includes('head.bin')||u.includes('conv5.bin')),false);
 // Heatmap-null cards show no map; changing images drops previous evidence.
 await d.evaluate(()=>window.__stark.api.loadImage('med_xray_pneumonia',{autoplay:false}));
 await d.waitForFunction(()=>window.__stark.api.state.image.id==='med_xray_pneumonia');
 const noHeat=await d.evaluate(()=>window.__stark.api.state.answers.find(a=>!a.hasHeatmap));
 if(noHeat){await d.evaluate(id=>window.__stark.api.focusTip(id),noHeat.classId);await d.waitForFunction(()=>document.querySelector('.hud-focus .focus-evidence-why p').textContent.includes('Spatial evidence is unavailable'));assert.equal(await card.locator('.focus-evidence-map').isVisible(),false);}
 const medical=await d.evaluate(()=>window.__stark.api.state.answers.find(a=>a.hasHeatmap));
 await d.evaluate(id=>window.__stark.api.focusTip(id),medical.classId);
 await d.waitForFunction(()=>document.querySelector('.hud-focus .focus-evidence-map').hidden===false);
 assert.match(await card.innerText(),/independent score · not a diagnosis/);
 await d.screenshot({path:'web/ui/.shots/focus-why-medical-1920x1080.png'});
 await d.evaluate(()=>{window.__stark.api.clearFocus();});
 assert.equal(await card.getAttribute('aria-hidden'),'true');
 assert.deepEqual(errors,[]);
 console.log('controller focus, phone overflow, medical maps, absent-map honesty and image clearing pass; no large model downloads or console errors');
} finally {await browser.close();}
