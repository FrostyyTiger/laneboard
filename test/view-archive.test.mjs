// The Archive view and the restore sheet (fleet plan §10 R14, security review S12a):
// search, expand and restore prefill against a fixture; the sheet preselects the
// row's source builder; another builder shows the "from builder X data" warning
// and the full plan text before Restore is enabled; a gone branch is refused
// before anything is sent; builder text only ever lands as textContent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEl, makeDocument } from './helpers/fakedom.mjs';
import {
  isArchiveRoute, listUrl, detailUrl, normRows, fmtDuration, prLabel, stagesLabel, restoreArgs,
  restoreModel, restoreKey, restoreBuilders, loadArchive, loadDetail, renderDetail, renderTable,
  restoreSheet, onArchiveRoute, COLUMNS, RESTORE_ARG_KEYS,
} from '../public/js/views/archive.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const HOSTILE = '<img src=x onerror=alert(1)>';

// A fake DOM with working listeners (fakedom's addEventListener is a no-op).
function evDoc(byId) {
  const base = makeDocument({ byId });
  const wrap = (n) => {
    const ls = {};
    n.addEventListener = (k, fn) => { (ls[k] ||= []).push(fn); };
    n.fire = (k, ev = {}) => { for (const fn of ls[k] || []) fn({ preventDefault() {}, ...ev }); };
    n.remove = function remove() { const s = this.parent?.children ?? []; const i = s.indexOf(this); if (i >= 0) s.splice(i, 1); this.parent = null; };
    return n;
  };
  return { ...base, createElement: (t) => wrap(makeEl(t)) };
}
const find = (root, cls) => root.querySelectorAll(`.${cls}`);
const one = (root, cls) => find(root, cls)[0];
const allEls = (n, out = []) => { out.push(n); n.children.forEach((c) => allEls(c, out)); return out; };

const ROWS_LOCAL = {
  rows: [
    { lane: 'auth', repo: 'acme', branch: 'feat/auth', plan_title: 'Auth', retired_at: Date.now() - 3600_000, duration_ms: 3720_000, cost_usd: 1.5, pr_number: 12, pr_state: 'MERGED', merged: true, stage_n: 3, stage_m: 5, summary: HOSTILE },
    { lane: 'Bad/../id', repo: 'acme' },
    { lane: 'pay', repo: 'acme', branch: 'feat/pay', retired_at: Date.now() - 86400_000, duration_ms: null, cost_usd: null },
  ],
};
const ROWS_HUB = {
  rows: [
    { lane: 'auth', builder: 'builder-a', fkey: 'builder-a/auth', repo: 'acme' },
    { lane: 'auth', builder: 'builder-b', fkey: 'builder-b/auth', repo: 'acme' },
    { lane: 'evil', builder: 'Not A Builder', repo: 'acme' },
  ],
  missing: ['builder-c', 'BAD ID'],
};
const DETAIL = {
  lane: 'auth', repo: 'acme', branch: 'feat/auth', plan_path: 'docs/plans/auth.md', plan_title: 'Auth',
  plan_head: `# Auth\n\nStep 1: ${HOSTILE}\nStep 2: curl example.invalid`,
  markers: [
    { kind: 'done', text: `finished ${HOSTILE}`, ts: Date.now() - 60_000 },
    { kind: 'blocked', text: 'needed a key', ts: Date.now() - 120_000, dismissed_at: Date.now() },
  ],
  restore: {
    lane: 'auth-r1', repo: 'acme', branch: 'feat/auth', plan: 'docs/plans/auth.md',
    model: 'opus', permissionMode: null, restoredFrom: 'auth', branchExists: true,
  },
};
const withRestore = (patch) => ({ ...DETAIL, restore: { ...DETAIL.restore, ...patch } });

function fakeFetch(map) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const hit = map[url];
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: 'not archived' }) };
    return { ok: true, status: 200, json: async () => structuredClone(hit) };
  };
  fn.calls = calls;
  return fn;
}

// ------------------------------------------------------------------ pure parts

test('the route: only #/board?s=archive is the archive', () => {
  assert.equal(isArchiveRoute({ view: 'board', s: 'archive' }), true);
  assert.equal(isArchiveRoute({ view: 'board', s: null }), false);
  assert.equal(isArchiveRoute({ view: 'map', s: 'archive' }), false);
  assert.equal(isArchiveRoute(null), false);
});

test('list and detail URLs for a builder and for the hub', () => {
  assert.equal(listUrl('local'), '/api/v1/archive');
  assert.equal(listUrl('local', '  '), '/api/v1/archive');
  assert.equal(listUrl('local', 'a&b=%'), '/api/v1/archive?q=a%26b%3D%25');
  assert.equal(listUrl('hub', 'auth'), '/api/fleet/archive?q=auth');
  assert.equal(listUrl('hub', 'x'.repeat(500)).length, '/api/fleet/archive?q='.length + 200);
  assert.equal(detailUrl('local', null, 'auth'), '/api/v1/archive/auth');
  assert.equal(detailUrl('hub', 'builder-a', 'auth'), '/api/fleet/builder-a/v1/archive/auth');
  assert.equal(detailUrl('hub', '../x', 'auth'), null);
  assert.equal(detailUrl('hub', 'builder-a', '..'), null);
  assert.equal(detailUrl('local', null, 'a/b'), null);
});

test('rows are tagged with their builder; bad ids are dropped', () => {
  const local = normRows(ROWS_LOCAL, { kind: 'local', localId: 'builder-a' });
  assert.deepEqual(local.rows.map((r) => r.fkey), ['builder-a/auth', 'builder-a/pay']);
  assert.deepEqual(local.missing, []);
  const hub = normRows(ROWS_HUB, { kind: 'hub' });
  assert.deepEqual(hub.rows.map((r) => r.fkey), ['builder-a/auth', 'builder-b/auth']);
  assert.deepEqual(hub.missing, ['builder-c']);
  assert.deepEqual(normRows(null).rows, []);
});

test('cell formatting', () => {
  assert.equal(fmtDuration(42_000), '42s');
  assert.equal(fmtDuration(3720_000), '1h 2m');
  assert.equal(fmtDuration(90061_000), '1d 1h');
  assert.equal(fmtDuration(null), '—');
  assert.equal(prLabel({ pr_number: 12, merged: true }), '#12 merged');
  assert.equal(prLabel({ pr_number: 7, pr_state: 'OPEN' }), '#7 open');
  assert.equal(prLabel({}), '—');
  assert.equal(stagesLabel({ stage_n: 3, stage_m: 5 }), '3/5');
  assert.equal(stagesLabel({ stage_n: 3 }), '—');
  assert.deepEqual(COLUMNS.map(([k]) => k), ['lane', 'builder', 'repo', 'branch', 'retired', 'duration', 'cost', 'pr', 'stages', 'summary']);
});

test('restore prefill: only the launch schema keys, nulls dropped; legacy adds the lane', () => {
  assert.deepEqual(restoreArgs({ ...DETAIL.restore, evil: 'x', branchExists: true }), {
    repo: 'acme', branch: 'feat/auth', plan: 'docs/plans/auth.md', model: 'opus', restoredFrom: 'auth',
  });
  assert.deepEqual(Object.keys(restoreArgs(DETAIL.restore, { legacy: true })), ['lane', 'repo', 'branch', 'plan', 'model', 'restoredFrom']);
  assert.ok(RESTORE_ARG_KEYS.every((k) => k !== 'lane'), 'the v1 launch takes the lane as target, not an arg');
  assert.deepEqual(restoreArgs(null), {});
});

test('restoreModel: the source builder by default, sendable', () => {
  const m = restoreModel({ detail: DETAIL, source: 'builder-a', builders: ['builder-a', 'builder-b'] });
  assert.equal(m.chosen, 'builder-a');
  assert.equal(m.cross, false);
  assert.equal(m.warning, null);
  assert.equal(m.refusal, null);
  assert.equal(m.canSend, true);
  assert.equal(m.lane, 'auth-r1');
});

test('restoreModel: another builder warns, shows the plan, and needs the tick', () => {
  const builders = ['builder-a', 'builder-b'];
  const m = restoreModel({ detail: DETAIL, source: 'builder-a', chosen: 'builder-b', builders });
  assert.equal(m.cross, true);
  assert.match(m.warning, /From builder builder-a data/);
  assert.equal(m.planText, DETAIL.plan_head);
  assert.equal(m.canSend, false, 'not before the user has read the plan');
  assert.equal(restoreModel({ detail: DETAIL, source: 'builder-a', chosen: 'builder-b', builders, ack: true }).canSend, true);
  const noPlan = restoreModel({ detail: { ...DETAIL, plan_head: '' }, source: 'builder-a', chosen: 'builder-b', builders, ack: true });
  assert.equal(noPlan.canSend, false);
  assert.match(noPlan.refusal, /no plan text/);
  assert.match(restoreModel({ detail: DETAIL, source: 'builder-a', chosen: 'builder-z', builders, ack: true }).refusal, /not a known builder/);
});

test('restoreModel: a gone branch is refused with a clear message, on any builder', () => {
  const gone = withRestore({ branchExists: false });
  for (const chosen of ['builder-a', 'builder-b']) {
    const m = restoreModel({ detail: gone, source: 'builder-a', chosen, builders: ['builder-a', 'builder-b'], ack: true });
    assert.equal(m.canSend, false);
    assert.match(m.refusal, /branch feat\/auth no longer exists on builder-a/);
  }
  assert.match(restoreModel({ detail: { lane: 'x' }, source: 'builder-a', builders: ['builder-a'] }).refusal, /no restore data/);
  assert.match(restoreModel({ detail: withRestore({ lane: null }), source: 'builder-a', builders: ['builder-a'] }).refusal, /no free restore id/);
  assert.match(restoreModel({ detail: withRestore({ plan: null }), source: 'builder-a', builders: ['builder-a'] }).refusal, /no plan path/);
});

test('restore keys and builders per source kind', () => {
  assert.equal(restoreKey('hub', 'builder-b', 'auth-r1'), 'builder-b/auth-r1');
  assert.equal(restoreKey('local', 'builder-a', 'auth-r1'), 'auth-r1');
  const hubStore = { source: { kind: 'hub' }, builders: new Map([['builder-b', {}], ['builder-a', {}]]) };
  assert.deepEqual(restoreBuilders(hubStore), ['builder-a', 'builder-b']);
});

// ------------------------------------------------------------------ fixtures: search + expand

test('search against a fixture: the q goes to the builder or the hub list', async () => {
  const f = fakeFetch({ '/api/v1/archive?q=auth': ROWS_LOCAL, '/api/fleet/archive?q=auth': ROWS_HUB });
  const local = await loadArchive({ q: 'auth', kind: 'local', localId: 'builder-a', fetchImpl: f });
  assert.equal(local.rows.length, 2);
  const hub = await loadArchive({ q: 'auth', kind: 'hub', fetchImpl: f });
  assert.deepEqual(hub.rows.map((r) => r.builder), ['builder-a', 'builder-b']);
  assert.deepEqual(f.calls.map((c) => [c.method, c.url]), [['GET', '/api/v1/archive?q=auth'], ['GET', '/api/fleet/archive?q=auth']]);
  await assert.rejects(loadArchive({ q: 'nope', kind: 'local', localId: 'builder-a', fetchImpl: f }), /not archived/);
});

test('expand: the detail comes from the row builder (hub read proxy) and shows markers and plan head as text', async () => {
  const f = fakeFetch({ '/api/fleet/builder-b/v1/archive/auth': DETAIL });
  const detail = await loadDetail({ kind: 'hub', builder: 'builder-b', lane: 'auth', fetchImpl: f });
  assert.equal(f.calls[0].url, '/api/fleet/builder-b/v1/archive/auth');
  const doc = evDoc(new Map());
  let restored = null;
  const node = renderDetail(detail, { doc, onRestore: (d) => { restored = d; } });
  const markers = find(node, 'arc-marker');
  assert.equal(markers.length, 2);
  assert.match(markers[0].textContent, /done/);
  assert.match(markers[0].textContent, /finished <img src=x onerror=alert\(1\)>/);
  assert.ok(markers[1].classList.contains('is-stale'), 'a dismissed marker is dimmed, still shown');
  assert.equal(one(node, 'arc-plan').textContent, DETAIL.plan_head);
  one(node, 'arc-restore').fire('click');
  assert.equal(restored, detail);
  for (const n of allEls(node)) assert.equal(n.innerHTML, '', 'no HTML sink');
  await assert.rejects(loadDetail({ kind: 'hub', builder: 'builder-b', lane: '../x', fetchImpl: f }), /bad lane id/);
});

test('the table: one row per lane, the expanded row right under it, hostile text inert', () => {
  const doc = evDoc(new Map());
  const { rows } = normRows(ROWS_LOCAL, { kind: 'local', localId: 'builder-a' });
  const opened = [];
  const detailNode = doc.createElement('div');
  detailNode.textContent = 'DETAIL';
  const t = renderTable(rows, { doc, onExpand: (r) => opened.push(r.fkey), expanded: new Map([['builder-a/auth', detailNode]]) });
  const trs = find(t, 'arc-row');
  assert.deepEqual(trs.map((r) => r.dataset.key), ['builder-a/auth', 'builder-a/pay']);
  assert.equal(trs[0].getAttribute('aria-expanded'), 'true');
  const cells = trs[0].children.map((c) => c.textContent);
  assert.deepEqual(cells.slice(0, 4), ['auth', 'builder-a', 'acme', 'feat/auth']);
  assert.equal(cells[5], '1h 2m');
  assert.equal(cells[6], '$1.50');
  assert.equal(cells[7], '#12 merged');
  assert.equal(cells[8], '3/5');
  assert.equal(cells[9], HOSTILE, 'the summary is text');
  assert.equal(find(t, 'arc-detail-row')[0].textContent, 'DETAIL');
  trs[1].fire('click');
  trs[0].fire('keydown', { key: 'Enter' });
  assert.deepEqual(opened, ['builder-a/pay', 'builder-a/auth']);
  for (const n of allEls(t)) assert.equal(n.innerHTML, '');
});

// ------------------------------------------------------------------ the restore sheet

function sheetFor(detail, { source = 'builder-a', builders = ['builder-a', 'builder-b'], kind = 'hub', confirmOk = true, actResult = { ok: true, result: { job: 'j1' } } } = {}) {
  const doc = evDoc(new Map());
  const calls = { confirm: [], act: [] };
  const sheet = restoreSheet(detail, source, {
    doc, kind, builders,
    confirm: async (spec) => { calls.confirm.push(spec); return { ok: confirmOk }; },
    act: async (k, action, args) => { calls.act.push([k, action, args]); return actResult; },
  });
  return { sheet, calls, root: sheet.root };
}

test('the sheet preselects the source builder and is prefilled', () => {
  const { root } = sheetFor(DETAIL);
  const sel = one(root, 'arc-builder');
  assert.equal(sel.value, 'builder-a');
  assert.deepEqual(sel.children.map((o) => o.value), ['builder-a', 'builder-b']);
  assert.match(sel.children[0].textContent, /source/);
  assert.equal(one(root, 'arc-f-branch').textContent, 'feat/auth');
  assert.equal(one(root, 'arc-f-plan').textContent, 'docs/plans/auth.md');
  assert.equal(one(root, 'arc-f-model').textContent, 'opus');
  assert.match(one(root, 'cfm-t').textContent, /Restore auth as auth-r1/);
  assert.equal(one(root, 'arc-warn').hidden, true);
  assert.equal(one(root, 'arc-plan-full').hidden, true);
  assert.equal(one(root, 'arc-send').disabled, false);
});

test('another builder: warning and the full plan text first, Restore enabled only after the tick', async () => {
  const { sheet, root, calls } = sheetFor(DETAIL);
  const sel = one(root, 'arc-builder');
  sel.value = 'builder-b';
  sel.fire('change');
  const warn = one(root, 'arc-warn');
  assert.equal(warn.hidden, false);
  assert.match(warn.textContent, /From builder builder-a data/);
  const plan = one(root, 'arc-plan-full');
  assert.equal(plan.hidden, false);
  assert.equal(plan.textContent, DETAIL.plan_head, 'the whole archived plan, as text');
  const send = one(root, 'arc-send');
  assert.equal(send.disabled, true);
  const r0 = await sheet.send();
  assert.equal(r0.ok, false);
  assert.equal(calls.act.length, 0, 'nothing sent before the tick');
  const ack = root.querySelectorAll('.arc-ack')[0].children[0];
  ack.checked = true;
  ack.fire('change');
  assert.equal(send.disabled, false);
  const r = await sheet.send();
  assert.equal(r.ok, true);
  assert.equal(calls.confirm.length, 1);
  assert.equal(calls.confirm[0].action, 'launch');
  assert.deepEqual(calls.confirm[0].targets, ['builder-b/auth-r1']);
  assert.ok(calls.confirm[0].consequence.some((l) => /From builder builder-a data/.test(l)));
  assert.deepEqual(calls.act, [['builder-b/auth-r1', 'launch', {
    repo: 'acme', branch: 'feat/auth', plan: 'docs/plans/auth.md', model: 'opus', restoredFrom: 'auth',
  }]]);
  assert.match(one(root, 'arc-status').textContent, /Launched auth-r1 on builder-b \(job j1\)/);
  // Back to the source: the tick is reset and the warning goes.
  sheet.choose('builder-a');
  assert.equal(one(root, 'arc-warn').hidden, true);
  assert.equal(sheet.model().cross, false);
});

test('restore to the source goes through the confirm and act(launch) with the prefill', async () => {
  const { sheet, calls } = sheetFor(DETAIL);
  one(sheet.root, 'arc-send').fire('click');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.confirm.length, 1);
  assert.deepEqual(calls.act.map((c) => c.slice(0, 2)), [['builder-a/auth-r1', 'launch']]);
});

test('a cancelled confirm sends nothing; a refusal is shown as text', async () => {
  const c = sheetFor(DETAIL, { confirmOk: false });
  const r = await c.sheet.send();
  assert.equal(r.code, 'cancelled');
  assert.equal(c.calls.act.length, 0);
  const bad = sheetFor(DETAIL, { actResult: { ok: false, error: `taken ${HOSTILE}` } });
  await bad.sheet.send();
  assert.equal(one(bad.root, 'arc-status').textContent, `Refused: taken ${HOSTILE}`);
  assert.equal(one(bad.root, 'arc-send').disabled, false, 'can retry after a refusal');
});

test('a gone branch is refused in the sheet, early and clearly', async () => {
  const { sheet, root, calls } = sheetFor(withRestore({ branchExists: false }));
  const refusal = one(root, 'arc-refusal');
  assert.equal(refusal.hidden, false);
  assert.match(refusal.textContent, /Cannot restore: branch feat\/auth no longer exists on builder-a/);
  assert.equal(one(root, 'arc-send').disabled, true);
  const r = await sheet.send();
  assert.equal(r.ok, false);
  assert.equal(calls.confirm.length, 0);
  assert.equal(calls.act.length, 0);
});

test('a builder source: one builder, the bare lane id is the act() key', async () => {
  const { sheet, root, calls } = sheetFor(DETAIL, { kind: 'local', builders: ['builder-a'] });
  assert.equal(one(root, 'arc-builder').disabled, true);
  await sheet.send();
  assert.deepEqual(calls.confirm[0].targets, ['auth-r1']);
  assert.equal(calls.act[0][0], 'auth-r1');
});

// ------------------------------------------------------------------ page wiring

test('the route hook shows the archive in the board and hides the lanes; reads only', async () => {
  const byId = new Map([['view-board', makeEl('div')], ['grid', makeEl('div')]]);
  byId.get('view-board').append(byId.get('grid'));
  const prev = { document: globalThis.document, fetch: globalThis.fetch };
  const calls = [];
  globalThis.document = evDoc(byId);
  globalThis.fetch = async (url, init) => {
    calls.push([init?.method ?? 'GET', url]);
    return { ok: true, status: 200, json: async () => structuredClone(ROWS_LOCAL) };
  };
  try {
    onArchiveRoute({ view: 'board', s: 'archive', q: 'auth', action: 'launch' });
    await new Promise((r) => setImmediate(r));
    const host = byId.get('view-board').children.find((c) => c.id === 'archive-view');
    assert.ok(host, 'mounted into the board view');
    assert.equal(host.hidden, false);
    assert.equal(byId.get('grid').hidden, true);
    assert.equal(one(host, 'arc-search').value, 'auth');
    assert.equal(find(host, 'arc-row').length, 2);
    assert.match(one(host, 'arc-note').textContent, /2 archived lanes/);
    assert.deepEqual(calls, [['GET', '/api/v1/archive?q=auth']], 'a route only reads');
    onArchiveRoute({ view: 'board', s: null });
    assert.equal(host.hidden, true);
    assert.equal(byId.get('grid').hidden, false);
  } finally {
    globalThis.document = prev.document;
    globalThis.fetch = prev.fetch;
  }
});

test('archive.js uses no HTML sinks and avoids the class/constructor forms', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/views/archive.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /\bclass\s+\w|\bconstructor\b|\bsuper\b/);
});
