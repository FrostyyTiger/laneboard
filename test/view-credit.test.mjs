// The Credit view, fleet-wide (fleet plan §4 D13): the pure model over the
// builder's /api/credit and the hub's /api/fleet/credit (§7 O11), and the view
// rendered into the fake DOM (test/helpers/fakedom.mjs). The hub payloads are
// made by the real mergeCredit, so the view is tested against the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEl, makeDocument, texts } from './helpers/fakedom.mjs';
import { mergeCredit, withFkeys } from '../server/hub/credit.mjs';

const byId = new Map([['credit-body', makeEl('div')], ['credit-sampler', makeEl('span')], ['view-credit', makeEl('section')]]);
globalThis.document = makeDocument({ byId });

const fetches = [];
let reply = () => ({});
globalThis.fetch = async (url) => {
  fetches.push(String(url));
  const body = reply(String(url));
  if (body instanceof Error) return { ok: false, status: 503, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => body };
};

const V = await import('../public/js/views/credit.js');
const view = V.default;

const NOW = Date.now();
const H = 3600e3;
const body = () => byId.get('credit-body');
const settle = () => new Promise((r) => setTimeout(r, 0));
const all = (node, pred, out = []) => { for (const c of node.children) { if (pred(c)) out.push(c); all(c, pred, out); } return out; };
const byClass = (node, cls) => node.querySelectorAll(cls);
const byTag = (node, tag) => all(node, (c) => c.tagName === tag.toUpperCase());

/** A builder's /api/credit (and /api/v1/credit) body. */
function part({ id = null, five = 40, seven = 10, lanes = [], totals = null, rows = 12 } = {}) {
  return {
    builder: id,
    now: NOW,
    charts: {
      sevenDay: { title: '7-day window', since: NOW - 7 * 24 * H, now: NOW, points: [{ t: NOW - 2 * H, v: seven }], resets: [NOW - 24 * H] },
      fiveHour: { title: '5-hour window', since: NOW - 24 * H, now: NOW, points: [{ t: NOW - 60e3, v: five }], resets: [] },
    },
    lanes,
    totals: totals ?? { tonight: 1, day: 2, week: 3, allTime: 4 },
    rateLimits: { fiveHour: { usedPct: five, resetsAt: NOW + H }, sevenDay: { usedPct: seven, resetsAt: NOW + 40 * H } },
    sampler: { rows, lastSampleAt: NOW - 30e3, lastSampleAgeMs: 30e3 },
    label: 'API-equivalent',
  };
}
const lane = (name, allTime, extra = {}) => ({ lane: name, hue: 120, tonight: 1, day: 1, week: allTime, allTime, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, ...extra });

const A = part({ id: 'builder-a', five: 40, seven: 10, lanes: [lane('api', 5), lane('web', 2)], totals: { tonight: 2, day: 2, week: 7, allTime: 7 } });
const B = part({ id: 'builder-b', five: 45, seven: 12, lanes: [lane('web', 9)], totals: { tonight: 1, day: 1, week: 9, allTime: 9 } });

function fleet(parts) { return mergeCredit(parts, { now: NOW }); }
const hubStore = { source: { kind: 'hub' } };
const localStore = { source: { kind: 'local' } };

async function show(payload, { store = localStore, route = { view: 'credit', b: null }, navigate = () => {} } = {}) {
  reply = () => payload;
  const st = V.creditState();
  st.data = null; st.url = null; st.known = [];
  view.mount(byId.get('view-credit'), { store, route, navigate });
  await settle();
  return body();
}

// --- pure model -------------------------------------------------------------------

test('the URL follows the source and the builder filter', () => {
  assert.equal(V.creditUrl({ hub: false, b: 'builder-a' }), '/api/credit');
  assert.equal(V.creditUrl({ hub: true }), '/api/fleet/credit');
  assert.equal(V.creditUrl({ hub: true, b: 'builder-a' }), '/api/fleet/credit?b=builder-a');
  assert.equal(V.builderFilter({ b: 'all' }), null);
  assert.equal(V.builderFilter({ b: 'builder-a' }), 'builder-a');
  assert.equal(V.builderFilter({ b: '../x' }), null);
  assert.equal(V.isHubSource(hubStore), true);
  assert.equal(V.isHubSource(localStore), false);
});

test('normalizeCredit survives garbage and keeps only checked values', () => {
  for (const raw of [null, 42, 'x', [], { charts: 'no', lanes: 'no', rateLimits: [], builders: {} }]) {
    const d = V.normalizeCredit(raw);
    assert.deepEqual(d.lanes, []);
    assert.deepEqual(d.charts.sevenDay.points, []);
    assert.equal(d.rateLimits.fiveHour, null);
  }
  const d = V.normalizeCredit({
    charts: { fiveHour: { points: [{ t: 1, v: 5 }, { t: 'x', v: 1 }, null, { t: 2, v: NaN }] } },
    lanes: [lane('x', 1, { hue: 'red; background:url(x)', tonight: '9' }), 'junk'],
    rateLimits: { fiveHour: { usedPct: 250, resetsAt: NOW } },
  });
  assert.deepEqual(d.charts.fiveHour.points, [{ t: 1, v: 5 }]);
  assert.equal(d.lanes.length, 1);
  assert.equal(d.lanes[0].hue, null, 'a non-number hue never reaches CSS');
  assert.equal(d.lanes[0].tonight, 0);
  assert.equal(d.rateLimits.fiveHour.usedPct, 100);
});

test('builder rows mark ok, stale and missing builders and keep the per-builder totals', () => {
  const d = V.normalizeCredit(fleet([
    { builder: 'builder-a', data: A },
    { builder: 'builder-b', data: B, stale: true, ageMs: 120e3, error: 'timeout' },
    { builder: 'builder-c', data: null, error: 'down' },
  ]), { hub: true });
  const rows = V.builderRows(d);
  const st = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  assert.deepEqual(st, { 'builder-a': 'ok', 'builder-b': 'stale', 'builder-c': 'missing' });
  assert.deepEqual(rows.find((r) => r.id === 'builder-a').totals, A.totals);
  assert.equal(rows.find((r) => r.id === 'builder-c').totals, null);
  assert.equal(d.partial, true);
});

test('account windows are never summed: one account shows the highest builder, two accounts stay apart', () => {
  const one = V.accountRows(V.normalizeCredit(fleet([{ builder: 'builder-a', data: A }, { builder: 'builder-b', data: B }]), { hub: true }));
  assert.equal(one.length, 1);
  assert.equal(one[0].fiveHour.usedPct, 45, 'max of 40 and 45, not 85');
  assert.deepEqual(one[0].builders, ['builder-a', 'builder-b']);

  const two = V.accountRows(V.normalizeCredit(fleet([
    { builder: 'builder-a', account: 'acme-1', data: A },
    { builder: 'builder-b', account: 'acme-2', data: B },
  ]), { hub: true }));
  assert.deepEqual(two.map((r) => [r.account, r.fiveHour.usedPct]), [['acme-1', 40], ['acme-2', 45]]);

  const local = V.accountRows(V.normalizeCredit(part()));
  assert.equal(local.length, 1);
  assert.equal(local[0].fiveHour.usedPct, 40);
});

test('lane rows sort by any column, the builder one included, and filter to one builder', () => {
  const d = V.normalizeCredit(fleet([{ builder: 'builder-a', data: A }, { builder: 'builder-b', data: B }]), { hub: true });
  assert.deepEqual(V.laneRows(d).map((r) => r.lane), ['builder-b/web', 'builder-a/api', 'builder-a/web']);
  assert.deepEqual(V.laneRows(d, { sort: 'builder', desc: false }).map((r) => r.builder), ['builder-a', 'builder-a', 'builder-b']);
  assert.deepEqual(V.laneRows(d, { b: 'builder-a' }).map((r) => r.localLane), ['api', 'web']);
  assert.deepEqual(V.columnsFor(false).map((c) => c.key).includes('builder'), false);
  assert.deepEqual(V.columnsFor(true)[0].key, 'builder');
});

// --- rendering --------------------------------------------------------------------

test('builder mode: /api/credit, both charts, no builder column and no fleet panels', async () => {
  fetches.length = 0;
  const box = await show(part({ lanes: [lane('bauplan', 3), lane('(ended sessions)', null, { week: 5 })] }));
  assert.deepEqual(fetches, ['/api/credit']);
  assert.equal(byClass(box, 'chart').length, 2);
  assert.equal(byClass(box, 'panel').length, 0);
  const ths = byTag(box, 'th').map((t) => t.textContent);
  assert.ok(!ths.includes('builder'));
  assert.match(box.textContent, /bauplan/);
  assert.ok(byClass(box, 'num').map((c) => c.textContent).includes('—'), 'an ended session shows a dash');
  assert.match(byId.get('credit-sampler').textContent, /12 samples/);
});

test('hub mode: builder column, per-builder breakdown, account windows and stale/missing marks', async () => {
  fetches.length = 0;
  const merged = fleet([
    { builder: 'builder-a', data: A },
    { builder: 'builder-b', data: B, stale: true, ageMs: 60e3 },
    { builder: 'builder-c', data: null },
  ]);
  const box = await show(merged, { store: hubStore });
  assert.deepEqual(fetches, ['/api/fleet/credit']);
  const text = box.textContent;
  assert.match(text, /ACCOUNTS/);
  assert.match(text, /BUILDERS/);
  assert.match(text, /builder-c missing/);
  assert.match(text, /builder-b stale/);
  assert.match(byId.get('credit-sampler').textContent, /missing: builder-c/);
  // The lane table has the builder column, and builder-b's lane is marked stale.
  const lanesTable = byTag(box, 'table').at(-1);
  assert.equal(byTag(lanesTable, 'th')[0].textContent, 'builder');
  const staleRows = byClass(lanesTable, 'is-stale');
  assert.equal(staleRows.length, 1);
  assert.match(staleRows[0].textContent, /builder-b/);
  assert.ok(all(staleRows[0], (c) => c.classList.contains('lamp') && c.dataset.p === 'stale').length >= 1);
  // The missing builder has an off lamp with words, not colour alone.
  const lamps = byClass(box, 'lamp').map((l) => l.getAttribute('aria-label'));
  assert.ok(lamps.includes('builder-c: missing'));
  // Account windows: 45 % (the max), never 85 %.
  assert.ok(byClass(box, 'chart-now').some((n) => n.textContent === '45%'));
  assert.ok(!byClass(box, 'chart-now').some((n) => n.textContent === '85%'));
  // The totals are the hub's sum.
  assert.match(byTag(lanesTable, 'tfoot')[0].textContent, /\$16\.00/);
  // Primary charts plus the folded per-builder ones.
  assert.equal(byClass(box, 'chart').length, 2 + 4);
});

test('hub mode with two accounts draws each account its own window charts', async () => {
  const box = await show(fleet([
    { builder: 'builder-a', account: 'acme-1', data: A },
    { builder: 'builder-b', account: 'acme-2', data: B },
  ]), { store: hubStore });
  assert.equal(byClass(box, 'chart').length, 2 + 4 + 4);
  assert.match(box.textContent, /acme-1/);
  assert.match(box.textContent, /acme-2/);
});

test('the builder filter: buttons navigate, b= fetches one builder, the chip clears it', async () => {
  const navs = [];
  const navigate = (p) => navs.push(p);
  await show(fleet([{ builder: 'builder-a', data: A }, { builder: 'builder-b', data: B }]), { store: hubStore, navigate });
  const filter = byClass(body(), 'credit-filter')[0];
  const buttons = byTag(filter, 'button');
  assert.deepEqual(buttons.map((b) => b.textContent), ['all', 'builder-a', 'builder-b']);
  buttons[2].onclick();
  assert.deepEqual(navs.at(-1), { b: 'builder-b' });

  // The router calls update() with the new route.
  fetches.length = 0;
  reply = () => withFkeys(B, 'builder-b');
  view.update(hubStore, { store: hubStore, route: { view: 'credit', b: 'builder-b' }, navigate });
  await settle();
  assert.deepEqual(fetches, ['/api/fleet/credit?b=builder-b']);
  const box = body();
  assert.equal(byClass(box, 'panel').length, 0, 'one builder: no fleet panels');
  assert.match(box.textContent, /total · builder-b/);
  assert.equal(byClass(box, 'chip').length, 1, 'a chip shows the filter');

  // A plain store change (no route) does not refetch.
  fetches.length = 0;
  view.update(hubStore, { store: hubStore });
  await settle();
  assert.deepEqual(fetches, []);

  // Back to all.
  reply = () => fleet([{ builder: 'builder-a', data: A }, { builder: 'builder-b', data: B }]);
  view.update(hubStore, { store: hubStore, route: { view: 'credit', b: 'all' } });
  await settle();
  assert.deepEqual(fetches, ['/api/fleet/credit']);
});

test('a source switch to the hub refetches from the hub', async () => {
  await show(part(), { store: localStore });
  fetches.length = 0;
  reply = () => fleet([{ builder: 'builder-a', data: A }]);
  view.update(hubStore, { store: hubStore });
  await settle();
  assert.deepEqual(fetches, ['/api/fleet/credit']);
  assert.ok(byClass(body(), 'panel').length > 0);
});

test('a failed fetch says so instead of crashing', async () => {
  reply = () => new Error('down');
  const st = V.creditState();
  st.data = null; st.url = null;
  view.mount(byId.get('view-credit'), { store: hubStore, route: { b: null } });
  await settle();
  assert.match(body().textContent, /Could not load: HTTP 503/);
});

test('builder text is only ever text', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const bad = part({ id: 'builder-a', lanes: [lane(evil, 3)] });
  const box = await show(fleet([{ builder: 'builder-a', data: bad, error: evil }]), { store: hubStore });
  assert.ok(texts(box).includes(evil), 'the lane name is a text node, verbatim');
  assert.equal(all(box, (c) => c.innerHTML !== '').length, 0, 'no node got innerHTML');
  assert.equal(all(box, (c) => c.tagName === 'IMG').length, 0);
});

test('the default export is a registry view and the registry picks it up', async () => {
  assert.equal(view.id, 'credit');
  for (const k of ['mount', 'unmount', 'update']) assert.equal(typeof view[k], 'function');
  const { getView, isView } = await import('../public/js/views/index.js');
  assert.ok(isView(view));
  assert.equal(getView('credit'), view, 'not the legacy adapter');
  view.unmount();
});
