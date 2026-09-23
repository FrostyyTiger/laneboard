// Retire (v3 Stage 4): readiness is a flag with reasons; the act is refused
// unless the lane is ready or the human forces AND confirms. Hermetic: the
// lanes dir and the worktree are scratch; nothing here reaches the act.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-retire-'));
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
process.env.LANEBOARD_CODE_DIR = path.join(tmp, 'code');

const R = await import('../server/lanes/retire.mjs');
const { LaneError } = await import('../server/lanes/launch.mjs');
const store = await import('../server/lanes/store.mjs');

let live = [];
R.init({ state: { all: () => live }, prFor: () => null });

// A real worktree-shaped repo: one commit, no remote.
const root = path.join(tmp, 'code', 'example-repo-t');
fs.mkdirSync(root, { recursive: true });
const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' }).toString();
git('init', '-q', '-b', 'feat/t');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'Stage 1: x');

await store.write({ id: 't', repo: 'example-repo', root, branch: 'feat/t', plan: 'docs/plans/t.md', slot: 2, session: 't-nosuch-session', createdAt: 1, retiredAt: null });
await store.write({ id: 'gone', repo: 'example-repo', root: '/x', branch: 'b', slot: 3, session: 'gone', createdAt: 1, retiredAt: 99 });

async function refused(p, re, status) {
  await assert.rejects(p, (err) => {
    assert.ok(err instanceof LaneError, `expected a LaneError, got ${err}`);
    assert.match(err.message, re);
    if (status) assert.equal(err.status, status);
    return true;
  });
}

// --- the rule --------------------------------------------------------------------

test('a lane that is done in every sense is ready, with the reasons said', () => {
  const v = R.judge({ liveSessions: [], worktreeExists: true, dirtyFiles: [], unpushed: 0, merged: true, prState: null });
  assert.equal(v.ready, true);
  assert.deepEqual(v.blockers, []);
  assert.deepEqual(v.reasons, ['no live session', 'worktree clean', 'nothing unpushed', 'merged into origin/main']);
});

test('every blocker is reported, so the flag can be argued with', () => {
  const v = R.judge({ liveSessions: ['t'], worktreeExists: true, dirtyFiles: ['a.py', 'b.py'], unpushed: 3, merged: false, prState: 'OPEN' });
  assert.equal(v.ready, false);
  assert.equal(v.blockers.length, 4, JSON.stringify(v.blockers));
  assert.match(v.blockers.join(' | '), /live session: t.*2 files.*3 commits not on any remote.*not merged/);
});

test('a closed or merged PR counts, a squash-merged branch is not "unmerged"', () => {
  const base = { liveSessions: [], worktreeExists: true, dirtyFiles: [], unpushed: 0, merged: false };
  assert.equal(R.judge({ ...base, prState: 'MERGED' }).ready, true);
  assert.equal(R.judge({ ...base, prState: 'CLOSED' }).ready, true);
  assert.equal(R.judge({ ...base, prState: 'OPEN' }).ready, false);
});

test('unknown counts against retiring, never for it', () => {
  const v = R.judge({ liveSessions: [], worktreeExists: true, dirtyFiles: [], unpushed: null, merged: null, prState: null });
  assert.equal(v.ready, false);
  assert.ok(v.blockers.includes('unpushed state unknown'));
  assert.ok(v.blockers.includes('merge state unknown'));
});

test('a worktree that is already gone (a failed launch) is not a blocker', () => {
  const v = R.judge({ liveSessions: [], worktreeExists: false, merged: null, prState: 'CLOSED' });
  assert.equal(v.ready, true);
  assert.ok(v.reasons.includes('worktree already gone'));
});

test('only lane slots map to a compose project; slot 1 never does', () => {
  assert.equal(R.slotProject(2), 'agent2');
  assert.equal(R.slotProject('4'), 'agent4');
  for (const bad of [1, 0, 5, 6, 'x', null, 2.5]) assert.throws(() => R.slotProject(bad), LaneError, String(bad));
});

// --- the facts, read from a real repo ------------------------------------------------

test('facts: a commit with no remote is unpushed, and the merge state is unknown without origin/main', async () => {
  const f = await R.facts(store.read('t'));
  assert.equal(f.worktreeExists, true);
  assert.deepEqual(f.dirtyFiles, []);
  assert.equal(f.unpushed, 1);
  assert.equal(f.merged, null);
  assert.deepEqual(f.liveSessions, []);
});

// --- the refusals ------------------------------------------------------------------------

test('no record, no retire; a retired lane is not retired twice', async () => {
  await refused(R.retire('nope'), /no launched lane nope/, 404);
  await refused(R.retire('gone'), /was retired at/, 409);
  await refused(R.retire('../x'), /invalid lane id/, 400);
});

test('a live session blocks retire, even with --force', async () => {
  live = [{ name: 'some-session', lane: 't' }];
  await refused(R.retire('t', { force: true, confirm: 't' }), /live session \(some-session\).*never kills a session/, 409);
  live = [];
});

test('a dirty worktree is refused with the file list', async () => {
  fs.writeFileSync(path.join(root, 'scratch.txt'), 'x');
  fs.writeFileSync(path.join(root, 'notes.md'), 'y');
  await refused(R.retire('t'), /worktree dirty: 2 files.*Dirty: notes\.md, scratch\.txt/s, 409);
  fs.rmSync(path.join(root, 'scratch.txt'));
  fs.rmSync(path.join(root, 'notes.md'));
});

test('an unready lane needs --force, and --force needs the lane named', async () => {
  await refused(R.retire('t'), /not ready to retire: 1 commit not on any remote; merge state unknown.*--force/s, 409);
  await refused(R.retire('t', { force: true }), /--force needs confirmation/, 400);
  await refused(R.retire('t', { force: true, confirm: 'other' }), /--force needs confirmation/, 400);
});

test('nothing in retire deletes a branch or kills a session', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../server/lanes/retire.mjs'), 'utf8')
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of ['branch', 'kill-session', 'process.kill', "'-D'", 'reset --hard', 'rm -rf']) {
    if (forbidden === 'branch') {
      assert.doesNotMatch(src, /'branch',\s*'-[dD]'/, 'git branch -d must never run');
      continue;
    }
    assert.ok(!src.includes(forbidden), `retire.mjs must not contain ${forbidden}`);
  }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
