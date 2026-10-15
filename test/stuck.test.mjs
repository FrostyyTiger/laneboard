// Stuck detector (fleet §7 O4): synthetic event streams per rule, a positive
// and a negative case each, plus the tracker (since, priority, evidence,
// auto-pause).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, evaluate, createTracker, progressFingerprint, resolveCfg, REASON_MAX } from '../server/fleet/stuck.mjs';
import { STUCK_RULES } from '../server/config/observability.mjs';

const MIN = 60 * 1000;
const NOW = 1_800_000_000_000;
const at = (m) => NOW + m * MIN; // minutes relative to NOW (negative = past)

const sess = (over = {}) => ({ name: 'builder-a-1', state: 'working', stateSince: at(-1), activity: { tool: null }, context: null, ...over });
const pre = (m, tool, inHash) => ({ t: at(m), ev: 'PreToolUse', tool, inHash, errHash: null });
const post = (m, tool, inHash) => ({ t: at(m), ev: 'PostToolUse', tool, inHash, errHash: null });
const fail = (m, tool, errHash) => ({ t: at(m), ev: 'PostToolUseFailure', tool, inHash: 'x', errHash });
const ev = (m, name, extra = {}) => ({ t: at(m), ev: name, tool: null, inHash: null, errHash: null, ...extra });
const fresh = (events) => ({ lastEventAt: events.length ? events[events.length - 1].t : null, subagentsLive: 0, compactions: [] });

function run(over) {
  const events = over.events ?? [];
  return evaluate({ session: sess(), events, counters: fresh(events), now: NOW, ...over });
}
const rulesOf = (s) => (s ? s.rules : []);

test('RULES mirrors the config fragment and the plan order', () => {
  assert.deepEqual([...RULES], [...STUCK_RULES]);
  assert.equal(RULES[0], 'approval-wait');
  assert.equal(RULES.at(-1), 'idle-in-working');
});

test('no events and an idle working session is not stuck', () => {
  assert.equal(run({ events: [pre(0, 'Read', 'a')] }), null);
});

test('approval-wait: fires at 5:01, not at 4:59', () => {
  const s501 = run({ session: sess({ state: 'waiting_permission', stateSince: NOW - (5 * MIN + 1000), activity: { tool: 'Bash' } }) });
  assert.equal(s501.rule, 'approval-wait');
  assert.equal(s501.reason, 'approval 5m: Bash');
  const s459 = run({ session: sess({ state: 'waiting_permission', stateSince: NOW - (4 * MIN + 59000), activity: { tool: 'Bash' } }) });
  assert.equal(s459, null);
});

test('approval-wait: an unresolved PermissionRequest in the ring counts; a later event resolves it', () => {
  const pending = [pre(-8, 'Bash', 'a'), ev(-7, 'PermissionRequest', { tool: 'Bash' }), ev(-6, 'Notification')];
  const s = run({ events: pending, counters: { lastEventAt: at(-1) } });
  assert.ok(rulesOf(s).includes('approval-wait'));
  assert.equal(s.reason, 'approval 7m: Bash');
  const resolved = [...pending, post(-5, 'Bash', 'a')];
  assert.ok(!rulesOf(run({ events: resolved, counters: { lastEventAt: at(-1) } })).includes('approval-wait'));
});

test('error-loop: fires on 3 identical errHashes, not on 2', () => {
  const three = [fail(-3, 'Bash', 'e1'), fail(-2, 'Bash', 'e1'), fail(-1, 'Bash', 'e1')];
  const s = run({ events: three });
  assert.equal(s.rule, 'error-loop');
  assert.equal(s.reason, 'same error ×3 (Bash)');
  assert.equal(run({ events: three.slice(1) }), null);
  // Three failures but different errors.
  assert.equal(run({ events: [fail(-3, 'Bash', 'e1'), fail(-2, 'Bash', 'e2'), fail(-1, 'Bash', 'e3')] }), null);
});

test('error-loop: not when spread over more than 15 min', () => {
  const spread = [fail(-16, 'Bash', 'e1'), fail(-8, 'Bash', 'e1'), fail(-1, 'Bash', 'e1')];
  assert.equal(run({ events: spread }), null);
});

test('error-loop: only the newest 20 events are looked at', () => {
  const evs = [fail(-10, 'Bash', 'e1'), fail(-10, 'Bash', 'e1'), fail(-10, 'Bash', 'e1')];
  for (let i = 0; i < 20; i++) evs.push(ev(-9 + i * 0.1, 'Notification'));
  assert.equal(run({ events: evs, counters: { lastEventAt: at(-1) } }), null);
});

test('tool-loop: fires on 5 identical PreToolUse, broken by one different call', () => {
  const loop = [];
  for (let i = 0; i < 5; i++) loop.push(pre(-5 + i, 'Read', 'h1'), post(-5 + i + 0.5, 'Read', 'h1'));
  const s = run({ events: loop });
  assert.equal(s.rule, 'tool-loop');
  assert.equal(s.reason, 'Read ×5 same input');
  const broken = [...loop];
  broken.splice(4, 0, pre(-3.2, 'Grep', 'h2'));
  assert.ok(!rulesOf(run({ events: broken })).includes('tool-loop'));
  // Four in a row is below the threshold.
  assert.ok(!rulesOf(run({ events: loop.slice(2) })).includes('tool-loop'));
});

test('tool-loop: a new user prompt ends the loop', () => {
  const loop = [];
  for (let i = 0; i < 5; i++) loop.push(pre(-6 + i, 'Read', 'h1'));
  loop.push(ev(-0.5, 'UserPromptSubmit'));
  assert.equal(run({ events: loop }), null);
});

test('oscillation: fires on ABABAB, not on AAB or ABC', () => {
  const abab = [];
  for (let i = 0; i < 6; i++) abab.push(i % 2 ? pre(-6 + i, 'Bash', 'b') : pre(-6 + i, 'Edit', 'a'));
  const s = run({ events: abab });
  assert.equal(s.rule, 'oscillation');
  assert.equal(s.reason, 'A↔B ×3 (Edit/Bash)');
  assert.equal(run({ events: [pre(-3, 'Edit', 'a'), pre(-2, 'Edit', 'a'), pre(-1, 'Bash', 'b')] }), null);
  assert.equal(run({ events: [pre(-3, 'Edit', 'a'), pre(-2, 'Bash', 'b'), pre(-1, 'Grep', 'c')] }), null);
  // ABABA B-less: only 5 alternating calls is not 3 repeats.
  assert.equal(run({ events: abab.slice(1) }), null);
  // ABABAC breaks it.
  assert.equal(run({ events: [...abab.slice(0, 5), pre(0, 'Grep', 'c')] }), null);
});

test('stalled: fires at 10 min, not before', () => {
  const events = [pre(-12, 'Read', 'a'), post(-10, 'Read', 'a')];
  const s = run({ events });
  assert.equal(s.rule, 'stalled');
  assert.equal(s.reason, 'no events 10m');
  assert.equal(run({ events: [pre(-12, 'Read', 'a'), post(-9.9, 'Read', 'a')] }), null);
  // Only while working.
  assert.equal(run({ events, session: sess({ state: 'done', stateSince: at(-10) }) }), null);
});

test('stalled: uses 30 min while a tool is in flight', () => {
  const inFlight = [pre(-14, 'Bash', 'a')];
  assert.equal(run({ events: inFlight }), null);
  const s = run({ events: [pre(-30, 'Bash', 'a')] });
  assert.equal(s.rule, 'stalled');
  assert.equal(s.reason, 'tool in flight 30m: Bash');
});

test('stalled: suppressed by a live subagent with fresh events', () => {
  const events = [post(-14, 'Task', 'a')];
  const counters = { lastEventAt: at(-14), subagentsLive: 1, lastSubagentAt: at(-2), compactions: [] };
  assert.equal(run({ events, counters }), null);
  // A live subagent that has been silent for longer than stalledToolMin does not suppress.
  const silent = { lastEventAt: at(-40), subagentsLive: 1, lastSubagentAt: at(-40), compactions: [] };
  assert.equal(run({ events: [post(-40, 'Task', 'a')], counters: silent }).rule, 'stalled');
});

test('context-pressure: fires on 86%, not on 85%', () => {
  const s = run({ session: sess({ context: { usedPct: 86 } }) });
  assert.equal(s.rule, 'context-pressure');
  assert.equal(s.reason, 'ctx 86%');
  assert.equal(run({ session: sess({ context: { usedPct: 85 } }) }), null);
});

test('context-pressure: fires on two compactions 12 min apart, not 25 min apart', () => {
  const events = [post(0, 'Read', 'a')];
  const c12 = { lastEventAt: NOW, subagentsLive: 0, compactions: [at(-12), at(-0.5)] };
  const s = run({ events, counters: c12 });
  assert.equal(s.rule, 'context-pressure');
  assert.equal(s.reason, 'compact ×2 in 11m');
  const c25 = { lastEventAt: NOW, subagentsLive: 0, compactions: [at(-25), at(-0.5)] };
  assert.equal(run({ events, counters: c25 }), null);
  // Stale: the pair is long past.
  const old = { lastEventAt: NOW, subagentsLive: 0, compactions: [at(-120), at(-110)] };
  assert.equal(run({ events, counters: old }), null);
});

test('cost-no-progress: fires on +$6 with the same fingerprint, not when head changed', () => {
  const events = [post(0, 'Read', 'a')];
  const s = run({ events, costNow: 16, costThen: 10, progress: { fingerprint: 'x', since: at(-45) } });
  assert.equal(s.rule, 'cost-no-progress');
  assert.equal(s.reason, '$6.00/30m, no diff');
  // Fingerprint changed 10 min ago (a new head): progress was made in the window.
  assert.equal(run({ events, costNow: 16, costThen: 10, progress: { fingerprint: 'y', since: at(-10) } }), null);
  // Only $4 spent.
  assert.equal(run({ events, costNow: 14, costThen: 10, progress: { fingerprint: 'x', since: at(-45) } }), null);
  // No cost sample from the window start.
  assert.equal(run({ events, costNow: 16, costThen: null, progress: { fingerprint: 'x', since: at(-45) } }), null);
});

test('cost-no-progress through the tracker: head change resets the window', () => {
  const tr = createTracker({});
  const s = sess({ head: 'abc', dirty: 1, ahead: 0, linesAdded: 3, linesRemoved: 1 });
  const ctx = (session, costNow, costThen) => [{ session, events: [post(0, 'Read', 'a')], counters: { lastEventAt: NOW }, costNow, costThen }];
  tr.update(ctx(s, 10, 10), at(-31));
  assert.equal(tr.update(ctx(s, 16, 10), NOW).get(s.name).rule, 'cost-no-progress');
  const tr2 = createTracker({});
  tr2.update(ctx(s, 10, 10), at(-31));
  tr2.update(ctx({ ...s, head: 'def' }, 12, 10), at(-5));
  assert.equal(tr2.update(ctx({ ...s, head: 'def' }, 16, 10), NOW).get(s.name), null);
});

test('progressFingerprint is head|dirty|ahead|linesAdded+linesRemoved', () => {
  assert.equal(progressFingerprint({ head: 'abc', dirty: 2, ahead: 1, linesAdded: 5, linesRemoved: 3 }), 'abc|2|1|8');
  assert.equal(progressFingerprint({}), '|0|0|0');
});

test('idle-in-working: fires on a lane record without a done marker, done for 25 min', () => {
  const lane = { record: { id: 'lane-1' }, markers: [] };
  const session = sess({ state: 'done', stateSince: at(-25) });
  const s = run({ session, lane, events: [ev(-25, 'Stop')], counters: { lastEventAt: at(-25) } });
  assert.equal(s.rule, 'idle-in-working');
  assert.equal(s.reason, 'idle 25m, lane unfinished');
  // No lane record: not a launched lane.
  assert.equal(run({ session, lane: null, events: [ev(-25, 'Stop')] }), null);
  assert.equal(run({ session, lane: { record: null, markers: [] }, events: [ev(-25, 'Stop')] }), null);
  // LANE-DONE written.
  const doneLane = { record: { id: 'lane-1' }, markers: [{ kind: 'done', text: 'LANE-DONE all good', ts: at(-26) }] };
  assert.equal(run({ session, lane: doneLane, events: [ev(-25, 'Stop')] }), null);
  // A STAGE-DONE is not a finished lane.
  const stageLane = { record: { id: 'lane-1' }, markers: [{ kind: 'done', text: 'STAGE-DONE 2', ts: at(-26) }] };
  assert.equal(run({ session, lane: stageLane, events: [ev(-25, 'Stop')] }).rule, 'idle-in-working');
  // Only 15 min idle.
  assert.equal(run({ session: sess({ state: 'idle', stateSince: at(-15) }), lane, events: [] }), null);
});

test('idle-in-working: suppressed by a newer NEED marker, not by an older one', () => {
  const session = sess({ state: 'done', stateSince: at(-25) });
  const newer = { record: { id: 'lane-1' }, markers: [{ kind: 'need', text: 'NEED-HUMAN pick one', ts: at(-24) }] };
  assert.equal(run({ session, lane: newer, events: [] }), null);
  const blocked = { record: { id: 'lane-1' }, markers: [{ kind: 'blocked', text: 'BLOCKED creds', ts: at(-25) }] };
  assert.equal(run({ session, lane: blocked, events: [] }), null);
  const older = { record: { id: 'lane-1' }, markers: [{ kind: 'need', text: 'NEED-HUMAN', ts: at(-60) }] };
  assert.equal(run({ session, lane: older, events: [] }).rule, 'idle-in-working');
});

test('evaluate: priority by RULES order, evidence lists every matched rule', () => {
  const events = [fail(-4, 'Bash', 'e1'), fail(-3, 'Bash', 'e1'), fail(-2, 'Bash', 'e1')];
  for (let i = 0; i < 5; i++) events.push(pre(-1.5 + i * 0.1, 'Read', 'h1'));
  const s = run({ events, session: sess({ context: { usedPct: 95 } }) });
  assert.equal(s.rule, 'error-loop');
  assert.deepEqual(s.rules, ['error-loop', 'tool-loop', 'context-pressure']);
  assert.deepEqual(s.evidence.map((e) => e.rule), s.rules);
  for (const e of s.evidence) assert.equal(typeof e.detail, 'string');
  assert.equal(s.since, NOW);
});

test('evaluate: disabled, dead, or junk input gives null; reason is capped', () => {
  const events = [fail(-3, 'Bash', 'e1'), fail(-2, 'Bash', 'e1'), fail(-1, 'Bash', 'e1')];
  assert.equal(run({ events, cfg: { stuck: { enabled: false } } }), null);
  assert.equal(run({ events, session: sess({ state: 'dead' }) }), null);
  assert.equal(evaluate({ session: null }), null);
  assert.equal(run({ events: [null, 'x', ...events.slice(0, 2)] }), null);
  const long = 'T'.repeat(300);
  const s = run({ events: [fail(-3, long, 'e1'), fail(-2, long, 'e1'), fail(-1, long, 'e1')] });
  assert.ok(s.reason.length <= REASON_MAX);
});

test('cfg: thresholds come from the config, the fragment or the whole config', () => {
  const events = [fail(-2, 'Bash', 'e1'), fail(-1, 'Bash', 'e1')];
  assert.equal(run({ events, cfg: { stuck: { errorLoopCount: 2 } } }).rule, 'error-loop');
  assert.equal(run({ events, cfg: { errorLoopCount: 2 } }).rule, 'error-loop');
  assert.equal(resolveCfg(undefined).toolLoopCount, 5);
  assert.equal(resolveCfg({}).autoPause, false);
});

test('tracker: since stays stable across ticks, winner by RULES order, evidence complete', () => {
  const tr = createTracker({});
  const loop = [];
  for (let i = 0; i < 5; i++) loop.push(pre(-10 + i * 0.1, 'Read', 'h1'));
  const session = sess();
  const ctx = (events, over = {}) => [{ session: { ...session, ...over }, events, counters: fresh(events) }];

  const m1 = tr.update(ctx(loop), NOW);
  const s1 = m1.get(session.name);
  assert.equal(s1.rule, 'tool-loop');
  assert.equal(s1.since, NOW);
  assert.deepEqual(tr.changes(), [{ name: session.name, stuck: s1 }]);

  const s2 = tr.update(ctx(loop), NOW + 2000).get(session.name);
  assert.equal(s2.since, NOW, 'since is the first match, not this tick');
  // Nothing changed (same rule, reason, since): no change reported.
  assert.deepEqual(tr.changes(), []);

  // A higher-priority rule joins: it wins, with its own since; tool-loop keeps its since.
  const withErr = [...loop.slice(0, 2), fail(-9, 'Bash', 'e1'), fail(-9, 'Bash', 'e1'), fail(-9, 'Bash', 'e1'), ...loop];
  const s3 = tr.update(ctx(withErr), NOW + 4000).get(session.name);
  assert.equal(s3.rule, 'error-loop');
  assert.equal(s3.since, NOW + 4000);
  assert.deepEqual(s3.rules, ['error-loop', 'tool-loop']);
  assert.equal(tr.changes().length, 1);

  // Back to only tool-loop: since is still the original first match.
  const s4 = tr.update(ctx(loop), NOW + 6000).get(session.name);
  assert.equal(s4.rule, 'tool-loop');
  assert.equal(s4.since, NOW);

  // Cleared: a null change, and current() forgets it.
  const m5 = tr.update(ctx([...loop, ev(-0.1, 'UserPromptSubmit')], { state: 'working' }), NOW + 8000);
  assert.equal(m5.get(session.name), null);
  const ch = tr.changes();
  assert.deepEqual(ch.at(-1), { name: session.name, stuck: null });
  assert.equal(tr.current().size, 0);

  // Matching again starts a new since.
  const s6 = tr.update(ctx(loop), NOW + 10000).get(session.name);
  assert.equal(s6.since, NOW + 10000);
});

test('tracker: sessions that vanish are forgotten; costAt is called with now - window', () => {
  const tr = createTracker({ stuck: { costWindowMin: 30 } });
  const asked = [];
  const session = sess({ name: 'builder-a-2' });
  tr.update([{ session, events: [post(0, 'Read', 'a')], counters: { lastEventAt: NOW }, costAt: (t) => { asked.push(t); return null; } }], NOW);
  assert.deepEqual(asked, [NOW - 30 * MIN]);
  const m = tr.update([], NOW + 1000);
  assert.equal(m.size, 0);
  assert.equal(tr.current().size, 0);
});

function loopCtx(name = 'builder-a-3') {
  const loop = [];
  for (let i = 0; i < 5; i++) loop.push(pre(-1 + i * 0.1, 'Read', 'h1'));
  return [{ session: sess({ name }), events: loop, counters: fresh(loop) }];
}

test('autoPause:false never calls onAutoPause', () => {
  let calls = 0;
  const tr = createTracker({ stuck: { autoPause: false } }, { onAutoPause: () => { calls++; } });
  tr.update(loopCtx(), NOW);
  tr.update(loopCtx(), NOW + 2000);
  assert.equal(calls, 0);
  // Default config is off too.
  const tr2 = createTracker(undefined, { onAutoPause: () => { calls++; } });
  tr2.update(loopCtx(), NOW);
  assert.equal(calls, 0);
});

test('autoPause:true calls onAutoPause once per episode, only for autoPauseRules', () => {
  const calls = [];
  const tr = createTracker({ stuck: { autoPause: true } }, { onAutoPause: (name, stuck) => calls.push([name, stuck.rule]) });
  tr.update(loopCtx(), NOW);
  tr.update(loopCtx(), NOW + 2000);
  assert.deepEqual(calls, [['builder-a-3', 'tool-loop']]);

  // A rule outside autoPauseRules never pauses.
  const tr2 = createTracker({ stuck: { autoPause: true } }, { onAutoPause: (name, stuck) => calls.push([name, stuck.rule]) });
  tr2.update([{ session: sess({ name: 'builder-a-4', context: { usedPct: 99 } }), events: [post(0, 'Read', 'a')], counters: { lastEventAt: NOW } }], NOW);
  assert.equal(calls.length, 1);

  // A throwing hook never breaks the tracker; the default is a no-op.
  const tr3 = createTracker({ stuck: { autoPause: true } }, { onAutoPause: () => { throw new Error('boom'); } });
  assert.equal(tr3.update(loopCtx(), NOW).get('builder-a-3').rule, 'tool-loop');
  const tr4 = createTracker({ stuck: { autoPause: true } });
  assert.equal(tr4.update(loopCtx(), NOW).get('builder-a-3').rule, 'tool-loop');
});
