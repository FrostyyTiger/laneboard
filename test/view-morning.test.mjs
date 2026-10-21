// public/js/views/morning.js: the Morning view's fleet blocks (fleet R15, plan §10 2.11/2.12).
// The hub data comes from R10's own mergeMorning over a two-builders-plus-one-down
// fixture, so the shape is the real one; builder mode is the build() shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, makeEl, texts } from './helpers/fakedom.mjs';
import { mergeMorning } from '../server/hub/morning.mjs';

const byId = new Map(['morning-body', 'morning-since', 'morning-window'].map((id) => [id, makeEl('div')]));
globalThis.document = makeDocument({ byId });

const V = await import('../public/js/views/morning.js');
const { store, setSourceKind } = await import('../public/js/core/store.js');
const { isView } = await import('../public/js/views/index.js');

const T0 = Date.parse('2026-10-15T07:00:00Z');
const H = 3600_000;
const MIN = 60_000;
const HOSTILE = '<img src=x onerror="alert(1)">';

function built({ needs = [], finished = [], lanes = [] } = {}) {
  return {
    window: 'tonight', label: 'Tonight', since: T0 - 12 * H, now: T0,
    needsYou: needs, finished,
    cost: { lanes, totalUsd: lanes.reduce((a, l) => a + l.usd, 0), totalTokens: lanes.reduce((a, l) => a + l.tokens, 0), label: 'API-equivalent' },
    rateLimits: null,
  };
}
const need = (name, kind, at, extra = {}) => ({ source: 'attention', id: `attention:${name}`, name, lane: 'feat', hue: 120, state: 'waiting', at, kind, text: 'needs a look', ...extra });
const fin = (lane, extra = {}) => ({ lane, hue: 10, branch: `lane/${lane}`, merged: false, isMain: false, idle: false, progress: { n: 1, m: 3 }, lastCommitAt: T0 - H, newCommit: true, doneMarkers: [], pr: null, sessions: [{ name: `${lane}-1`, state: 'idle', since: T0 - H }], packages: [], ...extra });
const costLane = (lane, usd, packages = []) => ({ lane, usd, tokens: 100, sessions: [`${lane}-1`], hue: 5, packages });

/** R10's merge over: builder-a (2 needs, 2 finished), builder-b down, builder-c (1 need). */
function merged() {
  const perBuilder = new Map([
    ['builder-a', built({
      needs: [need('a-1', 'need', T0 - 2 * H, { text: HOSTILE }), need('a-2', 'danger', T0 - 5 * H)],
      finished: [fin('feat', { doneMarkers: [{ id: 1, ts: T0 - H, text: 'PACKAGE-DONE: web', session: 'feat-1' }], packages: ['web'] }), fin('old')],
      lanes: [costLane('feat', 3, ['web', 'api']), costLane('old', 1, ['web'])],
    })],
    ['builder-b', { error: 'builder timeout' }],
    ['builder-c', built({ needs: [need('c-1', 'need', T0 - MIN)], lanes: [costLane('ui', 2, ['web', 'api', 'docs'])] })],
  ]);
  return mergeMorning({
    perBuilder,
    waits: { stats: { n: 4, medianMs: 30 * MIN, p90Ms: 2 * H }, open: [{ fkey: 'builder-c/ui', waitingMs: 3 * H }] },
    stuck: [
      { fkey: 'builder-a/a-1', builder: 'builder-a', reason: 'no output for 20 min', since: T0 - 3 * H, resolvedAt: T0 - 2 * H },
      { fkey: 'builder-c/c-1', builder: 'builder-c', reason: 'spinning', since: T0 - H, resolvedAt: null },
      { fkey: null, builder: null, reason: 'orphan incident', since: T0 - H, resolvedAt: null },
    ],
    audit: [
      { id: 'e1', action: 'approve', ts: T0 - H, result: { phase: 'done', ok: true } },
      { id: 'e2', action: 'deny', ts: T0 - H, result: { phase: 'done', ok: true } },
      { id: 'e3', action: 'release', ts: T0 - H, result: { phase: 'done', ok: true } },
    ],
    answerTimes: [2 * MIN, 4 * MIN],
    deferred: [
      { id: 'd1', kind: 'need', builder: 'builder-a', title: HOSTILE, body: 'held in quiet hours', reason: 'quiet', at: T0 - 4 * H, url: '#/inbox' },
      { id: 'd2', kind: 'stuck', builder: 'builder-c', title: 'rate held', body: '', reason: 'rate', at: T0 - 2 * H, url: '#/board' },
    ],
    window: 'tonight', since: T0 - 12 * H, now: T0,
  });
}

function walk(n, out = []) {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
}
const byClass = (root, cls) => walk(root).filter((n) => n.classList?.contains?.(cls));
const blockTitled = (root, title) => byClass(root, 'mblock').find((b) => b.children[0]?._text === title);

function render(m) {
  const box = makeEl('div');
  V.renderModel(box, m);
  return box;
}

// --- model ----------------------------------------------------------------------

test('model: the merge groups into builder rows with their stuck incidents; fleet blocks pass through', () => {
  const m = V.morningModel(merged(), { hub: true, s: store });
  assert.equal(m.hub, true);
  assert.deepEqual(m.builders.map((b) => b.id), ['builder-a', 'builder-c', 'builder-b']);
  const [a, c, b] = m.builders;
  assert.equal(a.code, 'BA');
  assert.equal(a.needsYou.length, 2);
  assert.equal(a.finished.length, 2);
  assert.equal(b.error, 'builder timeout');
  assert.equal(b.stale, true);
  assert.deepEqual(a.stuck.map((x) => x.reason), ['no output for 20 min']);
  assert.deepEqual(c.stuck.map((x) => x.reason), ['spinning']);
  assert.deepEqual(m.stuck.map((x) => x.reason), ['orphan incident'], 'an incident with no known builder stays fleet-level');
  assert.deepEqual(m.missing, ['builder-b']);
  assert.deepEqual(m.totals, { needsYou: 3, finished: 2, usd: 6, tokens: 300, sessions: { finished: 2, usd: 6 }, runs: { finished: 0, usd: 0 } });
  assert.equal(m.review.n, 4);
  assert.equal(m.review.waiting, 1);
  assert.equal(m.review.medianWaitMs, 30 * MIN);
  assert.equal(m.approvals.answered, 3);
  assert.equal(m.approvals.released, 1);
  assert.equal(m.approvals.medianAnswerMs, 3 * MIN);
  assert.ok(m.costByPackage.every((p) => typeof p.lanes === 'number'), 'lanes is a count');
  assert.deepEqual(m.deferred.map((d) => d.reason), ['quiet', 'rate']);
});

test('model: builder mode wraps /api/morning as one builder with empty fleet blocks', () => {
  const m = V.morningModel({ ...built({ needs: [need('x', 'need', T0)], lanes: [costLane('feat', 1)] }), rateLimits: { fiveHour: { usedPct: 10, resetsAt: T0 } } }, { hub: false, s: store });
  assert.equal(m.hub, false);
  assert.equal(m.builders.length, 1);
  assert.equal(m.builders[0].needsYou.length, 1);
  assert.deepEqual(m.review, { n: 0, waiting: 0, medianWaitMs: null, p90WaitMs: null, longest: [] });
  assert.equal(m.approvals.answered, 0);
  assert.deepEqual([m.stuck, m.costByPackage, m.deferred, m.missing], [[], [], [], []]);
  assert.equal(m.rateLimits.fiveHour.usedPct, 10);
  assert.equal(V.morningModel({ error: 'HTTP 500' }).error, 'HTTP 500');
  assert.equal(V.morningModel(null).error, 'bad response');
});

test('model: a hub ?b= answer (one sanitized builder row) is one group; its error keeps the row', () => {
  const one = V.morningModel({ id: 'builder-b', code: 'BB', error: 'builder timeout', stale: true, needsYou: [], finished: [], cost: { lanes: [] }, missing: ['builder-b'] }, { hub: true, s: store });
  assert.equal(one.error, undefined);
  assert.deepEqual(one.builders.map((b) => [b.id, b.code, b.error]), [['builder-b', 'BB', 'builder timeout']]);
  assert.deepEqual(one.missing, ['builder-b']);
});

test('url: hub fleet merge with an optional builder, builder mode keeps /api/morning', () => {
  assert.equal(V.morningUrl('tonight'), '/api/morning?window=tonight');
  assert.equal(V.morningUrl('7d', { hub: true }), '/api/fleet/morning?window=7d');
  assert.equal(V.morningUrl('24h', { hub: true, b: 'builder-a' }), '/api/fleet/morning?window=24h&b=builder-a');
  assert.equal(V.morningUrl('12h', { hub: true, b: 'all' }), '/api/fleet/morning?window=12h');
  assert.equal(V.morningUrl('x&y=1', { hub: true, b: '../x' }), '/api/fleet/morning?window=tonight');
});

test('helpers: durations, local parts, fleet keys that are already fkeyed', () => {
  assert.equal(V.dur(null), '—');
  assert.equal(V.dur(45_000), '45s');
  assert.equal(V.dur(30 * MIN), '30m');
  assert.equal(V.dur(2 * H + 5 * MIN), '2h 5m');
  assert.equal(V.dur(50 * H), '2d 2h');
  assert.equal(V.localPart('builder-a/web/x'), 'web/x');
  assert.equal(V.morningKey({ builder: 'builder-a' }, 'builder-a/web'), 'builder-a/web');
  assert.equal(V.morningKey({ builder: 'builder-a' }, 7), 'builder-a/7');
});

// --- render ---------------------------------------------------------------------

test('render: the merge fixture renders grouped by builder, then the fleet blocks', () => {
  const box = render(V.morningModel(merged(), { hub: true, s: store }));
  const groups = byClass(box, 'morning-builder');
  assert.deepEqual(groups.map((g) => g.dataset.builder), ['builder-a', 'builder-c'], 'one panel per builder that answered, merge order');
  const [a, c] = groups;
  assert.match(a.textContent, /^BA/);
  assert.match(a.textContent, /Needs you2/);
  assert.match(a.textContent, /Finished2/);
  assert.match(a.textContent, /Stuck incidents1/);
  assert.match(a.textContent, /no output for 20 min/);
  assert.match(a.textContent, /resolved after 1h/);
  assert.match(a.textContent, /What it cost/);
  assert.match(a.textContent, /PACKAGE-DONE: web/);
  assert.doesNotMatch(a.textContent, /builder-a\/feat-1/, 'local names are shown without the builder prefix');
  assert.match(c.textContent, /spinning/);
  const miss = byClass(box, 'morning-missing')[0];
  assert.match(miss.title, /builder-b: builder timeout/, 'the down builder is the strip line, its error in the title');
  assert.ok(walk(miss).some((n) => n.dataset?.p === 'stale'), 'the strip line carries a stale lamp');

  const text = box.textContent;
  assert.match(text, /no answer from builder-b/);
  const review = blockTitled(box, 'Review wait');
  assert.match(review.textContent, /median30m/);
  assert.match(review.textContent, /p902h/);
  assert.match(review.textContent, /uiBC3h/, 'longest: lane, builder code, wait');
  assert.match(blockTitled(box, 'Stuck incidents · fleet').textContent, /orphan incident/);
  const ap = blockTitled(box, 'Approvals answered');
  assert.match(ap.textContent, /Approvals answered3/);
  assert.match(ap.textContent, /approved1.*denied1.*released1.*median answer3m/);
  const pk = blockTitled(box, 'Cost by package');
  assert.match(pk.textContent, /≈ spend/);
  assert.match(pk.textContent, /web≈ \$3\.173api≈ \$2\.172/, 'equal split, lanes is a count');
  assert.match(pk.textContent, /total\$6\.00equal split/);
  const away = blockTitled(box, 'While you were away');
  assert.match(away.textContent, /quiet hours/);
  assert.match(away.textContent, /rate limit/);
  assert.ok(text.indexOf('BA') < text.indexOf('Review wait'), 'groups come before the fleet blocks');
});

test('render: builder text stays text (no element from a hostile string; links only to #/ routes)', () => {
  const data = merged();
  data.deferred.push({ id: 'd3', title: 'bad link', reason: 'quiet', url: 'javascript:alert(1)', at: T0 });
  const box = render(V.morningModel(data, { hub: true, s: store }));
  const nodes = walk(box);
  assert.ok(!nodes.some((n) => n.tagName === 'IMG'));
  assert.ok(texts(box).filter((t) => t === HOSTILE).length >= 2, 'the hostile need text and deferred title appear literally');
  const links = nodes.filter((n) => n.tagName === 'A');
  assert.deepEqual(links.map((l) => l.attrs.href), ['#/inbox', '#/board']);
});

test('render: builder mode keeps the three classic blocks and no fleet blocks', () => {
  const box = render(V.morningModel(built({ needs: [need('x', 'need', T0)], finished: [fin('feat')], lanes: [costLane('feat', 1.5)] }), { hub: false, s: store }));
  const titles = byClass(box, 'mblock').map((b) => b.children[0]._text);
  assert.deepEqual(titles, ['Needs you', 'Finished', 'What it cost']);
  assert.equal(byClass(box, 'morning-builder').length, 0);
});

// --- the view -------------------------------------------------------------------

test('view: default export fits the registry; hub mode fetches the fleet merge and renders it', async () => {
  assert.ok(isView(V.default));
  assert.equal(V.default.id, 'morning');
  const calls = [];
  const payload = merged();
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true, json: async () => payload }; };
  setSourceKind(store, 'hub');
  try {
    V.default.mount(byId.get('morning-body'), { route: { view: 'morning', b: 'all' } });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls, ['/api/fleet/morning?window=tonight']);
    const body = byId.get('morning-body');
    assert.equal(byClass(body, 'morning-builder').length, 2, 'builder-b did not answer: no block');
    assert.match(byId.get('morning-since').textContent, /^since /);

    // Same route: no refetch. Builder filter: one refetch with b=.
    V.default.update(store, { route: { view: 'morning', b: 'all' } });
    assert.equal(calls.length, 1);
    V.default.update(store, { route: { view: 'morning', b: 'builder-a' } });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls.slice(1), ['/api/fleet/morning?window=tonight&b=builder-a']);

    // A failed fetch says so instead of drawing stale data.
    globalThis.fetch = async () => ({ ok: false, status: 502 });
    await V.loadMorning(true);
    assert.match(body.textContent, /Could not load: HTTP 502/);
  } finally {
    V.default.unmount();
    setSourceKind(store, 'local');
    delete globalThis.fetch;
  }
});

test('view: builder mode fetches GET /api/morning and renders ungrouped', async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true, json: async () => built({ needs: [need('x', 'need', T0)] }) }; };
  try {
    V.default.mount(byId.get('morning-body'), { route: { view: 'morning' } });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls, ['/api/morning?window=tonight']);
    const body = byId.get('morning-body');
    assert.equal(byClass(body, 'morning-builder').length, 0);
    assert.match(body.textContent, /Needs you1/);
  } finally {
    delete globalThis.fetch;
  }
});

// --- runs (runs plan T7) ---------------------------------------------------------

/** Digest rows as server/runs/digest.mjs runsInWindow gives them. */
const RUNS = [
  {
    run: 'acme-search', goal: 'Add paged search to acme-api', state: 'stopped', rounds: 6,
    scores: { tests: { start: 40, end: 52, better: 'higher' }, lint: { start: 3, end: 5, better: 'lower' }, size: { start: 7, end: 7, better: null } },
    stop: 'done', prs: ['https://example.invalid/acme/api/pull/12', 'javascript:alert(1)'], usd: 9.98,
    usage: { fiveHourPct: 92, sevenDayPct: 40, overage: false }, startedAt: T0 - 8 * H, updatedAt: T0 - H,
  },
  { run: 'acme docs!', goal: HOSTILE, state: 'running', rounds: 1, scores: {}, stop: null, prs: [], usd: null, usage: null },
  { goal: 'no id' },
];

test('model T7: runs from /api/morning become blocks: goal link, rounds, score start → end with direction, stop, PRs, cost', () => {
  const m = V.morningModel({ ...built(), runs: RUNS }, { hub: false, s: store });
  assert.equal(m.runs.length, 2, 'a row without a run id is dropped');
  const [a, b] = m.runs;
  assert.equal(a.run, 'acme-search');
  assert.equal(a.href, '#/runs?run=acme-search');
  assert.equal(a.goal, 'Add paged search to acme-api');
  assert.equal(a.rounds, 6);
  assert.deepEqual(a.stop, { reason: 'done', p: 'ok' });
  assert.equal(a.usd, 9.98);
  assert.equal(a.usage.fiveHour.text, '92%');
  assert.deepEqual(a.scores.map((s) => [s.name, s.text, s.dir, s.good, s.mark]), [
    ['lint', '3 → 5', 'up', false, '▲'],
    ['size', '7', 'same', null, '='],
    ['tests', '40 → 52', 'up', true, '▲'],
  ]);
  assert.deepEqual(a.prs, [{ href: 'https://example.invalid/acme/api/pull/12', text: 'PR #12' }], 'only http(s) PR links');
  assert.equal(b.href, null, 'an id outside the protocol pattern gets no page link');
  assert.equal(b.stop, null);
  assert.equal(b.usd, null);
  assert.deepEqual(b.scores, []);
});

test('model T7: no runs (none sent, an older builder, the hub merge) is an empty list', () => {
  assert.deepEqual(V.morningModel(built(), { hub: false, s: store }).runs, []);
  assert.deepEqual(V.morningModel(merged(), { hub: true, s: store }).runs, []);
  assert.deepEqual(V.morningModel({ ...built(), runs: 'nope' }, { hub: false, s: store }).runs, []);
});

test('model T7: a hub payload with runs on top or on a builder row keeps both', () => {
  const data = merged();
  data.runs = [RUNS[0]];
  data.builders[0].runs = [{ ...RUNS[1], run: 'b-run' }];
  const m = V.morningModel(data, { hub: true, s: store });
  assert.deepEqual(m.runs.map((r) => [r.run, r.builder]), [['acme-search', null], ['b-run', 'builder-a']]);
});

test('model T7: the real digest of the demo run reads whole', async () => {
  const { demoRun } = await import('./helpers/demo-hub.mjs');
  const { runsInWindow } = await import('../server/runs/digest.mjs');
  const now = Date.now();
  const rows = runsInWindow([demoRun(now)], { since: now - 24 * H, now });
  const [r] = V.morningModel({ ...built(), runs: rows }, { hub: false, s: store }).runs;
  assert.ok(r.href.startsWith('#/runs?run='));
  assert.ok(r.rounds > 0);
  assert.ok(r.scores.length >= 2 && r.scores.every((s) => s.dir !== null));
  assert.ok(r.stop && r.stop.reason);
  assert.ok(r.prs.length >= 1);
  assert.ok(r.usd > 0);
});

test('render T7: a Runs block first, one row per run, text as text, links only to the run page and http(s) PRs', () => {
  const box = render(V.morningModel({ ...built({ needs: [need('x', 'need', T0)] }), runs: RUNS }, { hub: false, s: store }));
  const titles = byClass(box, 'mblock').map((b) => b.children[0]._text);
  assert.deepEqual(titles, ['Runs', 'Needs you', 'Finished', 'What it cost']);
  const rows = byClass(box, 'morning-run');
  assert.equal(rows.length, 2);
  const nodes = walk(box);
  assert.ok(!nodes.some((n) => n.tagName === 'IMG'));
  assert.ok(texts(box).includes(HOSTILE), 'a hostile goal appears literally');
  const all = texts(rows[0]);
  for (const want of ['6 rounds', 'stopped: done', '$9.98', '40 → 52', 'PR #12']) assert.ok(all.some((t) => t.includes(want)), want);
  const links = nodes.filter((n) => n.tagName === 'A').map((l) => l.attrs.href);
  assert.deepEqual(links, ['#/runs?run=acme-search', 'https://example.invalid/acme/api/pull/12']);
  const worse = byClass(rows[0], 'rn-score').filter((c) => c.dataset.trend === 'worse');
  assert.equal(worse.length, 1, 'only the score that went the wrong way gets the trouble tone');
});

test('model T32: a run that stopped in the window counts in FINISHED and its cost in SPEND; the package total stays sessions', () => {
  const data = merged();
  data.runs = [RUNS[0], RUNS[1]];
  const m = V.morningModel(data, { hub: true, s: store });
  assert.equal(m.totals.finished, 3, '2 lanes + the stopped run; the running one is not finished');
  assert.equal(m.totals.usd, 6 + 9.98);
  assert.deepEqual(m.totals.sessions, { finished: 2, usd: 6 });
  assert.deepEqual(m.totals.runs, { finished: 1, usd: 9.98 });
  const box = render(m);
  const cells = byClass(box, 'mkv');
  const cell = (k) => cells.find((c) => c.children[0]._text === k);
  assert.equal(cell('finished').children[1]._text, '3');
  assert.equal(cell('finished').title, '2 lanes + 1 runs stopped');
  assert.match(cell('spend').children[1]._text, /^\$15\.98/);
  assert.match(cell('spend').title, /sessions \$6\.0+ \+ runs \$9\.98/);
});

test('model T32: a builder answer with only a stopped run is not FINISHED 0 / SPEND $0', () => {
  const m = V.morningModel({ ...built(), runs: [RUNS[0]] }, { hub: false, s: store });
  assert.equal(m.totals.runs.finished, 1);
  assert.equal(m.totals.runs.usd, 9.98);
});

test('render T7: hub mode puts the Runs block after the summary; no runs draws no block', () => {
  const data = merged();
  data.runs = [RUNS[0]];
  let titles = byClass(render(V.morningModel(data, { hub: true, s: store })), 'mblock').map((b) => b.children[0]._text);
  assert.equal(titles[1], 'Runs', 'right after the summary (an mblock with no title)');
  assert.ok(titles.indexOf('Runs') < titles.indexOf('Needs you'));
  titles = byClass(render(V.morningModel(merged(), { hub: true, s: store })), 'mblock').map((b) => b.children[0]._text);
  assert.ok(!titles.includes('Runs'));
});

// --- T33: no block for a builder with no answer, empty fleet blocks in one line ------

test('model T33: the empty fleet blocks are listed in drawing order; the merge fixture has none', () => {
  assert.deepEqual(V.morningModel(merged(), { hub: true, s: store }).empty, []);
  const quiet = V.morningModel({ builders: [{ id: 'builder-a', needsYou: [], finished: [], cost: { lanes: [] } }] }, { hub: true, s: store });
  assert.deepEqual(quiet.empty, ['review wait', 'approvals', 'package cost', 'held back']);
  const some = V.morningModel({ builders: [], review: { n: 2, waiting: 0, longest: [] }, deferred: [{ reason: 'quiet', title: 'x' }] }, { hub: true, s: store });
  assert.deepEqual(some.empty, ['approvals', 'package cost'], 'reviews done with none waiting still draw the stats');
});

test('render T33: a builder with no answer draws no block, the strip names it; empty fleet blocks are one muted line', () => {
  const data = {
    builders: [
      { id: 'builder-a', error: 'not found', stale: true },
      { id: 'builder-b', error: 'builder down', stale: true },
      { id: 'builder-c', needsYou: [], finished: [fin('feat')], cost: { lanes: [costLane('feat', 1)] } },
    ],
    missing: ['builder-a', 'builder-b'],
  };
  const box = render(V.morningModel(data, { hub: true, s: store }));
  assert.deepEqual(byClass(box, 'morning-builder').map((g) => g.dataset.builder), ['builder-c']);
  assert.doesNotMatch(box.textContent, /No answer:/);
  const miss = byClass(box, 'morning-missing');
  assert.equal(miss.length, 1);
  assert.match(miss[0].textContent, /no answer from builder-a, builder-b$/);
  assert.equal(miss[0].title, 'builder-a: not found\nbuilder-b: builder down');
  const titles = byClass(box, 'mblock').map((b) => b.children[0]?._text);
  for (const t of ['Review wait', 'Approvals answered', 'Cost by package', 'While you were away']) {
    assert.ok(!titles.includes(t), `${t} is not drawn when empty`);
  }
  const quiet = byClass(box, 'morning-quiet');
  assert.equal(quiet.length, 1, 'one line for every empty fleet block');
  assert.ok(quiet[0].classList.contains('empty'), 'muted');
  assert.equal(quiet[0].textContent, 'Nothing on review wait, approvals, package cost, held back.');
  assert.equal(box.children.at(-1), quiet[0], 'at the end');
});

test('render T33: every builder down draws the strip only; the full merge draws no quiet line', () => {
  const down = render(V.morningModel({ builders: [{ id: 'builder-a', error: 'not found' }] }, { hub: true, s: store }));
  assert.equal(byClass(down, 'morning-builder').length, 0);
  assert.doesNotMatch(down.textContent, /No builder is configured/);
  assert.match(byClass(down, 'morning-missing')[0].textContent, /no answer from builder-a/);
  assert.equal(byClass(render(V.morningModel(merged(), { hub: true, s: store })), 'morning-quiet').length, 0);
});
