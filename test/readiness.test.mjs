// Safe-to-kill, kept from v2's Machine view. The flag is the only thing here
// with teeth, and it has none: it flags, a human acts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safeToKill, QUIET_STATES } from '../server/readiness.mjs';
import { procMemKb } from '../server/collector/registry.mjs';

const NOW = Date.parse('2026-09-05T05:00:00Z');
const DAY = 24 * 3600 * 1000;

const session = (over = {}) => ({
  name: 'a-lane',
  state: 'done',
  stateSince: NOW - 3 * DAY,
  dir: '/home/user/code/other-a-lane',
  branch: 'feat/a-lane',
  merged: true,
  isMain: false,
  dirty: 0,
  ahead: 0,
  ...over,
});

test('a long-idle session on a merged, clean branch is safe', () => {
  const v = safeToKill(session(), NOW);
  assert.equal(v.safe, true);
  assert.deepEqual(v.blockers, []);
  assert.ok(v.reasons.some((r) => /merged into origin\/main/.test(r)));
  assert.ok(v.reasons.some((r) => /working tree clean/.test(r)));
});

test('a session that is working is never safe, however long it has run', () => {
  const v = safeToKill(session({ state: 'working', stateSince: NOW - 30 * DAY }), NOW);
  assert.equal(v.safe, false);
  assert.ok(v.blockers.includes('state is working'));
});

test('waiting on a prompt is not quiet either', () => {
  for (const s of ['waiting_permission', 'waiting_question']) {
    assert.equal(safeToKill(session({ state: s }), NOW).safe, false, s);
    assert.equal(QUIET_STATES.has(s), false);
  }
});

test('under 24 h idle is not safe, even when everything else is clean', () => {
  const v = safeToKill(session({ stateSince: NOW - 5 * 3600e3 }), NOW);
  assert.equal(v.safe, false);
  assert.ok(v.blockers.some((b) => /only 5 h idle/.test(b)));
});

test('unmerged work is never thrown away', () => {
  const v = safeToKill(session({ merged: false }), NOW);
  assert.equal(v.safe, false);
  assert.ok(v.blockers.some((b) => /is not merged/.test(b)));
});

test('an unknown merge state counts against killing, not for it', () => {
  // Conservative in exactly one direction: unknown is never "merged".
  const v = safeToKill(session({ merged: null }), NOW);
  assert.equal(v.safe, false);
  assert.ok(v.blockers.some((b) => /merge state unknown/.test(b)));
});

test('uncommitted or unpushed work blocks the flag', () => {
  assert.equal(safeToKill(session({ dirty: 6 }), NOW).safe, false);
  assert.ok(safeToKill(session({ dirty: 6 }), NOW).blockers.includes('6 uncommitted'));
  assert.equal(safeToKill(session({ ahead: 2 }), NOW).safe, false);
  assert.ok(safeToKill(session({ ahead: 2 }), NOW).blockers.includes('2 unpushed'));
});

test('a main checkout is judged on clean-and-pushed, not on being merged', () => {
  // "Is this branch merged into main?" cannot be asked of main. Reporting it as
  // unknown blocked every session in ~/other, ~/example-agent and this repo.
  const v = safeToKill(session({ branch: 'main', isMain: true, merged: true }), NOW);
  assert.equal(v.safe, true);
  assert.ok(v.reasons.some((r) => /nothing to merge/.test(r)));
  // ...and a dirty main checkout is still blocked.
  const dirty = safeToKill(session({ branch: 'main', isMain: true, dirty: 6 }), NOW);
  assert.equal(dirty.safe, false);
  assert.deepEqual(dirty.blockers, ['6 uncommitted']);
});

test('a session with no repo has nothing to lose', () => {
  // The watchers run in ~, which is not a repo.
  const v = safeToKill(session({ dir: '/home/user', branch: null, state: 'shell', merged: null }), NOW);
  assert.equal(v.safe, true);
  assert.ok(v.reasons.includes('no repo to lose'));
});

test('every clause is reported, so the flag can be argued with', () => {
  const v = safeToKill(session({ state: 'working', merged: false, dirty: 3, ahead: 1 }), NOW);
  assert.equal(v.blockers.length, 4, `expected four blockers, got ${JSON.stringify(v.blockers)}`);
});

// --- reading the machine ------------------------------------------------------

test('procMemKb reads this very process, and survives a dead pid', async () => {
  // The per-session RSS and swap the Machine view showed now ride on every
  // session, read by the registry in the same /proc read as before.
  const mine = await procMemKb(process.pid);
  assert.ok(mine.rssKb > 0, 'this process has some RSS');
  assert.ok(mine.swapKb != null, 'VmSwap is present on this kernel');
  // A session can die between the snapshot and the read; that is not an error.
  assert.deepEqual(await procMemKb(999999), { rssKb: null, swapKb: null });
  assert.deepEqual(await procMemKb(null), { rssKb: null, swapKb: null });
});

test('nothing in the readiness rule can kill anything', () => {
  // Hard rule 6. The flag is a suggestion; the act goes through the existing
  // confirm + DELETE path, which lives in actions.mjs.
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../server/readiness.mjs'), 'utf8');
  for (const forbidden of ['kill-session', 'process.kill', 'execFile', 'spawn', 'writeFile', 'unlink']) {
    assert.ok(!src.includes(forbidden), `readiness.mjs must not contain ${forbidden}`);
  }
});
