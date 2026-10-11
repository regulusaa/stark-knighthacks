// npm run shot against a real display/relay; local test host key only.
import {chromium} from 'playwright';import {spawn} from 'node:child_process';
const base=process.env.BASE??'http://localhost:3004';
const browser=await chromium.launch({args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
 const display=await browser.newPage({viewport:{width:1920,height:1080}});
 await display.goto(base+'/display?image=ambig_cat&pulseAt=done');await display.waitForFunction(()=>window.__starkReady&&__stark.relay?.room,null,{timeout:45000});const room=await display.evaluate(()=>__stark.relay.room);
 for(const size of ['390x844','1180x820','2560x1440']) {
  await new Promise((resolve,reject)=>{const child=spawn('npm',['run','shot','--',`${base}/controller?room=${room}&role=host&key=test&workspace=immersion`,`web/ui/.shots/immersion-linked-${size}.png`,'--size',size,'--wait-flag','__immersionControllerReady','--timeout','45000'],{stdio:'inherit'});child.on('exit',code=>code===0?resolve():reject(new Error(`shot exit ${code}`)));});
 }
 const host=await browser.newPage({viewport:{width:1180,height:820},hasTouch:true});await host.goto(`${base}/controller?room=${room}&role=host&key=test`);await host.locator('[data-panel="steer"]').click();await host.waitForFunction(()=>document.querySelector('.steer-demo-text').textContent.includes('956')||!document.querySelector('.steer-demo').hidden);
 await host.screenshot({path:'web/ui/.shots/steer-guided-original-1180x820.png'});await host.locator('.steer-demo-next').click();await display.waitForFunction(()=>__stark.api.state.top1.classId===282);await host.waitForFunction(()=>!document.querySelector('.steer-flip').hidden);await host.screenshot({path:'web/ui/.shots/steer-guided-flipped-1180x820.png'});
 await host.locator('[data-workspace="immersion"]').click();await host.waitForFunction(()=>window.__immersionControllerReady);const frame=host.frames().find(f=>f.url().includes('/immersion/scene.html'));await frame.evaluate(()=>{__immersion.command({action:'select',key:'class:281'});__immersion.command({action:'features',key:'class:281'});});await frame.waitForFunction(()=>Boolean(__immersion.localEngine));await host.locator('.immersion-features').scrollIntoViewIfNeeded();await host.screenshot({path:'web/ui/.shots/immersion-linked-features-1180x820.png'});
}finally{await browser.close()}
