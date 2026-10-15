// Plan status parsing (§6 2.10, P8): the status words map through the states
// table, backticks are optional, unknown words are kept, and plan files read
// from git are cached by blob oid.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  planState, statusWord, stateTable, stateOf, stateNames, planPackage,
  parseLsTree, listPlanFiles, readPlans, _clearCache, cacheStats, SCAN_LINES,
} from '../server/packages/plans.mjs';
import { defaults } from '../server/config/packages.mjs';
import { run as realRun } from '../server/util.mjs';

const CFG = defaults().plans;

test('the default status words map to their states', () => {
  const cases = {
    OPEN: 'open', READY: 'open', PROPOSAL: 'open', 'IN-PROGRESS': 'open',
    PARTIAL: 'partial', DONE: 'done', SUPERSEDED: 'done', DECIDED: 'done', DEFERRED: 'deferred',
  };
  for (const [word, state] of Object.entries(cases)) {
    assert.deepEqual(planState(`# Title\n\n**Plan status:** ${word}\n`, CFG), { word, state }, word);
  }
});

test('backticks around the word are optional', () => {
  assert.deepEqual(planState('**Plan status:** `PARTIAL` (stage 2 of 4)', CFG), { word: 'PARTIAL', state: 'partial' });
  assert.deepEqual(planState('**Plan status:** PARTIAL — stage 2', CFG), { word: 'PARTIAL', state: 'partial' });
  assert.deepEqual(planState('**Plan status:**`DONE`', CFG), { word: 'DONE', state: 'done' });
});

test('an unknown word is kept, its state is unknown', () => {
  assert.deepEqual(planState('**Plan status:** `PARKED`', CFG), { word: 'PARKED', state: 'unknown' });
});

test('no status line, or one past the first 60 lines, is unknown with no word', () => {
  assert.deepEqual(planState('# A plan\n\nNo status here.\n', CFG), { word: null, state: 'unknown' });
  const late = `${'filler\n'.repeat(SCAN_LINES)}**Plan status:** DONE\n`;
  assert.deepEqual(planState(late, CFG), { word: null, state: 'unknown' });
  const justIn = `${'filler\n'.repeat(SCAN_LINES - 1)}**Plan status:** DONE\n`;
  assert.equal(planState(justIn, CFG).state, 'done');
  assert.deepEqual(planState('', CFG), { word: null, state: 'unknown' });
  assert.deepEqual(planState(null, CFG), { word: null, state: 'unknown' });
});

test('the status line is anchored and handles CRLF', () => {
  assert.equal(statusWord('see **Plan status:** DONE', CFG.statusLine), null);
  assert.equal(planState('x\r\n**Plan status:** DONE\r\n', CFG).state, 'done');
});

test('a configured status line and states table are honoured', () => {
  const cfg = {
    statusLine: '^Status:\\s*\\[?([a-z]+)',
    states: { open: ['todo'], done: ['shipped'], blocked: ['stuck'] },
  };
  assert.deepEqual(planState('Status: [shipped]', cfg), { word: 'shipped', state: 'done' });
  assert.deepEqual(planState('Status: stuck', cfg), { word: 'stuck', state: 'blocked' });
  assert.deepEqual(stateNames(cfg.states), ['open', 'done', 'blocked', 'unknown']);
  // Word lookup is case-insensitive against the table.
  assert.equal(stateOf('DONE', { done: ['done'] }).state, 'done');
});

test('the word table is built once per states object', () => {
  const states = { open: ['OPEN'], done: ['DONE', 'OPEN'] };
  const t = stateTable(states);
  assert.equal(stateTable(states), t, 'cached');
  assert.equal(t.get('OPEN'), 'open', 'the first state listing a word wins');
  assert.equal(stateTable(null).size, 0);
});

test('plan -> package: configured globs, then the file-name prefix, else repo-level', () => {
  const pkgs = [
    { name: 'web', paths: ['web/**'] },
    { name: 'web-admin', paths: ['web-admin/**'] },
    { name: 'core', paths: ['core/**'], plans: ['docs/plans/engine/**'] },
  ];
  assert.equal(planPackage('docs/plans/engine/stage-1.md', pkgs), 'core');
  assert.equal(planPackage('docs/plans/web-admin-auth.md', pkgs), 'web-admin', 'longest name first');
  assert.equal(planPackage('docs/plans/web-cache.md', pkgs), 'web');
  assert.equal(planPackage('docs/plans/webhooks.md', pkgs), null, 'a token match, not a string prefix');
  assert.equal(planPackage('docs/plans/roadmap.md', pkgs), null);
  assert.equal(planPackage('docs/plans/web-x.md', null), null);
});

test('parseLsTree keeps blobs with their oids', () => {
  const oid = 'a'.repeat(40);
  const out = parseLsTree(`100644 blob ${oid}\tdocs/plans/a.md\x00040000 tree ${'b'.repeat(40)}\tdocs\x00160000 commit ${'c'.repeat(40)}\tsub\x00`);
  assert.deepEqual(out, [{ path: 'docs/plans/a.md', oid }]);
});

test('a ref that could be an option is never handed to git', async () => {
  let called = 0;
  const run = async () => { called++; return { ok: true, stdout: '' }; };
  assert.deepEqual(await listPlanFiles('/x', '--output=/tmp/x', ['**'], { run }), []);
  assert.equal(called, 0);
});

// --- against a real temp repo -------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-p8-'));
const REPO = path.join(TMP, 'repo');
const git = (...args) => execFileSync('git', ['-C', REPO, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(REPO, p)), { recursive: true }); fs.writeFileSync(path.join(REPO, p), s); };

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('readPlans lists plans from the ref, counts states and caches by blob oid', async () => {
  fs.mkdirSync(REPO);
  execFileSync('git', ['init', '-q', '-b', 'main', REPO]);
  write('docs/plans/web-login.md', '# Login\n\n**Plan status:** `OPEN`\n');
  write('docs/plans/sub/core-engine.md', '# Engine\n**Plan status:** DONE\n');
  write('docs/plans/roadmap.md', '# Roadmap\n**Plan status:** PARKED\n');
  write('docs/plans/notes.txt', '**Plan status:** DONE\n');
  write('docs/other.md', '**Plan status:** DONE\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'one');
  // An uncommitted edit in the working tree is never read.
  write('docs/plans/web-login.md', '**Plan status:** DONE\n');

  _clearCache();
  const calls = [];
  const run = (cmd, args, opts) => { calls.push(args); return realRun(cmd, args, opts); };
  const repo = { dir: REPO, packages: [{ name: 'web', paths: ['web/**'] }, { name: 'core', paths: ['core/**'] }] };

  const first = await readPlans(repo, CFG, { ref: 'main', run });
  assert.deepEqual(first.counts, { open: 1, partial: 0, done: 1, deferred: 0, unknown: 1 });
  assert.deepEqual(first.files, [
    { path: 'docs/plans/roadmap.md', state: 'unknown', word: 'PARKED', pkg: null },
    { path: 'docs/plans/sub/core-engine.md', state: 'done', word: 'DONE', pkg: 'core' },
    { path: 'docs/plans/web-login.md', state: 'open', word: 'OPEN', pkg: 'web' },
  ]);
  assert.equal(calls.filter((a) => a.includes('cat-file')).length, 3);

  // Same ref again: nothing is read.
  calls.length = 0;
  const second = await readPlans(repo, CFG, { ref: 'main', run });
  assert.deepEqual(second, first);
  assert.equal(calls.filter((a) => a.includes('cat-file')).length, 0);
  assert.equal(cacheStats().hits, 3);

  // One plan changes on main: exactly one read.
  git('add', 'docs/plans/web-login.md');
  git('commit', '-q', '-m', 'two');
  calls.length = 0;
  const third = await readPlans(repo, CFG, { ref: 'main', run });
  assert.equal(calls.filter((a) => a.includes('cat-file')).length, 1);
  assert.deepEqual(third.counts, { open: 0, partial: 0, done: 2, deferred: 0, unknown: 1 });
});

test('readPlans fails soft: a missing ref or repo gives empty counts', async () => {
  const empty = { open: 0, partial: 0, done: 0, deferred: 0, unknown: 0 };
  assert.deepEqual(await readPlans({ dir: path.join(TMP, 'nope') }, CFG, { ref: 'main' }), { counts: empty, files: [] });
  assert.deepEqual(await readPlans({ dir: REPO }, CFG, { ref: 'no-such-ref' }), { counts: empty, files: [] });
  assert.deepEqual(await readPlans(null, CFG), { counts: empty, files: [] });
});
