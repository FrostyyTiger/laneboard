// The Audit view (fleet plan §4 D12): the pure model (URLs, hub/builder bodies, states and marks, filters,
// chips, fork alarms, the 404/503 empty state) and the DOM render against the fake DOM, with hostile builder
// text that must arrive as text only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEl, makeDocument } from './helpers/fakedom.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const A = await import('../public/js/views/audit.js');
const H13 = await import('../server/hub/audit-reconcile.mjs');

const T0 = Date.UTC(2026, 9, 15, 3, 4, 5);
const HOSTILE = '<img src=x onerror=alert(1)>';

/** The H13 `list()` body shape: one row per relayed action, plus a hub-only anchor and forks. */
function hubBody() {
  return {
    entries: [
      { ts: T0, id: 'e1', user: 'ops', via: 'hub', builder: 'builder-a', action: 'approve', target: 'auth', ok: true, state: 'match', builderEntry: { ok: true, hash: 'a'.repeat(64) } },
      { ts: T0 + 1000, id: 'e2', user: 'ops', via: 'hub', builder: 'builder-a', action: 'kill', target: HOSTILE, ok: true, state: 'missing-on-builder', builderEntry: null },
      { ts: T0 + 2000, id: 'e3', user: 'ops', via: 'hub', builder: 'builder-b', action: 'pause', target: 'web', ok: 'unknown', state: 'unknown-settled', builderEntry: { ok: true, hash: 'b'.repeat(64) } },
      { ts: T0 + 3000, id: 'e4', user: 'ops', via: 'hub', builder: 'builder-b', action: 'approve', target: 'api', ok: false, state: 'outcome-differs', builderEntry: { ok: true, hash: 'c'.repeat(64) } },
      { ts: T0 + 4000, id: 'e5', user: 'ops', via: 'hub', builder: 'builder-a', action: 'approve', target: 'docs', ok: 'unknown', state: 'pending', builderEntry: null },
      { ts: T0 + 5000, id: 'e6', user: 'hub', via: 'hub-reconcile', builder: 'builder-a', action: 'audit.anchor', target: 'builder-a', ok: true, state: null, builderEntry: null },
    ],
    more: false,
    forks: [{ builder: 'builder-b', text: `audit chain of builder-b no longer contains the anchored head ${HOSTILE}`, reason: 'after-not-found', at: T0 + 6000 }],
  };
}

function builderBody() {
  return {
    builder: 'builder-a',
    head: { hash: 'f'.repeat(64), count: 42 },
    entries: [
      { ts: T0, id: 'x1', user: 'local', via: 'local', builder: 'builder-a', action: 'pause', target: 'auth', argsHash: '0'.repeat(64), result: { phase: 'start' }, prevHash: '0'.repeat(64), hash: '1'.repeat(64) },
      { ts: T0 + 10, id: 'x1', user: 'local', via: 'local', builder: 'builder-a', action: 'pause', target: 'auth', argsHash: '0'.repeat(64), result: { phase: 'done', ok: true }, prevHash: '1'.repeat(64), hash: '2'.repeat(64) },
      { ts: T0 + 20, id: 'x2', user: 'ops\u0007 x', via: 'hub', builder: 'builder-a', action: 'kill', target: HOSTILE, result: { ok: false, error: 'control-disabled' }, hash: '3'.repeat(64) },
    ],
    more: true,
  };
}

// --- pure model -------------------------------------------------------------------

test('every H13 reconciliation state has a mark, and the mismatch states are ▲, unknown-settled ◆', () => {
  for (const s of H13.STATES) assert.ok(A.AUDIT_STATES.includes(s), `${s} is known to the view`);
  assert.ok(A.AUDIT_STATES.includes('unknown-on-hub'));
  for (const s of A.AUDIT_STATES) assert.ok(A.STATE_MARK[s], `${s} has a mark`);
  for (const s of ['missing-on-builder', 'outcome-differs', 'unknown-on-hub']) {
    assert.equal(A.STATE_MARK[s].shape, '▲');
    assert.ok(A.isMismatch(s));
  }
  assert.equal(A.STATE_MARK['unknown-settled'].shape, '◆');
  assert.equal(A.isMismatch('unknown-settled'), false);
  assert.equal(A.isMismatch('match'), false);
  assert.equal(A.STATE_MARK.match.p, 'off', 'normal is grey');
  assert.equal(A.STATE_MARK.pending.p, 'off', 'pending is grey');
});

test('the H13 reconcile output maps onto the view states', () => {
  const hub = [
    { ts: 1, id: 'm1', via: 'hub', builder: 'builder-a', action: 'approve', target: 'x', result: { phase: 'sent' } },
    { ts: 2, id: 'm1', via: 'hub', builder: 'builder-a', action: 'approve', target: 'x', result: { phase: 'done', ok: true, status: 200 } },
    { ts: 3, id: 'm2', via: 'hub', builder: 'builder-a', action: 'kill', target: 'y', result: { phase: 'done', ok: true, status: 200 } },
  ];
  const bld = [{ ts: 1, id: 'm1', via: 'hub', builder: 'builder-a', action: 'approve', target: 'x', result: { ok: true }, hash: 'a'.repeat(64) }];
  const rows = H13.reconcile(hub, bld);
  const m = A.auditModel('hub', { entries: rows.map((r, i) => ({ ts: i, id: r.id, via: 'hub', builder: r.builder, action: r.action, target: r.target, ok: r.hub.ok, state: r.state })) });
  assert.deepEqual(m.rows.map((r) => r.state), ['match', 'missing-on-builder']);
});

test('auditUrl: hub and builder routes, builder id validated, since/limit integers', () => {
  assert.equal(A.auditUrl('hub', { since: 1000.7, builder: 'builder-a' }), '/api/fleet/audit?since=1000&builder=builder-a&limit=1000');
  assert.equal(A.auditUrl('hub', { builder: '../x' }), '/api/fleet/audit?limit=1000', 'a bad builder id is dropped');
  assert.equal(A.auditUrl('hub', { builder: 'all' }), '/api/fleet/audit?limit=1000', 'b=all is no filter');
  assert.equal(A.auditUrl('builder', { since: 5, builder: 'builder-a', limit: 50 }), '/api/v1/audit?since=5&limit=50', 'builder mode has no builder param');
  assert.equal(A.auditUrl('builder', { limit: 99999 }), '/api/v1/audit?limit=1000', 'clamped to the read limit');
});

test('fmtTs is UTC; okText; clean strips control characters and clamps', () => {
  assert.equal(A.fmtTs(T0), '2026-10-15 03:04:05');
  assert.equal(A.fmtTs(null), null);
  assert.equal(A.fmtTs(NaN), null);
  assert.equal(A.okText(true), 'ok');
  assert.equal(A.okText(false), 'fail');
  assert.equal(A.okText('unknown'), '?');
  assert.equal(A.okText(null), null);
  assert.equal(A.clean('a\u0000b\u001bc d'), 'a�b�c�d');
  assert.equal(A.clean('x'.repeat(500)).length, 200);
  assert.equal(A.clean({ toString: () => 'evil' }), null, 'non-strings are dropped');
  assert.equal(A.clean(''), null);
});

test('auditModel (hub): the H13 list rows, states, hub-only rows, phase, forks', () => {
  const m = A.auditModel('hub', hubBody());
  assert.equal(m.mode, 'hub');
  assert.equal(m.rows.length, 6);
  const by = Object.fromEntries(m.rows.map((r) => [r.id, r]));
  assert.equal(by.e1.state, 'match');
  assert.equal(by.e1.phase, 'done', 'a boolean outcome on a relayed row is the done entry');
  assert.equal(by.e1.time, '2026-10-15 03:04:05');
  assert.equal(by.e2.target, HOSTILE, 'kept verbatim as text; the DOM gets it via textContent');
  assert.equal(by.e5.phase, null, 'an unknown outcome does not claim a phase');
  assert.equal(by.e6.state, null, 'hub-only entries (anchors) have no state');
  assert.equal(by.e6.phase, null);
  assert.deepEqual(m.forks.map((f) => f.builder), ['builder-b']);
  assert.match(m.forks[0].text, /no longer contains the anchored head/, 'the hub-written text is kept');
  assert.equal(m.head, null);
  const bogus = A.auditModel('hub', { entries: [{ id: 'z', state: 'weird' }, null, 7] });
  assert.equal(bogus.rows.length, 1);
  assert.equal(bogus.rows[0].state, null, 'an unknown state is not trusted');
  assert.deepEqual(A.auditModel('hub', null).rows, []);
  assert.deepEqual(A.auditModel('hub', 'x').forks, []);
});

test('auditModel (hub): unknown-on-hub mismatches become rows when the body carries them', () => {
  const body = hubBody();
  body.mismatches = [
    { kind: 'audit-mismatch', builder: 'builder-b', id: 'u1', state: 'unknown-on-hub', action: 'kill', target: 'web' },
    { kind: 'audit-mismatch', builder: 'builder-a', id: 'e2', state: 'missing-on-builder', action: 'kill', target: 'x' },
  ];
  const m = A.auditModel('hub', body);
  const u = m.rows.filter((r) => r.state === 'unknown-on-hub');
  assert.equal(u.length, 1, 'only unknown-on-hub (the others already have a hub row)');
  assert.equal(u[0].builder, 'builder-b');
  assert.equal(new Set(m.rows.map((r) => r.key)).size, m.rows.length, 'row keys are unique');
});

test('auditModel (builder): raw chain rows with phase from result, head, more', () => {
  const m = A.auditModel('builder', builderBody());
  assert.equal(m.mode, 'builder');
  assert.equal(m.builder, 'builder-a');
  assert.deepEqual(m.head, { hash: 'f'.repeat(64), count: 42 });
  assert.equal(m.more, true);
  assert.deepEqual(m.rows.map((r) => r.phase), ['start', 'done', null]);
  assert.deepEqual(m.rows.map((r) => r.ok), [null, true, false]);
  assert.ok(m.rows.every((r) => r.state === null), 'a builder log has no reconciliation state');
  assert.equal(m.rows[2].user, 'ops��x', 'control characters never reach the page');
});

test('filterRows: b, q (all words), action and state sets', () => {
  const rows = A.auditModel('hub', hubBody()).rows;
  assert.equal(A.filterRows(rows, {}).length, 6);
  assert.equal(A.filterRows(rows, { b: 'builder-b' }).length, 2);
  assert.equal(A.filterRows(rows, { b: 'all' }).length, 6);
  assert.deepEqual(A.filterRows(rows, { q: 'APPROVE builder-b' }).map((r) => r.id), ['e4']);
  assert.deepEqual(A.filterRows(rows, { q: 'outcome-differs' }).map((r) => r.id), ['e4'], 'q matches the state');
  assert.deepEqual(A.filterRows(rows, { actions: new Set(['kill', 'pause']) }).map((r) => r.id), ['e2', 'e3']);
  assert.deepEqual(A.filterRows(rows, { states: new Set(['missing-on-builder', 'outcome-differs']) }).map((r) => r.id), ['e2', 'e4']);
  assert.equal(A.filterRows(rows, { actions: new Set() }).length, 6, 'an empty set filters nothing');
  assert.deepEqual(A.filterRows(null, {}), []);
});

test('chipModel: builders (store + log) with counts, actions, states in mismatch-first order', () => {
  const rows = A.auditModel('hub', hubBody()).rows;
  const c = A.chipModel(rows, ['builder-c', 'builder-a']);
  assert.deepEqual(c.builders, [{ id: 'builder-a', n: 4 }, { id: 'builder-b', n: 2 }, { id: 'builder-c', n: 0 }]);
  assert.deepEqual(c.actions.map((a) => a.id), ['approve', 'audit.anchor', 'kill', 'pause']);
  assert.deepEqual(c.states.map((s) => s.id), ['missing-on-builder', 'outcome-differs', 'unknown-settled', 'pending', 'match']);
  assert.equal(c.states[0].mark.shape, '▲');
  assert.deepEqual(A.summary(rows), { total: 6, mismatch: 2, settled: 1, pending: 1 });
});

test('forkAlarms: response forks first, store audit-fork alarms added once per builder', () => {
  const m = A.auditModel('hub', hubBody());
  const f = A.forkAlarms(m, [
    { kind: 'audit-fork', builder: 'builder-b', text: 'duplicate' },
    { kind: 'audit-fork', builder: 'builder-c', text: 'audit chain of builder-c is shorter than the anchored head' },
    { kind: 'stuck', builder: 'builder-a', text: 'nope' },
    { kind: 'audit-fork', builder: 'builder-d' },
  ]);
  assert.deepEqual(f.map((x) => x.builder), ['builder-b', 'builder-c', 'builder-d']);
  assert.match(f[0].text, /no longer contains/, 'the hub text wins over the duplicate');
  assert.match(f[2].text, /builder-d was rewritten after an anchor/);
  assert.deepEqual(A.forkAlarms(null, null), []);
});

test('loadAudit: 404/503 are "unavailable" (empty state), other errors are errors, nothing throws', async () => {
  const res = (status, body = {}) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  assert.deepEqual(await A.loadAudit('/u', res(404)), { kind: 'unavailable', status: 404 });
  assert.deepEqual(await A.loadAudit('/u', res(503)), { kind: 'unavailable', status: 503 });
  assert.deepEqual(await A.loadAudit('/u', res(500)), { kind: 'error', message: 'HTTP 500' });
  assert.deepEqual(await A.loadAudit('/u', res(200, { entries: [] })), { kind: 'ok', body: { entries: [] } });
  const boom = await A.loadAudit('/u', async () => { throw new Error('net\u0000down'); });
  assert.equal(boom.kind, 'error');
  assert.equal(boom.message, 'net�down');
  const badJson = await A.loadAudit('/u', async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('bad'); } }));
  assert.equal(badJson.kind, 'error');
  const seen = [];
  await A.loadAudit('/api/fleet/audit', async (u, o) => { seen.push([u, o.method ?? 'GET']); return { status: 404 }; });
  assert.deepEqual(seen, [['/api/fleet/audit', 'GET']], 'a GET, never a mutating request');
});

test('modeOf: hub source or hub hello -> hub, else builder', () => {
  assert.equal(A.modeOf({ source: { kind: 'hub' } }), 'hub');
  assert.equal(A.modeOf({ source: { kind: 'local', hello: { mode: 'hub' } } }), 'hub');
  assert.equal(A.modeOf({ source: { kind: 'local' } }), 'builder');
  assert.equal(A.modeOf(null), 'builder');
});

// --- DOM render ---------------------------------------------------------------------

/** The fake DOM plus replaceChildren, tBodies-free tables, and recorded click listeners. */
function dom() {
  const base = makeDocument();
  const all = [];
  const wrap = (n) => {
    n.nodeType = 1;
    n.listeners = {};
    n.addEventListener = (t, fn) => { (n.listeners[t] ??= []).push(fn); };
    n.replaceChildren = (...kids) => {
      for (const c of n.children) c.parent = null;
      n.children = [];
      n._text = '';
      n.append(...kids);
    };
    all.push(n);
    return n;
  };
  const doc = { ...base, createElement: (t) => wrap(makeEl(t)), createElementNS: (_n, t) => wrap(makeEl(t)) };
  return { doc, all, wrap };
}

function walk(n, f) {
  f(n);
  for (const c of n.children) walk(c, f);
}

function find(root, pred) {
  const out = [];
  walk(root, (n) => { if (pred(n)) out.push(n); });
  return out;
}

const hasClass = (c) => (n) => n.classList?.contains(c);

async function mounted(mode, body, { status = 200, route = {}, store = null } = {}) {
  const { doc, all, wrap } = dom();
  const saved = globalThis.document;
  globalThis.document = doc;
  const el = wrap(makeEl('section'));
  const urls = [];
  const fetchFn = async (u) => { urls.push(u); return { status, ok: status === 200, json: async () => body }; };
  const st = store ?? { source: { kind: mode === 'hub' ? 'hub' : 'local' }, builders: new Map([['builder-a', {}], ['builder-b', {}]]), alarms: [] };
  const navs = [];
  try {
    await A.mountAudit(el, { store: st, route: { view: 'audit', b: null, s: null, q: null, ...route }, navigate: (p) => navs.push(p) }, { fetchFn, poll: false });
  } finally {
    globalThis.document = saved;
  }
  return { el, all, urls, navs, doc, restore: () => { globalThis.document = saved; } };
}

test('hub render: dense table, ▲/◆ marks, mismatch rows marked, fork text, hostile text as text only', async () => {
  const { el, all, urls } = await mounted('hub', hubBody());
  try {
    assert.match(urls[0], /^\/api\/fleet\/audit\?since=\d+&limit=1000$/);
    const text = el.textContent;
    assert.match(text, /AUDIT/);
    for (const h of ['TS', 'USER', 'VIA', 'B', 'ACTION', 'TARGET', 'OK', 'PHASE', 'STATE']) {
      assert.ok(find(el, (n) => n.tagName === 'BUTTON' && n._text === h).length, `column ${h}`);
    }
    assert.ok(text.includes(HOSTILE), 'the hostile target is shown as literal text');
    assert.ok(all.every((n) => n.innerHTML === ''), 'innerHTML is never written');
    assert.ok(find(el, (n) => n.tagName === 'IMG').length === 0, 'no element was parsed from builder text');
    assert.match(text, /no longer contains the anchored head/, 'the fork alarm with its hub-written text');
    assert.ok(find(el, hasClass('au-fork')).length === 1);
    const shapes = find(el, (n) => hasClass('au-st')(n)).map((n) => n.textContent);
    assert.ok(shapes.includes('▲missing-on-builder'));
    assert.ok(shapes.includes('▲outcome-differs'));
    assert.ok(shapes.includes('◆unknown-settled'));
    assert.ok(shapes.includes('match'), 'match carries no shape');
    const mis = find(el, (n) => n.tagName === 'TR' && n.classList.contains('au-mis'));
    assert.equal(mis.length, 2, 'the two mismatch rows are marked');
    const states = find(el, hasClass('au-st')).filter((n) => n.dataset.state);
    assert.ok(states.every((n) => n.attrs['aria-label']?.startsWith('state: ')), 'every state has an aria-label');
    assert.match(text, /6 entries · ▲ 2 mismatch · ◆ 1 settled · 1 pending/);
    const firstTs = find(el, (n) => n.tagName === 'TD')[0].textContent;
    assert.equal(firstTs, '2026-10-15 03:04:10', 'newest first, UTC');
  } finally {
    A.unmountAudit();
  }
});

test('hub render: chips filter (state, action local; builder navigates b=)', async () => {
  const { el, navs, doc } = await mounted('hub', hubBody());
  const saved = globalThis.document;
  globalThis.document = doc;
  try {
    const chips = () => find(el, hasClass('au-chip'));
    const chip = (label) => chips().find((n) => find(n, hasClass('chip-t'))[0]?._text === label);
    const rows = () => find(el, (n) => n.tagName === 'TR' && n.dataset.key).length;
    assert.equal(rows(), 6);
    chip('missing-on-builder').listeners.click[0]();
    assert.equal(rows(), 1, 'the state chip filters');
    assert.equal(chip('missing-on-builder').attrs['aria-pressed'], 'true');
    chip('missing-on-builder').listeners.click[0]();
    chip('pause').listeners.click[0]();
    assert.equal(rows(), 1, 'the action chip filters');
    chip('builder-b').listeners.click[0]();
    assert.deepEqual(navs, [{ b: 'builder-b' }], 'a builder chip routes b=, it never acts');
  } finally {
    globalThis.document = saved;
    A.unmountAudit();
  }
});

test('hub render: a route update with a new b reloads with builder=, q filters and shows a chip', async () => {
  const { el, urls, doc } = await mounted('hub', hubBody());
  const saved = globalThis.document;
  globalThis.document = doc;
  try {
    await A.updateAudit(null, { route: { view: 'audit', b: 'builder-a', q: null } });
    assert.match(urls.at(-1), /builder=builder-a/);
    A.updateAudit(null, { route: { view: 'audit', b: 'builder-a', q: 'docs' } });
    assert.equal(urls.length, 2, 'a q change does not refetch');
    assert.equal(find(el, (n) => n.tagName === 'TR' && n.dataset.key).length, 1);
    assert.ok(find(el, (n) => n.dataset?.param === 'q').length === 1, 'the q chip');
  } finally {
    globalThis.document = saved;
    A.unmountAudit();
  }
});

for (const status of [404, 503]) {
  test(`hub render: ${status} from the fleet route is an empty state, not an error`, async () => {
    const { el } = await mounted('hub', {}, { status });
    try {
      assert.match(el.textContent, /not available yet/);
      assert.doesNotMatch(el.textContent, /could not be loaded/);
    } finally {
      A.unmountAudit();
    }
  });
}

test('render: other HTTP errors say so; an empty log says so', async () => {
  let r = await mounted('hub', {}, { status: 500 });
  assert.match(r.el.textContent, /could not be loaded: HTTP 500/);
  A.unmountAudit();
  r = await mounted('hub', { entries: [], forks: [] });
  assert.match(r.el.textContent, /No audit entries/);
  A.unmountAudit();
});

test('store audit-fork alarms render even when the response has none', async () => {
  const store = { source: { kind: 'hub' }, builders: new Map(), alarms: [{ kind: 'audit-fork', builder: 'builder-c', text: `audit chain of builder-c is shorter ${HOSTILE}` }] };
  const { el } = await mounted('hub', { entries: [] }, { store });
  try {
    const f = find(el, hasClass('au-fork-t'));
    assert.equal(f.length, 1);
    assert.equal(f[0]._text, `audit chain of builder-c is shorter ${HOSTILE}`);
  } finally {
    A.unmountAudit();
  }
});

test('builder render: /api/v1/audit, the chain head and the verify hint, no builder chips', async () => {
  const { el, urls } = await mounted('builder', builderBody());
  try {
    assert.match(urls[0], /^\/api\/v1\/audit\?since=\d+&limit=1000$/);
    const text = el.textContent;
    assert.match(text, /HEAD/);
    assert.ok(text.includes('f'.repeat(16)));
    assert.match(text, /\[42\]/);
    assert.match(text, /laneboard audit verify/);
    assert.ok(text.includes(HOSTILE));
    assert.equal(find(el, (n) => n.attrs?.['aria-label'] === 'Builder').length, 0, 'no builder chip group');
    assert.match(text, /3 entries · more in the log/);
  } finally {
    A.unmountAudit();
  }
});

test('unmount clears the section; a load that lands after unmount paints nothing', async () => {
  const { doc, wrap } = dom();
  const saved = globalThis.document;
  globalThis.document = doc;
  try {
    const el = wrap(makeEl('section'));
    let release;
    const gate = new Promise((r) => { release = r; });
    const p = A.mountAudit(el, { store: { source: { kind: 'hub' } }, route: {} }, {
      poll: false,
      fetchFn: async () => { await gate; return { status: 200, ok: true, json: async () => hubBody() }; },
    });
    assert.match(el.textContent, /Loading/);
    A.unmountAudit();
    assert.equal(el.children.length, 0);
    release();
    await p;
    assert.equal(el.children.length, 0, 'nothing painted after unmount');
  } finally {
    globalThis.document = saved;
  }
});

test('the default export is a registry view', () => {
  const v = A.default;
  assert.equal(v.id, 'audit');
  for (const k of ['mount', 'unmount', 'update']) assert.equal(typeof v[k], 'function');
  assert.equal(A.auditScope({ b: 'builder-a' }), 'builder-a');
  assert.equal(A.auditScope(null), 'all');
});

// --- static ------------------------------------------------------------------------------

test('static: no HTML sinks, no mutating requests, no class syntax; the sheet uses tokens only', () => {
  const src = read('public/js/views/audit.js');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /method\s*:\s*['"](?:POST|PUT|DELETE|PATCH)/i);
  assert.doesNotMatch(src, /actions\.js'/);
  assert.doesNotMatch(src, /\bclass\s+\w|\bconstructor\b|\bsuper\b/);
  assert.match(src, /\/api\/fleet\/audit/);
  assert.match(src, /\/api\/v1\/audit/);
  const css = read('public/css/views/audit.css');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i, 'no colour literals outside tokens.css');
  assert.match(read('public/index.html'), /href="\/css\/views\/audit\.css"/);
});
