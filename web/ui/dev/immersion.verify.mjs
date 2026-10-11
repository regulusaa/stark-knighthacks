import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.BASE??'http://localhost:3004',errors=[];
const browser=await chromium.launch({args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});};
const frame=p=>p.frames().find(f=>f.url().includes('/immersion/scene.html'));
async function ready(p){await p.waitForFunction(()=>window.__immersionControllerReady);await frame(p).waitForFunction(()=>window.__immersion?.records.size>25);}
async function command(f,action,key,rest={}){await f.evaluate(p=>__immersion.command(p),{action,key,...rest});}
async function drag(p,f,key,target){const b=await p.locator('.immersion-stage iframe').boundingBox(),v=await f.evaluate(k=>__immersion.project(k),key);assert.ok(v.x>0&&v.x<b.width&&v.y>0&&v.y<b.height,`visible ${key}`);await p.mouse.move(b.x+v.x,b.y+v.y);await p.mouse.down();await p.mouse.move(b.x+target.x,b.y+target.y,{steps:15});await p.mouse.up();}
try {
 const p=await browser.newPage({viewport:{width:1180,height:820},hasTouch:true});watch(p);await p.goto(base+'/ui/dev/immersion.html');await ready(p);const f=frame(p);
 // Real pointer drag of a stationary class node, edit, then a drag onto another brain location.
 await drag(p,f,'class:281',{x:80,y:180});
 assert.equal(await f.evaluate(()=>__immersion.records.get('class:281').detached),true);
 await f.waitForFunction(()=>__immersion.edges.get(__immersion.records.get('class:281').nodeId).attr.array[0]===1);
 assert.equal(await f.evaluate(()=>__immersion.records.get('class:281').tip.mesh.visible),false);
 assert.equal(await f.evaluate(()=>__stark.activity.packets.some(p=>p.nodeId===__immersion.records.get('class:281').nodeId)),false);
 await p.locator('.immersion-name').fill('My cat hypothesis');await p.locator('.immersion-notes').fill('Inspect the eyes, then compare another class.');
 assert.equal(await f.evaluate(()=>__immersion.records.get('class:281').name),'My cat hypothesis');
 const brain=await f.evaluate(()=>__immersion.brainPoint());await drag(p,f,'class:281',brain);
 assert.equal(await f.evaluate(()=>__immersion.records.get('class:281').detached),false);
 assert.equal(await f.evaluate(()=>__immersion.records.get('class:281').tip.node.label),'My cat hypothesis');
 await f.waitForFunction(()=>__immersion.edges.get(__immersion.records.get('class:281').nodeId).attr.array[1]>.05);
 await p.screenshot({path:'web/ui/.shots/immersion-return-glow-1180x820.png'});await p.waitForTimeout(1100);assert.equal(await f.evaluate(()=>__immersion.edges.get(__immersion.records.get('class:281').nodeId).attr.array[1]),0);
 console.log('stationary drag: detached sphere, removed tip/text, neutral original branch; edited name/notes; arbitrary brain drop restores stream and glow ends after 1 s');
 // Moving label: pointer down captures its identity and current position even as flow moves.
 const b=await p.locator('.immersion-stage iframe').boundingBox();
 let moving;for(let i=0;i<60&&!moving;i++){moving=await f.evaluate(()=>{const p=__stark.activity.packets.find(p=>p.sprite.visible&&p.__immersionRecord&&!p.__immersionRecord.detached);if(!p)return null;const v=p.sprite.position.clone().project(__stark.camera);return {key:p.__immersionRecord.key,x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight};});if(!moving)await p.waitForTimeout(100);}
 assert.ok(moving);await p.mouse.move(b.x+moving.x,b.y+moving.y);await p.mouse.down();await p.mouse.move(b.x+100,b.y+650,{steps:12});await p.mouse.up();assert.equal(await f.evaluate(k=>__immersion.records.get(k).detached,moving.key),true);
 // No artificial extraction limit: all actual nodes/layers can coexist as 3D objects.
 const keys=await f.evaluate(()=>[...__immersion.records.keys()]);for(const key of keys)await command(f,'extract',key);assert.equal(await f.evaluate(()=>[...__immersion.records.values()].filter(r=>r.detached&&r.object.isObject3D).length),keys.length);
 await command(f,'return-all');assert.equal(await f.evaluate(()=>[...__immersion.records.values()].filter(r=>r.detached).length),0);console.log(`moving-node drag passed; all ${keys.length} nodes/layers extracted and returned without a cap`);
 // Exact local intervention, no made-up semantic feature names.
 await command(f,'select','class:281');await command(f,'features','class:281');await f.waitForFunction(()=>Boolean(__immersion.localEngine),null,{timeout:30000});
 const baseline=await f.evaluate(()=>__immersion.localEngine.probs[281]);await command(f,'scale','class:281',{channel:956,scale:0});
 assert.ok(await f.evaluate(v=>Math.abs(__immersion.localEngine.probs[281]-v)>.001,baseline));assert.equal(await f.evaluate(()=>__stark.api.state.top1.classId),282);await p.locator('[data-command="reset-features"]').click();await f.waitForFunction(()=>__stark.api.state.top1.classId===281);assert.equal(await f.evaluate(()=>__stark.api.state.top1.classId),281);assert.ok(await f.evaluate(v=>Math.abs(__immersion.localEngine.probs[281]-v)<1e-8,baseline));console.log('local feature 956 = 0 flips original tabby to tiger cat using the existing exact dense head; Reset restores original scores');
 // Private orbit and pinch.
 await command(f,'home');await p.waitForTimeout(700);const tip=await f.evaluate(()=>__immersion.project('class:282')),tapBox=await p.locator('iframe').boundingBox();await p.mouse.click(tapBox.x+tip.x,tapBox.y+tip.y);await f.waitForFunction(()=>__stark.api.state.focus?.classId===282);await command(f,'home');await p.waitForTimeout(700);const theta=await f.evaluate(()=>__stark.rig.state.spherical.theta);await p.mouse.move(b.x+30,b.y+400);await p.mouse.down();await p.mouse.move(b.x+150,b.y+460,{steps:10});await p.mouse.up();await f.waitForFunction(t=>Math.abs(__stark.rig.state.spherical.theta-t)>.1,theta);
 const cdp=await p.context().newCDPSession(p),radius=await f.evaluate(()=>__stark.rig.state.spherical.radius);const pts=n=>[{x:b.x+200-n,y:b.y+500,id:1},{x:b.x+200+n,y:b.y+500,id:2}];await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pts(20)});for(let n=25;n<=70;n+=5){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pts(n)});await p.waitForTimeout(35);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await f.waitForFunction(r=>__stark.rig.state.spherical.radius<r*.9,radius);assert.equal(await p.evaluate(()=>visualViewport.scale),1);console.log('private orbit and touch pinch work without page zoom');
 // Reopen retains annotations and extraction; image changes do not mix nodes.
 await command(f,'extract','class:620');await p.locator('[data-workspace="usage"]').click();assert.equal(await p.locator('iframe').count(),0);await p.locator('[data-workspace="immersion"]').click();await ready(p);await frame(p).waitForFunction(()=>__immersion.records.get('class:620').detached);assert.equal(await frame(p).evaluate(()=>__immersion.records.get('class:281').name),'My cat hypothesis');
 await p.locator('select').selectOption('med_xray_pneumonia');await frame(p).waitForFunction(()=>__immersion.imageId==='med_xray_pneumonia'&&__immersion.records.size>0);await command(frame(p),'select',(await frame(p).evaluate(()=>[...__immersion.records.keys()][0])));assert.equal(await p.locator('.immersion-features-button').isVisible(),false);console.log('reopen preserves local edits; medical findings show independent scores and no feature controls');
 // Portrait and rotation sizes.
 for(const [width,height]of [[390,844],[844,390],[320,568],[1180,820]]){await p.setViewportSize({width,height});await p.waitForTimeout(200);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);assert.ok(await p.locator('.immersion-stage').isVisible());}await frame(p).evaluate(()=>__immersion.setActive(false));const pausedTheta=await frame(p).evaluate(()=>__stark.rig.state.spherical.theta);const pausedBox=await p.locator('iframe').boundingBox();await p.mouse.move(pausedBox.x+30,pausedBox.y+400);await p.mouse.down();await p.mouse.move(pausedBox.x+180,pausedBox.y+440);await p.mouse.up();assert.equal(await frame(p).evaluate(()=>__stark.rig.state.spherical.theta),pausedTheta);await frame(p).evaluate(()=>__immersion.setActive(true));
 assert.deepEqual(errors,[]);console.log('responsive / rotate checks pass; 0 console errors');
} finally {await browser.close();}
