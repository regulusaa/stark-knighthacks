import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:3004';
assert.equal((await (await fetch(`${base}/api/room`)).json()).fixedRoom, null, 'Screenshots must use a local server, never the fixed live demo room.');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const display = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  await display.goto(`${base}/display?image=ambig_wolf&pulseAt=done`);
  await display.waitForFunction(() => window.__starkReady && window.__stark.relay?.room && window.__stark.stability.ready, null, { timeout: 45000 });
  const room = await display.evaluate(() => window.__stark.relay.room);
  await display.evaluate(() => window.__stark.api.setMode({ mode: 'stability' }));
  for (const size of ['390x844', '1180x820', '2560x1440']) {
    await new Promise((resolve, reject) => {
      const child = spawn('npm', ['run', 'shot', '--', `${base}/controller?room=${room}&role=host&key=test`, `web/ui/.shots/selected-image-tests-${size}.png`, '--size', size, '--timeout', '45000'], { stdio: 'inherit' });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`shot exited ${code}`)));
    });
  }
} finally { await browser.close(); }
