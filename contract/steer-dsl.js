// The Steer language (contract v2 section 11). Pure ES module, no dependencies; runs in the browser and in Node.
//
//   reset
//   channel[SEL] *= NUMBER
//   channel[SEL] = NUMBER
//   SEL := INT | INT, INT, ... | top(N, "class label")
//
// A program starts from a fresh baseline (every scale 1), applies its statements in order and is the complete
// intervention. The tokenizer is hand-written; nothing here ever evaluates user text. Every public function
// returns {ok:false, error} instead of throwing.

export const LIMITS = Object.freeze({
  MAX_CHARS: 600,
  MAX_STATEMENTS: 20,
  MAX_CHANNELS: 64,
  MAX_CHANNEL: 2047,
  MAX_SCALE: 3,
  TOP_MIN: 1,
  TOP_MAX: 20,
});

class DslError extends Error {
  constructor(line, col, message, withCol = true) {
    super(withCol ? `Line ${line}, col ${col}: ${message}` : `Line ${line}: ${message}`);
    this.line = line;
    this.col = col;
  }
}

const fail = (err) => ({
  ok: false,
  error: err instanceof DslError
    ? { line: err.line, col: err.col, message: err.message }
    : { line: 1, col: 1, message: 'Line 1, col 1: the program could not be read' },
});

// ------------------------------------------------------------------------------------------------- tokenizer
const isDigit = (c) => c >= '0' && c <= '9';
const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c) => isIdentStart(c) || isDigit(c);
const isSpace = (c) => c === ' ' || c === '\t' || c === '\f' || c === '\v';
const UNICODE_DIGIT = /\p{Nd}/u;

function describe(c) {
  const code = c.codePointAt(0);
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  if (code < 0x20 || code === 0x7f) return hex;
  return code < 0x80 ? `"${c}"` : `"${c}" (${hex})`;
}

/** text → tokens [{type, value, line, col}]; types: ident number string punct newline eof. */
function tokenize(text) {
  const chars = Array.from(text); // code points, so columns count characters, not UTF-16 units
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const peek = (k = 0) => chars[i + k] ?? '';
  const advance = () => {
    const c = chars[i++];
    if (c === '\n') { line += 1; col = 1; } else col += 1;
    return c;
  };
  while (i < chars.length) {
    const c = peek();
    const at = { line, col };
    if (isSpace(c)) { advance(); continue; }
    if (c === '\r') { // \r\n or a lone \r both end a line
      advance();
      if (peek() === '\n') i += 1;
      tokens.push({ type: 'newline', ...at });
      line += 1; col = 1;
      continue;
    }
    if (c === '\n') { advance(); tokens.push({ type: 'newline', ...at }); continue; }
    if (c === '#') { while (i < chars.length && peek() !== '\n' && peek() !== '\r') advance(); continue; }
    if (isIdentStart(c)) {
      let s = '';
      while (isIdentPart(peek())) s += advance();
      tokens.push({ type: 'ident', value: s, ...at });
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(peek(1)))) {
      let s = '';
      while (isDigit(peek())) s += advance();
      if (peek() === '.') {
        s += advance();
        if (!isDigit(peek())) throw new DslError(at.line, at.col, `"${s}" is not a number; write it like 2 or 2.0`);
        while (isDigit(peek())) s += advance();
      }
      const next = peek();
      if (next === '.' || isIdentPart(next) || UNICODE_DIGIT.test(next)) {
        throw new DslError(at.line, at.col,
          `"${s}${next}…" is not a number; use plain decimals like 0.5 or 2 (no exponents, hex or units)`);
      }
      const value = Number(s);
      if (!Number.isFinite(value)) throw new DslError(at.line, at.col, 'that number is too large');
      tokens.push({ type: 'number', value, raw: s, isInt: !s.includes('.'), ...at });
      continue;
    }
    if (c === '"') {
      advance();
      let s = '';
      for (;;) {
        if (i >= chars.length || peek() === '\n' || peek() === '\r') {
          throw new DslError(at.line, at.col, 'this label has no closing quote');
        }
        const d = advance();
        if (d === '"') break;
        if (d === '\\') {
          const e = peek();
          if (e === '"' || e === '\\') { s += advance(); continue; }
          throw new DslError(line, col - 1, 'only \\" and \\\\ are allowed after a backslash in a label');
        }
        s += d;
      }
      tokens.push({ type: 'string', value: s, ...at });
      continue;
    }
    if (c === '*') {
      if (peek(1) !== '=') throw new DslError(at.line, at.col, 'expected "*=" ("*" on its own is not allowed)');
      advance(); advance();
      tokens.push({ type: 'punct', value: '*=', ...at });
      continue;
    }
    if ('[](),;='.includes(c)) {
      advance();
      tokens.push({ type: c === ';' ? 'newline' : 'punct', value: c, ...at });
      continue;
    }
    if (c === '-' && (isDigit(peek(1)) || peek(1) === '.')) {
      throw new DslError(at.line, at.col, 'negative numbers are not allowed (scales are 0 or more)');
    }
    if (UNICODE_DIGIT.test(c)) {
      throw new DslError(at.line, at.col, `unexpected character ${describe(c)}; write digits as plain 0-9`);
    }
    throw new DslError(at.line, at.col, `unexpected character ${describe(c)}`);
  }
  tokens.push({ type: 'eof', line, col });
  return tokens;
}

// ---------------------------------------------------------------------------------------------------- parser
const show = (t) => t.type === 'eof' ? 'the end of the program' : t.type === 'newline' ? 'the end of the line'
  : t.type === 'string' ? `"${t.value}"` : `"${t.raw ?? t.value}"`;

function parseStatements(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isPunct = (t, v) => t.type === 'punct' && t.value === v;
  const statements = [];
  const distinct = new Set();

  function selector(open) {
    const first = peek();
    if (first.type === 'ident' && first.value.toLowerCase() === 'top') {
      const topErr = (t) => new DslError(t.line, t.col, 'top() takes a number 1–20 and a class label in quotes');
      next();
      if (!isPunct(peek(), '(')) throw topErr(peek());
      next();
      const n = next();
      if (n.type !== 'number' || !n.isInt || n.value < LIMITS.TOP_MIN || n.value > LIMITS.TOP_MAX) throw topErr(n);
      if (!isPunct(peek(), ',')) throw topErr(peek());
      next();
      const label = next();
      if (label.type !== 'string' || !label.value.trim()) throw topErr(label);
      if (!isPunct(peek(), ')')) throw topErr(peek());
      next();
      return { kind: 'top', n: n.value, label: label.value.trim(), line: first.line, col: first.col };
    }
    const channels = [];
    for (;;) {
      const t = next();
      if (t.type !== 'number') {
        if (isPunct(t, ']') && channels.length === 0) {
          throw new DslError(open.line, open.col, 'channel[] needs at least one channel index or top(N, "label")');
        }
        throw new DslError(t.line, t.col, `expected a channel index (0–2047), found ${show(t)}`);
      }
      if (!t.isInt) throw new DslError(t.line, t.col, `channel index ${t.raw} must be a whole number`);
      if (t.value > LIMITS.MAX_CHANNEL) {
        throw new DslError(t.line, t.col, `channel index ${t.raw} is out of range (0–2047)`);
      }
      channels.push(t.value);
      distinct.add(t.value);
      if (distinct.size > LIMITS.MAX_CHANNELS) {
        throw new DslError(t.line, t.col, `a program can change at most ${LIMITS.MAX_CHANNELS} distinct channels`);
      }
      if (isPunct(peek(), ',')) { next(); continue; }
      return { kind: 'channels', channels: [...new Set(channels)] };
    }
  }

  while (peek().type !== 'eof') {
    const t = peek();
    if (t.type === 'newline') { next(); continue; }
    if (statements.length >= LIMITS.MAX_STATEMENTS) {
      throw new DslError(t.line, t.col, `a program can have at most ${LIMITS.MAX_STATEMENTS} statements`);
    }
    if (t.type !== 'ident') {
      throw new DslError(t.line, t.col, `a statement starts with "channel[...]" or "reset", not ${show(t)}`);
    }
    const word = t.value.toLowerCase();
    next();
    if (word === 'reset') {
      statements.push({ op: 'reset', line: t.line, col: t.col });
    } else if (word === 'channel') {
      const open = next();
      if (!isPunct(open, '[')) throw new DslError(open.line, open.col, `expected "[" after channel, found ${show(open)}`);
      const target = selector(open);
      const close = next();
      if (!isPunct(close, ']')) {
        throw new DslError(close.line, close.col, `expected "," or "]" in channel[...], found ${show(close)}`);
      }
      const op = next();
      if (!isPunct(op, '*=') && !isPunct(op, '=')) {
        throw new DslError(op.line, op.col, 'expected "*=" or "=" after channel[...]', false);
      }
      const v = next();
      if (v.type !== 'number') throw new DslError(v.line, v.col, `expected a number after "${op.value}", found ${show(v)}`);
      statements.push({ op: op.value === '=' ? 'set' : 'mul', target, value: v.value, line: t.line, col: t.col });
    } else {
      throw new DslError(t.line, t.col, `unknown statement "${t.value}"; expected "channel[...]" or "reset"`);
    }
    const end = peek();
    if (end.type !== 'newline' && end.type !== 'eof') {
      throw new DslError(end.line, end.col,
        `unexpected ${show(end)} after the statement; put each statement on its own line or separate them with ";"`);
    }
  }
  return statements;
}

/**
 * Parse a Steer program (syntax only; top() labels are checked by resolve()).
 * @returns {{ok:true, statements:object[]} | {ok:false, error:{line:number, col:number, message:string}}}
 */
export function parse(text) {
  try {
    if (typeof text !== 'string') throw new DslError(1, 1, 'the program must be text');
    const chars = Array.from(text);
    if (chars.length > LIMITS.MAX_CHARS) {
      let line = 1;
      let col = 1;
      for (let i = 0; i < LIMITS.MAX_CHARS; i++) if (chars[i] === '\n') { line += 1; col = 1; } else col += 1;
      throw new DslError(line, col, `the program is ${chars.length} characters; the limit is ${LIMITS.MAX_CHARS}`);
    }
    return { ok: true, statements: parseStatements(tokenize(text)) };
  } catch (err) {
    return fail(err);
  }
}

// --------------------------------------------------------------------------------------------- class labels
function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * A findClass(label) for resolve(), over [{classId, label}]. Case-insensitive: an exact match first (the lowest
 * classId if two classes share a name), then a unique prefix; otherwise an error naming the closest label.
 * @returns {(label:string) => ({ok:true, classId:number, label:string} | {ok:false, message:string})}
 */
export function makeClassFinder(classes) {
  const list = (classes ?? [])
    .filter((c) => c && Number.isInteger(c.classId) && typeof c.label === 'string')
    .map((c) => ({ classId: c.classId, label: c.label, key: c.label.toLowerCase() }))
    .sort((a, b) => a.classId - b.classId);
  const exact = new Map();
  for (const c of list) if (!exact.has(c.key)) exact.set(c.key, c);
  return (label) => {
    const key = String(label ?? '').trim().toLowerCase();
    const hit = exact.get(key);
    if (hit) return { ok: true, classId: hit.classId, label: hit.label };
    const prefixed = key ? list.filter((c) => c.key.startsWith(key)) : [];
    if (prefixed.length === 1) return { ok: true, classId: prefixed[0].classId, label: prefixed[0].label };
    const pool = prefixed.length > 1 ? prefixed : list;
    // closest: the whole label, or one of its words. A word match costs a little extra (+0.5 for the last word, the
    // head noun as in "timber wolf"; +0.75 for any other, as in "wolf spider"); ties go to the lowest classId.
    let best = null;
    let bestD = Infinity;
    for (const c of pool) {
      let d = editDistance(key, c.key);
      const words = c.key.split(/[\s_-]+/);
      if (words.length > 1) {
        words.forEach((w, i) => { d = Math.min(d, editDistance(key, w) + (i === words.length - 1 ? 0.5 : 0.75)); });
      }
      if (d < bestD) { bestD = d; best = c; }
    }
    const shown = String(label ?? '').trim();
    if (!best) return { ok: false, message: `No class called "${shown}".` };
    return prefixed.length > 1
      ? { ok: false, message: `"${shown}" matches ${prefixed.length} classes. Did you mean "${best.label}"?` }
      : { ok: false, message: `No class called "${shown}". Did you mean "${best.label}"?` };
  };
}

// -------------------------------------------------------------------------------------------------- resolve
const clampScale = (s) => Math.min(LIMITS.MAX_SCALE, Math.max(0, s));

/**
 * Apply parsed statements from a fresh baseline (every scale 1).
 * resolver.findClass(label) → {ok, classId} | {ok:false, message} | classId | null
 * resolver.topChannels(classId, n) → channel indices, strongest first
 * @returns {{ok:true, scales:Map<number, number>} | {ok:false, error:{line, col, message}}}  scales lists only scale ≠ 1
 */
export function resolve(statements, resolver = {}) {
  try {
    if (!Array.isArray(statements)) throw new DslError(1, 1, 'nothing to resolve');
    const scales = new Map();
    const touched = new Set();
    for (const st of statements) {
      if (st.op === 'reset') { scales.clear(); continue; }
      let channels;
      if (st.target.kind === 'top') {
        const t = st.target;
        const found = typeof resolver.findClass === 'function' ? resolver.findClass(t.label) : null;
        const classId = typeof found === 'number' ? found : found?.ok ? found.classId : null;
        if (!Number.isInteger(classId)) {
          throw new DslError(t.line, t.col, found?.message ?? `No class called "${t.label}".`);
        }
        const got = typeof resolver.topChannels === 'function' ? resolver.topChannels(classId, t.n) : null;
        if (!Array.isArray(got)) throw new DslError(t.line, t.col, `no channel data for "${t.label}"`);
        channels = got.slice(0, t.n).filter((c) => Number.isInteger(c) && c >= 0 && c <= LIMITS.MAX_CHANNEL);
      } else {
        channels = st.target.channels;
      }
      for (const c of channels) {
        touched.add(c);
        if (touched.size > LIMITS.MAX_CHANNELS) {
          throw new DslError(st.line, st.col, `a program can change at most ${LIMITS.MAX_CHANNELS} distinct channels`);
        }
        const now = scales.get(c) ?? 1;
        scales.set(c, clampScale(st.op === 'set' ? st.value : now * st.value));
      }
    }
    for (const [c, s] of scales) if (s === 1) scales.delete(c);
    return { ok: true, scales };
  } catch (err) {
    return fail(err);
  }
}

// --------------------------------------------------------------------------------------------------- format
const round3 = (s) => Math.round(s * 1000) / 1000;

function entriesOf(scales) {
  if (scales instanceof Map) return [...scales.entries()];
  if (Array.isArray(scales)) {
    return scales.map((e) => (Array.isArray(e) ? e : [e?.channel, e?.scale]));
  }
  return [];
}

/**
 * Canonical program text for a set of scales: channels grouped by equal scale (rounded to 3 decimals), "=" form,
 * groups by ascending scale, channels ascending; scale-1 channels left out. "" when nothing is changed.
 * Note: a slider set with many different scales can format to more than 20 statements or 600 characters.
 */
export function format(scales) {
  try {
    const groups = new Map();
    for (const [c, s] of entriesOf(scales)) {
      if (!Number.isInteger(c) || c < 0 || c > LIMITS.MAX_CHANNEL || typeof s !== 'number' || !Number.isFinite(s)) continue;
      const r = round3(clampScale(s));
      if (r === 1) continue;
      if (!groups.has(r)) groups.set(r, new Set());
      groups.get(r).add(c);
    }
    return [...groups.keys()].sort((a, b) => a - b)
      .map((s) => `channel[${[...groups.get(s)].sort((a, b) => a - b).join(', ')}] = ${String(s)}`)
      .join('\n');
  } catch {
    return '';
  }
}
