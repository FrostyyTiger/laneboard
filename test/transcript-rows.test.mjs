// Transcript rows (fleet plan §10 R12): the pure core/transcript-rows.js
// (rowsFor, cleaning, caps, the tail merge) and the PEEK inspector tab
// (views/peek.js) in the fake DOM: preview and transcript reads, the touch,
// the guarded reply with its confirm, the quick buttons and the DIFF link.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument } from './helpers/fakedom.mjs';
import {
  rowsFor, rowFor, cleanRowText, truncate, mergeTail, emptyTail, timeOf, CAPS, ELLIPSIS, LABEL_CAP, KEEP_ENTRIES,
} from '../public/js/core/transcript-rows.js';
import {
  peekTarget, sessionUrl, replyArgs, refusalText, diffHref, previewLinesOf, mountPeek, mountDiffLink, init,
  QUICK, PREVIEW_N, REPLY_MAX, TOUCH_HOW_PEEK,
} from '../public/js/views/peek.js';
import { registeredTabs, _resetTabs } from '../public/js/ui/inspector.js';
import { createStore } from '../public/js/core/store.js';
import { entriesFromLine } from '../server/review/transcript.mjs';
import { HOWS } from '../server/hub/reviewwait.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EVIL = '<img src=x onerror=alert(1)>';

/** Entries from R4's fixture, through the server's own line mapper. */
function fixtureEntries() {
  const raw = read('test/fixtures/transcript/session.jsonl');
  const out = [];
  let off = 0;
  for (const line of raw.split('\n')) {
    const bytes = Buffer.byteLength(line) + 1;
    try { out.push(...entriesFromLine(JSON.parse(line), off)); } catch { /* malformed or partial */ }
    off += bytes;
  }
  return out;
}

// ---------------------------------------------------------------- rows

test('rowsFor maps every role of the R4 fixture to a labelled plain-text row', () => {
  const entries = fixtureEntries();
  assert.ok(entries.length >= 5, 'the fixture yields entries');
  const rows = rowsFor(entries);
  const kinds = new Set(rows.map((r) => r.cls));
  for (const k of ['user', 'assistant', 'tool', 'system']) assert.ok(kinds.has(k), `has a ${k} row`);
  assert.ok(kinds.has('error') || kinds.has('result'), 'has a tool result row');
  for (const r of rows) {
    assert.equal(typeof r.text, 'string');
    assert.equal(typeof r.label, 'string');
    assert.ok(!/\u001b/.test(r.text), 'no escape characters survive');
    assert.ok(r.off === null || Number.isSafeInteger(r.off));
  }
  const bash = rows.find((r) => r.cls === 'tool');
  assert.ok(bash.label.length > 0 && bash.label.length <= LABEL_CAP);
});

test('rowFor: labels, error results, unknown roles and empty texts', () => {
  assert.deepEqual(
    { ...rowFor({ off: 0, ts: null, role: 'user', text: 'hi' }) },
    { cls: 'user', label: 'YOU', text: 'hi', off: 0, ts: null, truncated: false },
  );
  assert.equal(rowFor({ role: 'assistant', text: 'ok' }).label, 'CLAUDE');
  assert.equal(rowFor({ role: 'tool_use', tool: 'Bash', text: 'npm  test' }).text, 'npm test');
  assert.equal(rowFor({ role: 'tool_use', tool: 'Bash', text: 'x' }).label, 'Bash');
  assert.equal(rowFor({ role: 'tool_use', text: 'x' }).label, 'TOOL');
  assert.equal(rowFor({ role: 'tool_result', isError: true, text: 'boom' }).cls, 'error');
  assert.equal(rowFor({ role: 'tool_result', text: 'fine' }).label, 'RESULT');
  assert.equal(rowFor({ role: 'system', text: 'summary' }).label, 'SUMMARY');
  assert.equal(rowFor({ role: 'thinking', text: 'secret' }), null);
  assert.equal(rowFor({ role: 'user', text: '   ' }), null);
  assert.equal(rowFor(null), null);
  assert.deepEqual(rowsFor('nope'), []);
  assert.deepEqual(rowsFor([null, 1, { role: 'x' }]), []);
  const long = rowFor({ role: 'tool_use', tool: 'x'.repeat(100), text: '' });
  assert.equal(long.label.length, LABEL_CAP);
  assert.ok(long.label.endsWith(ELLIPSIS));
});

test('untrusted text stays literal: markup kept as text, ANSI, controls and bidi overrides stripped', () => {
  const r = rowFor({ role: 'assistant', text: `${EVIL} \u001b[31mred\u001b[0m\u0007‮evil\u0000\r\nnext` });
  assert.ok(r.text.includes(EVIL), 'markup is plain text (escaping is the renderer: textContent)');
  assert.ok(r.text.includes('red') && !r.text.includes('\u001b') && !r.text.includes('[31m'));
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f‮]/.test(r.text));
  assert.ok(r.text.endsWith('evil\nnext'));
  assert.equal(cleanRowText('\u001b]0;title\u0007x'), 'x');
  assert.equal(cleanRowText(42), '');
  assert.equal(cleanRowText('a\ud800b'), 'a�b');
  assert.equal(r.ts, null);
  assert.equal(rowFor({ role: 'user', text: 'x', ts: '2026-01-01T00:00:00Z\u001b[2J' }).ts, '2026-01-01T00:00:00Z');
});

test('caps: characters and lines per kind, with an ellipsis and truncated:true', () => {
  const big = rowFor({ role: 'assistant', text: 'a'.repeat(5000) });
  assert.equal(big.text.length, CAPS.assistant);
  assert.ok(big.text.endsWith(ELLIPSIS));
  assert.equal(big.truncated, true);
  const lines = rowFor({ role: 'tool_result', text: '1\n2\n3\n4\n5\n6' });
  assert.equal(lines.text, `1\n2\n3${ELLIPSIS}`);
  assert.equal(lines.truncated, true);
  assert.equal(rowFor({ role: 'user', text: 'short', truncated: true }).truncated, true, 'a server-side cut is kept');
  const t = truncate(`${'x'.repeat(8)}😀tail`, 10);
  assert.ok(!/[\ud800-\udbff]$/.test(t.text.slice(0, -1)), 'never splits a surrogate pair');
  assert.deepEqual(truncate('ok\n\n', 10), { text: 'ok', cut: false });
});

test('timeOf: HH:MM or empty', () => {
  assert.equal(timeOf('2026-01-01T09:05:00.000Z', false), '09:05');
  assert.equal(timeOf('nonsense'), '');
  assert.equal(timeOf(null), '');
});

// ---------------------------------------------------------------- the tail merge

const page = (offs, { start = offs[0], end = offs.at(-1) + 10, size = 1000 } = {}) => ({
  size, startOffset: start, endOffset: end, reset: false,
  entries: offs.map((o) => ({ off: o, role: 'user', text: `e${o}` })),
});

test('mergeTail: tail, forward and older pages, de-duplicated, with hasOlder', () => {
  let t = mergeTail(emptyTail(), page([300, 400], { start: 300, end: 500 }), 'tail');
  assert.deepEqual(t.entries.map((e) => e.off), [300, 400]);
  assert.equal(t.startOffset, 300);
  assert.equal(t.endOffset, 500);
  assert.equal(t.hasOlder, true);
  t = mergeTail(t, page([500], { start: 500, end: 600 }), 'after');
  assert.equal(t.endOffset, 600);
  t = mergeTail(t, page([100, 200], { start: 0, end: 300 }), 'before');
  assert.deepEqual(t.entries.map((e) => e.off), [100, 200, 300, 400, 500]);
  assert.equal(t.startOffset, 0);
  assert.equal(t.hasOlder, false);
  const again = mergeTail(t, page([500], { start: 500, end: 600 }), 'after');
  assert.equal(again.entries.length, 5, 'a repeated page never doubles rows');
  // Two entries from one line (same off, same role) are both kept.
  const two = mergeTail(emptyTail(), { startOffset: 0, endOffset: 10, entries: [{ off: 0, role: 'tool_result', text: 'a' }, { off: 0, role: 'tool_result', text: 'b' }] }, 'tail');
  assert.equal(two.entries.length, 2);
  assert.equal(mergeTail(t, { reset: true }).entries.length, 0);
  assert.equal(mergeTail(t, { reset: true }).reset, true);
  assert.equal(mergeTail(t, null), t);
});

test('mergeTail keeps at most `keep` entries, dropping the oldest and moving startOffset', () => {
  const offs = Array.from({ length: KEEP_ENTRIES + 5 }, (_, i) => i * 10 + 10);
  const t = mergeTail(emptyTail(), page(offs), 'tail');
  assert.equal(t.entries.length, KEEP_ENTRIES);
  assert.equal(t.startOffset, 60);
  assert.equal(t.hasOlder, true);
  assert.equal(t.dropped, true);
});

// ---------------------------------------------------------------- peek: pure

function fleetStore(kind = 'hub') {
  const s = createStore({ keyMode: kind === 'hub' ? 'fkey' : 'name' });
  s.source.kind = kind;
  const sess = {
    key: 'builder-a/auth', name: 'auth', builder: 'builder-a', lane: 'auth', laneKey: 'builder-a/auth',
    state: 'idle', previewLines: ['store line'],
  };
  s.sessions.set(kind === 'hub' ? 'builder-a/auth' : 'auth', sess);
  s.lanes = [{ key: 'builder-a/auth', id: 'auth', builder: 'builder-a', sessions: ['auth'] }];
  if (kind !== 'hub') s.source.id = 'builder-a';
  return s;
}

test('peekTarget resolves a lane or session sel to the session act() and the URLs need', () => {
  const s = fleetStore('hub');
  const t = peekTarget(s, 'builder-a/auth');
  assert.deepEqual(t, { fkey: 'builder-a/auth', key: 'builder-a/auth', name: 'auth', builder: 'builder-a', hub: true, laneKey: 'builder-a/auth' });
  assert.equal(peekTarget(s, 'builder-a/nobody'), null);
  assert.equal(peekTarget(s, ''), null);
  const local = peekTarget(fleetStore('local'), 'builder-a/auth');
  assert.equal(local.key, 'auth');
  assert.equal(local.hub, false);
});

test('sessionUrl: builder and hub paths, encoded, unaddressable names refused', () => {
  assert.equal(sessionUrl({ name: 'auth', kind: 'preview', query: { n: 40 } }), '/api/v1/sessions/auth/preview?n=40');
  assert.equal(sessionUrl({ hub: true, builder: 'builder-a', name: 'auth', kind: 'transcript', query: { after: 120, limit: 50 } }),
    '/api/fleet/builder-a/v1/sessions/auth/transcript?after=120&limit=50');
  assert.equal(sessionUrl({ name: 'a b', kind: 'transcript', query: { before: 0 } }), '/api/v1/sessions/a%20b/transcript?before=0');
  assert.equal(sessionUrl({ name: 'auth', kind: 'transcript', query: { after: -1, before: 1.5, limit: '3' } }), '/api/v1/sessions/auth/transcript');
  for (const name of ['..', '.', 'a/b', '', null]) assert.equal(sessionUrl({ name, kind: 'preview' }), null, String(name));
  assert.equal(sessionUrl({ hub: true, builder: '../x', name: 'auth', kind: 'preview' }), null);
  assert.equal(sessionUrl({ hub: true, builder: null, name: 'auth', kind: 'preview' }), null);
  assert.equal(sessionUrl({ name: 'auth', kind: 'diff' }), null);
});

test('replyArgs, refusalText, diffHref, previewLinesOf', () => {
  assert.deepEqual(replyArgs('fix it\r\n'), { text: 'fix it', guardPrompt: true });
  assert.equal(replyArgs('   \n'), null);
  assert.equal(replyArgs('x'.repeat(REPLY_MAX + 1)), null);
  assert.equal(replyArgs(null), null);
  assert.match(refusalText({ ok: false, code: 'prompting' }), /prompt/);
  assert.match(refusalText({ ok: 'unknown' }), /may still arrive/);
  assert.match(refusalText({ ok: false, error: 'HTTP 500' }), /HTTP 500/);
  assert.equal(diffHref('builder-a/auth'), '#/diff?sel=builder-a%2Fauth');
  assert.equal(diffHref('auth'), null);
  assert.equal(diffHref('builder-a/..'), null);
  assert.deepEqual(previewLinesOf({ lines: ['a', 7] }), ['a', '7']);
  assert.equal(previewLinesOf({ lines: Array(100).fill('x') }).length, PREVIEW_N);
  assert.equal(previewLinesOf({}), null);
});

// ---------------------------------------------------------------- peek: fake DOM

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const byClass = (node, cls) => node.querySelectorAll(`.${cls}`);
function walk(node, fn) { fn(node); node.children.forEach((c) => walk(c, fn)); }

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const hit = routes.find(([rx]) => rx.test(url));
    const [status, body] = hit ? hit[1](url) : [404, { error: 'unknown' }];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  return Promise.resolve()
    .then(() => fn(globalThis.document))
    .finally(() => { globalThis.document = prev; });
}

function harness(kind = 'hub', { routes = null, confirmOk = true, actResult = { ok: true } } = {}) {
  const store = fleetStore(kind);
  const sent = [];
  const acts = [];
  const confirms = [];
  const timers = [];
  const fetch = fakeFetch(routes ?? [
    [/\/preview\?/, () => [200, { name: 'auth', lines: ['\u001b[31mred\u001b[0m line', EVIL] }]],
    [/\/transcript\?.*after=/, () => [200, { size: 900, startOffset: 800, endOffset: 900, reset: false, entries: [{ off: 800, role: 'assistant', text: 'new' }] }]],
    [/\/transcript\?.*before=/, () => [200, { size: 900, startOffset: 0, endOffset: 400, reset: false, entries: [{ off: 0, role: 'user', text: 'first' }] }]],
    [/\/transcript\?/, () => [200, { size: 800, startOffset: 400, endOffset: 800, reset: false, entries: [
      { off: 400, role: 'user', text: EVIL },
      { off: 600, role: 'tool_use', tool: 'Bash', text: 'npm test' },
    ] }]],
  ]);
  const ctx = {
    store,
    fetch,
    act: async (k, action, args) => { acts.push({ k, action, args }); return actResult; },
    confirm: async (spec) => { confirms.push(spec); return { ok: confirmOk }; },
    toast: () => {},
    send: (m) => sent.push(m),
    every: (fn, ms) => { timers.push({ fn, ms }); return () => { timers.splice(0); }; },
    later: () => {},
    openTerminal: () => {},
  };
  return { store, sent, acts, confirms, timers, fetch, ctx };
}

test('peek mounts: touch how=peek on the hub, pane tail and transcript rows as text, polls scheduled', () => withDom(async (doc) => {
  const h = harness('hub');
  const host = doc.createElement('div');
  const c = mountPeek(host, 'builder-a/auth', h.ctx);
  await flush();
  assert.deepEqual(h.sent, [{ type: 'touch', fkey: 'builder-a/auth', how: TOUCH_HOW_PEEK }]);
  assert.ok(HOWS.includes(TOUCH_HOW_PEEK), 'peek is an allowed touch how (O10)');
  assert.deepEqual(h.timers.map((t) => t.ms).sort(), [2000, 3000]);
  assert.ok(h.fetch.calls.includes('/api/fleet/builder-a/v1/sessions/auth/preview?n=40'));
  assert.ok(h.fetch.calls.includes('/api/fleet/builder-a/v1/sessions/auth/transcript?limit=50'));
  const prev = byClass(host, 'peek-preview')[0];
  assert.ok(prev.textContent.includes('red line'));
  assert.ok(!prev.textContent.includes('\u001b'));
  const rows = byClass(host, 'peek-row');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.dataset.kind), ['user', 'tool']);
  assert.ok(rows[0].textContent.includes(EVIL), 'markup shown as literal text');
  assert.ok(rows[1].textContent.includes('Bash') && rows[1].textContent.includes('npm test'));
  walk(host, (n) => {
    assert.equal(n.innerHTML, '', 'nothing is set through innerHTML');
    assert.notEqual(n.tagName, 'IMG');
  });
  assert.equal(byClass(host, 'peek-older')[0].hidden, false, 'older pages exist (startOffset > 0)');
  // Forward poll from endOffset, then the older page from startOffset.
  await c.refreshTranscript();
  assert.ok(h.fetch.calls.at(-1).includes('after=800'));
  assert.equal(byClass(host, 'peek-row').length, 3);
  await c.older();
  assert.ok(h.fetch.calls.at(-1).includes('before=400'));
  assert.deepEqual(byClass(host, 'peek-text').map((r) => r.textContent), ['first', EVIL, 'npm test', 'new']);
  c.stop();
  assert.equal(h.timers.length, 0, 'unmount stops the polls');
}));

test('peek reply: confirm (ask) with the exact text, then send-text with guardPrompt; cancel sends nothing', () => withDom(async (doc) => {
  const h = harness('hub');
  const c = mountPeek(doc.createElement('div'), 'builder-a/auth', h.ctx);
  await flush();
  c.input.value = 'please rebase';
  await c.sendReply();
  assert.equal(h.confirms.length, 1);
  assert.equal(h.confirms[0].action, 'send-text');
  assert.equal(h.confirms[0].tier, 'ask');
  assert.deepEqual(h.confirms[0].targets, ['builder-a/auth']);
  assert.ok(h.confirms[0].consequence.includes('please rebase'));
  assert.deepEqual(h.acts, [{ k: 'builder-a/auth', action: 'send-text', args: { text: 'please rebase', guardPrompt: true } }]);
  assert.equal(c.input.value, '', 'a sent reply clears the box');

  const h2 = harness('hub', { confirmOk: false });
  const c2 = mountPeek(doc.createElement('div'), 'builder-a/auth', h2.ctx);
  c2.input.value = 'no';
  await c2.sendReply();
  assert.equal(h2.acts.length, 0, 'cancel sends nothing');
  c2.input.value = '   ';
  await c2.sendReply();
  assert.equal(h2.confirms.length, 1, 'an empty reply never asks');
  c.stop(); c2.stop();
}));

test('peek quick buttons and a prompting refusal', () => withDom(async (doc) => {
  const h = harness('hub', { actResult: { ok: false, code: 'prompting', error: 'the session is prompting' } });
  const host = doc.createElement('div');
  const c = mountPeek(host, 'builder-a/auth', h.ctx);
  assert.deepEqual(byClass(host, 'peek-q').map((b) => b.textContent), QUICK.map((q) => q.label));
  await c.quick('continue');
  await c.quick('compact');
  await c.quick('esc');
  assert.deepEqual(h.acts.map((a) => [a.action, a.args]), [
    ['send-text', { text: 'continue', guardPrompt: true }],
    ['send-text', { text: '/compact', guardPrompt: true }],
    ['send-keys', { keys: ['Escape'] }],
  ]);
  assert.equal(h.confirms.length, 0, 'quick buttons are click tier');
  assert.match(byClass(host, 'peek-status')[0].textContent, /prompt/);
  c.stop();
}));

test('peek on a builder: local URLs, no touch; a 404 transcript stops its poll; preview falls back to the store', () => withDom(async (doc) => {
  const h = harness('local', { routes: [[/\/transcript/, () => [404, { error: 'no transcript' }]]] });
  const host = doc.createElement('div');
  const c = mountPeek(host, 'builder-a/auth', h.ctx);
  await flush();
  assert.deepEqual(h.sent, []);
  assert.ok(h.fetch.calls.includes('/api/v1/sessions/auth/preview?n=40'));
  assert.ok(byClass(host, 'peek-preview')[0].textContent.includes('store line'));
  assert.match(byClass(host, 'peek-note').map((n) => n.textContent).join(' '), /no transcript/);
  const n = h.fetch.calls.length;
  await c.refreshTranscript();
  assert.equal(h.fetch.calls.length, n, 'no more transcript reads after a 404');
  c.stop();
}));

test('peek with nothing to peek at renders a note and no polls', () => withDom(async (doc) => {
  const h = harness('hub');
  const host = doc.createElement('div');
  mountPeek(host, 'builder-a/ghost', h.ctx);
  assert.match(host.textContent, /No session/);
  assert.equal(h.timers.length, 0);
}));

test('init registers PEEK and DIFF; the DIFF tab links to #/diff?sel=<lane fkey>', () => withDom(async (doc) => {
  _resetTabs();
  const off = init();
  assert.equal(init(), off, 'idempotent');
  assert.deepEqual(registeredTabs().map((t) => t.id), ['peek', 'diff']);
  const host = doc.createElement('div');
  const href = mountDiffLink(host, 'builder-a/auth', { store: fleetStore('hub') });
  assert.equal(href, '#/diff?sel=builder-a%2Fauth');
  const a = byClass(host, 'peek-difflink')[0];
  assert.equal(a.getAttribute('href'), href);
  const none = doc.createElement('div');
  assert.equal(mountDiffLink(none, 'builder-a/ghost', { store: createStore() }), null);
  off();
  assert.deepEqual(registeredTabs(), []);
  _resetTabs();
}));

test('source: no markup sinks, pure at import, gotcha substrings avoided', () => {
  for (const rel of ['public/js/views/peek.js', 'public/js/core/transcript-rows.js']) {
    const src = read(rel);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), rel);
    assert.ok(!/d3/i.test(src), `${rel}: no chart-library token`);
    assert.ok(!/\bconstructor\b|\bsuper\b/.test(src), rel);
  }
  assert.ok(!/document|fetch\(|globalThis/.test(read('public/js/core/transcript-rows.js')), 'rows module is pure');
});
