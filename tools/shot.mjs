#!/usr/bin/env node
// Headless Chromium screenshot tool for agent self-verification.
// Usage: shot <url> <out.png> [--size 1920x1080] [--wait-flag __starkReady] [--timeout 15000]
// Exit codes: 0 ok, 1 page error, 2 timeout or navigation failure, 64 bad usage.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const FIXED_DELAY_MS = 1500;

function usage(msg) {
  if (msg) console.error(`shot: ${msg}`);
  console.error('usage: shot <url> <out.png> [--size WxH] [--wait-flag NAME] [--timeout MS]');
  process.exit(64);
}

function parseArgs(argv) {
  const opts = { size: '1920x1080', waitFlag: null, timeout: 15000 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? usage(`${a} needs a value`);
    if (a === '--size') opts.size = next();
    else if (a === '--wait-flag') opts.waitFlag = next();
    else if (a === '--timeout') opts.timeout = Number(next());
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 2) usage('expected <url> and <out.png>');
  const m = /^(\d+)x(\d+)$/.exec(opts.size);
  if (!m) usage(`bad --size ${opts.size}`);
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) usage('bad --timeout');
  return { url: positional[0], out: resolve(positional[1]), width: +m[1], height: +m[2], ...opts };
}

const args = parseArgs(process.argv.slice(2));

const browser = await chromium.launch({
  headless: true,
  // Software WebGL via SwiftShader so Three.js renders without a GPU.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let exitCode = 0;
const pageErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: args.width, height: args.height } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err);
    console.log(`[pageerror] ${err.message}`);
  });

  try {
    await page.goto(args.url, { waitUntil: 'load', timeout: args.timeout });
    if (args.waitFlag) {
      await page.waitForFunction((flag) => window[flag] === true, args.waitFlag, { timeout: args.timeout });
    } else {
      await page.waitForTimeout(FIXED_DELAY_MS);
    }
  } catch (err) {
    console.log(`[timeout] ${err.message.split('\n')[0]}`);
    exitCode = 2;
  }

  await mkdir(dirname(args.out), { recursive: true });
  await page.screenshot({ path: args.out });
  console.log(`saved ${args.out} (${args.width}x${args.height})`);
  if (pageErrors.length && exitCode === 0) exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
