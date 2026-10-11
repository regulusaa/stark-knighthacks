import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
  for (const dpr of [1,2]) {
    const page = await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:dpr});
    await page.goto('http://localhost:3003/display?offline=1&image=clean_retriever&pulseAt=done');
    await page.waitForFunction(()=>window.__starkReady,{timeout:30000});
    for (const [w,h] of [[1920,1080],[2560,1440],[1180,820],[390,844],[1920,1080]]) {
      await page.setViewportSize({width:w,height:h});
      await page.waitForTimeout(500);
      console.log(JSON.stringify(await page.evaluate(()=>{
        const s=window.__stark,c=document.querySelector('canvas'),gl=s.renderer.getContext();
        return {window:[innerWidth,innerHeight],css:[c.clientWidth,c.clientHeight],buffer:[c.width,c.height],dpr:devicePixelRatio,pixelRatio:s.renderer.getPixelRatio(),viewport:[...gl.getParameter(gl.VIEWPORT)],camera:s.camera.position.toArray(),target:s.rig.state.target.toArray(),aspect:s.camera.aspect,framing:s.framing};
      })));
    }
    await page.screenshot({path:`web/ui/.shots/redesign-before-dpr${dpr}.png`});
    await page.close();
  }
} finally { await browser.close(); }
