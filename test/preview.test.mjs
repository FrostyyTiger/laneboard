import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { previewFor, diffLines, cleanLine, splitLines, readForDiff, PREVIEW_LIMITS, capValue, stringifyBound, INPUT_CAP } from '../server/control/preview.mjs';

const dirs = [];
function tmp() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lb-preview-')));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const ts = (p) => p.lines.map((l) => l.t).join('');
const ss = (p) => p.lines.map((l) => l.s);

test('Edit gives the old lines as - and the new lines as +', () => {
  const p = previewFor('Edit', { file_path: '/x/a.js', old_string: 'a\nb', new_string: 'a\nc\nd' });
  assert.equal(p.kind, 'diff');
  assert.equal(p.truncated, false);
  assert.deepEqual(p.lines, [
    { t: '-', s: 'a' }, { t: '-', s: 'b' },
    { t: '+', s: 'a' }, { t: '+', s: 'c' }, { t: '+', s: 'd' },
  ]);
});

test('MultiEdit gives -/+ per edit with a label line', () => {
  const p = previewFor('MultiEdit', { file_path: '/x/a.js', edits: [
    { old_string: 'one', new_string: 'uno' },
    { old_string: 'two', new_string: 'dos' },
  ] });
  assert.equal(p.kind, 'diff');
  assert.equal(ts(p), ' -+ -+');
  assert.deepEqual(ss(p), ['edit 1/2', 'one', 'uno', 'edit 2/2', 'two', 'dos']);
});

test('Write on a missing file gives all +', () => {
  const d = tmp();
  const p = previewFor('Write', { file_path: path.join(d, 'new.txt'), content: 'x\ny\nz\n' }, { cwd: d });
  assert.equal(p.kind, 'diff');
  assert.equal(ts(p), '+++');
  assert.deepEqual(ss(p), ['x', 'y', 'z']);
  assert.equal(p.note, 'new-file');
});

test('Write on an existing file under cwd gives a line diff', () => {
  const d = tmp();
  const f = path.join(d, 'a.txt');
  fs.writeFileSync(f, 'a\nb\nc\nd\n');
  const p = previewFor('Write', { file_path: f, content: 'a\nB\nc\nd\ne\n' }, { cwd: d });
  assert.deepEqual(p.lines, [
    { t: ' ', s: 'a' }, { t: '-', s: 'b' }, { t: '+', s: 'B' }, { t: ' ', s: 'c' }, { t: ' ', s: 'd' }, { t: '+', s: 'e' },
  ]);
  // a relative file_path resolves against cwd
  const r = previewFor('Write', { file_path: 'a.txt', content: 'a\nb\nc\nd\n' }, { cwd: d });
  assert.equal(ts(r), '    ');
});

test('a path outside cwd is not read', () => {
  const outside = tmp();
  const cwd = tmp();
  const secret = path.join(outside, 'secret.txt');
  fs.writeFileSync(secret, 'TOP SECRET\n');
  const reads = [];
  const io = {
    realpath: (p) => fs.realpathSync.native(p),
    stat: (p) => fs.statSync(p),
    read: (p) => { reads.push(p); return fs.readFileSync(p, 'utf8'); },
  };
  const p = previewFor('Write', { file_path: secret, content: 'new\n' }, { cwd, io });
  assert.deepEqual(reads, []);
  assert.equal(p.note, 'outside-cwd');
  assert.deepEqual(p.lines, [{ t: '+', s: 'new' }]);
  assert.ok(!JSON.stringify(p).includes('TOP SECRET'));

  // `..` traversal and a symlink inside cwd pointing out are refused too
  const viaDots = previewFor('Write', { file_path: path.join(cwd, '..', path.basename(outside), 'secret.txt'), content: 'n' }, { cwd, io });
  assert.equal(viaDots.note, 'outside-cwd');
  fs.symlinkSync(secret, path.join(cwd, 'link.txt'));
  const viaLink = previewFor('Write', { file_path: path.join(cwd, 'link.txt'), content: 'n' }, { cwd, io });
  assert.equal(viaLink.note, 'outside-cwd');
  assert.deepEqual(reads, []);

  // the plan signature: a readFileSync-like function as the third argument, no cwd → no read
  const fnReads = [];
  const q = previewFor('Write', { file_path: secret, content: 'n' }, (p) => { fnReads.push(p); return ''; });
  assert.deepEqual(fnReads, []);
  assert.equal(q.note, 'no-cwd');
});

test('readForDiff refuses a cwd of / or HOME, non-files and big files', () => {
  const io = {
    realpath: (p) => p,
    stat: () => ({ isFile: () => true, size: 10 }),
    read: () => { throw new Error('must not read'); },
  };
  assert.equal(readForDiff('/etc/passwd', '/', io).note, 'cwd-too-broad');
  assert.equal(readForDiff(path.join(os.homedir(), '.bashrc'), os.homedir(), {
    ...io, realpath: (p) => p === os.homedir() ? fs.realpathSync(os.homedir()) : p,
  }).note, 'cwd-too-broad');
  assert.equal(readForDiff('rel', 'relative/cwd', io).note, 'no-cwd');
  assert.equal(readForDiff('/w/a', '/w', { ...io, stat: () => ({ isFile: () => false, size: 1 }) }).note, 'not-a-file');
  assert.equal(readForDiff('/w/a', '/w', { ...io, stat: () => ({ isFile: () => true, size: PREVIEW_LIMITS.maxFileBytes + 1 }) }).note, 'too-large');
  assert.equal(readForDiff('/w', '/w', io).note, 'outside-cwd'); // cwd itself is not a file under cwd
  const d = tmp();
  fs.mkdirSync(path.join(d, 'sub'));
  assert.equal(readForDiff(path.join(d, 'sub'), d).note, 'not-a-file');
});

test('a too-large existing file falls back to the first 80 lines as +', () => {
  const d = tmp();
  const f = path.join(d, 'big.txt');
  fs.writeFileSync(f, 'x'.repeat(PREVIEW_LIMITS.maxFileBytes + 10));
  const content = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  const p = previewFor('Write', { file_path: f, content }, { cwd: d });
  assert.equal(p.note, 'too-large');
  assert.equal(p.lines.length, 80);
  assert.ok(p.lines.every((l) => l.t === '+'));
  assert.equal(p.truncated, true);
});

test('Bash shows the command as text', () => {
  const p = previewFor('Bash', { command: 'rm -rf build\nls', description: 'clean\nup' });
  assert.equal(p.kind, 'text');
  assert.deepEqual(ss(p), ['# clean up', 'rm -rf build', 'ls']);
  assert.equal(ts(p), '   ');
});

test('other tools show indented JSON as text', () => {
  const p = previewFor('WebFetch', { url: 'https://example.invalid/' });
  assert.equal(p.kind, 'text');
  assert.deepEqual(ss(p), ['{', '  "url": "https://example.invalid/"', '}']);
  assert.deepEqual(previewFor('X', undefined).lines, [{ t: ' ', s: 'null' }]);
});

test('the caps hold: 300 lines by default, configurable, 16 KB, line length', () => {
  const many = Array.from({ length: 1000 }, (_, i) => `l${i}`).join('\n');
  const p = previewFor('Edit', { old_string: '', new_string: many });
  assert.equal(p.lines.length, 300);
  assert.equal(p.truncated, true);

  const q = previewFor('Edit', { old_string: '', new_string: many }, { maxLines: 10 });
  assert.equal(q.lines.length, 10);
  const hard = previewFor('Edit', { new_string: many }, { maxLines: 1e9 });
  assert.ok(hard.lines.length <= PREVIEW_LIMITS.hardMaxLines);

  const wide = Array.from({ length: 200 }, () => 'w'.repeat(500)).join('\n');
  const b = previewFor('Edit', { old_string: '', new_string: wide });
  const bytes = b.lines.reduce((n, l) => n + Buffer.byteLength(l.s) + 1, 0);
  assert.ok(bytes <= PREVIEW_LIMITS.maxBytes, `bytes ${bytes}`);
  assert.equal(b.truncated, true);

  const one = previewFor('Bash', { command: 'y'.repeat(50_000) });
  assert.equal(one.lines.length, 1);
  assert.ok(one.lines[0].s.length <= PREVIEW_LIMITS.maxLineChars);
  assert.equal(JSON.stringify(previewFor('Bash', { command: 'ok' })).length < 200, true);
});

test('untrusted text: control characters are neutralised, HTML is left as plain text', () => {
  const p = previewFor('Bash', { command: 'echo \u001b]52;c;ZXZpbA==\u0007 \u001b[31mred\u009b2J\r<script>x</script>\ttab' });
  const s = p.lines[0].s;
  assert.ok(!/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/.test(s), JSON.stringify(s));
  assert.ok(s.includes('<script>x</script>'), 'no HTML escaping here: the renderer uses textContent');
  assert.ok(s.includes('\ttab'), 'tab kept');
  assert.equal(cleanLine('a\u0000b'), 'a�b');
  // non-string fields do not throw
  assert.doesNotThrow(() => previewFor('Edit', { old_string: 5, new_string: { a: 1 } }));
  assert.doesNotThrow(() => previewFor('MultiEdit', { edits: 'nope' }));
  assert.doesNotThrow(() => previewFor('Write', { file_path: 7, content: null }, { cwd: '/nonexistent-dir-lb' }));
});

test('diffLines: LCS when small, - all / + all when either side exceeds 400 lines', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'c']), [{ t: ' ', s: 'a' }, { t: '-', s: 'b' }, { t: ' ', s: 'c' }]);
  assert.deepEqual(diffLines([], ['x']), [{ t: '+', s: 'x' }]);
  assert.deepEqual(diffLines(['x'], []), [{ t: '-', s: 'x' }]);
  const big = Array.from({ length: 401 }, (_, i) => String(i));
  const d = diffLines(big, ['0']);
  assert.equal(d.length, 402);
  assert.ok(d.slice(0, 401).every((l) => l.t === '-'));
  assert.equal(d[401].t, '+');
  // the diff reproduces both sides
  const a = ['p', 'q', 'r', 's', 't'];
  const b = ['q', 'x', 's', 't', 'u'];
  const out = diffLines(a, b);
  assert.deepEqual(out.filter((l) => l.t !== '+').map((l) => l.s), a);
  assert.deepEqual(out.filter((l) => l.t !== '-').map((l) => l.s), b);
});

test('splitLines drops one trailing newline and handles CRLF', () => {
  assert.deepEqual(splitLines('a\r\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('\n'), ['']);
});

// ------------------------------------------------- SR15 H1 ------------------

test('capValue keeps small inputs exactly and reports no truncation', () => {
  const v = { a: 1, b: [true, null, 'x'], c: { d: 'é😀' } };
  assert.deepEqual(capValue(v), { value: v, truncated: false });
  assert.deepEqual(capValue('s'), { value: 's', truncated: false });
  assert.deepEqual(capValue(undefined), { value: null, truncated: false });
});

test('capValue cuts depth, node count and characters, and never splits a surrogate pair', () => {
  let deep = 1;
  for (let i = 0; i < 50; i++) deep = [deep];
  const d = capValue(deep, { maxDepth: 3 });
  assert.equal(d.truncated, true);
  assert.deepEqual(d.value, [[['…']]]);

  const n = capValue(Array.from({ length: 100 }, (_, i) => i), { maxNodes: 10 });
  assert.equal(n.truncated, true);
  assert.ok(n.value.length <= 11);
  assert.equal(n.value.at(-1), '…');

  const c = capValue({ s: 'a😀cd' }, { maxChars: 4 });
  assert.equal(c.truncated, true);
  assert.equal(c.value.s, 'a…'); // 's' key costs 1, the pair is not split

  const k = capValue({ ['k'.repeat(100)]: 1 }, { maxChars: 10 });
  assert.equal(k.truncated, true);
  assert.ok(Object.keys(k.value)[0].length <= 10);
});

test('capValue survives getters, bigint and functions without throwing', () => {
  const evil = { get boom() { throw new Error('x'); }, big: 10n, fn() {}, ok: 1 };
  const r = capValue(evil);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.value, { big: null, ok: 1 });
});

test('stringifyBound holds for adversarial shapes (deep, wide, escapes)', () => {
  const bound = stringifyBound();
  let deep = [];
  for (let i = 0; i < 10_000; i++) deep = [deep, '\u0001'.repeat(10)];
  const wide = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`\u0002${i}`, -1.2345678901234567e-300]));
  for (const v of [deep, wide, { s: '\u001f'.repeat(100_000) }, Array(100_000).fill({})]) {
    const len = JSON.stringify(capValue(v).value, null, 2).length;
    assert.ok(len <= bound, `${len} > ${bound}`);
  }
  assert.ok(INPUT_CAP.maxDepth <= 32);
});

test('the JSON preview of a huge or deeply nested input is capped and marked truncated', () => {
  let deep = [];
  for (let i = 0; i < 100_000; i++) deep = [deep];
  for (const input of [deep, { blob: 'x\n'.repeat(500_000) }]) {
    const p = previewFor('mcp__acme__do', input);
    assert.equal(p.truncated, true);
    assert.ok(p.lines.length <= PREVIEW_LIMITS.maxLines);
  }
});

test('splitLines with a limit stops early; Edit/Bash/MultiEdit previews of huge text stay capped', () => {
  assert.deepEqual(splitLines('a\nb\nc\nd', 2), ['a', 'b']);
  assert.deepEqual(splitLines('a\nb\n', 5), ['a', 'b']);
  const huge = 'l\n'.repeat(200_000);
  for (const [tool, input] of [
    ['Edit', { old_string: huge, new_string: huge }],
    ['Bash', { command: huge, description: 'd'.repeat(100_000) }],
    ['MultiEdit', { edits: Array.from({ length: 5000 }, () => ({ old_string: 'a', new_string: 'b' })) }],
    ['Write', { file_path: 'nope.txt', content: huge }],
  ]) {
    const p = previewFor(tool, input, { maxLines: 50 });
    assert.equal(p.truncated, true, tool);
    assert.ok(p.lines.length <= 50, tool);
  }
  // A non-string field is not Array#join-ed into text.
  assert.deepEqual(previewFor('Bash', { command: ['a', 'b'] }).lines, []);
});
