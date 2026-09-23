// Markers — the lines a lane prints when it wants something from a human.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyLine, scanText, stripLinePrefix, stripWatchLogPrefix,
  record, _reset, keyOf, watchLogPaths, cleanMarkerText, looksLikeCode,
} from '../server/collector/markers.mjs';
import { listMarkers } from '../server/db.mjs';

const FIX = path.resolve(import.meta.dirname, 'fixtures/lane');

test('every marker the lanes are told to print is recognised', () => {
  const kinds = {
    'NEED-HUMAN: decide the palette': 'need',
    'NEED-HUMAN: sign the contract': 'need',
    'NEED-OWNER: open a browser': 'need',
    'BLOCKED: waiting on a token': 'blocked',
    'STAGE-DONE: stage 4': 'done',
    'LANE-DONE: everything shipped': 'done',
    'PROGRESS: Stage 3 done': 'progress',
  };
  for (const [line, kind] of Object.entries(kinds)) {
    assert.equal(classifyLine(line)?.kind, kind, line);
  }
});

test('a marker survives the bullet a TUI puts in front of it', () => {
  for (const prefix of ['● ', '> ', '  ', '│ ', '[32m● [0m']) {
    assert.equal(classifyLine(`${prefix}NEED-HUMAN: hi`)?.kind, 'need', JSON.stringify(prefix));
  }
});

test('the anchor is what keeps a lane from marking its own instructions', () => {
  // The real false positive, from ~/horizon-v1-watch.log: the watcher echoes
  // the prompt, which quotes the markers inside backticks. Anchoring after only
  // whitespace and bullets rejects it — a backtick is neither.
  const quoted = 'MARKER `PROGRESS: <stage> — <what is green>`. Blocked on a human? `NEED-HUMAN: <what>`';
  assert.equal(classifyLine(quoted), null);
  // And this very repository's config, which lists the patterns as data.
  assert.equal(classifyLine("  { kind: 'blocked', source: 'BLOCKED', anchored: true },"), null);
  // Prose is not a marker either.
  assert.equal(classifyLine('we need a human to look at this'), null);
  assert.equal(classifyLine('the build is blocked on something'), null);
});

test('markers are case-sensitive, because they are typed tokens', () => {
  assert.equal(classifyLine('need-human: lower case'), null);
  assert.equal(classifyLine('Blocked: capitalised prose'), null);
  assert.equal(classifyLine('NEED-HUMAN: right')?.kind, 'need', 'the exact token still matches');
});

test('a marker needs its colon', () => {
  assert.equal(classifyLine('BLOCKED by the network'), null);
  assert.equal(classifyLine('PROGRESS report'), null);
});

test('rate-limit phrases are matched anywhere in a line, case-insensitively', () => {
  // These are prose Claude prints mid-sentence, so they cannot anchor.
  for (const line of [
    "You've hit your limit for the 5 hour window",
    'Approaching your usage limit',
    'the API returned a rate limit error',
    'HIT YOUR LIMIT',
  ]) {
    assert.equal(classifyLine(line)?.kind, 'limit', line);
  }
});

test('the watch log prefix is stripped before matching', () => {
  const line = '2026-09-04 21:18:43 MARKER ● PROGRESS: Stage 0 done — plan committed';
  assert.equal(stripWatchLogPrefix(line), '● PROGRESS: Stage 0 done — plan committed');
  assert.equal(classifyLine(stripWatchLogPrefix(line))?.kind, 'progress');
  // A watchdog's own bookkeeping is not a marker.
  const noise = '2026-09-04 21:38:44 IDLE for ~10 min with no spinner — nudging';
  assert.equal(classifyLine(stripWatchLogPrefix(noise)), null);
});

test('the real watch-log fixture yields exactly one marker', () => {
  // Named .txt, not .log: .gitignore excludes *.log, so a fixture called
  // watch.log passed here and was missing from a fresh clone. The fresh-clone
  // check in stage 8 is what found it.
  const lines = fs.readFileSync(path.join(FIX, 'watchlog.txt'), 'utf8').split('\n');
  const hits = lines.map((l) => classifyLine(stripWatchLogPrefix(l))).filter(Boolean);
  assert.equal(hits.length, 1, `expected one marker, got ${JSON.stringify(hits)}`);
  assert.equal(hits[0].kind, 'progress');
  assert.match(hits[0].text, /Stage 0 done/);
});

test('scanText finds every marker in a multi-line assistant message', () => {
  const hits = scanText([
    'I finished the work.',
    'PROGRESS: Stage 2 done — the tiles load',
    'but there is a problem:',
    'NEED-HUMAN: which palette?',
  ].join('\n'));
  assert.deepEqual(hits.map((h) => h.kind), ['progress', 'need']);
});

test('stripLinePrefix removes ANSI, so a coloured pane still matches', () => {
  // capture-pane -e colours each word separately; matching must run on the
  // stripped string or the phrase arrives fragmented (v1 status, C3).
  assert.equal(stripLinePrefix('[32mNEED-HUMAN:[39m [37mhi'), 'NEED-HUMAN: hi');
});

test('a marker is stored once, however many times it is re-read', () => {
  _reset();
  const one = { lane: 'horizon-v1', sessionName: 'horizon-v1', kind: 'need', text: 'NEED-HUMAN: x', source: 'pane' };
  const first = record(one);
  assert.ok(first, 'the first sighting is recorded');
  assert.equal(record(one), null, 'the second is not');
  assert.equal(record({ ...one, source: 'watchlog' }), null, 'nor the same line from another source');
});

test('a session with no lane does not insert a fresh row every tick', () => {
  // SQLite treats two NULLs as distinct in a UNIQUE index, so the index uses
  // IFNULL. Without that, machine-cleanup would have written a row every 2 s.
  _reset();
  const m = { lane: null, sessionName: 'machine-cleanup', kind: 'done', text: 'CLEANUP-DONE: six', source: 'pane' };
  assert.ok(record(m));
  assert.equal(record(m), null);
  const rows = listMarkers({ limit: 1000 }).filter((r) => r.text === 'CLEANUP-DONE: six');
  assert.equal(rows.length, 1);
});

test('the marker key is unambiguous', () => {
  // A space separator would let lane "a" + session "b c" collide with lane
  // "a b" + session "c".
  assert.notEqual(keyOf('a', 'b c', 't'), keyOf('a b', 'c', 't'));
});

test('both watch-log layouts are tried, new one first', () => {
  const paths = watchLogPaths('horizon-v1');
  assert.equal(paths.length, 2);
  assert.match(paths[0], /lanes\/horizon-v1\/watch\.log$/);
  assert.match(paths[1], /horizon-v1-watch\.log$/);
  assert.deepEqual(watchLogPaths(null), []);
});

// --- what a real captured pane row actually looks like -----------------------
//
// These two strings are copied from live rows on this box, 2026-09-04. A
// capture-pane row is a SCREEN row and Claude Code renders columns, so one row
// holds a marker on the left and something else entirely on the right.

const ROW_A = "NEED-HUMAN: pdftotext isn't installed (in poppler-utils), so PDFs are filed "
  + "from their name alone — installing a package is      13 +     * Panels, not tiles.";
const ROW_B = "NEED-HUMAN: pdftotext isn't installed (in poppler-utils), so PDFs are filed "
  + "from their name alone — installing a package is      14 +       drop to 2 px.";
const ROW_CODE = "8 import path from 'node:path';                88      "
  + '{ kind: \'limit\', source: "hit your limit|usage limit|rate limit" }';

test('one marker on two differently-wrapped rows is ONE marker', () => {
  // Before this, ten near-identical rows were stored for a single NEED-HUMAN,
  // because the right-hand column changed between captures and the dedupe key
  // is the text.
  const a = classifyLine(ROW_A);
  const b = classifyLine(ROW_B);
  assert.equal(a.kind, 'need');
  assert.equal(a.text, b.text, 'the column that shares the row must be cut off');
  assert.ok(!a.text.includes('Panels'), 'nothing from the right-hand column survives');
  _reset();
  assert.ok(record({ lane: null, sessionName: 's', kind: a.kind, text: a.text, source: 'pane' }));
  assert.equal(record({ lane: null, sessionName: 's', kind: b.kind, text: b.text, source: 'pane' }), null);
});

test("a line of this repository's own source is not a rate-limit marker", () => {
  // The unanchored phrases would otherwise fire on any file that mentions
  // them — including the file that defines them.
  assert.equal(classifyLine(ROW_CODE), null);
  assert.equal(looksLikeCode(ROW_CODE), true);
  for (const code of [
    "const re = /hit your limit/;",
    "  if (x) { return 'usage limit'; }",
    "42 +   // rate limit handling",
    "export const LIMITS = ['rate limit'];",
  ]) {
    assert.equal(classifyLine(code), null, code);
  }
});

test('real prose about a limit still registers', () => {
  // The guard must not cost the signal it exists to protect.
  for (const line of [
    "You've hit your limit for the 5 hour window",
    'Approaching your usage limit — work will pause until 01:00',
    'The API returned a rate limit error and the run stopped',
  ]) {
    assert.equal(classifyLine(line)?.kind, 'limit', line);
    assert.equal(looksLikeCode(line), false, line);
  }
});

test('cleanMarkerText cuts at a column gap and collapses the rest', () => {
  assert.equal(cleanMarkerText('BLOCKED: waiting      99 + other column'), 'BLOCKED: waiting');
  assert.equal(cleanMarkerText('PROGRESS:  two  spaces  are  fine'), 'PROGRESS: two spaces are fine');
  assert.equal(cleanMarkerText('   padded   '), 'padded');
  assert.equal(cleanMarkerText(''), '');
});

test('an anchored marker is NOT subject to the code guard', () => {
  // A lane is entitled to say NEED-HUMAN about a semicolon.
  const line = 'NEED-HUMAN: should config.mjs export const LIMITS = [];';
  assert.equal(classifyLine(line)?.kind, 'need');
});

test('an unchanged pane is not rescanned', async () => {
  // Joining and regex-scanning 40 lines per session per 2 s tick was the
  // largest new allocation v2 put on the hot path: a 20-minute soak walked RSS
  // from 125 MB to 181 MB with the JS heap flat the whole time.
  const { paneChanged } = await import('../server/state.mjs');
  const lines = ['one', 'two', 'three'];
  assert.equal(paneChanged('s1', lines), true, 'first sight always scans');
  assert.equal(paneChanged('s1', lines), false, 'unchanged costs nothing');
  assert.equal(paneChanged('s1', [...lines, 'four']), true, 'a new line is a change');
  assert.equal(paneChanged('s1', ['one', 'two', 'CHANGED']), true, 'a rewritten last line too');
  // Two sessions with identical content are tracked separately.
  assert.equal(paneChanged('s2', ['one', 'two', 'CHANGED']), true);
  assert.equal(paneChanged('s1', []), true);
  assert.equal(paneChanged('s1', []), false);
});
