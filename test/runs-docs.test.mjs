// docs/runs.md is the run protocol's spec (runs plan §3 A1, task T2): its event
// table, states and stop reasons must match server/runs/protocol.mjs both ways.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { KNOWN_TYPES, STATES, STOP_REASONS, VERSION, FENCE_ACK_BY } from '../server/runs/protocol.mjs';
import { RULES as STUCK_RULES, FAILED_OUTCOME } from '../server/runs/stuck.mjs';

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

test('the needs.ack row names every `by` that may close a fence need (night 4 T6)', () => {
  const row = doc.split('\n').find((l) => l.startsWith('| `needs.ack` |'));
  assert.ok(row, 'no needs.ack row');
  for (const by of FENCE_ACK_BY) assert.ok(row.includes(`\`${by}\``), by);
});

test('the artifact row documents `state` and the update rule (night 5 T1)', () => {
  const row = doc.split('\n').find((l) => l.startsWith('| `artifact` |'));
  assert.ok(row, 'no artifact row');
  for (const s of ['`state`', '`open`', '`merged`', '`closed`']) assert.ok(row.includes(s), s);
  assert.match(row, /later line with that URL updates its `state`/);
  assert.match(row, /default `link`/);
  assert.match(row, /only `kind: pr` artifacts appear in a run's `prs`/);
});

test('round.start documents `title` and `wrapup`, run.stop `detail` (night 5 T3)', () => {
  const rows = doc.split('\n');
  const start = rows.find((l) => l.startsWith('| `round.start` |'));
  const stop = rows.find((l) => l.startsWith('| `run.stop` |'));
  for (const f of ['`title`', '`wrapup`']) assert.ok(start.includes(f), f);
  assert.ok(stop.includes('`detail`'), 'detail');
});

test('the states table matches STATES', () => {
  assert.deepEqual([...tableNames('States')].sort(), [...STATES].sort());
});

test('the stop reasons table matches STOP_REASONS', () => {
  assert.deepEqual([...tableNames('Stop reasons')].sort(), [...STOP_REASONS].sort());
});

test('the stuck table matches the run stuck rules, and every failed outcome it names counts as failed', () => {
  assert.deepEqual([...tableNames('Stuck')].sort(), [...STUCK_RULES].sort());
  const row = doc.split('\n').find((l) => l.startsWith('| `same-task` |'));
  const words = [...row.split('|')[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((w) => w !== 'outcome');
  assert.ok(words.length >= 5);
  for (const w of words) assert.match(w, FAILED_OUTCOME, w);
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

test('README\'s CLI block lists `laneboard run` and points at the doc', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const cli = readme.slice(readme.indexOf('## CLI'), readme.indexOf('## Nothing destructive'));
  assert.match(cli, /^laneboard run start\|round\|score\|needs\|ack\|artifact\|stop/m);
  assert.match(cli, /`laneboard run`[^\n]*\(docs\/runs\.md\)/);
});

test('README lists every view and its `g` chord', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const { VIEWS, VIEW_KEYS } = await import('../public/js/core/router.js');
  for (const v of VIEWS) assert.ok(readme.includes(`\`#/${v}\``), `#/${v}`);
  for (const [k, v] of Object.entries(VIEW_KEYS)) assert.ok(readme.includes(`\`g ${k}\` ${v}`), `g ${k}`);
});

test('the API section has a curl example the server accepts, and names the 403 without the header', async () => {
  const { parseLine } = await import('../server/runs/protocol.mjs');
  const { checkCsrf } = await import('../server/security.mjs');
  const block = /```sh\n(curl [^`]*?\/api\/runs\/events[\s\S]*?)```/.exec(doc);
  assert.ok(block, 'no curl example for POST /api/runs/events');
  const header = /-H '(x-laneboard): ([^']*)'/i.exec(block[1]);
  assert.ok(header, 'the example sends no x-laneboard header');
  const req = { method: 'POST', headers: { [header[1].toLowerCase()]: header[2] } };
  assert.equal(checkCsrf(req, '/api/runs/events'), null, 'the server would refuse the header as written');
  assert.equal(checkCsrf({ method: 'POST', headers: {} }, '/api/runs/events'), 'no-csrf-header');
  const body = /-d '([^']*)'/.exec(block[1]);
  assert.ok(body, 'the example sends no body');
  assert.equal(parseLine(body[1]).ok, true, body[1]);
  assert.ok(doc.includes('"no-csrf-header"') && /403/.test(doc));
});

test('the doc says `score` and `needs` without `n` attach to the latest round, even an ended one, as the fold does', async () => {
  const { parseLine, foldRun } = await import('../server/runs/protocol.mjs');
  for (const t of ['score', 'needs']) {
    const row = doc.split('\n').find((l) => l.startsWith(`| \`${t}\` |`) && l.includes('latest round'));
    assert.ok(row && /even if that round has ended/.test(row), `the ${t} row does not say it`);
  }
  assert.match(doc, /`score` and `needs` without `--n` attach to the latest round/);
  const lines = [
    { t: 'round.start', n: 3 },
    { t: 'round.end', n: 3, outcome: 'kept' },
    { t: 'needs', kind: 'decision', text: 'Drop the v1 export?' },
    { t: 'score', name: 'tests', value: 10 },
  ].map((e) => parseLine(JSON.stringify({ v: 1, run: 'readiness', ...e })));
  for (const l of lines) assert.equal(l.ok, true);
  const run = foldRun(lines.map((l) => l.event));
  assert.equal(run.needs[0].n, 3);
  assert.equal(run.scores.tests[0].n, 3);
});

test('`laneboard run` leaves no untracked file: .laneboard/ is ignored and README names the default path (night 4 T20)', async () => {
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.ok(ignore.split('\n').some((l) => l.trim() === '.laneboard/'), '.laneboard/ not in .gitignore');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /`\.\/\.laneboard\/run\.jsonl` in the current directory/);
  assert.match(readme, /unless `--post`/);
});

test('docs/runs.md names the CLI receipt and the ack warnings (night 4 T21)', () => {
  assert.match(doc, /`ok <run> <type> appended to\s+<file>`/);
  assert.match(doc, /`ok <run> <type> posted`/);
  assert.match(doc, /a warning on\s+stderr says it is advisory: the need stays open/);
});

test('docs/runs.md says an ack whose ref names no need writes nothing and exits 1 (night 4 T35), offline per file only', async () => {
  assert.match(doc, /`laneboard: no need\s+<ref> in run <run> …; nothing written` \(or `nothing posted`\) and exits 1/);
  assert.match(doc, /`laneboard run ack` refuses one/);
  // Offline the check is per file, so a missing ref warns and is still written;
  // `by` is advisory (not enforced), and the loop prompts forbid a person's by.
  assert.match(doc, /that check is per file/);
  assert.match(doc, /`by` is not enforced/);
  const common = await readFile(new URL('../docs/plans/runs/loop/prompts/common.md', import.meta.url), 'utf8');
  assert.match(common, /Never ack a need with `by` `owner`, `inbox` or `run page`/);
  // T39: a second ack of a closed need sends nothing and exits 0.
  assert.match(doc, /`need\s+<ref> already acked, nothing written` \(or `nothing posted`\), adds no line\s+and exits 0/);
  for (const by of FENCE_ACK_BY) assert.ok(doc.includes(`\`${by}\``), by);
});

test('docs/runs.md says which cost a stopped run prints: the cost events, else the stop usd (night 4 T34)', () => {
  assert.match(doc, /The list row and the run page print `cost\.usd`; only\s+when no `cost` event was sent and the rounds give none above 0 \(`cost\.rounds` is 0,\s+`cost\.usd` null or 0\) and `stop\.usd` is set do\s+they print `stop\.usd` instead, marked `loop` as the loop's own figure\./);
  assert.match(doc, /`stopUsd` \(`stop\.usd`/);
});

test('docs/runs.md says where a score without --n lands before any round (night 4 T36)', () => {
  assert.match(doc, /Before any round they land on round 0: the score gets `n: 0`, and the run\s+shows `round: null` in `GET \/api\/runs` until its first `round\.start`\./);
});

test('the helper CLI table says a round start is meant for eval (night 4 T40)', () => {
  const row = doc.split('\n').find((l) => l.startsWith('| `round` |'));
  assert.ok(row, 'no `round` row');
  assert.match(row, /`eval "\$\(laneboard run round --n 1 [^`]*\)"`/);
  assert.match(row, /export LANEBOARD_RUN=<run>\/<n>/);
});

test('T6: docs/runs.md documents `run cost`, the run cost from rounds and what --post prints', () => {
  assert.match(doc, /^\| `cost` \| \*\*`--usd x`\*\*, `--n N`/m);
  assert.match(doc, /A run with no `cost` event sums its rounds' `round\.end`\s+`usd`/);
  assert.match(doc, /neither, `usd` and `from` are null, never 0/);
  assert.match(doc, /`, dropped: <fields>`/);
  assert.match(doc, /201 `\{ok, run, t, dropped\}`/);
});

test('T7: docs/runs.md says `rounds` is rounds done and `maxRounds` the cap, the alias with its version, and `?run=`', () => {
  assert.ok(doc.includes('`rounds` is rounds done, `maxRounds` the cap'));
  assert.match(doc, /`budget\.rounds`[^|]*old name, still read as `maxRounds` in 0\.1\.x\s+and dropped in 0\.2\.0/);
  assert.ok(doc.includes('`?run=<id>`'));
  assert.ok(doc.includes('no run <run>; the list is GET /api/runs'));
});

test('T8: README has the API route table with /api/health, and every route in it exists', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /^## API$/m);
  assert.match(readme, /^\| View \| Reads \|$/m);
  assert.ok(readme.includes('`GET /api/health`: `{ok, version, mode}`'));
  const table = readme.slice(readme.indexOf('| View | Reads |'), readme.indexOf('`/healthz` adds'));
  const paths = [...table.matchAll(/`(?:GET|POST) (\/api\/[a-z0-9/_-]+)/g)].map((m) => m[1].replace(/\/<id>$/, ''));
  assert.ok(paths.length >= 10, `only ${paths.length} routes in the table`);
  const server = await Promise.all(['server/boot/builder.mjs', 'server/routes/runs.mjs', 'server/routes/api-health.mjs',
    'server/routes/packages.mjs', 'server/routes/health.mjs', 'server/fleet/api-v1.mjs', 'server/routes/archive.mjs']
    .map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8').catch(() => '')));
  const all = server.join('\n');
  for (const p of paths) assert.ok(all.includes(`'${p}`), `${p} is in the README table but no server file names it`);
});

test('a round\'s --end --usd wins over stop --usd, and cost.from shows which (night 5 T36)', () => {
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /a round's `--end --usd` wins over `stop --usd` for the run's cost/);
  assert.match(flat, /`cost\.from` shows which was used/);
});

test('docs/runs.md says a stop with no --reason records stop: "unknown" (night 5 T42)', () => {
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /A `run\.stop` with no `reason` \(such as `laneboard run stop` with no `--reason`\) records `stop: "unknown"`/);
  assert.match(flat, /\| `stop` \| `--reason` \(left out, the line carries no reason and the run records `stop: "unknown"`\)/);
});

test('docs/runs.md says cost.rounds counts the cost events, not rounds, and is 0 with from rounds (night 5 T43)', () => {
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /`cost\.rounds` is the number of `cost` events, not a count of rounds: it is neither `counted` nor the rounds that carried a `round\.end` `usd`/);
  assert.match(flat, /shows `rounds: 0` next to `from: "rounds"`/);
});
