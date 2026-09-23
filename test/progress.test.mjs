// How far a lane has got. Fixtures are trimmed copies of the real files in
// ~/other-horizon-v1 and ~/other-creatures-v1, taken 2026-09-04.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stageHeadings, stageFromSubject } from '../server/collector/progress.mjs';

const FIX = path.resolve(import.meta.dirname, 'fixtures/lane');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

test('the plan gives the total, and a deeper sub-heading cannot inflate it', () => {
  const stages = stageHeadings(read('plan-horizon-v1.md'));
  assert.deepEqual(stages.slice(0, 9), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(Math.max(...stages), 8, 'horizon-v1 is a nine-stage plan');
});

test('the status doc gives how far it has got', () => {
  const stages = stageHeadings(read('status-horizon-v1.md'));
  assert.equal(Math.max(...stages), 3);
});

test('a heading must be a heading', () => {
  // Prose mentioning a stage is not progress, and neither is a bare # title.
  assert.deepEqual(stageHeadings('Stage 7 was hard'), []);
  assert.deepEqual(stageHeadings('# Stage 7'), [], 'h1 is the document title');
  assert.deepEqual(stageHeadings('##### Stage 7'), [], 'h5 is too deep to be a stage');
  assert.deepEqual(stageHeadings('## Stage 7 — the sprint line'), [7]);
  assert.deepEqual(stageHeadings('#### Stage 12'), [12]);
});

test('the plan-shaped commit subject is read', () => {
  assert.equal(stageFromSubject('Stage 4: the thing'), 4);
  assert.equal(stageFromSubject('Stage 12: later'), 12);
});

test('the commit style the lanes on this box ACTUALLY use is read', () => {
  // Measured 2026-09-04: every staged commit in ~/other-* is a conventional
  // commit, not the plan's `Stage N:` form. Matching only the plan's shape
  // would have made this source dead code on the machine it was written for.
  assert.equal(stageFromSubject('feat(horizon): stage 3 - rings to 38 km'), 3);
  assert.equal(stageFromSubject('feat(creatures): stage 8 - the tuner'), 8);
  // A range has finished its upper end.
  assert.equal(stageFromSubject('feat(creatures): stages 6-7 - the pack'), 7);
});

test('a commit with no stage in it is not progress', () => {
  assert.equal(stageFromSubject('docs(horizon): the tour is deterministic'), null);
  assert.equal(stageFromSubject('fix: staging server config'), null, '"staging" is not "stage N"');
  assert.equal(stageFromSubject(''), null);
  assert.equal(stageFromSubject(undefined), null);
});

test('the real commit log resolves to the highest stage on the branch', () => {
  const lines = read('commits.tsv').trim().split('\n');
  let best = null;
  let bestAt = null;
  for (const line of lines) {
    const tab = line.indexOf('\t');
    const n = stageFromSubject(line.slice(tab + 1));
    if (n != null && (best == null || n > best)) { best = n; bestAt = Number(line.slice(0, tab)) * 1000; }
  }
  // The fixture holds horizon-v1's branch plus four creatures-v1 commits; the
  // highest stage in it is creatures' stage 8.
  assert.equal(best, 8);
  assert.ok(bestAt > 0 && bestAt < Date.now(), 'the timestamp of that commit is recorded');
});

test('horizon-v1 reads as stage 3 of 8', () => {
  // The number that actually shows on the pill.
  const m = Math.max(...stageHeadings(read('plan-horizon-v1.md')));
  const fromStatus = Math.max(...stageHeadings(read('status-horizon-v1.md')));
  const fromCommit = read('commits.tsv').trim().split('\n')
    .filter((l) => l.includes('horizon'))
    .map((l) => stageFromSubject(l.slice(l.indexOf('\t') + 1)))
    .filter((n) => n != null)
    .reduce((a, b) => Math.max(a, b), -1);
  assert.equal(Math.max(fromStatus, fromCommit), 3);
  assert.equal(m, 8);
});

test('the current stage is the lowest one above the last finished, with its title', async () => {
  const { stageTitles, currentStage } = await import('../server/collector/progress.mjs');
  const t = stageTitles('# P\n\n## Stage 0 — Measure\n\n### Stage 1 — Cut\n\n## Stage 2: Install as a service\n');
  assert.deepEqual([...t.entries()], [[0, 'Measure'], [1, 'Cut'], [2, 'Install as a service']]);
  assert.deepEqual(currentStage(t, null), { n: 0, title: 'Measure' });
  assert.deepEqual(currentStage(t, 0), { n: 1, title: 'Cut' });
  assert.deepEqual(currentStage(t, 2), { n: null, title: 'all stages done' });
});
