// Transcript tail by byte offset (fleet R4, server/review/transcript.mjs).
// Uses only the synthetic fixture under test/fixtures/transcript/ and temp
// copies of it; never a real ~/.claude transcript.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  tailTranscript, entriesFromLine, summarizeToolInput, cleanText,
  resolveTranscriptFile, TranscriptError,
} from '../server/review/transcript.mjs';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'transcript', 'session.jsonl');
const RAW = fs.readFileSync(FIXTURE);

/** Byte offsets of every complete line's first byte in a buffer. */
function lineStarts(buf) {
  const out = [0];
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a && i + 1 < buf.length) out.push(i + 1);
  return out;
}
const STARTS = lineStarts(RAW);
const LAST_NL = RAW.lastIndexOf(0x0a) + 1; // end of the last whole line

function tmpProjects() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-transcript-'));
  const proj = path.join(root, 'projects');
  fs.mkdirSync(path.join(proj, '-home-user-acme'), { recursive: true });
  const file = path.join(proj, '-home-user-acme', 'sess.jsonl');
  fs.copyFileSync(FIXTURE, file);
  return { root, proj, file, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('fixture sanity: multi-byte UTF-8 and a trailing partial line', () => {
  assert.ok(RAW.toString('utf8').length < RAW.length, 'multi-byte characters present');
  assert.notEqual(RAW[RAW.length - 1], 0x0a, 'ends with a partial line');
  assert.equal(STARTS.length, 10); // 9 whole lines + the partial one
});

test('full backward read maps every line kind and drops thinking/malformed/other types', async () => {
  const r = await tailTranscript({ file: FIXTURE });
  assert.equal(r.size, RAW.length);
  assert.equal(r.reset, false);
  assert.equal(r.startOffset, 0);
  assert.equal(r.endOffset, LAST_NL, 'partial line excluded');
  assert.deepEqual(r.entries.map((e) => e.role), ['system', 'user', 'tool_use', 'tool_result', 'assistant', 'user']);
  assert.deepEqual(r.entries.map((e) => e.off), [STARTS[0], STARTS[1], STARTS[3], STARTS[4], STARTS[6], STARTS[8]]);
  const [summary, user, toolUse, toolResult, assistant, user2] = r.entries;
  assert.equal(summary.text, 'Fixing the acme build');
  assert.equal(summary.ts, null);
  assert.match(user.text, /naïve café ✓ 🙂/);
  assert.equal(user.ts, '2026-01-01T00:00:01.000Z');
  assert.equal(toolUse.tool, 'Bash');
  assert.equal(toolUse.text, 'npm test');
  assert.equal(toolResult.isError, true);
  assert.equal(toolResult.text, 'Exit code 1\nTest failed');
  assert.equal(user2.text, 'Thanks,\nnow commit it');
  // ANSI stripped, HTML left literal (escaping is the renderer's job)
  assert.equal(assistant.text, 'Found it: <img src=x onerror=alert(1)> and red text');
  assert.ok(!r.entries.some((e) => /secret reasoning/.test(e.text)), 'thinking dropped');
  assert.ok(!r.entries.some((e) => /partial/.test(e.text)));
});

test('backward limit=3 returns the last 3 entries at their real byte offsets', async () => {
  const r = await tailTranscript({ file: FIXTURE, limit: 3 });
  assert.deepEqual(r.entries.map((e) => e.role), ['tool_result', 'assistant', 'user']);
  assert.deepEqual(r.entries.map((e) => e.off), [STARTS[4], STARTS[6], STARTS[8]]);
  for (const e of r.entries) {
    // the line at `off` really is that entry's JSON line
    const line = RAW.subarray(e.off, RAW.indexOf(0x0a, e.off)).toString('utf8');
    assert.ok(JSON.parse(line).timestamp === e.ts);
  }
  assert.equal(r.startOffset, STARTS[4]);
  assert.equal(r.endOffset, LAST_NL);
});

test('before=startOffset pages back with no overlap or gap', async () => {
  const all = await tailTranscript({ file: FIXTURE });
  const seen = [];
  let before = null;
  for (let i = 0; i < 10; i++) {
    const r = await tailTranscript({ file: FIXTURE, before, limit: 2 });
    assert.ok(r.entries.length <= 2);
    seen.unshift(...r.entries);
    if (r.startOffset === 0) break;
    assert.ok(before === null || r.startOffset < before);
    before = r.startOffset;
  }
  assert.deepEqual(seen, all.entries);
});

test('small chunks: maxBytes stops the backward scan but paging still covers everything', async () => {
  const all = await tailTranscript({ file: FIXTURE });
  const seen = [];
  let before = null;
  for (let i = 0; i < 50; i++) {
    const r = await tailTranscript({ file: FIXTURE, before, maxBytes: 1 });
    seen.unshift(...r.entries);
    if (r.startOffset === 0) break;
    before = r.startOffset;
  }
  // maxBytes=1 still reads one 64 KiB chunk, so this finishes in one page;
  // the point is that it terminates and loses nothing.
  assert.deepEqual(seen, all.entries);
});

test('after=endOffset returns exactly the appended lines; a partial line waits for its newline', async () => {
  const t = tmpProjects();
  try {
    const r0 = await tailTranscript({ file: t.file });
    assert.equal(r0.endOffset, LAST_NL);
    // Nothing new yet: the partial line is not returned.
    const r1 = await tailTranscript({ file: t.file, after: r0.endOffset });
    assert.deepEqual(r1.entries, []);
    assert.equal(r1.endOffset, r0.endOffset);
    // Complete the partial line: it was cut mid-JSON, so it is malformed and
    // yields nothing, but the offset moves past it.
    fs.appendFileSync(t.file, '\n');
    const two = [
      { type: 'assistant', timestamp: '2026-01-01T00:01:00.000Z', message: { content: [{ type: 'text', text: 'Committed ✓' }] } },
      { type: 'assistant', timestamp: '2026-01-01T00:01:01.000Z', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/home/user/acme/a.js' } }] } },
    ];
    const before = fs.statSync(t.file).size;
    fs.appendFileSync(t.file, two.map((o) => JSON.stringify(o)).join('\n') + '\n' + '{"type":"user","mess');
    const r2 = await tailTranscript({ file: t.file, after: r0.endOffset });
    assert.deepEqual(r2.entries.map((e) => [e.role, e.text]), [['assistant', 'Committed ✓'], ['tool_use', '/home/user/acme/a.js']]);
    assert.equal(r2.entries[0].off, before);
    assert.equal(r2.startOffset, r0.endOffset);
    const buf = fs.readFileSync(t.file);
    assert.equal(r2.endOffset, buf.lastIndexOf(0x0a) + 1);
    // finish the new partial line
    fs.appendFileSync(t.file, 'age":{"content":"go on"}}\n');
    const r3 = await tailTranscript({ file: t.file, after: r2.endOffset });
    assert.deepEqual(r3.entries.map((e) => [e.role, e.text, e.off]), [['user', 'go on', r2.endOffset]]);
    assert.equal(r3.endOffset, fs.statSync(t.file).size);
    // forward limit
    const r4 = await tailTranscript({ file: t.file, after: 0, limit: 2 });
    assert.deepEqual(r4.entries.map((e) => e.role), ['system', 'user']);
    assert.equal(r4.endOffset, STARTS[2]);
    // Truncation: the old offset is past the end now.
    fs.truncateSync(t.file, 10);
    const r5 = await tailTranscript({ file: t.file, after: r3.endOffset });
    assert.equal(r5.reset, true);
    assert.deepEqual(r5.entries, []);
    const r6 = await tailTranscript({ file: t.file, before: r3.endOffset });
    assert.equal(r6.reset, true);
  } finally {
    t.cleanup();
  }
});

test('a line longer than maxBytes is skipped in both directions instead of sticking', async () => {
  const t = tmpProjects();
  try {
    const big = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(200 * 1024) } });
    const small = JSON.stringify({ type: 'user', message: { content: 'after big' } });
    fs.writeFileSync(t.file, JSON.stringify({ type: 'user', message: { content: 'first' } }) + '\n' + big + '\n' + small + '\n');
    const bigOff = fs.readFileSync(t.file).indexOf(0x0a) + 1;
    const f1 = await tailTranscript({ file: t.file, after: bigOff, maxBytes: 1024 });
    assert.deepEqual(f1.entries.map((e) => [e.role, e.off, e.truncated]), [['system', bigOff, true]]);
    assert.equal(f1.endOffset, bigOff + big.length + 1);
    const f2 = await tailTranscript({ file: t.file, after: f1.endOffset, maxBytes: 1024 });
    assert.deepEqual(f2.entries.map((e) => e.text), ['after big']);

    const b1 = await tailTranscript({ file: t.file, maxBytes: 1024 });
    assert.deepEqual(b1.entries.map((e) => e.text), ['after big']);
    const b2 = await tailTranscript({ file: t.file, before: b1.startOffset, maxBytes: 1024 });
    assert.deepEqual(b2.entries.map((e) => [e.role, e.off]), [['system', bigOff]]);
    assert.equal(b2.startOffset, bigOff);
    const b3 = await tailTranscript({ file: t.file, before: b2.startOffset, maxBytes: 1024 });
    assert.deepEqual(b3.entries.map((e) => e.text), ['first']);
    assert.equal(b3.startOffset, 0);
  } finally {
    t.cleanup();
  }
});

test('text is capped with truncated:true; caps are clamped to the config LIMITS', async () => {
  const r = await tailTranscript({ file: FIXTURE, textCap: 5 });
  const user = r.entries.find((e) => e.role === 'user');
  assert.equal(user.text, 'Pleas');
  assert.equal(user.truncated, true);
  assert.ok(!('truncated' in (await tailTranscript({ file: FIXTURE })).entries[0]));
  const huge = await tailTranscript({ file: FIXTURE, limit: 1e9, maxBytes: 1e12, textCap: 1e9 });
  assert.equal(huge.entries.length, 6);
  const tiny = await tailTranscript({ file: FIXTURE, limit: 0 });
  assert.equal(tiny.entries.length, 1, 'limit clamps to at least 1');
});

test('bad offsets are rejected; missing files are 404', async () => {
  await assert.rejects(tailTranscript({ file: FIXTURE, after: -1 }), (e) => e instanceof TranscriptError && e.status === 400);
  await assert.rejects(tailTranscript({ file: FIXTURE, before: 'abc' }), (e) => e.status === 400);
  await assert.rejects(tailTranscript({ file: FIXTURE, after: 1.5 }), (e) => e.status === 400);
  const ok = await tailTranscript({ file: FIXTURE, after: String(STARTS[8]) });
  assert.deepEqual(ok.entries.map((e) => e.role), ['user']);
  await assert.rejects(tailTranscript({ file: '/nonexistent/x.jsonl' }), (e) => e.status === 404);
  await assert.rejects(tailTranscript({}), (e) => e.status === 404);
});

test('resolveTranscriptFile: only .jsonl files inside projectsDir, no symlink escape', async () => {
  const t = tmpProjects();
  try {
    const real = await resolveTranscriptFile(t.file, t.proj);
    assert.equal(real, fs.realpathSync(t.file));
    // via a symlinked projectsDir is fine: both sides are realpath'd
    const linkedRoot = path.join(t.root, 'projects-link');
    fs.symlinkSync(t.proj, linkedRoot);
    assert.equal(await resolveTranscriptFile(path.join(linkedRoot, '-home-user-acme', 'sess.jsonl'), linkedRoot), real);

    const outside = path.join(t.root, 'outside.jsonl');
    fs.copyFileSync(FIXTURE, outside);
    const is404 = (e) => e instanceof TranscriptError && e.status === 404;
    await assert.rejects(resolveTranscriptFile(outside, t.proj), is404);
    await assert.rejects(resolveTranscriptFile(path.join(t.proj, '..', 'outside.jsonl'), t.proj), is404);
    const escape = path.join(t.proj, '-home-user-acme', 'escape.jsonl');
    fs.symlinkSync(outside, escape);
    await assert.rejects(resolveTranscriptFile(escape, t.proj), is404);
    const dirEscape = path.join(t.proj, 'dir-link');
    fs.symlinkSync(t.root, dirEscape);
    await assert.rejects(resolveTranscriptFile(path.join(dirEscape, 'outside.jsonl'), t.proj), is404);
    const notJsonl = path.join(t.proj, '-home-user-acme', 'notes.txt');
    fs.writeFileSync(notJsonl, 'x');
    await assert.rejects(resolveTranscriptFile(notJsonl, t.proj), is404);
    const dir = path.join(t.proj, 'd.jsonl');
    fs.mkdirSync(dir);
    await assert.rejects(resolveTranscriptFile(dir, t.proj), is404);
    await assert.rejects(resolveTranscriptFile(t.proj, t.proj), is404);
    await assert.rejects(resolveTranscriptFile(path.join(t.proj, 'missing.jsonl'), t.proj), is404);
    await assert.rejects(resolveTranscriptFile('', t.proj), is404);
    await assert.rejects(resolveTranscriptFile(t.file, ''), is404);
    await assert.rejects(resolveTranscriptFile(t.file + '\0', t.proj), is404);
    // a sibling dir sharing the prefix is not "inside"
    const sib = path.join(t.root, 'projects-other');
    fs.mkdirSync(sib);
    fs.copyFileSync(FIXTURE, path.join(sib, 'x.jsonl'));
    await assert.rejects(resolveTranscriptFile(path.join(sib, 'x.jsonl'), t.proj), is404);
    // tailTranscript itself refuses a symlink as the final component
    await assert.rejects(tailTranscript({ file: escape }), is404);
  } finally {
    t.cleanup();
  }
});

test('entriesFromLine: pure mapping rules', () => {
  assert.deepEqual(entriesFromLine(null, 0), []);
  assert.deepEqual(entriesFromLine([], 0), []);
  assert.deepEqual(entriesFromLine({ type: 'system', content: 'x' }, 0), []);
  assert.deepEqual(entriesFromLine({ type: 'user', message: { content: [{ type: 'image' }] } }, 0), []);
  const mixed = entriesFromLine({
    type: 'user', timestamp: 7,
    message: { content: [{ type: 'tool_result', content: 'ok' }, { type: 'text', text: 'hi' }] },
  }, 42);
  assert.deepEqual(mixed, [
    { off: 42, ts: null, role: 'tool_result', text: 'ok', isError: false },
    { off: 42, ts: null, role: 'user', text: 'hi' },
  ]);
  const a = entriesFromLine({
    type: 'assistant',
    message: { content: [{ type: 'redacted_thinking', data: 'z' }, { type: 'text', text: 'a' }, { type: 'tool_use', name: 'Grep', input: { pattern: 'foo', path: 'src' } }] },
  }, 1);
  assert.deepEqual(a.map((e) => [e.role, e.text, e.tool]), [['assistant', 'a', undefined], ['tool_use', 'foo in src', 'Grep']]);
  const evil = entriesFromLine({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'X\u001b[2J\u0007', input: null }] } }, 0);
  assert.equal(evil[0].tool, 'X');
  assert.equal(evil[0].text, '');
});

test('summarizeToolInput table and 300-char cap', () => {
  assert.equal(summarizeToolInput('Bash', { command: 'ls -la' }), 'ls -la');
  for (const t of ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    assert.equal(summarizeToolInput(t, { file_path: '/home/user/acme/x.md', old_string: 'a' }), '/home/user/acme/x.md');
  }
  assert.equal(summarizeToolInput('Glob', { pattern: '**/*.mjs' }), '**/*.mjs');
  assert.equal(summarizeToolInput('Grep', { pattern: 'x', path: 'lib' }), 'x in lib');
  assert.equal(summarizeToolInput('Task', { description: 'look around', prompt: 'long' }), 'look around');
  assert.equal(summarizeToolInput('Agent', { description: 'sub' }), 'sub');
  assert.equal(summarizeToolInput('WebFetch', { url: 'https://example.invalid/', prompt: 'p' }), 'https://example.invalid/');
  assert.equal(summarizeToolInput('mcp__x', { a: 1, b: 'two', c: { d: true }, e: 'skip' }), 'a=1 b=two c={"d":true}');
  assert.equal(summarizeToolInput('Other', 'not an object'), '');
  assert.equal(summarizeToolInput('Bash', { command: 'y'.repeat(1000) }).length, 300);
  assert.equal(summarizeToolInput('Bash', { command: 'echo \u001b[31mhi\u001b[0m\r' }), 'echo hi');
});

test('cleanText strips ANSI and control chars but keeps \\n and \\t', () => {
  assert.equal(cleanText('a\u001b[1mb\u001b]8;;http://x\u0007c\u0000d\r\ne\tf\u007f\u0085', 100), 'abcd\ne\tf');
  assert.equal(cleanText('<script>', 100), '<script>');
  assert.equal(cleanText(42, 10), '');
  assert.equal(cleanText('ab🙂', 3), 'ab', 'never splits a surrogate pair');
});

test('lines spanning 64 KiB chunk boundaries: backward pages equal one forward read', async () => {
  const t = tmpProjects();
  try {
    const lines = [];
    for (let i = 0; i < 3000; i++) {
      lines.push(JSON.stringify({ type: i % 2 ? 'user' : 'assistant', message: { content: `line ${i} ${'é'.repeat(i % 97)}` } }));
    }
    fs.writeFileSync(t.file, lines.join('\n') + '\n');
    const size = fs.statSync(t.file).size;
    const fwd = [];
    let after = 0;
    for (;;) {
      const r = await tailTranscript({ file: t.file, after, limit: 2000, maxBytes: 100000 });
      fwd.push(...r.entries);
      if (r.endOffset === after) break;
      after = r.endOffset;
    }
    assert.equal(after, size);
    assert.equal(fwd.length, 3000);
    const back = [];
    let before = null;
    for (;;) {
      const r = await tailTranscript({ file: t.file, before, limit: 7, maxBytes: 300000 });
      back.unshift(...r.entries);
      if (r.startOffset === 0) break;
      before = r.startOffset;
    }
    assert.deepEqual(back, fwd);
    const buf = fs.readFileSync(t.file);
    for (const e of fwd.slice(0, 50)) assert.ok(e.off === 0 || buf[e.off - 1] === 0x0a);
  } finally {
    t.cleanup();
  }
});
