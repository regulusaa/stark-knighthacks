import {chromium,webkit} from 'playwright';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const base=process.env.BASE??'http://localhost:3004',errors=[];
const hostKey=process.env.STARK_KEY_FILE?(await readFile(process.env.STARK_KEY_FILE,'utf8')).trim():'test';
const b=await chromium.launch({args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});};
const frame=p=>p.frames().find(f=>f.url().includes('/immersion/scene.html'));
const ready=async p=>{await p.waitForFunction(()=>window.__immersionControllerReady);await frame(p).waitForFunction(()=>window.__immersion?.records.size>0);};
try{
 const d=await b.newPage({viewport:{width:1920,height:1080}});watch(d);await d.goto(base+'/display?image=ambig_cat&pulseAt=done');await d.waitForFunction(()=>window.__starkReady&&window.__stark.relay?.room,null,{timeout:45000});const room=await d.evaluate(()=>__stark.relay.room);
 await d.evaluate(()=>{window.__immersionEvents=[];for(const event of ['control-orbit','control-zoom','focus-tip','clear-focus','steer-update','select-image','scene-action','take-control'])__stark.relay.socket.on(event,p=>__immersionEvents.push({event,p}));});
 const host=await b.newPage({viewport:{width:1180,height:820},hasTouch:true}),guest=await b.newPage({viewport:{width:390,height:844},hasTouch:true});watch(host);watch(guest);
 await host.goto(`${base}/controller?room=${room}&role=host&key=${encodeURIComponent(hostKey)}`);await guest.goto(`${base}/controller?room=${room}`);
 for(const p of [host,guest]){await p.waitForFunction(()=>window.__inspectionControllerReady);assert.equal(await p.locator('iframe,canvas').count(),0);await p.locator('[data-workspace="immersion"]').click();await ready(p);}
 const hf=frame(host),gf=frame(guest);const shared=await d.evaluate(()=>({camera:__stark.inspection.snapshot().camera,image:__stark.api.state.image.id,top1:__stark.api.state.top1}));
 await hf.evaluate(()=>{__immersion.command({action:'extract',key:'class:620'});__immersion.command({action:'annotate',key:'class:620',name:'Host laptop note',notes:'Own workspace'});});
 await gf.evaluate(()=>{__immersion.command({action:'extract',key:'class:281'});__immersion.command({action:'annotate',key:'class:281',name:'Guest cat note',notes:'Independent workspace'});});
 assert.equal(await gf.evaluate(()=>__immersion.records.get('class:620').detached),false);assert.equal(await hf.evaluate(()=>__immersion.records.get('class:281').detached),false);
 assert.deepEqual(await d.evaluate(()=>({camera:__stark.inspection.snapshot().camera,image:__stark.api.state.image.id,top1:__stark.api.state.top1})),shared);
 assert.deepEqual(await d.evaluate(()=>window.__immersionEvents),[]);console.log('private extraction and annotations do not affect the shared model or another workspace');
 // Real relay navigation, focus and exact model edits must reach the screen.
 const boxHost=await host.locator('iframe').boundingBox();const theta=await d.evaluate(()=>__stark.rig.state.spherical.theta);
 await host.mouse.move(boxHost.x+30,boxHost.y+400);await host.mouse.down();await host.mouse.move(boxHost.x+160,boxHost.y+460,{steps:15});await host.mouse.up();
 await d.waitForFunction(t=>Math.abs(__stark.rig.state.spherical.theta-t)>.1,theta);
 const zoomBefore=await d.evaluate(()=>__stark.rig.state.spherical.radius),touch=await host.context().newCDPSession(host);
 const pinch=n=>[{x:boxHost.x+200-n,y:boxHost.y+450,id:1},{x:boxHost.x+200+n,y:boxHost.y+450,id:2}];await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pinch(20)});for(let n=25;n<=55;n+=5){await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pinch(n)});await host.waitForTimeout(35);}await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await d.waitForFunction(r=>__stark.rig.state.spherical.radius<r*.98,zoomBefore);assert.equal(await host.evaluate(()=>visualViewport.scale),1);
 await hf.evaluate(()=>__immersion.command({action:'select',key:'class:620'}));await host.waitForFunction(()=>document.querySelector('#notice').textContent.includes('currently accepts focus only'));assert.equal(await d.evaluate(()=>__stark.api.state.focus),null);
 console.log('FIX-FOR-SERVER: real laptop node 620 rejected: classId 620 is not in the current answer list');
 await hf.evaluate(()=>__immersion.command({action:'select',key:'class:281'}));await d.waitForFunction(()=>__stark.api.state.focus?.classId===281);
 await hf.evaluate(()=>__immersion.command({action:'features',key:'class:281'}));await hf.waitForFunction(()=>Boolean(__immersion.localEngine));
 const scaleInput=host.locator('.immersion-channel[data-channel="956"] input');await scaleInput.scrollIntoViewIfNeeded();const sb=await scaleInput.boundingBox();await host.mouse.move(sb.x+sb.width/3,sb.y+sb.height/2);await host.mouse.down();await host.mouse.move(sb.x+1,sb.y+sb.height/2,{steps:10});await host.mouse.up();
 await d.waitForFunction(()=>__stark.api.state.top1.classId===282);await hf.waitForFunction(()=>__stark.api.state.top1.classId===282);await gf.waitForFunction(()=>__stark.api.state.top1.classId===282);
 assert.ok((await d.evaluate(()=>window.__immersionEvents)).some(e=>e.event==='steer-update'&&e.p.set.some(c=>c.channel===956&&c.scale===0)));
 await hf.evaluate(()=>__immersion.command({action:'reset-features'}));await d.waitForFunction(()=>__stark.api.state.top1.classId===281);
 const beforeLocked=await d.evaluate(()=>window.__immersionEvents.length);await gf.evaluate(()=>__immersion.command({action:'select',key:'class:282'}));await guest.waitForTimeout(150);assert.equal(await d.evaluate(()=>window.__immersionEvents.length),beforeLocked);assert.match(await guest.locator('#notice').innerText(),/driving/);
 console.log('real relay: Immersion orbit, zoom, class focus and feature-956 answer flip reach display; Reset restores baseline; locked guest emits nothing');
 await hf.evaluate(()=>__immersion.command({action:'home'}));await host.waitForTimeout(700);
 // Touch extraction and reinsertion on a portrait phone using actual pointer dispatch.
 const cdp=await guest.context().newCDPSession(guest);let box=await guest.locator('.immersion-stage iframe').boundingBox();await gf.evaluate(()=>__immersion.command({action:'return-all'}));
 let v=await gf.evaluate(()=>__immersion.project('class:281'));const point=(x,y)=>[{x:box.x+x,y:box.y+y,id:1}];
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(v.x,v.y)});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:point(v.x+(35-v.x)*i/10,v.y+(180-v.y)*i/10)});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await gf.evaluate(()=>__immersion.records.get('class:281').detached),true);assert.equal(await guest.evaluate(()=>visualViewport.scale),1);
 v=await gf.evaluate(()=>__immersion.project('class:281'));const brain=await gf.evaluate(()=>__immersion.brainPoint());await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(v.x,v.y)});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:point(v.x+(brain.x-v.x)*i/10,v.y+(brain.y-v.y)*i/10)});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await gf.evaluate(()=>__immersion.records.get('class:281').detached),false);console.log('phone touch extraction and arbitrary-brain reinsertion passed, no page zoom');
 // Every gallery image is loadable and has movable real class / finding records.
 const ids=await d.evaluate(()=>__stark.api.manifest.map(m=>m.id));for(const id of ids){await d.evaluate(id=>__stark.api.loadImage(id,{autoplay:false}),id);await gf.waitForFunction(id=>window.__immersion?.imageId===id&&__immersion.records.size>0,id);await gf.evaluate(()=>{const key=[...__immersion.records.keys()][0];__immersion.command({action:'extract',key});});await gf.waitForFunction(()=>[...__immersion.records.values()].some(r=>r.detached));assert.ok(await gf.evaluate(()=>[...__immersion.records.values()].filter(r=>r.classId!=null).every(r=>Number.isFinite(r.tip.score))));await gf.evaluate(()=>__immersion.command({action:'return-all'}));console.log(`gallery ${id}: class/finding extraction and return passed`);}
 await guest.locator('[data-workspace="usage"]').click();assert.equal(await guest.locator('iframe').count(),0);await guest.locator('[data-workspace="immersion"]').click();await ready(guest);
 assert.deepEqual(errors,[]);console.log('real host/guest integration: 0 console errors');
}catch(e){throw new Error(e.message.replaceAll(hostKey,'[redacted]'));}finally{await b.close();}
// Safari engine smoke: renderer, editor and input sizing work on an iPhone viewport.
const w=await webkit.launch();try{const p=await w.newPage({viewport:{width:390,height:844},hasTouch:true});watch(p);await p.goto(base+'/ui/dev/immersion.html?extract=1');await ready(p);const f=frame(p);await p.locator('.immersion-name').fill('Safari annotation');assert.equal(await f.evaluate(()=>__immersion.records.get('class:620').name),'Safari annotation');assert.equal(await p.evaluate(()=>visualViewport.scale),1);assert.equal(await p.locator('.immersion-name').evaluate(e=>getComputedStyle(e).fontSize),'16px');assert.deepEqual(errors,[]);console.log('WebKit phone: 3D, annotation editor, 16 px inputs and no page zoom pass; 0 console errors');}finally{await w.close();}
