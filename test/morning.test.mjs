// The Morning view's arithmetic. The windows and the spend deltas are the two
// places a wrong number would be believed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { windowStart, windowLabel, WINDOWS } from '../server/util.mjs';
import { spendBySession, spendByLane, sumTokens, build } from '../server/morning.mjs';

const TZ = 'Europe/Zurich';
const H = 3600 * 1000;
const at = (iso) => Date.parse(iso);
const hoursBack = (now, start) => (now - start) / H;

test('tonight reaches back to 18:00 of the evening that has begun', () => {
  // The design case: read at 07:00, it covers last evening onward.
  const morning = at('2026-09-05T05:00:00Z'); // 07:00 Zurich
  assert.equal(hoursBack(morning, windowStart('tonight', TZ, morning)), 13);
});

test('the 12 h floor stops a reading just after midnight cutting the night in half', () => {
  // 02:30 Zurich: 18:00 yesterday is only 8.5 h back, so the floor wins.
  const small = at('2026-09-05T00:30:00Z');
  assert.equal(hoursBack(small, windowStart('tonight', TZ, small)), 12);
});

test('read in the evening, tonight does not mean yesterday afternoon', () => {
  // The plan says "18:00 of the previous calendar day". Read at 22:00 that is
  // 28 hours back, and a block labelled "tonight" covering yesterday afternoon
  // is a lie. Past 18:00 local, today's 18:00 is the boundary — then the floor.
  const evening = at('2026-09-04T20:00:00Z'); // 22:00 Zurich
  const start = windowStart('tonight', TZ, evening);
  assert.equal(hoursBack(evening, start), 12);
  assert.ok(hoursBack(evening, start) < 28, 'must not reach back a whole extra day');
});

test('the fixed windows are exactly what they say', () => {
  const now = at('2026-09-05T05:00:00Z');
  assert.equal(hoursBack(now, windowStart('12h', TZ, now)), 12);
  assert.equal(hoursBack(now, windowStart('24h', TZ, now)), 24);
  assert.equal(hoursBack(now, windowStart('7d', TZ, now)), 24 * 7);
});

test('an unknown window falls back to tonight rather than to nothing', () => {
  const now = at('2026-09-05T05:00:00Z');
  assert.equal(windowStart('nonsense', TZ, now), windowStart('tonight', TZ, now));
  assert.deepEqual(WINDOWS, ['12h', 'tonight', '24h', '7d']);
  assert.equal(windowLabel('7d'), 'last 7 days');
});

test('sumTokens survives whatever split the cost engine recorded', () => {
  assert.equal(sumTokens({ input: 10, output: 5, cacheRead: 100 }), 115);
  assert.equal(sumTokens(null), 0);
  assert.equal(sumTokens({ input: 'nope' }), 0);
});

// --- the delta that matters --------------------------------------------------

const since = at('2026-09-04T18:00:00Z');
const row = (name, ts, usd, tokens = {}) => ({ session_name: name, ts, usd, tokens, lane: null });

test('a session already running is charged only what it spent IN the window', () => {
  // The whole point of the baseline. kubic has spent $1530 in its life; if the
  // pre-window snapshot were ignored, tonight's total would claim all of it.
  const spend = spendBySession({
    rows: [
      row('kubic', since - 2 * H, 1500),
      row('kubic', since + 1 * H, 1510),
      row('kubic', since + 3 * H, 1530),
    ],
    since,
  });
  assert.equal(spend.get('kubic').usd, 30);
});

test('a session that started inside the window is charged all of it', () => {
  const spend = spendBySession({
    rows: [row('new-lane', since + 1 * H, 4), row('new-lane', since + 2 * H, 9)],
    since,
  });
  assert.equal(spend.get('new-lane').usd, 9);
});

test('a live session uses its live cost, not its last hourly snapshot', () => {
  // Snapshots are hourly; without this the Morning view would lag up to an
  // hour behind /api/cost and the two would visibly disagree.
  const spend = spendBySession({
    rows: [row('horizon-v1', since - H, 100), row('horizon-v1', since + H, 110)],
    since,
    live: new Map([['horizon-v1', { usd: 125, tokens: { input: 7 } }]]),
  });
  assert.equal(spend.get('horizon-v1').usd, 25, 'live 125 minus the 100 baseline');
});

test('a live session with no snapshots at all is charged its whole cost', () => {
  const spend = spendBySession({
    rows: [],
    since,
    live: new Map([['fresh', { usd: 3, tokens: { input: 2 } }]]),
  });
  assert.equal(spend.get('fresh').usd, 3);
  assert.equal(spend.get('fresh').tokens, 2);
});

test('spend never goes negative when a transcript is re-read smaller', () => {
  const spend = spendBySession({
    rows: [row('odd', since - H, 50), row('odd', since + H, 20)],
    since,
  });
  assert.equal(spend.get('odd').usd, 0);
});

test('the newest pre-window snapshot is the baseline, not the oldest', () => {
  const spend = spendBySession({
    rows: [
      row('s', since - 5 * H, 10),
      row('s', since - 1 * H, 40),
      row('s', since + H, 50),
    ],
    since,
  });
  assert.equal(spend.get('s').usd, 10);
});

test('spend rolls up to lanes, and sessions with no lane are kept separate', () => {
  const spend = new Map([
    ['a', { name: 'a', lane: null, usd: 2, tokens: 100 }],
    ['b', { name: 'b', lane: null, usd: 3, tokens: 200 }],
    ['watcher', { name: 'watcher', lane: null, usd: 0.5, tokens: 10 }],
  ]);
  const laneOf = (n) => ({ a: 'horizon-v1', b: 'horizon-v1' }[n] ?? null);
  const out = spendByLane(spend, laneOf);
  assert.equal(out.totalUsd, 5.5);
  assert.equal(out.totalTokens, 310);
  const horizon = out.lanes.find((l) => l.lane === 'horizon-v1');
  assert.equal(horizon.usd, 5);
  assert.deepEqual(horizon.sessions.sort(), ['a', 'b']);
  assert.ok(out.lanes.some((l) => l.lane === null), 'the lane-less watcher is still counted');
});

test('a snapshot row that carries its own lane beats the session lookup', () => {
  // Which is what makes a snapshot still attributable after its session is gone.
  const spend = spendBySession({
    rows: [{ session_name: 'gone', ts: since + H, usd: 7, tokens: {}, lane: 'retired-lane' }],
    since,
  });
  const out = spendByLane(spend, () => null);
  assert.equal(out.lanes[0].lane, 'retired-lane');
});

// --- the whole payload -------------------------------------------------------

const snapshot = {
  sessions: [
    {
      name: 'horizon-v1', lane: 'horizon-v1', state: 'done', stateSince: since + 2 * H,
      cost: { usd: 12, tokens: { input: 500 } },
      activity: { lastAssistant: 'finished stage 3' },
      rateLimits: { fiveHour: { usedPct: 39, resetsAt: since + 5 * H }, sevenDay: { usedPct: 8, resetsAt: since + 99 * H } },
      claude: { startedAt: since },
    },
    { name: 'watcher', lane: null, state: 'shell', stateSince: since, cost: null, activity: {} },
  ],
  lanes: [
    { id: 'horizon-v1', hue: 112, branch: 'feat/horizon-v1', merged: false, isMain: false,
      lastCommitAt: since + 2 * H, sessions: ['horizon-v1'], idle: false, progress: { n: 3, m: 8, source: 'commit', at: since + 2 * H } },
    { id: 'sleepy', hue: 200, branch: 'feat/sleepy', merged: true, isMain: false,
      lastCommitAt: since - 200 * H, sessions: [], idle: true, progress: null },
  ],
  attention: [{ name: 'horizon-v1', state: 'done', score: 50, since: since + 2 * H }],
};

test('build returns the three blocks the view renders', () => {
  const out = build({ window: 'tonight', now: since + 4 * H, snapshot });
  assert.equal(out.window, 'tonight');
  assert.ok(Array.isArray(out.needsYou));
  assert.ok(Array.isArray(out.finished));
  assert.ok(Array.isArray(out.cost.lanes));
  assert.equal(out.cost.label, 'API-equivalent');
});

test('a lane with nothing happening in the window is not listed as finished', () => {
  const out = build({ window: 'tonight', now: since + 4 * H, snapshot });
  const ids = out.finished.map((f) => f.lane);
  assert.ok(ids.includes('horizon-v1'), 'it committed inside the window');
  assert.ok(!ids.includes('sleepy'), 'its last commit was 200 h ago');
});

test('the attention queue reaches the Needs-you block with its lane colour', () => {
  const out = build({ window: 'tonight', now: since + 4 * H, snapshot });
  const item = out.needsYou.find((n) => n.name === 'horizon-v1');
  assert.ok(item, 'the attention entry should be there');
  assert.equal(item.hue, 112);
  assert.equal(item.source, 'attention');
});

test('rate limits come from the freshest statusline, as on the board', () => {
  const out = build({ window: 'tonight', now: since + 4 * H, snapshot });
  assert.equal(out.rateLimits.fiveHour.usedPct, 39);
});

test('v3: a danger flag goes first in "needs you", ahead of newer items', async () => {
  const morning = await import('../server/morning.mjs');
  const now = Date.now();
  const snap = {
    sessions: [
      { name: 'old-danger', lane: null, state: 'working', stateSince: now - 3600e3, activity: {} },
      { name: 'fresh-prompt', lane: null, state: 'waiting_permission', stateSince: now - 60e3, activity: {} },
    ],
    lanes: [],
    attention: [
      { name: 'fresh-prompt', state: 'waiting_permission', score: 100, since: now - 60e3, danger: null },
      { name: 'old-danger', state: 'working', score: 1000, since: now - 3600e3, danger: 'DATABASE_ADMIN_URL points at :5432' },
    ],
  };
  const m = morning.build({ window: '12h', now, snapshot: snap, prFor: () => null });
  assert.equal(m.needsYou[0].name, 'old-danger');
  assert.equal(m.needsYou[0].kind, 'danger');
  assert.match(m.needsYou[0].text, /:5432/);
});

test('v3: a finished lane carries its PR and check state', async () => {
  const morning = await import('../server/morning.mjs');
  const now = Date.now();
  const snap = {
    sessions: [],
    lanes: [{ id: 'bauplan', hue: 10, branch: 'feat/bauplan', sessions: [], merged: false, isMain: false, idle: true,
      lastCommitAt: now - 600e3, progress: null }],
    attention: [],
  };
  const pr = { number: 12, url: 'https://github.com/x/y/pull/12', state: 'OPEN', isDraft: true, verdict: 'pending', checks: { passed: 3, failed: 0, pending: 2, total: 5 } };
  const m = morning.build({ window: '12h', now, snapshot: snap, prFor: (id) => (id === 'bauplan' ? pr : null) });
  assert.equal(m.finished[0].lane, 'bauplan');
  assert.deepEqual(m.finished[0].pr, pr);
});
