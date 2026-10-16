// The aggregates import ratelimits.mjs, which imports db.mjs: keep it in memory.
process.env.LANEBOARD_DB ||= ':memory:';
const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { aggregates, attention, rateLimit, cost, ci, counts, ATTENTION_CAP } = await import('../server/hub/aggregates.mjs');
const { createFleetStore } = await import('../server/hub/fleet-store.mjs');

const T0 = 1_000_000;
const H = 3600_000;

// A view in fleet-store's shape, built by hand: builders with a snapshot.
function b(id, { state = 'up', account = 'default', code = id.slice(0, 2).toUpperCase(), sessions = [], attention = [], lanes = [], box = null } = {}) {
  return {
    id, code, account, state, stale: state !== 'up',
    snap: { sessions: new Map(sessions.map((s) => [s.name, s])), lanes, box, vitals: null, attention, generatedAt: T0 },
  };
}
const view = (...builders) => ({ now: T0, builders });
const rl = (five, fiveReset, seven = null, sevenReset = null) => ({
  fiveHour: five === null ? null : { usedPct: five, resetsAt: fiveReset },
  sevenDay: seven === null ? null : { usedPct: seven, resetsAt: sevenReset },
});
const sess = (name, extra = {}) => ({ name, state: 'working', claude: { startedAt: T0 }, ...extra });

test('attention: live before stale, then score desc and since asc, mapped with fkey', () => {
  const v = view(
    b('builder-a', { attention: [
      { name: 'a1', state: 'waiting_permission', score: 50, since: 200, danger: null },
      { name: 'a2', state: 'waiting_question', score: 80, since: 300, danger: 'rm -rf' },
      { name: 'a3', state: 'done', score: 50, since: 100, danger: null },
    ] }),
    b('builder-b', { state: 'down', attention: [{ name: 'b1', state: 'waiting_permission', score: 99, since: 1 }] }),
    b('builder-c', { attention: [{ name: 'c1', state: 'done', score: 60, since: 5 }] }),
  );
  const out = attention(v);
  assert.deepEqual(out.map((a) => a.fkey), ['builder-a/a2', 'builder-c/c1', 'builder-a/a3', 'builder-a/a1', 'builder-b/b1']);
  assert.deepEqual(out[0], {
    fkey: 'builder-a/a2', builder: 'builder-a', code: 'BU', name: 'a2', state: 'waiting_question',
    score: 80, since: 300, danger: 'rm -rf', stale: false,
  });
  assert.equal(out.at(-1).stale, true);
});

test('attention: capped at 100 and junk entries dropped', () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ name: `s${i}`, state: 'done', score: i, since: i }));
  const out = attention(view(b('builder-a', { attention: [...many, null, { name: '' }, { score: 5 }] })));
  assert.equal(out.length, ATTENTION_CAP);
  assert.equal(out[0].name, 's149');
});

test('rate limit: same resetsAt across builders gives the max, never the sum', () => {
  const R = T0 + 2 * H;
  const v = view(
    b('builder-a', { sessions: [sess('x', { rateLimits: rl(30, R) })] }),
    b('builder-b', { sessions: [sess('y', { rateLimits: rl(31, R) })] }),
    b('builder-c', { sessions: [sess('z', { rateLimits: rl(29, R) })] }),
  );
  const out = rateLimit(v);
  assert.equal(out.fiveHour.usedPct, 31);
  assert.equal(out.fiveHour.resetsAt, R);
  assert.equal(out.source, 'builder-b/y');
  assert.deepEqual(Object.keys(out.accounts), ['default']);
});

test('rate limit: an older resetsAt (rolled-over window) is ignored even when higher', () => {
  const v = view(
    b('builder-a', { sessions: [sess('old', { rateLimits: rl(95, T0 - H, 40, T0 + 100 * H) })] }),
    b('builder-b', { sessions: [sess('new', { rateLimits: rl(10, T0 + 4 * H, 41, T0 + 100 * H) })] }),
  );
  const out = rateLimit(v);
  assert.equal(out.fiveHour.usedPct, 10);
  assert.equal(out.fiveHour.source, 'builder-b/new');
  assert.equal(out.sevenDay.usedPct, 41);
});

test('rate limit: per-builder candidate is the freshest statusline (ratelimits.freshest)', () => {
  const R = T0 + H;
  const v = view(b('builder-a', { sessions: [
    sess('older', { claude: { startedAt: T0 - 10 }, rateLimits: rl(70, R) }),
    sess('fresh', { claude: { startedAt: T0 }, rateLimits: rl(60, R) }),
  ] }));
  assert.equal(rateLimit(v).fiveHour.usedPct, 60);
});

test('rate limit: two accounts reported separately, the worst is the headline', () => {
  const R = T0 + H;
  const v = view(
    b('builder-a', { account: 'acme', sessions: [sess('a', { rateLimits: rl(20, R) })] }),
    b('builder-b', { account: 'acme', sessions: [sess('b', { rateLimits: rl(25, R) })] }),
    b('builder-c', { account: 'other', sessions: [sess('c', { rateLimits: rl(70, R) })] }),
  );
  const out = rateLimit(v);
  assert.equal(out.accounts.acme.fiveHour.usedPct, 25);
  assert.deepEqual(out.accounts.acme.builders, ['builder-a', 'builder-b']);
  assert.equal(out.accounts.other.fiveHour.usedPct, 70);
  assert.equal(out.fiveHour.usedPct, 70);
  assert.equal(out.source, 'builder-c/c');
});

test('rate limit: no samples and malformed samples give nulls, no throw', () => {
  const out = rateLimit(view(
    b('builder-a', { sessions: [sess('a', { rateLimits: { fiveHour: { usedPct: 'x', resetsAt: 1 } } })] }),
    b('builder-b'),
  ));
  assert.equal(out.fiveHour, null);
  assert.equal(out.sevenDay, null);
  assert.equal(out.source, null);
});

test('cost: sums usdToday, usd and burn5h across builders', () => {
  const v = view(
    b('builder-a', {
      sessions: [sess('a1', { cost: { usdToday: 1.25, usd: 10 } }), sess('a2', { cost: { usdToday: 0.5, usd: 2.5 } }), sess('a3')],
      box: { burn5h: { 'lane-1': 3, 'lane-2': 1.5 } },
    }),
    b('builder-b', { state: 'down', sessions: [sess('b1', { cost: { usdToday: 2, usd: 'bad' } })], box: { burn5h: { l: 4, junk: 'x' } } }),
  );
  const out = cost(v);
  assert.equal(out.usdToday, 3.75);
  assert.equal(out.usd, 12.5);
  assert.equal(out.burn5h, 8.5);
  assert.deepEqual(out.byBuilder, { 'builder-a': { usdToday: 1.75, burn5h: 4.5 }, 'builder-b': { usdToday: 2, burn5h: 4 } });
  assert.equal(out.label, 'API-equivalent');
});

test('ci: union dedupes identical runs from two builders and recounts queued/running', () => {
  const run = (name, branch, status, createdAt) => ({ name, branch, status, conclusion: null, createdAt });
  const shared = [run('test', 'main', 'in_progress', 300), run('lint', 'main', 'queued', 200)];
  const v = view(
    b('builder-a', { box: { ci: { provider: 'gh', queue: { repo: 'acme', runs: [...shared, run('build', 'x', 'completed', 100)], queued: 1, running: 1 } } } }),
    b('builder-b', { box: { ci: { provider: 'gh', queue: { repo: 'acme', runs: [...shared, run('test', 'y', 'waiting', 400)], queued: 99, running: 99 } } } }),
    b('builder-c', { box: { ci: { provider: 'gh', queue: { repo: 'other', runs: [run('test', 'main', 'in_progress', 300)] } } } }),
    b('builder-d', { box: { ci: { provider: 'none', queue: null } } }),
  );
  const out = ci(v);
  assert.equal(out.runs.length, 5);
  assert.equal(out.queued, 2);
  assert.equal(out.running, 2);
  assert.deepEqual(out.runs.map((r) => r.createdAt), [400, 300, 300, 200, 100]);
  const t = out.runs.find((r) => r.repo === 'acme' && r.name === 'test' && r.branch === 'main');
  assert.deepEqual(t.builders, ['builder-a', 'builder-b']);
});

test('counts: builders by state, sessions, lanes, working, needsYou', () => {
  const v = view(
    b('builder-a', { sessions: [sess('a'), sess('b', { state: 'waiting_permission' }), sess('c', { state: 'idle' })], lanes: [{ id: 'l1' }] }),
    b('builder-b', { state: 'stale', sessions: [sess('d', { state: 'waiting_question' })], lanes: [{ id: 'l2' }, { id: 'l3' }] }),
    b('builder-c', { state: 'connecting' }),
    { id: 'builder-d', state: 'down', snap: null },
  );
  assert.deepEqual(counts(v), { builders: { up: 1, stale: 1, down: 2 }, sessions: 4, lanes: 3, working: 1, needsYou: 2 });
});

test('aggregates() runs on a real fleet-store view and is JSON-serializable', () => {
  const st = createFleetStore({ builders: [{ id: 'builder-a', url: 'https://a.example.invalid', account: 'acme' }, { id: 'builder-b', url: 'https://b.example.invalid' }], staleMs: 15_000, downMs: 60_000 });
  st.setConn('builder-a', { state: 'up', lastSeen: T0 });
  st.applySnapshot('builder-a', {
    type: 'snapshot', seq: 1, generatedAt: T0,
    sessions: [sess('w', { state: 'waiting_permission', cost: { usdToday: 1, usd: 2 }, rateLimits: rl(42, T0 + H) })],
    lanes: [], box: { burn5h: { l: 1 } }, vitals: null,
    attention: [{ name: 'w', state: 'waiting_permission', score: 90, since: T0 }],
  }, T0);
  const out = aggregates(st.view(T0 + 1000), T0 + 1000);
  assert.equal(out.attention.length, 1);
  assert.equal(out.attention[0].fkey, 'builder-a/w');
  assert.equal(out.rateLimit.fiveHour.usedPct, 42);
  assert.deepEqual(Object.keys(out.rateLimit.accounts).sort(), ['acme', 'default']);
  assert.equal(out.cost.usdToday, 1);
  assert.equal(out.counts.sessions, 1);
  assert.equal(out.counts.needsYou, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('aggregates() of an empty fleet', () => {
  const out = aggregates({ now: T0, builders: [] }, T0);
  assert.deepEqual(out.attention, []);
  assert.equal(out.rateLimit.fiveHour, null);
  assert.equal(out.cost.usd, 0);
  assert.deepEqual(out.ci, { queued: 0, running: 0, runs: [] });
  assert.deepEqual(out.counts.builders, { up: 0, stale: 0, down: 0 });
});
