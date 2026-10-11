// Shared-model regressions: use actual asset flip recipes and the real relay.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.BASE??'http://localhost:3004',errors=[];
const browser=await chromium.launch({args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});};
try {
 const display=await browser.newPage({viewport:{width:1920,height:1080}});watch(display);
 await display.goto(base+'/display?image=ambig_cat&pulseAt=done');await display.waitForFunction(()=>window.__starkReady&&__stark.relay?.room,null,{timeout:45000});const room=await display.evaluate(()=>__stark.relay.room);
 const host=await browser.newPage({viewport:{width:1180,height:820},hasTouch:true});watch(host);await host.goto(`${base}/controller?room=${room}&role=host&key=test`);await host.locator('[data-panel="steer"]').click();await host.waitForFunction(()=>document.querySelectorAll('.steer-row').length===10);
 await display.evaluate(()=>{window.__resetMessages=[];__stark.relay.socket.on('steer-reset',p=>__resetMessages.push(p));window.__steerMessages=[];__stark.relay.socket.on('steer-update',p=>__steerMessages.push(p));});
 // Actual pointer range drag, followed by the real display's recomputed answer.
 const slider=host.locator('.steer-row[data-channel="956"] input').first();await slider.scrollIntoViewIfNeeded();const box=await slider.boundingBox();await host.mouse.move(box.x+box.width/3,box.y+box.height/2);await host.mouse.down();await host.mouse.move(box.x+1,box.y+box.height/2,{steps:15});await host.mouse.up();await display.waitForFunction(()=>__stark.api.state.top1.classId===282);
 assert.match(await host.locator('.steer-flip').innerText(),/tabby → tiger cat/);await host.locator('.steer-reset').click();await display.waitForFunction(()=>__stark.api.state.top1.classId===281);console.log('real cat range drag: tabby → tiger cat; Reset restores original');
 for(const id of ['ambig_cat','ambig_wolf','clean_retriever','adv_retriever','clean_sportscar','clean_monarch','ambig_chihuahua']) {
  const data=await fetch(`${base}/assets/${id}/steer.json`).then(r=>r.json()),flip=data.flip;
  await display.evaluate(id=>__stark.api.loadImage(id,{autoplay:false}),id);await host.locator('[data-panel="steer"]').waitFor({state:'visible'});await host.locator('[data-panel="steer"]').click();
  await host.waitForFunction(f=>document.querySelector('.steer-demo-text')?.textContent.includes(`off ${f.n} channel`)&&document.querySelector('.steer-demo-text')?.textContent.endsWith(`→ ${f.toLabel}.`),flip);await host.locator('.steer-demo-next').waitFor({state:'visible'});
  const original=await display.evaluate(()=>__stark.api.state.top1.classId);assert.equal(original,flip.from);
  for(let i=0;i<flip.n;i++){await host.locator('.steer-demo-next').click();await host.waitForFunction(n=>document.querySelector('.steer-demo-progress').textContent.startsWith(`${n} /`),i+1);await display.waitForFunction(n=>__stark.steer.session.state.scales.length===n&&__stark.steer.session.state.probe===null,i+1);}
  await display.waitForFunction(id=>__stark.api.state.top1.classId===id,flip.to);const state=await display.evaluate(()=>__stark.steer.session.state);
  assert.deepEqual(state.scales.map(c=>c.channel),[...flip.channels].sort((a,b)=>a-b));assert.equal(state.probe,null);assert.ok(Math.abs(state.result.top1.score-flip.toScore)<.0001);
  console.log(`${id}: ${flip.n} recorded channels off → ${state.result.top1.label}, model score ${(state.result.top1.score*100).toFixed(1)}%`);
  await host.locator('.steer-reset').click();await display.waitForFunction(id=>__stark.api.state.top1.classId===id,flip.from,{timeout:7000}).catch(async e=>{console.log('RESET DIAGNOSTIC',await display.evaluate(()=>({image:__stark.api.state.image.id,top1:__stark.api.state.top1,scales:__stark.steer.session.state.scales,seq:__stark.steer.session.state.seq,resets:__resetMessages})),await host.locator('.steer-panel').innerText());throw e});
 }
 const updates=await display.evaluate(()=>window.__steerMessages);for(let i=1;i<updates.length;i++)assert.ok(updates[i].seq>updates[i-1].seq);assert.deepEqual(errors,[]);console.log('all seven real image recipes, complete snapshots, increasing seq, final probe:null, baseline resets and zero console errors pass');
}finally{await browser.close()}
