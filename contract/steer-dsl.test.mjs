// Tests for steer-dsl.js. Plain node, no framework:  node contract/steer-dsl.test.mjs
import { readFileSync } from 'node:fs';
import { parse, resolve, format, makeClassFinder, LIMITS } from './steer-dsl.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}
function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what} expected ${e}, got ${a}`);
}
function ok(cond, what) { if (!cond) throw new Error(what); }

// A small class table and channel ranking for resolve().
const CLASSES = [
  { classId: 207, label: 'golden retriever' }, { classId: 208, label: 'Labrador retriever' },
  { classId: 269, label: 'timber wolf' }, { classId: 270, label: 'white wolf' }, { classId: 281, label: 'tabby' },
  { classId: 1, label: 'goldfish' }, { classId: 77, label: 'wolf spider' }, { classId: 11, label: 'goldfinch' }, { classId: 134, label: 'crane' },
  { classId: 517, label: 'crane' }, { classId: 852, label: 'tennis ball' },
];
const TOP = { 207: [1187, 311, 87, 1402, 12, 640, 7, 8, 9, 10], 208: [640, 1187, 1990, 455, 87] };
const resolver = { findClass: makeClassFinder(CLASSES), topChannels: (k, n) => (TOP[k] ?? []).slice(0, n) };
const run = (text) => {
  const p = parse(text);
  if (!p.ok) return p;
  return resolve(p.statements, resolver);
};
const scalesOf = (text) => {
  const r = run(text);
  if (!r.ok) throw new Error(`unexpected error: ${r.error.message}`);
  return Object.fromEntries([...r.scales].sort((a, b) => a[0] - b[0]));
};
const err = (text) => {
  const r = run(text);
  if (r.ok) throw new Error(`expected an error for ${JSON.stringify(text)}`);
  ok(typeof r.error.message === 'string' && r.error.message.length > 0, 'error has a message');
  return r.error;
};
const errAt = (text, line, col, includes) => {
  const e = err(text);
  eq([e.line, e.col], [line, col], `position of error "${e.message}"`);
  if (includes) ok(e.message.includes(includes), `message "${e.message}" should include "${includes}"`);
  return e;
};

// ------------------------------------------------------------------------------------------ valid forms
test('set one channel', () => eq(scalesOf('channel[87] = 0'), { 87: 0 }));
test('multiply one channel', () => eq(scalesOf('channel[87] *= 2'), { 87: 2 }));
test('channel list', () => eq(scalesOf('channel[87, 311, 1402] = 0'), { 87: 0, 311: 0, 1402: 0 }));
test('list without spaces', () => eq(scalesOf('channel[1,2,3]=0.5'), { 1: 0.5, 2: 0.5, 3: 0.5 }));
test('top(N, label)', () => eq(scalesOf('channel[top(3, "golden retriever")] = 0'), { 87: 0, 311: 0, 1187: 0 }));
test('top() label is case-insensitive', () => eq(scalesOf('channel[top(1, "GOLDEN Retriever")] = 2'), { 1187: 2 }));
test('top() unique prefix', () => eq(scalesOf('channel[top(2, "labrador")] *= 0.5'), { 640: 0.5, 1187: 0.5 }));
test('reset clears earlier statements', () => eq(scalesOf('channel[1] = 0\nreset\nchannel[2] = 2'), { 2: 2 }));
test('number forms 0, 0.5, .5, 2, 2.0', () => {
  eq(scalesOf('channel[1] = 0; channel[2] = 0.5; channel[3] = .5; channel[4] = 2; channel[5] = 2.0'),
    { 1: 0, 2: 0.5, 3: 0.5, 4: 2, 5: 2 });
});
test('keywords are case-insensitive', () => eq(scalesOf('CHANNEL[5] = 0\nReset\nChannel[6] = 0'), { 6: 0 }));
test('comments and blank lines', () => {
  eq(scalesOf('# start\n\nchannel[9] = 0   # silence 9\n\n   # done\n'), { 9: 0 });
});
test('";" separates statements on one line', () => eq(scalesOf('channel[1] = 0; channel[2] = 3;'), { 1: 0, 2: 3 }));
test('empty program is a no-op', () => eq(scalesOf(''), {}));
test('only comments is a no-op', () => eq(scalesOf('# nothing here'), {}));
test('whitespace is free', () => eq(scalesOf('  channel [ 4 ,5 ]\t*=\t2  '), { 4: 2, 5: 2 }));
test('CRLF line endings', () => eq(scalesOf('channel[1] = 0\r\nchannel[2] = 2\r\n'), { 1: 0, 2: 2 }));
test('scale 1 is dropped from the result', () => eq(scalesOf('channel[1] = 2\nchannel[1] *= 0.5'), {}));
test('channel 0 and 2047 are valid', () => eq(scalesOf('channel[0, 2047] = 0'), { 0: 0, 2047: 0 }));
test('duplicate channels in a list count once', () => eq(scalesOf('channel[3, 3, 3] *= 2'), { 3: 2 }));

// ------------------------------------------------------------------------------------- order and clamping
test('clamping: *= 10 → 3', () => eq(scalesOf('channel[1] *= 10'), { 1: 3 }));
test('clamping: = 99 → 3', () => eq(scalesOf('channel[1] = 99'), { 1: 3 }));
test('order: = 0 then *= 2 stays 0', () => eq(scalesOf('channel[1] = 0; channel[1] *= 2'), { 1: 0 }));
test('order: *= 2 then = 0.5', () => eq(scalesOf('channel[1] *= 2; channel[1] = 0.5'), { 1: 0.5 }));
test('clamped after each statement', () => eq(scalesOf('channel[1] *= 10; channel[1] *= 0.5'), { 1: 1.5 }));
test('a program is complete, not added to the previous one', () => {
  eq(scalesOf('channel[1] = 0'), { 1: 0 });
  eq(scalesOf('channel[2] = 0'), { 2: 0 }); // channel 1 is back to 1
});

// -------------------------------------------------------------------------------- errors, with positions
test('channel index out of range', () => errAt('channel[1]=0\nchannel[3000] = 0', 2, 9, 'channel index 3000 is out of range (0–2047)'));
test('exact message for out of range', () => {
  eq(err('channel[1]=0\nchannel[3000] = 0').message, 'Line 2, col 9: channel index 3000 is out of range (0–2047)');
});
test('missing operator', () => {
  const e = errAt('channel[5] 2', 1, 12);
  eq(e.message, 'Line 1: expected "*=" or "=" after channel[...]');
});
test('top() with N = 0', () => errAt('\n\nchannel[top(0, "tabby")] = 0', 3, 13, 'top() takes a number 1–20 and a class label in quotes'));
test('top() with N = 21', () => errAt('channel[top(21, "tabby")] = 0', 1, 13, 'top() takes a number 1–20'));
test('top() without quotes', () => errAt('channel[top(3, tabby)] = 0', 1, 16, 'class label in quotes'));
test('top() with a decimal N', () => errAt('channel[top(2.5, "tabby")] = 0', 1, 13, 'top() takes'));
test('unknown label suggests the closest', () => {
  eq(err('channel[top(3, "wolfe")] = 0').message, 'Line 1, col 9: No class called "wolfe". Did you mean "timber wolf"?');
});
test('unknown label closest by edit distance', () => {
  ok(err('channel[top(3, "timbre wolf")] = 0').message.includes('Did you mean "timber wolf"?'), 'timber wolf');
});
test('ambiguous prefix names a candidate', () => {
  ok(err('channel[top(3, "gold")] = 0').message.includes('Did you mean "gold'), 'ambiguous prefix');
});
test('duplicate exact label takes the lowest classId', () => {
  eq(makeClassFinder(CLASSES)('crane'), { ok: true, classId: 134, label: 'crane' });
});
test('unknown statement', () => errAt('channel[1]=0\nboost[4] = 2', 2, 1, 'unknown statement "boost"'));
test('missing [', () => errAt('channel 4 = 0', 1, 9, 'expected "["'));
test('empty channel list', () => errAt('channel[] = 0', 1, 8, 'at least one channel'));
test('unclosed list', () => errAt('channel[4 = 0', 1, 11, 'expected "," or "]"'));
test('decimal channel index', () => errAt('channel[4.5] = 0', 1, 9, 'whole number'));
test('missing number', () => errAt('channel[4] =', 1, 13, 'expected a number after "="'));
test('trailing junk after a statement', () => errAt('channel[4] = 0 0', 1, 16, 'after the statement'));
test('two statements on one line need ";"', () => errAt('channel[1] = 0 channel[2] = 0', 1, 16, 'separate them with ";"'));
test('negative number', () => errAt('channel[4] = -1', 1, 14, 'negative numbers are not allowed'));
test('exponent', () => errAt('channel[4] = 1e3', 1, 14, 'no exponents'));
test('hex', () => errAt('channel[4] = 0x1F', 1, 14, 'hex'));
test('NaN is not a number', () => errAt('channel[4] = NaN', 1, 14, 'expected a number'));
test('Infinity is not a number', () => errAt('channel[4] = Infinity', 1, 14, 'expected a number'));
test('"2." is not a number', () => errAt('channel[4] = 2.', 1, 14, 'not a number'));
test('"1.2.3" is not a number', () => errAt('channel[4] = 1.2.3', 1, 14, 'not a number'));
test('lone "*"', () => errAt('channel[4] * 2', 1, 12, 'expected "*="'));
test('unclosed label', () => errAt('channel[top(3, "tabby)] = 0', 1, 16, 'no closing quote'));
test('bad escape in a label', () => errAt('channel[top(3, "ta\\nbby")] = 0', 1, 19, 'only \\" and \\\\'));
test('escaped quote in a label is read', () => {
  const p = parse('channel[top(3, "say \\"hi\\" \\\\")] = 0');
  ok(p.ok, 'parses');
  eq(p.statements[0].target.label, 'say "hi" \\');
});
test('a statement cannot start with a number', () => errAt('5 = 0', 1, 1, 'starts with'));

// ------------------------------------------------------------------------------------------------- limits
test('600 characters is fine', () => {
  const text = `channel[1] = 0${' '.repeat(600 - 14)}`;
  eq(text.length, 600);
  ok(parse(text).ok, '600 chars parses');
});
test('601 characters is too long', () => {
  const e = errAt(`channel[1] = 0${' '.repeat(601 - 14)}`, 1, 601, 'the limit is 600');
  ok(e.message.includes('601 characters'), e.message);
});
test('20 statements is fine', () => ok(parse(Array.from({ length: 20 }, (_, i) => `channel[${i}] = 0`).join('\n')).ok, '20 ok'));
test('21 statements is too many', () => {
  errAt(Array.from({ length: 21 }, (_, i) => `channel[${i}] = 0`).join('\n'), 21, 1, 'at most 20 statements');
});
test('64 channels is fine', () => ok(run(`channel[${Array.from({ length: 64 }, (_, i) => i).join(',')}] = 0`).ok, '64 ok'));
test('65 channels is too many (parse)', () => {
  const list = Array.from({ length: 65 }, (_, i) => i).join(',');
  const e = err(`channel[${list}] = 0`);
  ok(e.message.includes('at most 64 distinct channels'), e.message);
});
test('65 channels across top() is too many (resolve)', () => {
  const many = { findClass: () => ({ ok: true, classId: 1 }), topChannels: (k, n) => Array.from({ length: n }, (_, i) => 100 + i) };
  const text = ['channel[top(20, "a")] = 0', `channel[${Array.from({ length: 45 }, (_, i) => 500 + i).join(',')}] = 0`].join('\n');
  const p = parse(text);
  ok(p.ok, 'parses');
  const r = resolve(p.statements, many);
  ok(!r.ok && r.error.message.includes('at most 64 distinct channels'), JSON.stringify(r));
  eq(r.error.line, 2);
});

// ------------------------------------------------------------------------------------------------- format
test('format groups by scale, "=" form, sorted', () => {
  eq(format(new Map([[1402, 0], [12, 2], [311, 0], [87, 0]])), 'channel[87, 311, 1402] = 0\nchannel[12] = 2');
});
test('format rounds to 3 decimals and omits scale 1', () => {
  eq(format(new Map([[5, 0.12345], [6, 1], [7, 0.99999], [8, 1.0004]])), 'channel[5] = 0.123'); // 0.99999 → 1 → omitted
});
test('format of nothing is ""', () => eq(format(new Map()), ''));
test('format accepts [{channel, scale}]', () => eq(format([{ channel: 3, scale: 0.5 }]), 'channel[3] = 0.5'));
test('format ignores garbage entries', () => eq(format([[3, 'x'], [-1, 0], [5000, 0], [2, 0]]), 'channel[2] = 0'));

// round trip: parse(format(x)) == x for 200 random scale maps (within the language's limits)
test('round trip for 200 random scale maps', () => {
  let seed = 1337;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let made = 0;
  let tries = 0;
  while (made < 200 && tries < 10000) {
    tries += 1;
    const n = 1 + Math.floor(rand() * 40);
    const palette = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => Math.round(rand() * 3000) / 1000);
    const x = new Map();
    for (let i = 0; i < n; i++) x.set(Math.floor(rand() * 2048), palette[Math.floor(rand() * palette.length)]);
    for (const [c, s] of x) if (s === 1) x.delete(c);
    const text = format(x);
    if (text.length > LIMITS.MAX_CHARS) continue; // too long to be a program; not a round-trip case
    const p = parse(text);
    if (!p.ok) throw new Error(`format output did not parse: ${p.error.message}\n${text}`);
    const r = resolve(p.statements, resolver);
    if (!r.ok) throw new Error(r.error.message);
    const back = [...r.scales].sort((a, b) => a[0] - b[0]);
    const want = [...x].sort((a, b) => a[0] - b[0]);
    eq(back, want, `round trip #${made}`);
    eq(format(r.scales), text, 'format is stable');
    made += 1;
  }
  eq(made, 200, 'round-trip cases');
});

// ------------------------------------------------------------------------------------------- hostile input
const HOSTILE = [
  '__proto__', 'constructor', 'channel[top(1, "__proto__")] = 0', 'channel[top(1, "constructor")] = 0',
  'process.exit()', "require('fs')", '`${process.exit()}`', 'channel[`1`] = 0', 'x'.repeat(10000),
  'channel[１２] = 0', 'channel[1] = ٣', 'channel[1] = 0\u0000', '\u0000', 'eval("1")', 'new Function("x")',
  'import("fs")', 'channel[1] = 0; __proto__', 'channel[top(1, "toString")] = 0', '{}', '[]', 'channel[1] = 0 // c',
  '﻿channel[1] = 0', 'channel[1] = 0', 'channеl[1] = 0', '😀', 'channel[1] = 0 channel[2] = 0',
];
for (const text of HOSTILE) {
  test(`hostile: ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text)}`, () => {
    let r;
    try { r = run(text); } catch (e) { throw new Error(`threw ${e.message}`); }
    ok(r && r.ok === false, 'returns ok:false');
    ok(typeof r.error.message === 'string' && r.error.message.startsWith('Line '), r.error.message);
    ok(Number.isInteger(r.error.line) && Number.isInteger(r.error.col), 'has line and col');
  });
}
test('hostile: non-string input never throws', () => {
  for (const v of [null, undefined, 42, {}, [], Symbol('x'), { toString() { throw new Error('boom'); } }]) {
    const r = parse(v);
    ok(r.ok === false && r.error.line === 1, `parse(${String(typeof v)})`);
  }
  ok(resolve(null).ok === false, 'resolve(null)');
  ok(resolve([{ op: 'set', target: null }]).ok === false, 'resolve(malformed)');
  eq(format(null), '');
  eq(format({ get size() { throw new Error('boom'); } }), '');
});
test('hostile: unicode digits get a helpful message', () => {
  ok(err('channel[１２] = 0').message.includes('plain 0-9'), 'fullwidth digits');
});
test('hostile: null byte is named by code point', () => {
  ok(err('channel[1] = 0\u0000').message.includes('U+0000'), 'null byte');
});
test('hostile: a throwing resolver does not throw', () => {
  const p = parse('channel[top(2, "tabby")] = 0');
  const r = resolve(p.statements, { findClass: () => { throw new Error('boom'); } });
  ok(r.ok === false, 'ok:false');
});
test('hostile: prototype keys never resolve as classes', () => {
  const find = makeClassFinder(CLASSES);
  ok(find('__proto__').ok === false && find('constructor').ok === false && find('hasOwnProperty').ok === false, 'no match');
});
test('the module never uses eval, Function or dynamic import', () => {
  const code = readFileSync(new URL('./steer-dsl.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // strip comments
  for (const bad of [/\beval\s*\(/, /\bFunction\s*\(/, /\bimport\s*\(/, /\brequire\s*\(/, /setTimeout|setInterval/]) {
    ok(!bad.test(code), `steer-dsl.js matches ${bad}`);
  }
});

const total = passed + failures.length;
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`steer-dsl: ${passed}/${total} passed`);
process.exitCode = failures.length ? 1 : 0;
