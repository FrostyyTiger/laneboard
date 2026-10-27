// The room link's message checks against the protocol's own examples
// (spec protocols.md §2.4, §9, D98, D136). Every JSON example of
// docs/cockpit/protocol.md (the night's copy of the spec, D136) is a fixture:
// each validates against its class's checks; for each field §2.4 lists as
// required in that fixture's case, a copy without it fails with `bad-message`
// naming the field; a copy with an unknown field still validates; and the
// types of §2.4's two tables equal the types server/cockpit/protocol.mjs
// knows. So a message added to the code but not to the protocol fails, and so
// does one added to the protocol but not to the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  checkMessage, checkItem, checkTurn, SCREEN_TYPES, ROOM_TYPES, ITEM_KINDS,
} from '../server/cockpit/protocol.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOC = 'docs/cockpit/protocol.md';
const TEXT = fs.readFileSync(path.join(ROOT, DOC), 'utf8');
const LINES = TEXT.split('\n');

// ---------------------------------------------------------------- extraction (§9)

const FENCE_CLASSES = new Set(['json', 'json item', 'json bridge', 'json claude', 'json stt']);

/** The section number (`2`, `11`) a `## N.` heading opens; `### 11.4` gives `11.4` as sub. */
function sections() {
  const out = [];
  let sec = 0;
  let sub = '';
  for (const l of LINES) {
    const h2 = /^## (\d+)\./.exec(l);
    if (h2) { sec = Number(h2[1]); sub = ''; }
    const h3 = /^### (\d+\.\d+(?:\.\d+)?) /.exec(l);
    if (h3) sub = h3[1];
    out.push({ sec, sub });
  }
  return out;
}

function spanClass(sec, sub, inFirstCell) {
  if (sec === 12) return 'json stt';
  if (sec === 11) return sub === '11.4' && inFirstCell ? 'json claude' : 'json bridge';
  if (sec >= 13) return 'json bridge';
  return 'json';
}

/** Every fixture: {cls, value, where}; and every span that should have parsed but did not. */
function extract() {
  const secs = sections();
  const fixtures = [];
  const broken = [];
  let fence = null;
  for (let i = 0; i < LINES.length; i++) {
    const l = LINES[i];
    const open = /^\s*```(.*)$/.exec(l);
    if (open) {
      if (fence) {
        if (fence.cls) {
          const src = fence.body.join('\n');
          let value;
          try { value = JSON.parse(src); } catch (e) { broken.push(`${DOC}:${fence.line} \`\`\`${fence.cls} does not parse: ${e.message}`); }
          if (value !== undefined) fixtures.push({ cls: fence.cls, value, where: `${DOC}:${fence.line}` });
        }
        fence = null;
      } else {
        const info = open[1].trim();
        fence = { cls: FENCE_CLASSES.has(info) ? info : null, body: [], line: i + 1 };
      }
      continue;
    }
    if (fence) { fence.body.push(l); continue; }
    const { sec, sub } = secs[i];
    const isRow = l.startsWith('|');
    const firstCellEnd = isRow ? l.replace(/\\\|/g, '\0\0').indexOf('|', 1) : -1;
    for (const m of l.matchAll(/`([^`\n]+)`/g)) {
      const body = m[1];
      if (!body.startsWith('{')) continue;
      const cls = spanClass(sec, sub, isRow && m.index < firstCellEnd);
      let value;
      try { value = JSON.parse(body); } catch {
        if (/^\{\s*"type"/.test(body) && !body.includes('…')) broken.push(`${DOC}:${i + 1} span does not parse: ${body}`);
        continue;
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      const keyed = typeof value.type === 'string' || (sec === 12 && typeof value.status === 'string');
      if (keyed) fixtures.push({ cls, value, where: `${DOC}:${i + 1}` });
    }
  }
  return { fixtures, broken };
}

const { fixtures: FIXTURES, broken: BROKEN } = extract();
const linkFixtures = FIXTURES.filter((f) => f.cls === 'json');
const itemFixtures = FIXTURES.filter((f) => f.cls === 'json item');

// ---------------------------------------------------------------- §2.4's tables

/** The rows of the table that follows `marker` inside §2.4, cells split (`\|` kept as `|`). */
function tableAfter(marker) {
  const from = TEXT.indexOf('### 2.4 ');
  const at = TEXT.indexOf(marker, from);
  assert.ok(at > 0, `§2.4 has "${marker}"`);
  const rows = [];
  let started = false;
  for (const l of TEXT.slice(at).split('\n').slice(1)) {
    if (l.startsWith('|')) {
      started = true;
      const cells = l.replace(/\\\|/g, '\0').split('|').slice(1, -1).map((c) => c.replace(/\0/g, '|').trim());
      if (/^-+$/.test(cells[0]) || cells[0] === '`type`' || cells[0] === 'Shape') continue;
      rows.push(cells);
    } else if (started) break;
  }
  return rows;
}

const names = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\|null$/, ''));

/** Split at depth 0 (outside parentheses) on `sep`. */
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const SCREEN_ROWS = tableAfter('**Screen → room**');
const ROOM_ROWS = tableAfter('**Room → screen:**');
const SHAPE_ROWS = tableAfter('**Turns and items**');

function rowFor(type) {
  for (const r of SCREEN_ROWS) if (names(r[0]).includes(type)) return { required: r[1], seq: 'link' };
  for (const r of ROOM_ROWS) if (names(r[0]).includes(type)) return { required: r[2], seq: r[1] };
  return null;
}
const shapeRow = (label) => SHAPE_ROWS.find((r) => r[0] === label)?.[1];

const has = (v, k) => v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, k);

/**
 * The paths a cell of §2.4 makes required in `value`'s case: the plain names;
 * a "with X" (or "when", "while") name when the fixture is in that case (a
 * field "with X" is present exactly then); a parenthesis after an object or a
 * list of objects names its own fields; "in the object" names the previous
 * field's.
 */
function requiredPaths(cell, value, prefix = '') {
  const out = [];
  let last = null;
  for (const part of splitTop(cell, ';')) {
    const inObject = /^in the object /.exec(part);
    if (inObject) {
      if (last && has(value, last) && value[last] && typeof value[last] === 'object') {
        for (const n of names(part)) out.push(`${prefix}${last}.${n}`);
      }
      continue;
    }
    // "with X" outside any parenthesis: inside one it is a nested field's.
    const top = part.replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '()');
    const cond = /^(.*?)\s(?:with|when|while)\s/.exec(top);
    if (cond) {
      for (const n of names(cond[1])) if (has(value, n)) out.push(`${prefix}${n}`);
      continue;
    }
    for (const tok of splitTop(part, ',')) {
      const ref = /`([a-z.]+)`'s (required )?fields(?: but `([a-zA-Z]+)`)?/.exec(tok);
      if (ref) {
        // "and `show.line`'s required fields but `turnId`" / "`turn.end`'s fields "with X"".
        const row = rowFor(ref[1]);
        const sub = requiredPaths(row.required, value, prefix).filter((p) => p !== `${prefix}${ref[3]}`);
        out.push(...(ref[2] ? sub : sub.filter((p) => !['turnId', 'state', 'at'].includes(p.slice(prefix.length)))));
        continue;
      }
      const n = names(tok)[0];
      if (!n) continue;
      if (n.includes('.')) continue; // a value or another message, not a field
      out.push(`${prefix}${n}`);
      last = n;
      const inner = /^`[^`]+`\s*\((.*)\)$/.exec(tok);
      if (!inner || !has(value, n)) continue;
      const v = value[n];
      if (Array.isArray(v) && /^each /.test(inner[1]) && v[0] && typeof v[0] === 'object') {
        out.push(...requiredPaths(inner[1].replace(/^each /, ''), v[0], `${prefix}${n}[0].`));
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        out.push(...requiredPaths(inner[1], v, `${prefix}${n}.`));
      }
    }
  }
  return [...new Set(out)];
}

function messagePaths(msg) {
  const row = rowFor(msg.type);
  assert.ok(row, `§2.4 has a row for ${msg.type}`);
  const paths = requiredPaths(row.required, msg);
  if (row.seq === '`room`' && !paths.includes('seq')) paths.unshift('seq');
  return paths;
}

function itemPaths(item) {
  const cell = shapeRow(`item \`${item.kind}\``);
  assert.ok(cell, `§2.4's items table has item ${item.kind}`);
  return requiredPaths(cell, item);
}

/** A deep copy of `v` without the field at `p` (`a.b`, `items[0].key`). */
function without(v, p) {
  const copy = structuredClone(v);
  const keys = p.replace(/\[(\d+)\]/g, '.$1').split('.');
  let o = copy;
  for (const k of keys.slice(0, -1)) o = o[k];
  delete o[keys.at(-1)];
  return copy;
}

const dirOf = (type) => (SCREEN_TYPES.includes(type) ? 'in' : ROOM_TYPES.includes(type) ? 'out' : null);

// ---------------------------------------------------------------- the tests

test('the protocol copy exists and every fixture parses (§9 rules 1-3)', () => {
  assert.deepEqual(BROKEN, []);
  assert.ok(linkFixtures.length >= 70, `found ${linkFixtures.length} room-link fixtures`);
  for (const cls of FENCE_CLASSES) assert.ok(FIXTURES.some((f) => f.cls === cls), `a ${cls} fixture`);
});

test('the two directions know distinct types', () => {
  assert.deepEqual(SCREEN_TYPES.filter((t) => ROOM_TYPES.includes(t)), []);
});

test("§2.4's types equal the module's, both ways", () => {
  const screen = SCREEN_ROWS.flatMap((r) => names(r[0]));
  const room = ROOM_ROWS.flatMap((r) => names(r[0]));
  assert.deepEqual([...screen].sort(), [...SCREEN_TYPES].sort());
  assert.deepEqual([...room].sort(), [...ROOM_TYPES].sort());
  const kinds = SHAPE_ROWS.map((r) => /^item `([a-z]+)`$/.exec(r[0])?.[1]).filter(Boolean);
  assert.deepEqual([...kinds].sort(), [...ITEM_KINDS].sort());
});

test('every type and every item kind has at least one fixture', () => {
  const seen = new Set(linkFixtures.map((f) => f.value.type));
  for (const t of [...SCREEN_TYPES, ...ROOM_TYPES]) assert.ok(seen.has(t), `no fixture for ${t}`);
  const items = new Set([
    ...itemFixtures.map((f) => f.value.kind),
    ...linkFixtures.flatMap((f) => (f.value.turns ?? []).flatMap((t) => t.items.map((i) => i.kind))),
  ]);
  // A `show` item is a `show.line` without `turnId` (§2.4); its fixture is that message's.
  if (seen.has('show.line')) items.add('show');
  for (const k of ITEM_KINDS) assert.ok(items.has(k), `no fixture for item ${k}`);
});

test('every room-link fixture validates, and with an unknown field added too (§2.1)', () => {
  for (const { value, where } of linkFixtures) {
    const dir = dirOf(value.type);
    assert.ok(dir, `${where}: ${value.type} is a type of §2.4`);
    assert.deepEqual(checkMessage(value, dir), { ok: true }, `${where}: ${JSON.stringify(value)}`);
    assert.deepEqual(checkMessage({ ...value, zzNewer: [1, { x: 2 }] }, dir), { ok: true }, `${where} + unknown field`);
  }
  for (const { value, where } of itemFixtures) {
    assert.deepEqual(checkItem(value), { ok: true }, `${where}: ${JSON.stringify(value)}`);
    assert.deepEqual(checkItem({ ...value, zzNewer: true }), { ok: true }, `${where} + unknown field`);
  }
});

test('each required field dropped fails with bad-message naming it', () => {
  let cases = 0;
  for (const { value, where } of linkFixtures) {
    const dir = dirOf(value.type);
    const paths = messagePaths(value);
    assert.ok(paths.length, `${where}: ${value.type} has required fields`);
    for (const p of paths) {
      const r = checkMessage(without(value, p), dir);
      assert.equal(r.ok, false, `${where}: ${value.type} without ${p} validated`);
      assert.equal(r.code, 'bad-message', `${where}: ${value.type} without ${p}`);
      assert.equal(r.field, p, `${where}: ${value.type} without ${p} names ${r.field} (${r.message})`);
      assert.match(r.message, new RegExp(`^${value.type.replace(/\./g, '\\.')}\\.`));
      cases++;
    }
  }
  assert.ok(cases > 300, `${cases} drop cases`);
});

test('turns and items in snapshots: each required field dropped fails', () => {
  const turns = linkFixtures.flatMap((f) => f.value.turns ?? []);
  assert.ok(turns.length, 'a snapshot with turns');
  for (const turn of turns) {
    assert.deepEqual(checkTurn(turn), { ok: true });
    for (const p of requiredPaths(shapeRow('turn'), turn)) {
      const r = checkTurn(without(turn, p));
      assert.equal(r.field, p, `turn without ${p}: ${r.message}`);
    }
    for (const p of requiredPaths(shapeRow('`end`'), turn.end ?? {}, 'end.')) {
      assert.equal(checkTurn(without(turn, p)).field, p, `turn without ${p}`);
    }
    for (const item of turn.items) {
      assert.deepEqual(checkItem(item), { ok: true });
      for (const p of itemPaths(item)) assert.equal(checkItem(without(item, p)).field, p, `${item.kind} item without ${p}`);
    }
  }
  for (const { value } of itemFixtures) {
    for (const p of itemPaths(value)) assert.equal(checkItem(without(value, p)).field, p, `${value.kind} item without ${p}`);
  }
});

// ---------------------------------------------------------------- value rules, by hand

const fixture = (type) => structuredClone(linkFixtures.find((f) => f.value.type === type).value);
const check = (msg, opts) => checkMessage(msg, dirOf(msg.type), opts);
const fails = (msg, field, opts) => {
  const r = check(msg, opts);
  assert.equal(r.ok, false, `${JSON.stringify(msg)} validated`);
  assert.equal(r.code, 'bad-message');
  assert.equal(r.field, field, r.message);
};

test('unknown and malformed types (§2.1, §2.3)', () => {
  assert.equal(checkMessage({ type: 'launch', seq: 1 }, 'in').code, 'unknown-type');
  assert.equal(checkMessage({ type: 'turn.end', seq: 1 }, 'in').code, 'unknown-type', 'a room type from the screen');
  assert.equal(checkMessage({ type: 'prompt', seq: 1 }, 'out').code, 'unknown-type');
  assert.equal(checkMessage({ type: 'Bad Type' }, 'in').code, 'bad-message');
  assert.equal(checkMessage({ seq: 1 }, 'in').code, 'bad-message');
  assert.equal(checkMessage([], 'in').code, 'bad-message');
  assert.equal(checkMessage(null, 'out').code, 'bad-message');
  assert.equal(checkMessage({ type: 'constructor', seq: 1 }, 'in').code, 'unknown-type', 'no prototype keys');
  assert.throws(() => checkMessage({ type: 'new', seq: 1 }, 'both'), TypeError);
});

test('prompt (§3.1): text, clientId, source, focus', () => {
  const p = fixture('prompt');
  assert.deepEqual(check(p), { ok: true });
  fails({ ...p, text: '' }, 'text');
  fails({ ...p, text: '   \n ' }, 'text');
  assert.deepEqual(check({ ...p, text: 'x'.repeat(8000) }), { ok: true });
  fails({ ...p, text: 'x'.repeat(8001) }, 'text');
  fails({ ...p, text: 'x'.repeat(101) }, 'text', { maxPromptChars: 100 });
  fails({ ...p, clientId: 'p-3C1E0B2A' }, 'clientId');
  fails({ ...p, clientId: 'p-3c1e0b2' }, 'clientId');
  fails({ ...p, source: 'speak-up' }, 'source', undefined);
  fails({ ...p, sentAt: '1793080924120' }, 'sentAt');
  fails({ ...p, lang: 'German' }, 'lang');
  fails({ ...p, focus: { ...p.focus, pane: 'half' } }, 'focus.pane');
  fails({ ...p, focus: { ...p.focus, inSight: Array.from({ length: 61 }, (_, i) => `n${i}`) } }, 'focus.inSight');
  const { at, ...noAt } = fixture('focus');
  void at;
  assert.deepEqual(check({ ...p, focus: { ...noAt, type: undefined, seq: undefined } }), { ok: true }, 'focus without type, seq, at');
});

test('focus (c3-see.md §8.1): the exact refusal line of §2.3, route and ids', () => {
  const f = fixture('focus');
  assert.deepEqual(check(f), { ok: true });
  const r = check({ ...f, inSight: Array.from({ length: 61 }, (_, i) => `n${i}`) });
  assert.equal(r.message, 'focus.inSight: more than 60 ids');
  assert.deepEqual(check({ ...f, inSight: Array.from({ length: 60 }, (_, i) => `n${i}`) }), { ok: true });
  fails({ ...f, inSight: ['x'.repeat(129)] }, 'inSight[0]');
  fails({ ...f, inSight: ['a\u0007b'] }, 'inSight[0]');
  fails({ ...f, route: { view: 'map', sel: `node:${'x'.repeat(300)}` } }, 'route.sel');
  fails({ ...f, route: { view: 'map', q: 'a\nb' } }, 'route.q');
  fails({ ...f, route: 'map' }, 'route');
  assert.deepEqual(check({ ...f, route: { view: 'map', zz: 'dropped later' } }), { ok: true }, 'unknown route keys are parseHash\'s to drop');
  fails({ ...f, wallState: 'sleep' }, 'wallState');
  fails({ ...f, layout: 'grid' }, 'layout');
  fails({ ...f, at: '2026-10-27 07:12' }, 'at');
  fails({ ...f, at: '2026-10-27T07:12:28' }, 'at', undefined);
});

test('hello (§2.2): epoch and lastSeq both or neither', () => {
  const h = fixture('hello');
  assert.deepEqual(check(h), { ok: true });
  const { epoch, lastSeq, ...fresh } = h;
  void epoch; void lastSeq;
  assert.deepEqual(check(fresh), { ok: true });
  fails({ ...fresh, epoch: 'r-5f2c9a' }, 'lastSeq');
  fails({ ...fresh, lastSeq: 3 }, 'epoch');
  fails({ ...h, page: 'board' }, 'page');
  fails({ ...h, seq: 0 }, 'seq');
});

test('history count 1 to 50 (§3.7)', () => {
  const h = fixture('history');
  assert.deepEqual(check({ ...h, count: 1 }), { ok: true });
  fails({ ...h, count: 0 }, 'count');
  fails({ ...h, count: 51 }, 'count');
  fails({ ...h, count: 2.5 }, 'count');
});

test("show.result: B00's four whys, `why` only with skipped (§4, §2.4)", () => {
  const s = fixture('show.result');
  for (const why of ['in use', 'unsupported', 'not drawn', 'bad-args']) {
    assert.deepEqual(check({ ...s, state: 'skipped', why }), { ok: true }, why);
  }
  fails({ ...s, state: 'skipped' }, 'why');
  fails({ ...s, state: 'skipped', why: 'busy' }, 'why');
  fails({ ...s, state: 'shown', why: 'in use' }, 'why');
  fails({ ...s, state: 'gone' }, 'state');
});

test('turn.end: each state with exactly its fields (§3.2)', () => {
  const base = { type: 'turn.end', seq: 9, turnId: 't-0133', at: '2026-10-27T07:05:40+01:00' };
  assert.deepEqual(check({ ...base, state: 'done' }), { ok: true });
  assert.deepEqual(check({ ...base, state: 'stopped', forced: true }), { ok: true });
  fails({ ...base, state: 'stopped' }, 'forced');
  fails({ ...base, state: 'done', forced: false }, 'forced');
  assert.deepEqual(check({ ...base, state: 'error', code: 'agent-exited' }), { ok: true });
  assert.deepEqual(check({ ...base, state: 'error', code: 'not-logged-in' }), { ok: true });
  fails({ ...base, state: 'error', code: 'agent-down' }, 'detail');
  assert.deepEqual(check({ ...base, state: 'error', code: 'failed', detail: 'API Error: 529 overloaded' }), { ok: true });
  fails({ ...base, state: 'error', code: 'failed', detail: 'x'.repeat(121) }, 'detail');
  fails({ ...base, state: 'error', code: 'step-limit' }, 'steps');
  fails({ ...base, state: 'error', code: 'oops' }, 'code');
  fails({ ...base, state: 'error' }, 'code');
  fails({ ...base, state: 'done', code: 'failed' }, 'code');
});

test('tool.end: denied always with isError (§3.2); tool ids are the room\'s (D102)', () => {
  const e = fixture('tool.end');
  assert.deepEqual(check({ ...e, isError: true, denied: true }), { ok: true });
  fails({ ...e, isError: false, denied: true }, 'isError');
  fails({ ...e, toolUseId: 'toolu_01A9' }, 'toolUseId');
  fails({ ...fixture('tool.start'), input: 'window=tonight' }, 'input');
});

test('turn.prompt: the once-only repeat has no seq; speak-up turns carry their block (§3.1, §3.9)', () => {
  const t = fixture('turn.prompt');
  const { seq, ...repeat } = t;
  void seq;
  assert.deepEqual(check(repeat), { ok: true });
  assert.deepEqual(check({ ...t, delivery: 'new', from: 'queued' }), { ok: true });
  fails({ ...t, from: 'later' }, 'from');
  fails({ ...t, source: 'speak-up', clientId: null, screen: null }, 'speakup');
  fails({ ...t, speakup: 'su-0012' }, 'speakup');
  fails({ ...t, delivery: 'now' }, 'delivery');
});

test('prompt.taken, prompt.refused, status, error codes', () => {
  const p = fixture('prompt.taken');
  fails({ ...p, state: 'cancelled' }, 'atBlock');
  assert.deepEqual(check({ ...p, state: 'cancelled', atBlock: undefined, why: 'stopped' }), { ok: true });
  fails({ ...p, state: 'cancelled', atBlock: undefined, why: 'bored' }, 'why');
  const r = fixture('prompt.refused');
  for (const code of ['agent-down', 'too-many', 'audit-unavailable']) assert.deepEqual(check({ ...r, code }), { ok: true });
  fails({ ...r, code: 'nope' }, 'code');
  const s = fixture('status');
  assert.deepEqual(check({ ...s, status: null }), { ok: true });
  fails({ ...s, status: { ...s.status, code: 'room-down' } }, 'status.code', undefined);
  fails({ ...s, status: { code: 'agent-down' } }, 'status.since');
  const e = fixture('error');
  for (const code of ['bad-message', 'unknown-type', 'unknown-id', 'too-many', 'not-now', 'not-yours', 'not-a-person', 'too-late']) {
    assert.deepEqual(check({ ...e, code }), { ok: true }, code);
  }
  fails({ ...e, code: 'nope' }, 'code');
});

test('snapshot: parts, turns and their items', () => {
  const s = fixture('snapshot');
  fails({ ...s, part: 2, parts: 1 }, 'part');
  const turn = s.turns[0];
  fails({ ...s, turns: [{ ...turn, state: 'thinking' }] }, 'turns[0].end');
  const { end, ...running } = turn;
  void end;
  assert.deepEqual(check({ ...s, turns: [{ ...running, state: 'working' }] }), { ok: true }, 'a running turn has no end');
  fails({ ...s, turns: [{ ...turn, items: [{ kind: 'image', blockIndex: 2 }] }] }, 'turns[0].items[0].kind');
  const tool = turn.items[0];
  const { endedAt, ...noEnd } = tool;
  void endedAt;
  fails({ ...s, turns: [{ ...turn, items: [noEnd] }] }, 'turns[0].items[0].endedAt');
  const { endedAt: e2, isError, ...open } = tool;
  void e2; void isError;
  assert.deepEqual(check({ ...s, turns: [{ ...turn, items: [open] }] }), { ok: true }, 'a running call has neither');
  assert.deepEqual(check({ ...s, confirm: null, speakups: [], jobs: [] }), { ok: true });
});

test('opts.languages limits audio.start.lang (D48)', () => {
  const a = fixture('audio.start');
  assert.deepEqual(check(a, { languages: ['en', 'de'] }), { ok: true });
  fails(a, 'lang', { languages: ['en'] });
  assert.deepEqual(check({ ...a, lang: 'auto' }, { languages: ['auto'] }), { ok: true });
});

// The bridge's own checks are `server/cockpit/bridge-events.mjs` (§13, T9);
// here only §9's reverse rule: every §11.3 type has a fixture, and every
// `json bridge` fixture is a §11.3 type.
test('every bridge type of §11.3 has a fixture, and no fixture is of another type', () => {
  const from = TEXT.indexOf('### 11.3 ');
  const to = TEXT.indexOf('### 11.4 ', from);
  const types = new Set();
  for (const l of TEXT.slice(from, to).split('\n')) {
    const m = /^\| `([a-z.]+)` \|/.exec(l);
    if (m && m[1] !== 'type') types.add(m[1]);
  }
  assert.ok(types.size >= 11, `read ${types.size} bridge types`);
  const bridge = FIXTURES.filter((f) => f.cls === 'json bridge');
  const seen = new Set(bridge.map((f) => f.value.type));
  for (const t of types) assert.ok(seen.has(t), `no json bridge fixture for ${t}`);
  for (const f of bridge) assert.ok(types.has(f.value.type), `${f.where}: ${f.value.type} is not a §11.3 type`);
});
