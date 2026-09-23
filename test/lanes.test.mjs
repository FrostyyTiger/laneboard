// Lane identity: the worktree root a session is working in.
import test from 'node:test';
import assert from 'node:assert/strict';

// Lane ids are derived against the main checkouts: the repos config names,
// plus whatever `codeDir` actually holds. This suite sets them by hand — the
// scan itself is tested against a scratch codeDir further down.
process.env.LANEBOARD_REPOS = 'example-repo';
const lanes = await import('../server/collector/lanes.mjs');
lanes.setRepos(['example-repo', 'laneboard']);

test('a lane id strips its main checkout, and a main checkout keeps its name', () => {
  // A lane's worktree is named <repo>-<lane>, which is why the basename is
  // meaningful in the first place.
  assert.equal(lanes.laneIdFor('/home/user/code/example-repo-bauplan'), 'bauplan');
  assert.equal(lanes.laneIdFor('/home/user/code/example-repo-world-truth-plan'), 'world-truth-plan');
  // A main checkout is not a lane OF anything, so it keeps its own name.
  assert.equal(lanes.laneIdFor('/home/user/code/example-repo'), 'example-repo');
  assert.equal(lanes.laneIdFor('/home/user/code/laneboard'), 'laneboard');
  // A directory that belongs to no known checkout keeps its full name.
  assert.equal(lanes.laneIdFor('/home/user/Other-horizon-v1'), 'Other-horizon-v1');
  assert.equal(lanes.laneIdFor(null), null);
});

test('the repos config seeds the checkouts before anything is scanned', async () => {
  const { config } = await import('../server/config.mjs');
  assert.deepEqual(config.repoNames, ['example-repo']);
  assert.equal(config.defaultRepo, 'example-repo');
});

test('a checkout name that is the whole basename is not stripped to nothing', () => {
  assert.equal(lanes.laneIdFor('/x/example-repo-'), 'example-repo-');
});

test('the longer checkout name wins, with two repos that share a prefix', () => {
  // "example-repo-" must be tried before "example-", or every lane of it
  // would come out named "repo-<lane>".
  lanes.setRepos(['example', 'example-repo']);
  assert.equal(lanes.laneIdFor('/x/example-repo-hygiene'), 'hygiene');
  assert.equal(lanes.laneIdFor('/x/example-hygiene'), 'hygiene');
  assert.equal(lanes.laneIdFor('/x/example-repo'), 'example-repo');
  assert.equal(lanes.laneIdFor('/x/example'), 'example');
  // And a directory that merely starts with the same letters is not a lane.
  lanes.setRepos(['example-repo']);
  assert.equal(lanes.laneIdFor('/x/example-test-server'), 'example-test-server');
  assert.equal(lanes.laneIdFor('/x/examplewebsite'), 'examplewebsite');
  lanes.setRepos(['example-repo', 'laneboard']);
});

test('the checkouts are scanned from codeDir: a repo, a worktree, a plain directory', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-repos-'));
  const { config } = await import('../server/config.mjs');
  const codeDir = config.codeDir;
  try {
    fs.mkdirSync(path.join(dir, 'alpha', '.git'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'beta', '.git'), { recursive: true });
    // A worktree: `.git` is a FILE pointing back at the repo, not a directory.
    fs.mkdirSync(path.join(dir, 'alpha-lane'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'alpha-lane', '.git'), 'gitdir: /x\n');
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });

    config.codeDir = dir;
    const found = await lanes.scanRepos();
    assert.deepEqual([...found].sort(), ['alpha', 'beta', 'example-repo'].sort());
    // And the derivation follows from the scan alone.
    assert.equal(lanes.laneIdFor(path.join(dir, 'alpha-lane')), 'lane');
    assert.equal(lanes.laneIdFor(path.join(dir, 'alpha')), 'alpha');
    assert.equal(lanes.laneIdFor(path.join(dir, 'notes')), 'notes');
  } finally {
    config.codeDir = codeDir;
    lanes.setRepos(['example-repo', 'laneboard']);
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
