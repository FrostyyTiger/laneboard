// `laneboard morning` against a fake /api/morning body (T9): it reads like the
// web page — ISO dates, 2-decimal money, session counts instead of names or
// ids, stopped runs under Finished with their reason, lanes with a session
// still at work under Still running (T25), and no line wider than 100 columns. The child gets a scratch HOME and only the test server's URL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'laneboard');
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SINCE = Date.parse('2026-10-21T16:00:00Z'); // 18:00 in Zurich (CEST)
const NOW = Date.parse('2026-10-22T05:00:00Z');

const BODY = {
  window: 'tonight',
  label: 'last night',
  since: SINCE,
  now: NOW,
  needsYou: [{
    kind: 'approval', state: 'waiting', name: 'acme-api', lane: 'acme', at: NOW - 60000,
    text: 'Allow the agent to run the migration script against the scratch database? '.repeat(4),
  }],
  finished: [{
    lane: 'acme', progress: { n: 3, m: 5 }, branch: 'feat/a-rather-long-branch-name-for-the-table',
    isMain: false, merged: false, lastCommitAt: NOW - 3600000, doneMarkers: [1],
    sessions: [{ name: UUID, state: 'idle' }, { name: 'acme-api', state: 'working' }, { name: 'acme-web', state: 'idle' }],
  }],
  runs: [
    { run: 'acme-docs', goal: 'Write the docs for every public route and keep them in step with the code '.repeat(2),
      state: 'stopped', rounds: 12, scores: { tasks: { start: 2, end: 9, better: 'higher' } },
      stop: 'tasks done', stoppedAt: NOW - 7200000, prs: ['https://example.invalid/acme/pull/1'], usd: 0.1 },
    { run: 'acme-tests', goal: 'Green suite', state: 'running', rounds: 4, scores: {}, stop: null, prs: [], usd: 1.234 },
  ],
  cost: { lanes: [{ lane: 'acme', usd: 0.1, tokens: 12000, sessions: [UUID, 'acme-api', 'acme-web'] }], totalUsd: 0.1, totalTokens: 12000 },
  rateLimits: null,
};

function morning(t, body) {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-cli-morning-'));
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    t.after(() => { server.close(); fs.rmSync(home, { recursive: true, force: true }); });
    server.listen(0, '127.0.0.1', () => {
      const env = {
        PATH: process.env.PATH, HOME: home, TZ: 'Europe/Zurich',
        XDG_CONFIG_HOME: path.join(home, 'config'), XDG_STATE_HOME: path.join(home, 'state'),
        LANEBOARD_CONFIG: path.join(home, 'no-config.json'),
        LANEBOARD_URL: `http://127.0.0.1:${server.address().port}`,
      };
      execFile(process.execPath, [BIN, 'morning'], { env, cwd: home, timeout: 20000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`${err.message}\n${stderr}`));
        resolve(stdout);
      });
    });
  });
}

test('laneboard morning: ISO header, the server\'s word, 2-decimal money, counts, no id, ≤ 100 columns', async (t) => {
  const out = await morning(t, BODY);
  const lines = out.split('\n');
  assert.equal(lines[0], 'Morning — last night (since 2026-10-21 18:00)');
  assert.match(out, /\$0\.10\b/);
  assert.doesNotMatch(out, /\$0\.100/);
  assert.match(out, /\$1\.23\b/);
  assert.match(out, /\b3 sessions\b/);
  assert.ok(!out.includes(UUID), 'a session id never reaches the text');
  for (const l of lines) assert.ok(l.length <= 100, `over 100 columns (${l.length}): ${l}`);
});

test('laneboard morning: a run that stopped in the window is under Finished with its reason', async (t) => {
  const out = await morning(t, BODY);
  const finished = out.indexOf('Finished');
  const runsHead = out.indexOf('\nRuns (1)');
  const cost = out.indexOf('What it cost');
  assert.ok(finished > 0 && runsHead > finished && cost > runsHead, out);
  const docs = out.indexOf('acme-docs');
  assert.ok(docs > finished && docs < runsHead, 'the stopped run sits under Finished');
  assert.match(out, /Finished \(1 run stopped, 1 lane\)/);
  assert.match(out, /acme-docs {2}12 rounds {2}tasks 2→9 ↑ {2}stopped: tasks done/);
  const tests = out.indexOf('acme-tests');
  assert.ok(tests > runsHead && tests < cost, 'a running run stays under Runs');
});

test('laneboard morning: a run stopped before the window is not news, nothing to say is said once', async (t) => {
  const body = {
    ...BODY, needsYou: [], finished: [],
    runs: [{ ...BODY.runs[0], stoppedAt: SINCE - 1000, state: 'stopped' }],
  };
  const out = await morning(t, body);
  assert.match(out, /Finished \(0 lanes\)\n {2}\(nothing moved\)/);
  assert.match(out, /Runs \(1\)\n {2}acme-docs/);
});

test('laneboard morning: a lane still at work is under Still running, never under Finished', async (t) => {
  const body = {
    ...BODY,
    finished: [
      BODY.finished[0],
      { lane: 'acme-wip', progress: null, branch: 'feat/wip', isMain: false, merged: false,
        lastCommitAt: null, doneMarkers: [], sessions: [{ name: 'acme-wip-1', state: 'working' }] },
    ],
  };
  const out = await morning(t, body);
  assert.doesNotMatch(out, /active\)/);
  assert.match(out, /Finished \(1 run stopped, 1 lane\)/);
  const finished = out.indexOf('\nFinished');
  const still = out.indexOf('\nStill running (1 lane)');
  const runsHead = out.indexOf('\nRuns (1)');
  assert.ok(finished > 0 && still > finished && runsHead > still, out);
  const wip = out.indexOf('acme-wip');
  assert.ok(wip > still && wip < runsHead, 'the working lane sits under Still running');
  const done = out.indexOf('\nacme ', finished);
  assert.ok(done > finished && done < still, 'the lane with a done marker stays under Finished');
  for (const l of out.split('\n')) assert.ok(l.length <= 100, `over 100 columns (${l.length}): ${l}`);
});

test('laneboard morning: only running lanes moved, Finished says nothing finished', async (t) => {
  const body = {
    ...BODY, runs: [],
    finished: [{ lane: 'acme-wip', branch: 'feat/wip', isMain: false, merged: false, doneMarkers: [],
      sessions: [{ name: 'acme-wip-1', state: 'waiting_question' }] }],
  };
  const out = await morning(t, body);
  assert.match(out, /Finished \(0 lanes\)\n {2}\(nothing finished\)\n\nStill running \(1 lane\)\n/);
});

test('laneboard morning: an idle or merged lane is finished, whatever its sessions', async (t) => {
  const body = {
    ...BODY, runs: [],
    finished: [
      { lane: 'acme-idle', branch: 'feat/idle', isMain: false, merged: false, doneMarkers: [], sessions: [{ name: 'i', state: 'idle' }] },
      { lane: 'acme-merged', branch: 'feat/m', isMain: false, merged: true, doneMarkers: [], sessions: [{ name: 'm', state: 'working' }] },
    ],
  };
  const out = await morning(t, body);
  assert.match(out, /Finished \(2 lanes\)/);
  assert.doesNotMatch(out, /Still running/);
});
