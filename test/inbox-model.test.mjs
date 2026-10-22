// Inbox model (fleet plan §8 2.9, task C13): grouping, ordering, and the
// key -> action mapping bound to the focused id.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  GROUPS, COOPERATIVE_NOTE, LIMITS, KEY_COMMANDS, buildInbox, keyAction, moveFocus, reconcileFocus,
  rowOf, withNote, effectiveTier, formatCountdown, lineClass, previewOf, inboxClip,
  ackEvent, needAckRef, runPageHref, RUN_PR_FRESH_MS, ACK_BY,
} from '../public/js/core/inbox-model.js';
import { buildReviewQueue } from '../public/js/core/review-queue.js';
import { createRegistry } from '../public/js/core/commands.js';
import { resolve, KEYMAP } from '../public/js/ui/hotkeys.js';

const NOW = 1_700_000_000_000;

function builder(id, { sessions = [], approvals = [], lanes = [], box = null } = {}) {
  return {
    id,
    sessions: new Map(sessions.map((s) => [s.name, { builder: id, key: `${id}/${s.name}`, ...s }])),
    approvals: new Map(approvals.map((a) => [a.id, { builder: id, ...a }])),
    lanes: lanes.map((l) => ({ builder: id, key: `${id}/${l.id}`, ...l })),
    box,
  };
}

function approval(id, session, createdAt, extra = {}) {
  return {
    id, session, lane: session, tool: 'Bash', summary: `run ${id}`, input: '{"command":"rm x"}',
    status: 'pending', createdAt, expiresAt: createdAt + 60_000, ...extra,
  };
}

function storeOf(builders, extra = {}) {
  const s = { builders: new Map(builders.map((b) => [b.id, b])), attention: [], lanes: [], packages: null, ...extra };
  s.lanes = builders.flatMap((b) => b.lanes);
  return s;
}

const groupIds = (m, g) => m.groups.find((x) => x.id === g).rows.map((r) => r.id);

test('groups come in the plan order and the approvals header carries the S7 note', () => {
  const m = buildInbox(storeOf([]), { now: NOW });
  // No runs list (no runs route): the runs group is left out.
  assert.deepEqual(m.groups.map((g) => g.id), ['approvals', 'needs', 'review', 'paused', 'stale']);
  assert.deepEqual(GROUPS, ['approvals', 'needs', 'runs', 'review', 'runprs', 'paused', 'stale']);
  assert.deepEqual(buildInbox(storeOf([]), { now: NOW, runs: [] }).groups.map((g) => g.id), GROUPS);
  assert.equal(m.groups[0].note, COOPERATIVE_NOTE);
  assert.match(COOPERATIVE_NOTE, /^Approvals, pause, budget and kill are cooperative on the builder: an agent with a shell there can bypass them$/);
  assert.equal(m.count, 0);
});

test('approvals: pending from every builder, oldest first, with tool, lane, countdown', () => {
  const s = storeOf([
    builder('builder-a', { sessions: [{ name: 'auth' }], approvals: [approval('x2', 'auth', NOW - 1000), approval('x9', 'auth', NOW - 1000, { status: 'allowed' })] }),
    builder('builder-b', { sessions: [{ name: 'web' }], approvals: [approval('x1', 'web', NOW - 5000)] }),
  ]);
  const m = buildInbox(s, { now: NOW });
  assert.deepEqual(groupIds(m, 'approvals'), ['ap:builder-b:x1', 'ap:builder-a:x2']);
  const r = rowOf(m, 'ap:builder-b:x1');
  assert.equal(r.fkey, 'builder-b/web');
  assert.equal(r.tool, 'Bash');
  assert.equal(r.lane, 'web');
  assert.equal(r.expiresInMs, 55_000);
  assert.equal(formatCountdown(r.expiresInMs), '0:55');
  assert.equal(formatCountdown(-1), 'expired');
  // The builder scope filters.
  assert.deepEqual(groupIds(buildInbox(s, { now: NOW, scope: 'builder-a' }), 'approvals'), ['ap:builder-a:x2']);
});

test('approval text is untrusted: copied as plain text and clipped', () => {
  const big = 'A'.repeat(10_000);
  const s = storeOf([builder('builder-a', {
    sessions: [{ name: 'auth' }],
    approvals: [approval('x1', 'auth', NOW, {
      summary: `<img src=x onerror=alert(1)>${big}`, input: big, tool: 'T'.repeat(500),
      preview: { kind: 'diff', lines: Array.from({ length: 500 }, (_, i) => ({ t: i % 2 ? '+' : '-', s: `<b>${big}</b>` })) },
    })],
  })]);
  const r = rowOf(buildInbox(s, { now: NOW }), 'ap:builder-a:x1');
  assert.ok(r.summary.startsWith('<img src=x onerror=alert(1)>'), 'kept as text, not escaped or parsed');
  assert.equal(r.summary.length, LIMITS.summary);
  assert.equal(r.input.length, LIMITS.input);
  assert.equal(r.tool.length, LIMITS.tool);
  assert.equal(r.preview.lines.length, LIMITS.previewLines);
  assert.equal(r.preview.truncated, true);
  assert.ok(r.preview.lines.every((l) => l.s.length <= LIMITS.previewLine));
  assert.equal(lineClass('+'), 'd-add');
  assert.equal(lineClass('-'), 'd-del');
  assert.equal(lineClass(' '), 'd-ctx');
  assert.equal(previewOf({ lines: [{ t: 'x', s: 1 }] }).lines[0].t, ' ');
  assert.equal(inboxClip('a\u0007b', 10), 'a b');
});

test('needs you: waiting_* from attention, in attention order, then need/blocked markers; held approvals not doubled', () => {
  const s = storeOf([builder('builder-a', {
    sessions: [
      { name: 'q', state: 'waiting_question' },
      { name: 'perm', state: 'waiting_permission' },
      { name: 'held', state: 'working', awaitingApproval: 'x1' },
      { name: 'busy', state: 'working' },
      { name: 'mk', state: 'idle', lastMarker: { kind: 'blocked', text: 'needs a key', ts: NOW - 10 } },
      { name: 'old', state: 'idle', lastMarker: { kind: 'need', text: 'review', ts: NOW - 100, dismissed_at: NOW } },
    ],
  })], {
    attention: [
      { builder: 'builder-a', name: 'perm', state: 'waiting_permission', score: 100, since: 2 },
      { builder: 'builder-a', name: 'held', state: 'working', score: 100, since: 1 },
      { builder: 'builder-a', name: 'q', state: 'waiting_question', score: 80, since: 1 },
      { builder: 'builder-a', name: 'busy', state: 'done', score: 50, since: 1 },
    ],
  });
  const m = buildInbox(s, { now: NOW });
  assert.deepEqual(groupIds(m, 'needs'), ['nd:builder-a/perm', 'nd:builder-a/q', 'nd:builder-a/mk']);
  // T27: the word says the kind (`▲ BLKD`), so the text is the marker's own
  assert.equal(rowOf(m, 'nd:builder-a/mk').reason, 'needs a key');
  assert.equal(rowOf(m, 'nd:builder-a/mk').word, 'BLKD');
});

// review 27-designer Across 3 (runs n5 T27): the Inbox row reads `▲ QUES`
// like the Board, then the session's own question; `question` only as a fallback.
test('T27: needs rows carry the Board word and the session\'s own text; the generic word only as fallback', () => {
  const s = storeOf([builder('builder-a', {
    sessions: [
      { name: 'q', state: 'waiting_question', activity: { lastAssistant: 'Keep the old export or drop it?' } },
      { name: 'bare', state: 'waiting_question' },
      { name: 'perm', state: 'waiting_permission', activity: { tool: 'Bash', toolInput: 'npm run bench', lastAssistant: 'x' } },
      { name: 'stk', state: 'waiting_question', stuck: { reason: 'r' }, activity: { lastAssistant: '' } },
      { name: 'nd', state: 'idle', lastMarker: { kind: 'need', text: '', ts: NOW - 10 } },
    ],
  })], {
    attention: ['q', 'bare', 'perm', 'stk'].map((name, i) => ({
      builder: 'builder-a', name, state: name === 'perm' ? 'waiting_permission' : 'waiting_question', score: 90 - i, since: 1,
    })),
  });
  const m = buildInbox(s, { now: NOW });
  const q = rowOf(m, 'nd:builder-a/q');
  assert.deepEqual([q.word, q.reason, q.fallback], ['QUES', 'Keep the old export or drop it?', false]);
  const bare = rowOf(m, 'nd:builder-a/bare');
  assert.deepEqual([bare.word, bare.reason, bare.fallback], ['QUES', 'question', true]);
  const perm = rowOf(m, 'nd:builder-a/perm');
  assert.deepEqual([perm.word, perm.reason, perm.fallback], ['PERM', 'Bash npm run bench', false]);
  assert.equal(rowOf(m, 'nd:builder-a/stk').word, 'QUES', 'a waiting state keeps its word, as the card');
  assert.equal(rowOf(m, 'nd:builder-a/stk').fallback, true);
  const nd = rowOf(m, 'nd:builder-a/nd');
  assert.deepEqual([nd.word, nd.reason, nd.fallback], ['NEED', 'need', true]);
});

test('review rows come from the review queue (longest wait first); paused with kind; stale has stuck reasons and archive candidates', () => {
  const lanes = [
    { id: 'l1', reviewReady: { ready: true, reasons: ['pr-green'], since: NOW - 1000 }, sessions: ['l1'] },
    { id: 'l2', reviewReady: { ready: true, reasons: ['done-marker'], since: NOW - 9000 } },
    { id: 'l3', merged: true },
  ];
  const s = storeOf([builder('builder-a', {
    lanes,
    sessions: [
      { name: 'l1', state: 'idle' },
      { name: 'pb', paused: { scope: 'session', kind: 'budget', by: 'budget', at: NOW - 5 } },
      { name: 'po', paused: { scope: 'all', kind: 'operator', by: 'op', at: NOW - 50 } },
      { name: 'st', stuck: { rule: 'loop', reason: 'same tool 12 times', since: NOW - 7 } },
    ],
    box: { readiness: { l3: { ready: true }, l1: { ready: true } }, prs: {} },
  })]);
  const review = buildReviewQueue(s.lanes, NOW);
  const m = buildInbox(s, { now: NOW, review });
  assert.deepEqual(groupIds(m, 'review'), ['rv:builder-a/l2', 'rv:builder-a/l1']);
  assert.equal(rowOf(m, 'rv:builder-a/l1').sessionKey, 'builder-a/l1');
  assert.deepEqual(groupIds(m, 'paused'), ['pz:builder-a/po', 'pz:builder-a/pb']);
  assert.equal(rowOf(m, 'pz:builder-a/pb').pauseKind, 'budget');
  assert.match(rowOf(m, 'pz:builder-a/po').reason, /operator \(builder\) by op/);
  assert.deepEqual(groupIds(m, 'stale'), ['st:builder-a/st', 'ar:builder-a/l3']);
  assert.equal(rowOf(m, 'st:builder-a/st').reason, 'same tool 12 times');
  assert.deepEqual(m.order.slice(0, 2), ['rv:builder-a/l2', 'rv:builder-a/l1']);
  assert.equal(m.count, 6);
});

test('keys act on the focused id, not on the first row, across a re-sort', () => {
  const b = builder('builder-a', { sessions: [{ name: 'auth' }, { name: 'web' }], approvals: [approval('x1', 'auth', NOW - 10), approval('x2', 'web', NOW - 5)] });
  const m1 = buildInbox(storeOf([b]), { now: NOW });
  const focus = 'ap:builder-a:x2';
  assert.deepEqual(keyAction('a', focus, m1), { action: 'approve', fkey: 'builder-a/web', args: { approvalId: 'x2' }, rowId: focus });
  // A new, older approval arrives and lands first: `a` still hits x2.
  b.approvals.set('x0', { builder: 'builder-a', ...approval('x0', 'auth', NOW - 100) });
  const m2 = buildInbox(storeOf([b]), { now: NOW });
  assert.equal(m2.order[0], 'ap:builder-a:x0');
  assert.equal(reconcileFocus(m2, focus), focus);
  assert.equal(keyAction('a', focus, m2).args.approvalId, 'x2');
  assert.equal(keyAction('r', focus, m2).action, 'release');
  const deny = keyAction('d', focus, m2);
  assert.equal(deny.needsNote, true);
  assert.deepEqual(withNote(deny, '  not that one  '), { action: 'deny', fkey: 'builder-a/web', args: { approvalId: 'x2', note: 'not that one' }, rowId: focus });
  assert.deepEqual(withNote(deny, '').args, { approvalId: 'x2' });
  assert.equal(withNote(deny, 'n'.repeat(2000)).args.note.length, LIMITS.note);
  assert.deepEqual(keyAction('p', focus, m2), { action: 'pause', fkey: 'builder-a/web', args: {}, rowId: focus });
  assert.deepEqual(keyAction('Enter', focus, m2), { open: 'builder-a/web', rowId: focus });
  assert.deepEqual(keyAction('a', null, m2), { none: 'no-focus' });
  assert.deepEqual(keyAction('x', focus, m2), { none: 'unbound' });
});

test('a focused approval that closes stays as a closed ghost and keys do nothing', () => {
  const b = builder('builder-a', { sessions: [{ name: 'auth' }], approvals: [approval('x1', 'auth', NOW)] });
  const m1 = buildInbox(storeOf([b]), { now: NOW });
  const ghost = rowOf(m1, 'ap:builder-a:x1');
  b.approvals.delete('x1');
  const m2 = buildInbox(storeOf([b]), { now: NOW, ghost });
  const r = rowOf(m2, 'ap:builder-a:x1');
  assert.equal(r.closed, true);
  assert.equal(r.status, 'closed');
  assert.equal(m2.count, 0, 'a ghost is not counted');
  for (const k of ['a', 'd', 'r', 'p']) assert.deepEqual(keyAction(k, r.id, m2), { none: 'closed' });
  // Without the ghost the id is simply gone.
  assert.equal(rowOf(buildInbox(storeOf([b]), { now: NOW }), r.id), null);
});

test('action keys outside approvals: a/d/r do nothing, p pauses the session, review pauses its first session', () => {
  const s = storeOf([builder('builder-a', {
    lanes: [{ id: 'l1', reviewReady: { ready: true, reasons: [], since: NOW - 1 }, sessions: ['l1'] }],
    sessions: [{ name: 'q', state: 'waiting_question' }, { name: 'l1' }, { name: 'pz', paused: { kind: 'operator' } }],
  })], { attention: [{ builder: 'builder-a', name: 'q', state: 'waiting_question', score: 80, since: 1 }] });
  const m = buildInbox(s, { now: NOW, review: buildReviewQueue(s.lanes, NOW) });
  assert.deepEqual(keyAction('a', 'nd:builder-a/q', m), { none: 'not-an-approval' });
  assert.equal(keyAction('p', 'nd:builder-a/q', m).fkey, 'builder-a/q');
  assert.equal(keyAction('p', 'rv:builder-a/l1', m).fkey, 'builder-a/l1');
  assert.deepEqual(keyAction('p', 'pz:builder-a/pz', m), { none: 'already-paused' });
});

test('j/k move through the order and stop at the ends', () => {
  const m = { order: ['a', 'b', 'c'] };
  assert.equal(moveFocus(m, null, 1), 'a');
  assert.equal(moveFocus(m, null, -1), 'c');
  assert.equal(moveFocus(m, 'a', 1), 'b');
  assert.equal(moveFocus(m, 'c', 1), 'c');
  assert.equal(moveFocus(m, 'a', -1), 'a');
  assert.equal(moveFocus({ order: [] }, 'a', 1), null);
});

test('approve is at least tier ask (2); others keep the live tier', () => {
  assert.equal(effectiveTier('approve', 'click'), 'ask');
  assert.equal(effectiveTier('approve', 'confirm'), 'confirm');
  assert.equal(effectiveTier('deny', 'click'), 'click');
  assert.equal(effectiveTier('release', 'click'), 'click');
  assert.equal(effectiveTier('pause', 'bogus'), 'confirm');
});

test('the §4 hotkey table maps a/d/r/p in the inbox to the inbox commands, winning over the globals', () => {
  for (const [key, id] of Object.entries(KEY_COMMANDS)) {
    if (key === 'Enter') continue;
    assert.equal(resolve({ key }, { view: 'inbox', now: NOW }), id);
    assert.ok(KEYMAP.some((r) => r.id === id && r.view === 'inbox'));
  }
  assert.equal(resolve({ key: 'a' }, { view: 'board', now: NOW }), 'alarm.ack');
  // A focused inbox list keeps j/k/Enter for itself.
  assert.equal(resolve({ key: 'j' }, { view: 'inbox', inList: true, now: NOW }), null);
});

test('inbox commands register with when(view === inbox)', async () => {
  // views/inbox.js touches the DOM only in mount; importing it is pure.
  const mod = await import('../public/js/views/inbox.js');
  const reg = createRegistry();
  mod.registerInboxCommands(reg.register);
  for (const id of ['inbox.approve', 'inbox.deny', 'inbox.release', 'inbox.pause']) assert.ok(reg.has(id), id);
  // Not mounted: unavailable everywhere, so a key on another view runs nothing.
  assert.deepEqual(reg.run('inbox.approve', { view: 'inbox' }), { ok: false, reason: 'unavailable' });
  assert.deepEqual(reg.run('inbox.approve', { view: 'board' }), { ok: false, reason: 'unavailable' });
  assert.equal(mod.default.id, 'inbox');
});

test('the view renders untrusted text with textContent only and mounts the R13 review group', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '../public/js/views/inbox.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(src, /import \{ mountReviewQueue \} from '\.\/review-queue\.js'/);
  assert.match(src, /dataset\.slot = 'review-queue'/);
  assert.match(src, /handle\.tick\(now\)/);
  assert.match(src, /confirmAction\(/);
});

test('S20: the inbox sends actions only after confirmAction, never from the route', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '../public/js/views/inbox.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const calls = [...code.matchAll(/\b(?:act|hubAct|fetch)\s*\(/g)];
  assert.equal(calls.length, 2, 'one act() in perform(), one in archiveLane()');
  for (const fn of ['perform', 'archiveLane']) {
    const body = code.slice(code.indexOf(`async function ${fn}(`));
    const end = body.indexOf('\n}\n');
    const block = body.slice(0, end);
    assert.ok(block.indexOf('confirmAction(') >= 0 && block.indexOf('confirmAction(') < block.indexOf('act('), `${fn}: dialog before act()`);
  }
  // The run-need ack (T5) posts only after confirmAction too.
  const ack = code.slice(code.indexOf('async function ackRun('));
  const ackBlock = ack.slice(0, ack.indexOf('\n}\n'));
  assert.ok(ackBlock.indexOf('confirmAction(') >= 0 && ackBlock.indexOf('confirmAction(') < ackBlock.indexOf('post('), 'ackRun: dialog before post()');
  assert.equal([...code.matchAll(/\bpost\s*\(/g)].length, 1, 'one post(), in ackRun()');
  assert.doesNotMatch(code, /\.sel\b[^\n]*act\(|route[^\n]*\bact\(/);
});

// ---------------------------------------------------------------- runs (runs plan T5)

const HOUR = 3600_000;
function runRow(run, extra = {}) {
  return { run, goal: 'g', state: 'running', needs: [], prs: [], startedAt: NOW - 5 * HOUR, updatedAt: NOW - 60_000, ...extra };
}
const need = (i, ts, extra = {}) => ({ i, kind: 'decision', text: `need ${i}`, link: null, n: 1, ts, open: true, acked: false, ...extra });

test('runs: open needs and recent PRs, newest first, each linking to the run page', () => {
  const runs = [
    runRow('acme-search', {
      needs: [need(0, NOW - 3 * HOUR), need(2, NOW - HOUR, { link: 'https://example.invalid/acme/acme-api/pull/42' }),
        need(3, NOW - 10_000, { kind: 'wait', text: 'sleeping' })],
      prs: [{ url: 'https://example.invalid/acme/acme-api/pull/42', title: 'Paged search', ts: NOW - 2 * HOUR }],
    }),
    runRow('acme-docs', { needs: [need(0, NOW - 30 * 60_000, { kind: 'fence', text: 'touched a fenced file' })] }),
  ];
  const m = buildInbox(storeOf([]), { now: NOW, runs });
  // T16: the run needs and the run PRs are the filled groups, needs before PRs.
  assert.deepEqual(m.groups.map((g) => g.id).slice(0, 2), ['runs', 'runprs']);
  assert.deepEqual(groupIds(m, 'runs'), ['rn:acme-docs:0', 'rn:acme-search:2', 'rn:acme-search:0']);
  assert.deepEqual(groupIds(m, 'runprs'), ['rp:acme-search:https://example.invalid/acme/acme-api/pull/42']);
  const r = rowOf(m, 'rn:acme-search:2');
  assert.equal(r.href, '#/runs?run=acme-search');
  assert.equal(r.href, runPageHref('acme-search'));
  assert.equal(r.reason, 'decision: need 2');
  assert.equal(r.link, 'https://example.invalid/acme/acme-api/pull/42');
  assert.equal(rowOf(m, 'rn:acme-docs:0').reason, 'fence: touched a fenced file');
  assert.equal(rowOf(m, 'rp:acme-search:https://example.invalid/acme/acme-api/pull/42').reason, 'Paged search', 'T16: no `pr:` prefix, the group says RUN PRS');
  // T35: a PR is news, the grey hollow lamp; an open need keeps the amber triangle.
  assert.equal(rowOf(m, 'rp:acme-search:https://example.invalid/acme/acme-api/pull/42').p, 'off');
  assert.equal(rowOf(m, 'rp:acme-search:https://example.invalid/acme/acme-api/pull/42').lampLabel, 'pr to review');
  assert.equal(r.p, '2');
  // A `wait` need is the loop sleeping: no row.
  assert.equal(rowOf(m, 'rn:acme-search:3'), null);
  assert.equal(m.count, 4);
  // Enter opens the run page, never the inspector.
  assert.deepEqual(keyAction('Enter', 'rn:acme-search:2', m), { run: 'acme-search', rowId: 'rn:acme-search:2' });
});

test('runs: untrusted text is clipped, bad ids and links are dropped, acked needs are gone', () => {
  const long = 'x'.repeat(5000);
  const runs = [
    runRow('acme-search', { needs: [need(0, NOW - 1000, { text: long, link: 'javascript:alert(1)' }), need(1, NOW, { open: false, acked: true })],
      prs: [{ url: 'javascript:alert(1)', title: 'evil', ts: NOW }] }),
    runRow('../etc', { needs: [need(0, NOW)] }),
    runRow('acme-x', { needs: [{ kind: 'decision', text: 'no index', ts: NOW, open: true }] }),
  ];
  const m = buildInbox(storeOf([]), { now: NOW, runs });
  assert.deepEqual(groupIds(m, 'runs'), ['rn:acme-search:0']);
  const r = rowOf(m, 'rn:acme-search:0');
  assert.ok(r.reason.length <= 'decision: '.length + LIMITS.reason);
  assert.equal(r.link, null);
});

test('runs: a stopped run keeps its PR for RUN_PR_FRESH_MS after its last event, then drops it', () => {
  const pr = { url: 'https://example.invalid/acme/acme-api/pull/7', title: 'PR', ts: NOW - 30 * HOUR };
  const at = (ago) => buildInbox(storeOf([]), { now: NOW, runs: [runRow('acme-api', { state: 'stopped', updatedAt: NOW - ago, prs: [pr] })] });
  assert.equal(groupIds(at(RUN_PR_FRESH_MS - 1000), 'runprs').length, 1);
  assert.equal(groupIds(at(RUN_PR_FRESH_MS + 1000), 'runprs').length, 0);
  // A live run keeps its PR whatever its age.
  const live = buildInbox(storeOf([]), { now: NOW, runs: [runRow('acme-api', { updatedAt: NOW - 3 * RUN_PR_FRESH_MS, prs: [pr] })] });
  assert.equal(groupIds(live, 'runprs').length, 1);
});

test('runs: a PR with a state follows it: open stays in review, merged or closed leaves at once (§8 Q10)', () => {
  const url = 'https://example.invalid/acme/acme-api/pull/9';
  const at = (state, run = {}) => buildInbox(storeOf([]), { now: NOW, runs: [runRow('acme-api', { prs: [{ url, title: 'Paged search', state, ts: NOW - HOUR }], ...run })] });
  assert.deepEqual(groupIds(at('open'), 'runprs'), [`rp:acme-api:${url}`]);
  assert.deepEqual(groupIds(at('merged'), 'runprs'), []);
  assert.deepEqual(groupIds(at('closed'), 'runprs'), []);
  // An open PR outlives the 24 h rule; merged on a live run still leaves.
  const old = { state: 'stopped', updatedAt: NOW - 3 * RUN_PR_FRESH_MS };
  assert.equal(groupIds(at('open', old), 'runprs').length, 1);
  // No state (or one the protocol does not know): the 24 h rule as before.
  assert.equal(groupIds(at(null, old), 'runprs').length, 0);
  assert.equal(groupIds(at('bogus', old), 'runprs').length, 0);
  assert.equal(groupIds(at(null, { state: 'stopped', updatedAt: NOW - HOUR }), 'runprs').length, 1);
});

test('runs: `a` on a run need is the needs.ack of its ts; on a PR it does nothing', () => {
  const runs = [runRow('acme-search', { needs: [need(2, NOW)], prs: [{ url: 'https://example.invalid/p/1', title: 't', ts: NOW - 1 }] })];
  const m = buildInbox(storeOf([]), { now: NOW, runs });
  const plan = keyAction('a', 'rn:acme-search:2', m);
  assert.deepEqual(plan, { action: 'ack', run: 'acme-search', ref: NOW, rowId: 'rn:acme-search:2' });
  assert.deepEqual(ackEvent(plan), { v: 1, t: 'needs.ack', run: 'acme-search', ref: NOW, by: ACK_BY });
  // A need without a time falls back to its place.
  assert.equal(needAckRef({ i: 3, ts: null }), 3);
  assert.equal(needAckRef({ i: 3, ts: 0 }), 3);
  assert.deepEqual(keyAction('a', 'rp:acme-search:https://example.invalid/p/1', m), { none: 'not-an-approval' });
  assert.deepEqual(keyAction('d', 'rn:acme-search:2', m), { none: 'not-an-approval' });
  assert.deepEqual(keyAction('p', 'rn:acme-search:2', m), { none: 'no-session' });
  // Once acked the row is gone; the focused one stays as a closed ghost and `a` does nothing.
  const ghost = rowOf(m, 'rn:acme-search:2');
  const after = buildInbox(storeOf([]), { now: NOW, runs: [runRow('acme-search')], ghost });
  assert.equal(rowOf(after, 'rn:acme-search:2').closed, true);
  assert.deepEqual(keyAction('a', 'rn:acme-search:2', after), { none: 'closed' });
  assert.equal(after.count, 0);
});

test('runs: the posted ack is one the protocol folds into a closed need', async () => {
  const { parseLine, foldRun } = await import('../server/runs/protocol.mjs');
  const start = { v: 1, t: 'run.start', run: 'acme-search', ts: NOW - HOUR };
  const n = { v: 1, t: 'needs', run: 'acme-search', ts: NOW - 1000, kind: 'decision', text: 'keep it?' };
  const ack = { ...ackEvent({ run: 'acme-search', ref: 0 }), ts: NOW };
  const events = [start, n, ack].map((e) => { const p = parseLine(JSON.stringify(e)); assert.ok(p.ok, JSON.stringify(p)); return p.event; });
  const run = foldRun(events);
  assert.equal(run.needs[0].open, false);
  assert.equal(run.needs[0].by, ACK_BY);
});

// T5 (review 1d): the store merges sources by time, so a source read later
// that holds an older need shifts every place after it. The ack names the
// need by its ts and still closes the one the person saw.
test('runs: an ack by ts closes the need the row showed after a later-read source shifted the places', async () => {
  const { parseLine } = await import('../server/runs/protocol.mjs');
  const { createStore } = await import('../server/runs/store.mjs');
  const { summarize } = await import('../server/runs/summary.mjs');
  const ev = (o) => { const p = parseLine(JSON.stringify({ v: 1, run: 'acme-search', ...o })); assert.ok(p.ok, JSON.stringify(p)); return p.event; };
  const store = createStore({ now: () => NOW });
  store.ingest('loop.jsonl', [ev({ t: 'run.start', ts: NOW - HOUR }), ev({ t: 'needs', ts: NOW - 1000, text: 'keep the old export?' })]);
  const before = buildInbox(storeOf([]), { now: NOW, runs: store.list().map((r) => summarize(r, { now: NOW })) });
  assert.deepEqual(groupIds(before, 'runs'), ['rn:acme-search:0']);
  const plan = keyAction('a', 'rn:acme-search:0', before);
  assert.equal(plan.ref, NOW - 1000, 'the ack names the ts, not place 0');
  // The API's own file is read later and holds an older need: it takes place 0.
  store.ingest('api.jsonl', [ev({ t: 'needs', ts: NOW - 5000, text: 'fence: a round touched a fenced file', kind: 'fence' })]);
  assert.equal(store.get('acme-search').needs[0].text, 'fence: a round touched a fenced file', 'the places shifted');
  store.ingest('api.jsonl', [{ ...ev(ackEvent(plan)), ts: NOW }]);
  const run = store.get('acme-search');
  assert.deepEqual(run.needs.map((n) => [n.text, n.open, n.by]), [
    ['fence: a round touched a fenced file', true, null],
    ['keep the old export?', false, ACK_BY],
  ]);
  // The place the row had (0) would have closed the wrong need.
  const byPlace = createStore({ now: () => NOW });
  byPlace.ingest('loop.jsonl', [ev({ t: 'run.start', ts: NOW - HOUR }), ev({ t: 'needs', ts: NOW - 1000, text: 'keep the old export?' })]);
  byPlace.ingest('api.jsonl', [ev({ t: 'needs', ts: NOW - 5000, text: 'fence', kind: 'fence' }), ev({ ...ackEvent({ run: 'acme-search', ref: 0 }), ts: NOW })]);
  assert.equal(byPlace.get('acme-search').needs[0].open, false, 'by place, the fence need closes instead');
});

// Seen at 390 (reviews/20-designer.md, Inbox 1): the run decision was cut to
// "decision: Keep the o…", one line beside OPEN and ACK.
test('T34: on a phone a run need wraps on its own line instead of a one-line clamp', () => {
  const root = path.join(import.meta.dirname, '..');
  const css = fs.readFileSync(path.join(root, 'public/css/views/fleet-views.css'), 'utf8');
  const at = css.indexOf('@media (max-width: 700px)');
  assert.ok(at > 0, 'a phone block exists');
  const phone = css.slice(at);
  const rule = phone.match(/\.inbox-row-h--need > \.inbox-sum \{([^}]*)\}/);
  assert.ok(rule, 'the phone block styles the need text');
  assert.match(rule[1], /white-space: normal;/);
  assert.match(rule[1], /flex: 1 0 100%;/, 'a line of its own');
  assert.match(rule[1], /line-clamp: [2-9];/, 'more than one line');
  assert.match(phone, /\.inbox-row-h--need \{[^}]*flex-wrap: wrap;/);
  assert.match(phone, /\.inbox-row-h--need > \.plate \{[^}]*margin-right: auto;/, 'OPEN/ACK on the right edge');
  // the desktop row stays one line, its title carries the whole text
  assert.match(css.slice(0, at), /\.inbox-sum \{[^}]*white-space: nowrap;/);
  const view = fs.readFileSync(path.join(root, 'public/js/views/inbox.js'), 'utf8');
  assert.match(view, /r\.kind === 'run-need'\) head\.classList\.add\('inbox-row-h--need'\)/);
});
