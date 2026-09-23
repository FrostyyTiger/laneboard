// The Credit view: the rate-limit sampler and the chart arithmetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSample, rowFrom, freshest } from '../server/collector/ratelimits.mjs';
import { thin, resetTicks, build, COST_WINDOWS } from '../server/credit.mjs';
import { ENDED, laneResolver } from '../server/morning.mjs';

const NOW = Date.parse('2026-09-05T05:00:00Z');
const MIN = 60_000;

// --- the sampler -------------------------------------------------------------

const row = (five, seven, resetsAt = NOW + 3600e3) => ({
  fiveHourPct: five, sevenDayPct: seven,
  fiveHourResetsAt: resetsAt, sevenDayResetsAt: resetsAt,
  sourceSession: 's',
});
const stored = (five, seven, ts, resetsAt = NOW + 3600e3) => ({
  ts, five_hour_pct: five, seven_day_pct: seven,
  five_hour_resets_at: resetsAt, seven_day_resets_at: resetsAt,
});

test('the first sample is always written', () => {
  assert.equal(shouldSample(null, row(39, 8), NOW), true);
});

test('an unchanged reading is skipped while it is fresh', () => {
  assert.equal(shouldSample(stored(39, 8, NOW - 2 * MIN), row(39, 8), NOW), false);
});

test('an unchanged reading is written again after ten minutes', () => {
  // A flat line still has to be drawn. A chart with an hour-long hole in it
  // looks like an outage rather than like "the number did not move".
  assert.equal(shouldSample(stored(39, 8, NOW - 11 * MIN), row(39, 8), NOW), true);
  assert.equal(shouldSample(stored(39, 8, NOW - 9 * MIN), row(39, 8), NOW), false);
});

test('any change is written immediately, however small', () => {
  assert.equal(shouldSample(stored(39, 8, NOW - MIN), row(40, 8), NOW), true);
  assert.equal(shouldSample(stored(39, 8, NOW - MIN), row(39, 9), NOW), true);
});

test('a reset is a change even when the percentages match', () => {
  // 74% before a reset and 74% after are different facts.
  const before = stored(74, 8, NOW - MIN, NOW + 60e3);
  assert.equal(shouldSample(before, row(74, 8, NOW + 5 * 3600e3), NOW), true);
});

test('nothing to sample is not a sample', () => {
  assert.equal(shouldSample(null, null, NOW), false);
  assert.equal(rowFrom(null), null);
  assert.equal(rowFrom({ rateLimits: {} }), null);
});

test('the sample comes from the freshest statusline, as on the board', () => {
  const sessions = [
    { name: 'old', claude: { startedAt: 1 }, rateLimits: { fiveHour: { usedPct: 10, resetsAt: 1 } } },
    { name: 'new', claude: { startedAt: 99 }, rateLimits: { fiveHour: { usedPct: 74, resetsAt: 2 } } },
    { name: 'none', claude: { startedAt: 500 }, rateLimits: null },
  ];
  const f = freshest(sessions);
  assert.equal(f.session, 'new');
  assert.equal(rowFrom(f).fiveHourPct, 74);
});

// --- the chart ---------------------------------------------------------------

test('a short series is drawn exactly as it is', () => {
  const pts = [{ t: 1, v: 10 }, { t: 2, v: 20 }];
  assert.equal(thin(pts, 240), pts);
});

test('thinning keeps the peak of each bucket, not the average', () => {
  // For a usage gauge the peak is the number that matters: averaging would
  // hide the spike that actually stopped work.
  const pts = [];
  for (let i = 0; i < 1000; i++) pts.push({ t: i, v: i === 500 ? 99 : 10 });
  const out = thin(pts, 100);
  assert.ok(out.length <= 100, `max is a real maximum, got ${out.length}`);
  assert.ok(out.some((p) => p.v === 99), 'the spike must survive thinning');
});

test('thinning respects its maximum exactly, edges included', () => {
  const pts = [];
  for (let i = 0; i < 5000; i++) pts.push({ t: i, v: i % 100 });
  for (const max of [10, 50, 240]) {
    assert.ok(thin(pts, max).length <= max, `max ${max} exceeded`);
  }
});

test('thinning keeps the first and the last sample exactly', () => {
  const pts = [];
  for (let i = 0; i < 1000; i++) pts.push({ t: i, v: (i * 7) % 100 });
  const out = thin(pts, 50);
  assert.equal(out[0], pts[0], 'the first point is the start of the range');
  assert.equal(out[out.length - 1], pts[pts.length - 1], 'the last point is "now"');
});

test('reset ticks are unique, sorted, and clipped to the range', () => {
  const rows = [
    { r: 100 }, { r: 100 }, { r: 300 }, { r: 50 }, { r: 900 }, { r: null },
  ];
  assert.deepEqual(resetTicks(rows, 'r', 90, 500), [100, 300]);
});

// --- the payload -------------------------------------------------------------

test('spend from a session that no longer exists is not folded into "no lane"', () => {
  // Nine sessions were killed on this box in one night. Their snapshots stay
  // forever, and putting $619 of dead sessions next to a live lane's $5.88
  // all-time made an honest number look like a bug.
  const resolve = laneResolver(new Map([['alive', { lane: 'horizon-v1' }], ['watcher', { lane: null }]]));
  assert.equal(resolve('alive'), 'horizon-v1');
  assert.equal(resolve('watcher'), null, 'a live session with no repo is not "ended"');
  assert.equal(resolve('killed-hours-ago'), ENDED);
});

test('build returns both charts, the lane table and the sampler health', () => {
  const snapshot = {
    sessions: [{
      name: 'horizon-v1', lane: 'horizon-v1', claude: { startedAt: 1, sessionId: 'abc' },
      cost: { usd: 210.63, tokens: { input: 1600, output: 632200, cacheRead: 363800000, cacheWrite5m: 1300000 } },
      rateLimits: { fiveHour: { usedPct: 75, resetsAt: NOW + 3600e3 }, sevenDay: { usedPct: 15, resetsAt: NOW + 9e7 } },
    }],
    lanes: [{ id: 'horizon-v1', hue: 112, sessions: ['horizon-v1'], idle: false }],
    attention: [],
  };
  const out = build({ now: NOW, snapshot });
  assert.ok(out.charts.sevenDay && out.charts.fiveHour);
  assert.equal(out.label, 'API-equivalent');
  assert.ok(out.sampler && 'rows' in out.sampler);
  const lane = out.lanes.find((l) => l.lane === 'horizon-v1');
  assert.ok(lane, 'the lane should be in the table');
  // The plan's check: a lane's all-time equals the sum of its sessions' cost.usd.
  assert.equal(lane.allTime, 210.63);
  assert.equal(lane.tokens.cacheWrite, 1300000, 'the 5m and 1h cache writes are one column');
  assert.deepEqual(COST_WINDOWS, ['tonight', '24h', '7d']);
});

test('the 5-hour chart covers a day and the 7-day chart covers a week', () => {
  // A 5 h gauge plotted over a week is four resets a day and unreadable.
  const out = build({ now: NOW, snapshot: { sessions: [], lanes: [], attention: [] } });
  assert.equal(NOW - out.charts.fiveHour.since, 24 * 3600e3);
  assert.equal(NOW - out.charts.sevenDay.since, 7 * 24 * 3600e3);
});
