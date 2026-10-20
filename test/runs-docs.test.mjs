// docs/runs.md is the run protocol's spec (runs plan §3 A1, task T2): its event
// table, states and stop reasons must match server/runs/protocol.mjs both ways.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { KNOWN_TYPES, STATES, STOP_REASONS, VERSION } from '../server/runs/protocol.mjs';

const doc = await readFile(new URL('../docs/runs.md', import.meta.url), 'utf8');

/** The first-column backticked names of the table under `## <heading>` / `### <heading>`. */
function tableNames(heading) {
  const start = doc.search(new RegExp(`^#{2,3} ${heading}$`, 'm'));
  assert.ok(start >= 0, `no "${heading}" section`);
  const rest = doc.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => /^#{2,3} /.test(l));
  const names = [];
  for (const line of end < 0 ? rest : rest.slice(0, end)) {
    const m = /^\| `([^`]+)` \|/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

test('every known event type is in the events table, and the table names no other', () => {
  const names = tableNames('Events');
  assert.deepEqual([...names].sort(), [...KNOWN_TYPES].sort());
});

test('the states table matches STATES', () => {
  assert.deepEqual([...tableNames('States')].sort(), [...STATES].sort());
});

test('the stop reasons table matches STOP_REASONS', () => {
  assert.deepEqual([...tableNames('Stop reasons')].sort(), [...STOP_REASONS].sort());
});

test('the doc names the version, the file location and the none default', () => {
  assert.match(doc, new RegExp(`protocol, v${VERSION}`));
  assert.ok(doc.includes('<run dir>/.laneboard/run.jsonl'));
  assert.match(doc, /`none` default/);
});

test('every example line in the doc parses', async () => {
  const { parseLine } = await import('../server/runs/protocol.mjs');
  const block = /```jsonl\n([\s\S]*?)```/.exec(doc);
  assert.ok(block, 'no jsonl example');
  const lines = block[1].split('\n').filter((l) => l.trim());
  assert.ok(lines.length >= 7);
  for (const line of lines) assert.equal(parseLine(line).ok, true, line);
});

test('README links the doc', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('(docs/runs.md)'));
});

test('the doc names the view URLs and says where a run file must be to be seen', () => {
  assert.ok(!/is being built/.test(doc), 'stale status note');
  for (const s of ['`#/runs`', '`#/runs?run=<id>`', 'score chart', '`g r`']) assert.ok(doc.includes(s), s);
  const cli = doc.slice(doc.indexOf('## The helper CLI'), doc.indexOf('## The API'));
  assert.match(cli, /`runs\.files`[\s\S]*`--post`/);
  const loop = doc.slice(doc.indexOf('## Writing a loop'), doc.indexOf('## Watching the runs loop'));
  assert.match(loop, /`runs\.files`/);
});
