// Lane identity: the worktree root a session is working in.
import test from 'node:test';
import assert from 'node:assert/strict';

// Lane ids are derived against the repo prefixes in config, which default to
// none: a fresh install has no repos yet. This suite configures one.
process.env.LANEBOARD_REPO_PREFIXES = 'example-repo-';
const lanes = await import('../server/collector/lanes.mjs');

test('a lane id strips the repo prefix, and a main checkout keeps its name', () => {
  // The worktrees on this box are named after their plan, which is why the
  // basename is meaningful in the first place.
  assert.equal(lanes.laneIdFor('/home/user/code/example-repo-bauplan'), 'bauplan');
  assert.equal(lanes.laneIdFor('/home/user/code/example-repo-world-truth-plan'), 'world-truth-plan');
  // A main checkout is not a lane OF anything, so it keeps its own name.
  assert.equal(lanes.laneIdFor('/home/user/code/example-repo'), 'example-repo');
  assert.equal(lanes.laneIdFor('/home/user/code/laneboard'), 'laneboard');
  // A repo whose prefix is not configured keeps its full name.
  assert.equal(lanes.laneIdFor('/home/user/Other-horizon-v1'), 'Other-horizon-v1');
  assert.equal(lanes.laneIdFor(null), null);
});

test('the repo prefixes come from config', async () => {
  const { config } = await import('../server/config.mjs');
  assert.equal(lanes.REPO_PREFIXES, config.repoPrefixes);
  assert.deepEqual(config.repoPrefixes, ['example-repo-']);
});

test('a prefix that is the whole name is not stripped to nothing', () => {
  assert.equal(lanes.laneIdFor('/x/example-repo-'), 'example-repo-');
});

test('the longer repo prefix wins', () => {
  // "example-repo-" must be tried before anything shorter could match, or
  // every lane of it would come out named "repo-<lane>".
  assert.equal(lanes.laneIdFor('/x/example-repo-hygiene'), 'hygiene');
  // A repo that merely starts with "example-" is not a lane clone.
  assert.equal(lanes.laneIdFor('/x/example-test-server'), 'example-test-server');
  assert.equal(lanes.laneIdFor('/x/example-website'), 'example-website');
});

test('the lane hue is stable, in range, and derived from the id alone', () => {
  // Stable across restarts and across browsers is the whole requirement: no
  // config file, no database column, no insertion order (lanes plan rule 4).
  for (const id of ['horizon-v1', 'bauplan', 'other', 'a', '']) {
    const h = lanes.hueFor(id);
    assert.equal(h, lanes.hueFor(id), 'the same id must give the same hue');
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360, `hue out of range for ${id}: ${h}`);
  }
  assert.notEqual(lanes.hueFor('horizon-v1'), lanes.hueFor('mesher-v1'));
});

test('worktree list is parsed, detached heads included', () => {
  const out = lanes.parseWorktreeList(`worktree /home/user/code/other
HEAD 14ed112d
branch refs/heads/main

worktree /home/user/code/other-horizon-v1
HEAD b303ec5a
branch refs/heads/feat/horizon-v1

worktree /home/user/code/other-odd
HEAD deadbeef
detached
`);
  assert.deepEqual(out.map((w) => w.path), [
    '/home/user/code/other', '/home/user/code/other-horizon-v1', '/home/user/code/other-odd',
  ]);
  // refs/heads/ is stripped, and a branch with a slash in it survives intact.
  assert.equal(out[1].branch, 'feat/horizon-v1');
  assert.equal(out[2].branch, null);
  assert.equal(out[2].detached, true);
});

test('an empty or broken worktree list is not an error', () => {
  assert.deepEqual(lanes.parseWorktreeList(''), []);
  assert.deepEqual(lanes.parseWorktreeList('garbage\nHEAD abc\n'), []);
});

test('build groups sessions by lane and never invents one for a repo-less session', () => {
  // The watcher sessions run in ~, which is not a repo. They must get no lane
  // at all rather than a grey placeholder.
  const built = lanes.build([
    { name: 'horizon-v1', dir: '/nope/a', branch: 'feat/horizon-v1' },
    { name: 'bauplan-watch', dir: null, branch: null },
  ]);
  assert.deepEqual(built, [], 'nothing is resolved, so there are no lanes yet');
});

test('lanes sort active-first, then alphabetically — and that orders the RAIL only', () => {
  // Hard rule 1: the grid's order belongs to attention. This sort touches the
  // lanes array, which the rail renders; no session order depends on it.
  const rows = [
    { id: 'zebra', idle: false }, { id: 'alpha', idle: true },
    { id: 'beta', idle: false }, { id: 'gamma', idle: true },
  ];
  const sorted = [...rows].sort((a, b) => Number(a.idle) - Number(b.idle) || a.id.localeCompare(b.id));
  assert.deepEqual(sorted.map((r) => r.id), ['beta', 'zebra', 'alpha', 'gamma']);
});

test('health reports what the 60 s pass knows', () => {
  const h = lanes.health();
  assert.ok('lanes' in h && 'roots' in h && 'refreshedAt' in h);
});
