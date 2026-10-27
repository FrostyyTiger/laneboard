// The Wall's frame (Wall plan T9, docs/plans/wall/README.md §3): the fleet's
// worst line bottom right (crit beats attention beats warn, a calm fleet says
// so), the ambient fact under it, the clock's words and when it ticks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  worstLine, ambientLine, clockText, msToNextMinute, MAX_LINE, fleetSize, FLEET_FAR, clearedLine,
} from '../public/js/wall/frame.js';
import { STEPS } from '../public/js/wall/caption.js';
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
  assert.deepEqual(w, { status: 'ok', tone: 'grey', step: 'calm', text: 'all calm', more: 0 });
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
  const d = worstLine(fleet({ ...attention, cloud: { status: 'down' } }));
  assert.equal(d.status, 'down');
  assert.equal(d.tone, 'crit');
  assert.equal(d.text, 'cloud · down', 'a site down names itself once, and the status stands in for a missing why');
});

test('frame: two crits are named together, oldest first, whatever else is held (night 4 T8)', () => {
  const warn = { 'api-prod': { status: 'warn', why: 'p95 latency 840 ms' } };
  const two = { storage: { status: 'crit', why: 'pool 97% full' }, 'builder:builder-a': { status: 'crit', why: 'no contact' } };
  const m = fleet({ ...warn, ...two });
  // No `since`: model order (hv1's builder comes first in the model).
  const w = worstLine(m);
  assert.equal(w.step, 'far');
  assert.equal(w.tone, 'crit');
  assert.equal(w.glyph, '■');
  assert.equal(w.crits, 2);
  assert.equal(w.word, '2 crit · hv1 · hv2');
  assert.equal(w.why, 'builder-a · no contact', "the oldest's name and reason");
  assert.equal(w.id, 'builder:builder-a');
  assert.equal(w.more, 1, 'the count is the milder problems past the named crits');
  assert.equal(w.text, '2 crit · hv1 · hv2 · builder-a · no contact');
  // `since` says storage was seen first: it leads, and its reason is the why.
  const since = new Map([['storage', 1000], ['builder:builder-a', 5000]]);
  const s = worstLine(m, { since });
  assert.equal(s.word, '2 crit · hv2 · hv1');
  assert.equal(s.why, 'storage · pool 97% full');
  assert.equal(s.id, 'storage');
  // One `since` does not know is the newest.
  assert.equal(worstLine(m, { since: new Map([['storage', 1000]]) }).word, '2 crit · hv2 · hv1');
  // A down and a crit seen together: the down leads; the word says crit unless all are down.
  const d = worstLine(fleet({ storage: { status: 'crit', why: 'pool 97% full' }, cloud: { status: 'down' } }));
  assert.equal(d.word, '2 crit · cloud · hv2');
  assert.equal(d.why, 'down', 'a site down is its own place: only its status');
  assert.equal(d.status, 'down');
  const dd = worstLine(fleet({ cloud: { status: 'down' }, hv2: { status: 'down' } }));
  assert.equal(dd.word, '2 down · hv2 · cloud');
  // Two crits in one site name it once; past FAR_NAMES places the count says how many.
  const same = worstLine(fleet({ storage: { status: 'crit' }, hv2: { status: 'ok' }, 'api-prod': { status: 'crit' }, cloud: { status: 'ok' } }));
  assert.equal(same.word, '2 crit · hv2 · cloud');
  const many = {
    title: 'many',
    nodes: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, kind: 'site', label: `s${i}`, status: 'crit' })),
  };
  assert.equal(worstLine(many).word, '5 crit · s0 · s1 · s2');
});

test('frame: crit sets the line at the 3 m step with its count, attention and calm do not (T21)', () => {
  const warn = { 'api-prod': { status: 'warn', why: 'p95 latency 840 ms' } };
  const attention = { 'lane:a/fix': { status: 'attention', why: 'asked a question · 3m' } };
  const crit = { storage: { status: 'crit', why: 'pool 97% full' } };

  const c = worstLine(fleet({ ...warn, ...attention, ...crit }));
  assert.deepEqual(
    { step: c.step, word: c.word, why: c.why, more: c.more },
    { step: 'far', word: 'hv2 · storage', why: 'pool 97% full', more: 2 },
    'crit: where it is big, the why and +2 more under it',
  );
  assert.equal(worstLine(fleet({ cloud: { status: 'down' } })).step, 'far', 'down is read from across the room too');
  assert.equal(worstLine(fleet({ cloud: { status: 'down' } })).word, 'cloud');

  const a = worstLine(fleet({ ...warn, ...attention }));
  assert.deepEqual({ step: a.step, word: a.word, more: a.more }, { step: 'line', word: 'hv1 · fix-login', more: 1 },
    'attention only: today\'s line step, the whole line on it');
  assert.equal(worstLine(fleet(warn)).step, 'line');
  assert.equal(worstLine(fleet()).step, 'calm');
});

test('frame: the far step is the caption hero, fitted by width, never under the hero minimum (T21)', () => {
  // A short word on the tablet (1368 x 912 CSS px) takes the full 3 m step.
  assert.equal(fleetSize('hv2', 1368, 912), STEPS.hero);
  // The demo's word fits 64vw a step down from the hero, still far above the name.
  const demo = fleetSize('hv2 · storage', 1368, 912);
  assert.ok(demo < STEPS.hero && demo > STEPS.name + 4, `hv2 · storage at ${demo}vmin`);
  assert.ok(fleetSize('hv2 · storage', 1920, 1080) > demo, 'a wider screen gives the word more of the step');
  assert.equal(fleetSize('x'.repeat(80), 1368, 912), STEPS.heroMin, 'a long word bottoms out, the CSS cuts it');
  assert.equal(fleetSize('hv2', 0, 0), STEPS.hero, 'no stage yet: the CSS default');
  // The word at its size never runs wider than the band allows.
  const ems = 1.1 + [...'hv2 · storage'].length * 0.47;
  assert.ok((demo * ems * 912) / 100 <= (FLEET_FAR.maxVw * 1368) / 100 + 1);
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
    assert.equal(box.dataset.step, 'calm');
    const [lineEl, sub, fact] = box.children;
    assert.equal(lineEl.textContent, 'all calm');
    assert.equal(sub.hidden, true);
    assert.equal(fact.textContent, '3 sites · 8 nodes · 1 working');

    frame.update(fleet({ 'lane:a/fix': { status: 'attention', why: 'asked a question' } }));
    assert.equal(box.dataset.step, 'line');
    assert.equal(lineEl.textContent, '▲hv1 · fix-login · asked a question');
    assert.equal(sub.hidden, true, 'attention keeps one line and the fact under it');
    assert.equal(fact.hidden, false);

    frame.update(fleet({
      'lane:a/fix': { status: 'attention', why: 'asked a question' },
      'sess:a/fix': { status: 'attention' },
      storage: { status: 'crit', why: 'builder-c no contact' },
    }));
    assert.equal(box.dataset.tone, 'crit');
    assert.equal(box.dataset.step, 'far');
    const line = box.children[0];
    assert.equal(line.textContent, '■hv2 · storage', 'crit: where, big, on its own line');
    const whole = (el) => (el.classList.contains('wall-fleet-name') ? [el.textContent] : el.children.flatMap(whole));
    assert.deepEqual(whole(line), ['hv2 · storage'], 'the word never breaks');
    assert.equal(sub.hidden, false);
    assert.equal(sub.textContent, 'builder-c no contact+1 more', 'the why and the count under it');
    assert.equal(fact.hidden, true, 'the ambient fact gives way');

    frame.update(fleet({ storage: { status: 'crit', why: 'pool 97% full' } }));
    assert.equal(sub.textContent, 'pool 97% full');
    assert.equal(sub.children[1].hidden, true, 'no other problem, no count');

    frame.update(fleet());
    assert.equal(box.dataset.step, 'calm');
    assert.equal(sub.hidden, true);
    assert.equal(fact.hidden, false, 'the fact comes back with calm');
    assert.equal(lineEl.textContent, 'all calm');

    assert.equal(tag.textContent, 'laneboard · demo-host');
    frame.live(true);
    assert.equal(tag.dataset.live, '1');
    frame.live(false);
    assert.equal(tag.textContent, 'laneboard · demo-hostoffline');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('frame: a crit that cleared reads calm, grey, with its old glyph and how long it was down (night 3 T18)', () => {
  assert.equal(clearedLine(fleet(), null), null);
  assert.equal(clearedLine(fleet(), { id: 'gone', status: 'crit', forMs: 1 }), null, 'a node that went: nothing to remember');
  const w = clearedLine(fleet(), { id: 'storage', status: 'down', forMs: 6 * 60000 + 10000 });
  assert.equal(w.step, 'calm', 'never the 3 m step');
  assert.equal(w.tone, 'cleared');
  assert.equal(w.was, 'crit', 'the glyph keeps its old hue');
  assert.equal(w.glyph, '■');
  assert.equal(w.status, 'ok');
  assert.equal(w.text, 'hv2 · storage ok · was down 6m');
  assert.equal(clearedLine(fleet(), { id: 'storage', status: 'crit', forMs: 41400 }).why, 'was crit 41s');

  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const timers = { setTimeout: () => 1, clearTimeout() {} };
    const root = makeEl('div');
    const frame = createFrame(root, { timers, now: () => 0 });
    const box = frame.el.fleet;
    const [line, sub, fact] = box.children;
    frame.update(fleet({ storage: { status: 'crit', why: 'pool 97% full' } }));
    assert.equal(box.dataset.step, 'far');
    // The node the line names, for a finger (night 4 T2): the live one, then the cleared one, none at all calm.
    assert.equal(box.dataset.subject, 'storage');
    assert.ok(frame.el.more && frame.el.subMore, 'its +N more, for the hud');
    frame.update(fleet(), { cleared: { id: 'storage', status: 'crit', forMs: 6 * 60000 } });
    assert.equal(box.dataset.subject, 'storage');
    assert.equal(box.dataset.step, 'calm', 'the red slab goes when the trouble goes');
    assert.equal(box.dataset.tone, 'cleared');
    assert.equal(box.dataset.was, 'crit');
    assert.equal(line.textContent, '■hv2 · storage ok · was crit 6m');
    assert.equal(line.children[0].className, 'wall-fleet-glyph');
    assert.equal(sub.hidden, true, 'no why row of the far step');
    assert.equal(fact.hidden, false, 'the ambient fact stays');
    assert.equal(frame.cover(), null, 'no far block');
    // A live problem is louder than a memory: it takes the line.
    frame.update(fleet({ 'lane:a/fix': { status: 'attention', why: 'asked a question' } }), { cleared: { id: 'storage', status: 'crit', forMs: 1 } });
    assert.equal(box.dataset.tone, 'warn');
    assert.equal(box.dataset.was, undefined);
    assert.equal(line.textContent, '▲hv1 · fix-login · asked a question');
    frame.update(fleet());
    assert.equal(line.textContent, 'all calm');
    assert.equal(box.dataset.subject, undefined);
  } finally {
    globalThis.document = prevDoc;
  }
});
