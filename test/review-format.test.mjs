import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReview, pullCommands, shq, cleanText, cleanLine, fitsInline, reviewPointer,
  ReviewFormatError, DEFAULT_INLINE_MAX_CHARS, MAX_QUOTE_LINES, MAX_QUOTE_LINE_CHARS, MAX_BODY_CHARS,
} from '../public/js/core/review-format.js';
// Same rule as server/actions.mjs shellQuote (not imported: that module loads config).
const shellQuote = (v) => "'" + String(v).split("'").join("'\\''") + "'";

const base = {
  lane: 'feat-x', branch: 'feat/x', base: 'origin/main',
  mergeBase: 'ab12cd3ffffffffffffffffffffffffffffffff0', headSha: 'ef45678000000000000000000000000000000000',
};

test('formatReview: snapshot', () => {
  const text = formatReview({
    ...base,
    comments: [
      { path: 'src/b.js', side: 'new', line: 3, quote: ['let y = 1;'], body: 'Use const.' },
      { path: 'src/a.js', side: 'new', line: 42, endLine: 44, quote: ['const x = y;'], body: 'Rename x; it shadows the import.' },
      { path: 'src/a.js', side: 'old', line: 7, quote: [], body: 'Why was this removed?\nIt was used by `init()`.' },
    ],
  });
  assert.equal(text, [
    'REVIEW of feat/x (origin/main @ ab12cd3 .. ef45678), 3 comments.',
    'Address each comment, commit, then print DONE: or NEED-HUMAN:.',
    '',
    '1. src/a.js:7 (old)',
    '   Why was this removed?',
    '   It was used by `init()`.',
    '',
    '2. src/a.js:42-44',
    '   > const x = y;',
    '   Rename x; it shadows the import.',
    '',
    '3. src/b.js:3',
    '   > let y = 1;',
    '   Use const.',
    '',
  ].join('\n'));
});

test('formatReview: singular, note, no comments', () => {
  const one = formatReview({ ...base, comments: [{ path: 'a', line: 1, quote: [], body: 'x' }], note: 'Overall fine.\r\nShip it.' });
  assert.match(one, /, 1 comment\.\n/);
  assert.match(one, /\n\nOverall fine\.\nShip it\.\n\n1\. a:1\n/);
  const none = formatReview({ ...base, comments: [] });
  assert.match(none, /, 0 comments\./);
});

test('formatReview: sort order by path, then line (stable)', () => {
  const comments = [
    { path: 'z.js', line: 1, body: 'z1' },
    { path: 'a.js', line: 10, body: 'a10' },
    { path: 'a.js', line: 2, body: 'a2-first' },
    { path: 'a.js', line: 2, body: 'a2-second' },
    { path: 'B.js', line: 5, body: 'B5' },
  ];
  const text = formatReview({ ...base, comments });
  const order = [...text.matchAll(/^   (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['B5', 'a2-first', 'a2-second', 'a10', 'z1']);
  assert.match(text, /^1\. B\.js:5$/m);
  assert.match(text, /^5\. z\.js:1$/m);
});

test('formatReview: quote capping (lines and chars)', () => {
  const quote = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  quote[0] = 'x'.repeat(500);
  const text = formatReview({ ...base, comments: [{ path: 'a', line: 1, quote, body: 'b' }] });
  const qlines = text.split('\n').filter((l) => l.startsWith('   > '));
  assert.equal(qlines.length, MAX_QUOTE_LINES + 1);
  assert.equal(qlines[0].length, 5 + MAX_QUOTE_LINE_CHARS);
  assert.ok(qlines[0].endsWith('…'));
  assert.equal(qlines.at(-1), '   > … (8 more lines)');
  assert.ok(!text.includes('line 12'));
});

test('formatReview: body capped', () => {
  const text = formatReview({ ...base, comments: [{ path: 'a', line: 1, body: 'y'.repeat(5000) }] });
  assert.equal(text.match(/y+/)[0].length, MAX_BODY_CHARS - 1);
});

test('formatReview: quotes from the diff are untrusted: escapes and controls stripped, backticks kept', () => {
  const evil = '\x1b]52;c;ZWNobyBwd25lZA==\x07`rm -rf` \x1b[31mred\x1b[0m‮txt.exe\u0085\x7f';
  const text = formatReview({
    ...base, branch: 'feat/\x1b[2Jx',
    comments: [{ path: 'a', line: 1, quote: [evil, 'two\nlines\rhere'], body: 'ok\x1b[1m\r\nbold\x00' }],
  });
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f‪-‮]/.test(text), JSON.stringify(text));
  assert.ok(text.includes('`rm -rf`'));
  assert.ok(text.includes('   > two lines here'));
  assert.ok(text.includes('   ok[1m\n   bold'));
  assert.ok(text.startsWith('REVIEW of feat/[2Jx '));
});

test('formatReview: paths validated', () => {
  const c = (o) => ({ ...base, comments: [{ path: 'a.js', line: 1, body: 'b', ...o }], files: ['a.js'] });
  assert.doesNotThrow(() => formatReview(c({})));
  assert.throws(() => formatReview(c({ path: 'other.js' })), ReviewFormatError);
  assert.throws(() => formatReview({ ...c({}), files: new Set(['x']) }), /not in the diff/);
  assert.throws(() => formatReview(c({ path: 'a\x1b.js' })), ReviewFormatError);
  assert.throws(() => formatReview(c({ path: '' })), ReviewFormatError);
  assert.throws(() => formatReview(c({ line: 0 })), ReviewFormatError);
  assert.throws(() => formatReview(c({ line: 1.5 })), ReviewFormatError);
  assert.throws(() => formatReview(c({ endLine: 0 })), ReviewFormatError);
  assert.throws(() => formatReview(c({ side: 'both' })), ReviewFormatError);
  const many = Array.from({ length: 101 }, () => ({ path: 'a.js', line: 1, body: 'b' }));
  assert.throws(() => formatReview({ ...base, comments: many }), /at most 100/);
});

test('cleanText / cleanLine', () => {
  assert.equal(cleanText('a\r\nb\rc\td\x1b\x9b'), 'a\nb\nc\td');
  assert.equal(cleanLine('a\nb\tc'), 'a b c');
  assert.equal(cleanText(null), '');
});

test('fitsInline and reviewPointer', () => {
  assert.equal(DEFAULT_INLINE_MAX_CHARS, 7000);
  assert.equal(fitsInline('x'.repeat(7000)), true);
  assert.equal(fitsInline('x'.repeat(7001)), false);
  assert.equal(fitsInline('x'.repeat(11), 10), false);
  assert.equal(
    reviewPointer(3, '/home/u/lanes/l1/reviews/1700000000000.md'),
    'REVIEW with 3 comments is in /home/u/lanes/l1/reviews/1700000000000.md. Read it fully, address each comment, commit, then print DONE:.',
  );
  assert.match(reviewPointer(1, '/x.md'), /^REVIEW with 1 comment is in/);
  assert.throws(() => reviewPointer(3, 'relative.md'), ReviewFormatError);
  assert.throws(() => reviewPointer(3, '/x\x1b[2J.md'), ReviewFormatError);
  assert.throws(() => reviewPointer(-1, '/x.md'), ReviewFormatError);
});

test('shq matches the actions.shellQuote rule', () => {
  for (const s of ["it's", '$(id)', '`id`', 'a b', '', "''", '\\']) assert.equal(shq(s), shellQuote(s));
  assert.equal(shq("a'b"), "'a'\\''b'");
  assert.equal(shq('$(id)'), "'$(id)'");
});

const good = { repo: 'web', branch: 'feat/x', laneId: 'web-feat-x', pr: 12, ciRepo: 'acme/web' };

test('pullCommands: remote branch + PR', () => {
  assert.deepEqual(pullCommands(good), [
    {
      label: 'Fetch the branch into a new worktree',
      cmd: "git fetch origin 'feat/x' && git worktree add --track -b 'feat/x' '../web-web-feat-x' 'origin/feat/x'",
    },
    { label: 'Check out PR #12', cmd: "gh pr checkout 12 --repo 'acme/web'" },
  ]);
});

test('pullCommands: local branch, no PR', () => {
  assert.deepEqual(pullCommands({ repo: 'web', branch: 'feat/x', laneId: 'l1', local: true }), [
    { label: 'Worktree from the local branch', cmd: "git worktree add '../web-l1' 'feat/x'" },
  ]);
  assert.equal(pullCommands({ ...good, ciRepo: undefined }).length, 1);
  assert.equal(pullCommands({ ...good, pr: null }).length, 1);
  assert.equal(pullCommands({ ...good, pr: '7' })[1].cmd, "gh pr checkout 7 --repo 'acme/web'");
});

test('pullCommands: every bad input yields no command at all', () => {
  const bad = [
    { branch: '--upload-pack=x' },
    { branch: '-x' },
    { branch: 'a..b' },
    { branch: 'a;b' },
    { branch: "it's" },
    { branch: '$(id)' },
    { branch: 'feat/`id`' },
    { branch: 'a b' },
    { branch: 'feat/\x1b]52;c;aWQ=\x07' },
    { branch: 'feat/x\n' },
    { branch: 'feat/‮x' },
    { branch: '' },
    { branch: 'a/' },
    { branch: 'a.lock' },
    { branch: 42 },
    { branch: undefined },
    { repo: '$(id)' },
    { repo: '-x' },
    { repo: '..' },
    { repo: 'a/b' },
    { repo: undefined },
    { laneId: '../x' },
    { laneId: 'X' },
    { laneId: 'a\x1bb' },
    { laneId: undefined },
    { pr: '1;id' },
    { pr: 0 },
    { pr: -1 },
    { pr: 1.5 },
    { pr: '01' },
    { pr: NaN },
    { ciRepo: 'a/b c' },
    { ciRepo: 'a/b;id' },
    { ciRepo: '-a/b' },
    { ciRepo: 'a/b/c' },
    { ciRepo: 'a/$(id)' },
    { ciRepo: 'a/..' },
  ];
  for (const o of bad) assert.deepEqual(pullCommands({ ...good, ...o }), [], JSON.stringify(o));
  assert.deepEqual(pullCommands(), []);
});

test('pullCommands: output never contains control characters', () => {
  for (const cmd of pullCommands(good).map((c) => c.cmd)) assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(cmd));
});
