// The Wall's frame (Wall plan T9, docs/plans/wall/README.md §3): the fleet's
// worst line bottom right (crit beats attention beats warn, a calm fleet says
// so), the ambient fact under it, the clock's words and when it ticks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  worstLine, ambientLine, clockText, msToNextMinute, MAX_LINE,
} from '../public/js/wall/frame.js';
import { buildFleet, parseTopology } from '../server/map.mjs';
import { DEMO_TOPOLOGY_LARGE, createLargeLive } from './helpers/demo-hub.mjs';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';
import { createFrame } from '../public/js/wall/frame.js';

/** Three sites, all calm; `set` puts statuses on nodes by id. */
function fleet(set = {}) {
  const nodes = [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'lab', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'builder:builder-a', parent: 'lab', kind: 'builder', label: 'builder-a', status: 'working' },
    { id: 'lane:a/fix', parent: 'builder:builder-a', kind: 'lane', label: 'fix-login', status: 'ok' },
    { id: 'sess:a/fix', parent: 'lane:a/fix', kind: 'session', label: 'login fix', status: 'ok' },
    { id: 'hv2', parent: '__core', kind: 'site', label: 'hv2', status: 'ok' },
    { id: 'storage', parent: 'hv2', kind: 'room', label: 'storage', status: 'ok' },
    { id: 'cloud', parent: '__core', kind: 'site', label: 'cloud', status: 'ok' },
    { id: 'api-prod', parent: 'cloud', kind: 'service', label: 'api-prod', status: 'ok' },
    { id: '__repos', parent: '__core', kind: 'site', label: 'REPOS', status: 'ok' },
  ];
  for (const n of nodes) Object.assign(n, set[n.id] ?? {});
  return { title: 'demo-host', nodes };
}

test('frame: a calm fleet says so, with no shape and no count', () => {
  const w = worstLine(fleet());
  assert.deepEqual(w, { status: 'ok', tone: 'grey', text: 'all calm', more: 0 });
  assert.deepEqual(worstLine({}), w, 'no model reads as calm, not as an error');
  assert.deepEqual(worstLine(null), w);
});

test('frame: crit beats attention beats warn, whatever the model order', () => {
  const warn = { 'api-prod': { status: 'warn', why: 'p95 latency 840 ms' } };
  const attention = { 'lane:a/fix': { status: 'attention', why: 'asked a question · 3m' } };
  const crit = { storage: { status: 'crit', why: 'pool 97% full' } };

  const w = worstLine(fleet(warn));
  assert.equal(w.status, 'warn');
  assert.equal(w.tone, 'warn');
  assert.equal(w.glyph, '▲');
  assert.equal(w.text, 'cloud · api-prod · p95 latency 840 ms');
  assert.equal(w.more, 0);

  const a = worstLine(fleet({ ...warn, ...attention }));
  assert.equal(a.status, 'attention');
  assert.equal(a.tone, 'warn', 'attention reads in the warn tone, as on the Map');
  assert.equal(a.text, 'hv1 · fix-login · asked a question · 3m');
  assert.equal(a.more, 1);

  const c = worstLine(fleet({ ...warn, ...attention, ...crit }));
  assert.deepEqual(
    { status: c.status, tone: c.tone, shape: c.shape, glyph: c.glyph, site: c.site, name: c.name, why: c.why, more: c.more },
    { status: 'crit', tone: 'crit', shape: 'square', glyph: '■', site: 'hv2', name: 'storage', why: 'pool 97% full', more: 2 },
  );
  assert.equal(c.text, 'hv2 · storage · pool 97% full');

  // down is worse than crit
  const d = worstLine(fleet({ ...crit, cloud: { status: 'down' } }));
  assert.equal(d.status, 'down');
  assert.equal(d.tone, 'crit');
  assert.equal(d.text, 'cloud · down', 'a site down names itself once, and the status stands in for a missing why');
});

test('frame: a node in trouble under one in trouble is the same problem, counted once', () => {
  const w = worstLine(fleet({
    'lane:a/fix': { status: 'attention', why: 'waiting on a permission prompt · 3m' },
    'sess:a/fix': { status: 'crit', why: 'session died' },
  }));
  assert.equal(w.more, 0, 'lane and session are one problem');
  assert.equal(w.status, 'crit', 'and the worst node in it speaks for it');
  assert.equal(w.text, 'hv1 · login fix · session died');
});

test('frame: a long line is clipped so it never runs into the clock', () => {
  const w = worstLine(fleet({ storage: { status: 'crit', why: 'x'.repeat(200) } }));
  assert.equal(w.text.length, MAX_LINE);
  assert.ok(w.text.endsWith('…'));
});

test('frame: the ambient fact counts places, not laneboard itself', () => {
  assert.equal(ambientLine(fleet()), '3 sites · 8 nodes · 1 working');
  assert.equal(ambientLine({ nodes: [{ id: 'x', kind: 'room', status: 'ok' }] }), '1 node');
});

test('frame: the clock says hours and minutes, 24 h, and ticks on the minute', () => {
  assert.deepEqual(clockText(new Date(2026, 9, 26, 7, 5, 59)), { time: '07:05', date: 'mon 26 oct' });
  assert.deepEqual(clockText(new Date(2026, 0, 1, 23, 0)), { time: '23:00', date: 'thu 01 jan' });
  assert.equal(msToNextMinute(120000), 60000);
  assert.equal(msToNextMinute(120000 + 59500), 500);
});

test('frame: on the large demo the crit window puts hv2 storage on the line, the calm window says calm', () => {
  const live = createLargeLive();
  const now = 1_790_000_000_000;
  const at = (tick) => {
    const feeds = new Map(live(tick, now).map((f) => [f.source, { ...f, receivedAt: now }]));
    return buildFleet({ topology: parseTopology(structuredClone(DEMO_TOPOLOGY_LARGE)), feeds, now, hostname: 'demo-host' });
  };
  const crit = worstLine(at(10));
  assert.equal(crit.status, 'crit');
  assert.equal(crit.site, 'hv2');
  assert.equal(crit.name, 'storage');
  const calm = worstLine(at(87));
  assert.ok(['ok', 'warn', 'attention'].includes(calm.status), 'no crit in the calm window');
  assert.notEqual(calm.status, 'crit');
  assert.match(ambientLine(at(10)), /^5 sites · \d+ nodes/);
});

test('frame: the DOM part sets the line, keeps names whole, says live, and ticks on the minute', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    let t = new Date(2026, 9, 26, 7, 5, 30).getTime();
    const waits = [];
    const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout() {} };
    const root = makeEl('div');
    const frame = createFrame(root, { timers, now: () => t });
    const { clock, fleet: box, tag } = frame.el;
    assert.equal(clock.textContent, '07:05mon 26 oct');
    assert.equal(waits.at(-1).ms, 30000 + 50, 'the next tick just after the minute turns');
    t += 30050;
    waits.at(-1).fn();
    assert.equal(clock.children[0].textContent, '07:06');

    frame.update(fleet());
    assert.equal(box.dataset.tone, 'grey');
    assert.equal(box.children[0].textContent, 'all calm');
    assert.equal(box.children[1].textContent, '3 sites · 8 nodes · 1 working');

    frame.update(fleet({
      'lane:a/fix': { status: 'attention', why: 'asked a question' },
      'sess:a/fix': { status: 'attention' },
      storage: { status: 'crit', why: 'builder-c no contact' },
    }));
    assert.equal(box.dataset.tone, 'crit');
    const line = box.children[0];
    assert.equal(line.textContent, '■hv2 · storage · builder-c no contact');
    const whole = (el) => (el.classList.contains('wall-fleet-name') ? [el.textContent] : el.children.flatMap(whole));
    assert.deepEqual(whole(line), ['hv2', 'storage', 'builder-c'], 'site, name and hyphenated words never break');
    assert.equal(box.children[1].textContent, '+1 more3 sites · 8 nodes · 1 working');

    assert.equal(tag.textContent, 'laneboard · demo-host');
    frame.live(true);
    assert.equal(tag.dataset.live, '1');
    frame.live(false);
    assert.equal(tag.textContent, 'laneboard · demo-hostoffline');
  } finally {
    globalThis.document = prevDoc;
  }
});
