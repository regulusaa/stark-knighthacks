import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:1180,height:820}}),errors=[];
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await p.goto('http://localhost:3003/ui/dev/inspection-study.html');await p.waitForFunction(()=>window.__starkReady);await p.waitForTimeout(800);
 const pose=()=>p.evaluate(()=>({brain:window.__study.brain.position.toArray(),stem:window.__study.stem.position.toArray(),camera:window.__study.camera.position.toArray()}));
 await p.locator('#split').click();await p.waitForTimeout(180);const a=await pose();
 await p.locator('#split').click();const mid=await pose();assert.ok(Math.hypot(...mid.brain.map((x,i)=>x-a.brain[i]))<.8,'reversal must start from the current position');
 await p.waitForTimeout(1300);const joined=await pose();assert.ok(Math.hypot(...joined.brain)<.04&&Math.hypot(...joined.stem)<.04,'join settles at origin');
 await p.locator('#split').click();await p.waitForTimeout(1400);await p.screenshot({path:'web/ui/.shots/inspection-study-split-1180x820.png'});
 console.log('split',await pose());
 await p.locator('[data-select="stem"]').click();await p.locator('#inspect').click();await p.waitForTimeout(1400);await p.screenshot({path:'web/ui/.shots/inspection-study-stem-1180x820.png'});
 console.log('stem visible labels',await p.evaluate(()=>window.__study.packets.filter(x=>x.sprite.visible&&x.sprite.material.opacity>.15).length));
 await p.locator('[data-select="brain"]').click();await p.locator('#inspect').click();await p.waitForTimeout(1400);await p.screenshot({path:'web/ui/.shots/inspection-study-brain-1180x820.png'});
 console.log('brain visible labels',await p.evaluate(()=>window.__study.packets.filter(x=>x.sprite.visible&&x.sprite.material.opacity>.15).length));
 await p.locator('#center').click();await p.locator('[data-select="all"]').click();await p.waitForTimeout(900);
 const h=await p.locator('[data-handle="brain"]').boundingBox(),before=await pose();await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(h.x+h.width/2-90,h.y+h.height/2-30,{steps:12});await p.mouse.up();await p.waitForTimeout(700);const after=await pose();assert.ok(Math.hypot(...after.brain.map((x,i)=>x-before.brain[i]))>1,'brain moved');assert.ok(Math.hypot(...after.stem.map((x,i)=>x-before.stem[i]))<.04,'stem stayed put');
 console.log('independent handle movement passed');
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(1000);await p.screenshot({path:'web/ui/.shots/inspection-study-phone-390x844.png'});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow');
 const timing=await p.evaluate(async()=>{const out=[];let last=performance.now();for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const now=performance.now();out.push(now-last);last=now;}out.sort((a,b)=>a-b);return {medianMs:out[45],p95Ms:out[85],calls:window.__study.renderer.info.render.calls,triangles:window.__study.renderer.info.render.triangles};});console.log('render timing',timing);
 assert.deepEqual(errors,[]);console.log('study checks passed; no console errors');
}finally{await b.close();}
