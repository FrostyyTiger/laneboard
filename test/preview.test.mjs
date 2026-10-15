import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { previewFor, diffLines, cleanLine, splitLines, readForDiff, PREVIEW_LIMITS } from '../server/control/preview.mjs';

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
