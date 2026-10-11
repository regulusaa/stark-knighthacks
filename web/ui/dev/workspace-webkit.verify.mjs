import assert from 'node:assert/strict';
import { webkit } from 'playwright';
const base=process.env.BASE??'http://172.20.10.14:3004';
const browser=await webkit.launch();
try{
 let p=await browser.newPage({viewport:{width:1180,height:820}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/display?offline=1&image=clean_retriever&pulseAt=done');
 try { await p.waitForFunction(()=>window.__starkReady,null,{timeout:45000}); }
 catch(error){
  console.error('WebKit startup diagnostic',await p.evaluate(()=>({ready:window.__starkReady,error:window.__starkStartupError,message:document.querySelector('#display-startup')?.innerText,scene:!!window.__stark,canvases:document.querySelectorAll('canvas').length})));
  await p.screenshot({path:'web/ui/.shots/workspace-webkit-timeout.png'});throw error;
 }
 await p.locator('#display-startup').waitFor({state:'hidden'});assert.deepEqual(errors,[]);
 await p.screenshot({path:'web/ui/.shots/workspace-webkit-display.png'});
 console.log('WebKit at LAN address: scene ready, no page errors');
 // A silent worker must time out and use the pure geometry builder.
 await p.close();p=await browser.newPage({viewport:{width:1180,height:820}});
 await p.route('**/brainTissueWorker.js',r=>r.fulfill({contentType:'text/javascript',body:'self.onmessage = () => {};'}));
 await p.goto(base+'/display?offline=1&image=clean_retriever&pulseAt=done');assert.equal(await p.locator('#display-startup').isVisible(),true);
 await p.waitForFunction(()=>window.__starkReady,null,{timeout:45000});
 await p.locator('#display-startup').waitFor({state:'hidden'});console.log('silent geometry worker: fallback renders scene');
 await p.close();p=await browser.newPage({viewport:{width:1180,height:820}});
 await p.route('**/main.js',r=>r.fulfill({contentType:'text/javascript',body:'throw new Error("Test startup failure");'}));
 await p.goto(base+'/display?offline=1&image=clean_retriever&pulseAt=done');await p.locator('#display-startup button').waitFor({state:'visible'});
 assert.match(await p.locator('#display-startup h1').innerText(),/could not start/);
 await p.screenshot({path:'web/ui/.shots/workspace-startup-retry.png'});
 await p.unroute('**/main.js');await p.locator('#display-startup button').click();
 await p.waitForFunction(()=>window.__starkReady,null,{timeout:45000});
 await p.locator('#display-startup').waitFor({state:'hidden'});console.log('startup failure: visible Retry recovers');
 console.log('WebKit startup: all checks passed');
}finally{await browser.close();}
