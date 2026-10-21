// T24 (review r17-designer.md, across 3): Morning's counts agree with the
// rest of the app. A builder that sent no data makes a 0 unknown (`—`, "no
// data"); "no answer from …" names only builders the header does not show
// LIVE; open run needs (§8 Q9) are in Morning's Needs you, and for one fixture
// Morning and the Inbox count the same needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';
import { build, morningRunNeeds } from '../server/morning.mjs';
import { createStore } from '../server/runs/store.mjs';
import { parseLine } from '../server/runs/protocol.mjs';
import { summarize } from '../server/runs/summary.mjs';
import { buildInbox } from '../public/js/core/inbox-model.js';

const byId = new Map(['morning-body', 'morning-since', 'morning-window'].map((id) => [id, makeEl('div')]));
globalThis.document = makeDocument({ byId });
const V = await import('../public/js/views/morning.js');

const H = 3600_000;
const M = 60_000;
const NOW = Date.parse('2026-10-21T05:00:00Z');

function walk(n, out = []) {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
}
const byClass = (root, cls) => walk(root).filter((n) => n.classList?.contains?.(cls));
const render = (m) => { const box = makeEl('div'); V.renderModel(box, m); return box; };
/** A store-like object whose builders the header shows with `status`. */
const header = (status) => ({ builders: new Map(Object.entries(status).map(([id, s]) => [id, { id, status: s }])) });

function runsStoreOf(events) {
  const store = createStore({ now: () => NOW });
  const bySource = new Map();
  for (const e of events) {
    const parsed = parseLine(JSON.stringify({ v: 1, ...e }));
    assert.ok(parsed.ok, `fixture line ${JSON.stringify(e)}: ${parsed.reason}`);
    if (!bySource.has(e.run)) bySource.set(e.run, []);
    bySource.get(e.run).push(parsed.event);
  }
  for (const [run, evs] of bySource) store.ingest(`${run}.jsonl`, evs);
  return store;
}

// acme-search: an open fence need, one acked from the Inbox, a `wait` (the
// loop sleeping). acme-docs: one open decision asked long before any window.
const runEvents = [
  { t: 'run.start', run: 'acme-search', ts: NOW - 5 * H, goal: 'Paged search' },
  { t: 'round.start', run: 'acme-search', ts: NOW - 5 * H, n: 1 },
  { t: 'needs', run: 'acme-search', ts: NOW - 4 * H, kind: 'fence', text: 'round 1 wanted to change server/http.mjs' },
  { t: 'needs', run: 'acme-search', ts: NOW - 3 * H, kind: 'decision', text: 'which page size?' },
  { t: 'needs.ack', run: 'acme-search', ts: NOW - 2 * H, ref: NOW - 3 * H, by: 'inbox' },
  { t: 'needs', run: 'acme-search', ts: NOW - 10 * M, kind: 'wait', text: 'sleeping until the limit resets' },
  { t: 'run.start', run: 'acme-docs', ts: NOW - 50 * H, goal: 'Docs' },
  { t: 'needs', run: 'acme-docs', ts: NOW - 49 * H, kind: 'decision', text: 'keep the old page?' },
];

const sessions = [
  { name: 'web', lane: 'web', state: 'waiting_question', stateSince: NOW - H, activity: { lastAssistant: 'which port?' } },
  { name: 'api', lane: 'api', state: 'waiting_permission', stateSince: NOW - 30 * M, activity: {} },
  { name: 'held', lane: 'api', state: 'waiting_permission', stateSince: NOW - 20 * M, awaitingApproval: 'ap1', activity: {} },
  { name: 'docs', lane: 'docs', state: 'done', stateSince: NOW - H, activity: { lastAssistant: 'all done' } },
];
const attention = [
  { name: 'api', state: 'waiting_permission', score: 100, since: NOW - 30 * M, danger: null },
  { name: 'held', state: 'waiting_permission', score: 100, since: NOW - 20 * M, danger: null },
  { name: 'web', state: 'waiting_question', score: 80, since: NOW - H, danger: null },
  { name: 'docs', state: 'done', score: 50, since: NOW - H, danger: null },
];

test('T24: open run needs a person answers are in /api/morning needsYou, whatever the window', () => {
  const runs = runsStoreOf(runEvents);
  const m = build({ window: '12h', now: NOW, snapshot: { sessions: [], lanes: [], attention: [] }, prFor: () => null, runsStore: runs });
  const got = m.needsYou.filter((n) => n.source === 'run');
  assert.deepEqual(got.map((n) => [n.run, n.kind, n.text]), [
    ['acme-search', 'fence', 'round 1 wanted to change server/http.mjs'],
    ['acme-docs', 'decision', 'keep the old page?'],
  ], 'newest first; the acked need and the wait are not listed; a need older than the window still is');
  assert.equal(got[0].id, `run:acme-search:${NOW - 4 * H}`, 'named by the ts needs.ack uses');
  assert.equal(got[0].name, 'acme-search');
  assert.equal(got[0].lane, null);
  assert.deepEqual(morningRunNeeds(null), []);
  assert.deepEqual(morningRunNeeds({ list() { throw new Error('broken fold'); } }), [], 'a failing store loses only its needs');
});

test('T24: with every builder answering, Morning and the Inbox count the same needs', () => {
  const runs = runsStoreOf(runEvents);
  const api = build({ window: 'tonight', now: NOW, snapshot: { sessions, lanes: [], attention }, prFor: () => null, runsStore: runs });
  const m = V.morningModel({ ...api, builder: 'builder-a' }, { hub: false, s: header({ 'builder-a': 'live' }) });
  assert.deepEqual(m.missing, []);

  const s = {
    builders: new Map([['builder-a', {
      id: 'builder-a',
      sessions: new Map(sessions.map((x) => [x.name, { builder: 'builder-a', key: `builder-a/${x.name}`, ...x }])),
      approvals: new Map(),
      lanes: [],
      box: null,
    }]]),
    attention: attention.map((a) => ({ builder: 'builder-a', ...a })),
    lanes: [],
    packages: null,
  };
  const inbox = buildInbox(s, { now: NOW, runs: runs.list().map((r) => summarize(r, { now: NOW })) });
  const inboxNeeds = inbox.groups.filter((g) => g.id === 'needs' || g.id === 'runs').reduce((a, g) => a + g.rows.length, 0);
  assert.equal(inboxNeeds, 4, 'web, api, and the two open run needs (held is an approval, docs is news)');
  assert.equal(m.totals.needsYou, inboxNeeds);
  assert.deepEqual(m.counts.needsYou, { text: '4', noData: false });
});

test('T24: one builder with no data: its zeros are `—` with "no data", never a confident 0', () => {
  const data = {
    builders: [
      { id: 'builder-a', needsYou: [], finished: [], cost: { lanes: [], totalUsd: 0, totalTokens: 0 } },
      { id: 'builder-b', error: 'not found', stale: true },
    ],
    missing: ['builder-b'],
  };
  const m = V.morningModel(data, { hub: true, s: header({ 'builder-a': 'live', 'builder-b': 'down' }) });
  for (const k of ['needsYou', 'finished', 'spend', 'tokens']) {
    assert.deepEqual(m.counts[k], { text: '—', noData: true }, k);
  }
  const box = render(m);
  const cells = byClass(byClass(box, 'morning-summary')[0], 'mkv');
  const cell = (k) => cells.find((c) => c.children[0]._text === k);
  for (const k of ['needs you', 'finished', 'spend', 'tokens']) {
    const c = cell(k);
    assert.equal(c.children[1]._text, '—', `${k} shows —`);
    assert.equal(byClass(c, 'mkv-nodata')[0]?._text, 'no data', `${k} says no data`);
    assert.ok(c.classList.contains('nodata'), `${k} is dim`);
    assert.doesNotMatch(c.textContent, /\b0\b|\$0/, `${k} carries no 0`);
  }
  assert.ok(!cell('needs you').classList.contains('warn'), 'an unknown count is not amber');

  // A count some builder did report stays a number.
  const some = V.morningModel({ ...data, builders: [{ ...data.builders[0], needsYou: [{ name: 'x', kind: 'need', at: NOW }] }, data.builders[1]] },
    { hub: true, s: header({}) });
  assert.deepEqual(some.counts.needsYou, { text: '1', noData: false });
  // Nobody missing: a 0 is a real 0.
  const all = V.morningModel({ builders: [data.builders[0]] }, { hub: true, s: header({ 'builder-a': 'live' }) });
  assert.deepEqual(all.counts.needsYou, { text: '0', noData: false });
  assert.deepEqual(all.counts.spend, { text: '$0.00', noData: false });
});

test('T24: "no answer from" names only builders the header does not show LIVE', () => {
  const data = {
    builders: [
      { id: 'builder-a', error: 'not found', stale: true },
      { id: 'builder-b', error: 'builder down', stale: true },
      { id: 'builder-c', needsYou: [], finished: [], cost: { lanes: [] } },
    ],
    missing: ['builder-a', 'builder-b'],
  };
  const m = V.morningModel(data, { hub: true, s: header({ 'builder-a': 'live', 'builder-b': 'down', 'builder-c': 'live' }) });
  assert.deepEqual([m.noAnswer, m.noData], [['builder-b'], ['builder-a']]);
  const lines = byClass(render(m), 'morning-missing');
  assert.deepEqual(lines.map((l) => l.textContent.trim()), ['no answer from builder-b', 'no Morning data from builder-a']);
  assert.equal(lines[0].title, 'builder-b: builder down');
  assert.equal(lines[1].title, 'builder-a: not found');
  assert.ok(walk(lines[1]).some((n) => n.dataset?.p === 'off'), 'a live builder with no data is the grey hollow lamp, not stale');

  const allLive = V.morningModel(data, { hub: true, s: header({ 'builder-a': 'live', 'builder-b': 'live' }) });
  assert.doesNotMatch(render(allLive).textContent, /no answer from/);
});

test('T24: a run need row opens the run page, in builder mode and through the hub', () => {
  assert.equal(V.runOfNeed({ source: 'run', run: 'acme-search', id: 'run:acme-search:1' }), 'acme-search');
  assert.equal(V.runOfNeed({ source: 'marker', id: 'builder-a/run:acme-search:1761000000000' }), 'acme-search', 'the hub keeps only the id');
  assert.equal(V.runOfNeed({ source: 'marker', id: 'builder-a/marker:7' }), null);
  assert.equal(V.runOfNeed({ source: 'run', run: '../etc' }), null);
  const runs = runsStoreOf(runEvents);
  const api = build({ window: '12h', now: NOW, snapshot: { sessions: [], lanes: [], attention: [] }, prFor: () => null, runsStore: runs });
  const box = render(V.morningModel({ ...api, builder: 'builder-a' }, { hub: false, s: header({}) }));
  const open = walk(box).filter((n) => n.tagName === 'A' && n._text === 'Open').map((n) => n.getAttribute('href'));
  assert.deepEqual(open, ['#/runs?run=acme-search', '#/runs?run=acme-docs']);
});
