import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  openAudit, verifyFile, verifyChain, entryHash, argsHashOf, createUnauthWarner, GENESIS,
} from '../server/fleet/audit.mjs';
import { canonicalJson, sha256Hex } from '../server/fleet/canonical.mjs';

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-audit-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function clock(start = Date.UTC(2026, 9, 15, 1, 2, 3)) {
  const c = { t: start, now: () => c.t };
  return c;
}

const act = (n, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  user: 'builder-a@example.invalid',
  via: 'direct',
  builder: 'builder-a',
  action: 'send-text',
  target: `s${n}`,
  args: { text: `secret prompt ${n}` },
  result: { ok: true, status: 200 },
  ...extra,
});

function lines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

function setup(t, opts = {}) {
  const dir = tmpDir(t);
  const file = path.join(dir, 'state', 'audit.jsonl');
  const c = clock();
  const audit = openAudit({ file, now: c.now, ...opts });
  t.after(() => audit.close());
  return { dir, file, c, audit };
}

test('three appends chain; verify ok; head is {hash, count}', (t) => {
  const { file, c, audit } = setup(t);
  assert.deepEqual(audit.head(), { hash: GENESIS, count: 0 });
  const e = [];
  for (let i = 1; i <= 3; i++) {
    e.push(audit.append(act(i)));
    c.t += 1000;
  }
  assert.equal(e[0].prevHash, GENESIS);
  for (let i = 1; i < 3; i++) assert.equal(e[i].prevHash, e[i - 1].hash);
  const stored = lines(file).map((l) => JSON.parse(l));
  assert.deepEqual(stored, e);
  for (let i = 1; i < 3; i++) assert.equal(stored[i].prevHash, stored[i - 1].hash);
  assert.deepEqual(audit.head(), { hash: e[2].hash, count: 3 });
  const v = audit.verifyAll();
  assert.equal(v.ok, true);
  assert.equal(v.count, 3);
  assert.equal(v.head, e[2].hash);
  assert.deepEqual(verifyFile(lines(file)), { ok: true, count: 3, head: e[2].hash, lastTs: e[2].ts });
});

test('entry shape: hash formula, argsHash, args never stored, error truncated', (t) => {
  const { file, audit } = setup(t);
  const long = 'x'.repeat(1000);
  const e = audit.append(act(1, { result: { ok: false, status: 500, error: long } }));
  assert.deepEqual(Object.keys(e).sort(), ['action', 'argsHash', 'builder', 'hash', 'id', 'prevHash', 'result', 'target', 'ts', 'user', 'via']);
  assert.equal(e.argsHash, sha256Hex(canonicalJson({ text: 'secret prompt 1' })));
  assert.equal(e.argsHash, argsHashOf({ text: 'secret prompt 1' }));
  const { hash, ...rest } = e;
  assert.equal(hash, sha256Hex(`${rest.prevHash}\n${canonicalJson(rest)}`));
  assert.equal(hash, entryHash(rest));
  assert.equal(e.result.error.length, 300);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('secret prompt'), 'args are not stored');
  assert.ok(raw.endsWith('\n'));
});

test('append input validation', (t) => {
  const { audit } = setup(t);
  assert.throws(() => audit.append({ ...act(1), bytesIn: 3 }), /unknown entry field/);
  assert.throws(() => audit.append({ ...act(1), action: undefined }), /action is required/);
  assert.throws(() => audit.append({ ...act(1), action: 'audit.rotate' }), /reserved|written by the audit log/);
  assert.throws(() => audit.append({ ...act(1), argsHash: 'nope', args: undefined }), /argsHash/);
  assert.throws(() => audit.append({ ...act(1), argsHash: 'a'.repeat(64) }), /args or argsHash/);
  assert.throws(() => audit.append({ ...act(1), result: JSON.parse('{"__proto__": {"x": 1}}') }), /forbidden key/);
  assert.throws(() => audit.append({ ...act(1), result: { when: new Date(0) } }), /non-plain/);
  assert.throws(() => audit.append({ ...act(1), result: { big: Array.from({ length: 50 }, () => 'y'.repeat(300)) } }), /larger than/);
  assert.equal(audit.head().count, 0, 'nothing written by refused appends');
  // argsHash passthrough (the hub relay hashes args itself), id defaulted, default builder
  const h = argsHashOf({ a: 1 });
  const e = audit.append({ user: 'u', via: 'hub', action: 'audit.anchor', target: 'builder-a', argsHash: h, result: { ok: true, head: { hash: GENESIS, count: 0 } } });
  assert.equal(e.argsHash, h);
  assert.match(e.id, /^[0-9a-f-]{36}$/);
  assert.equal(e.builder, null);
  // lone surrogates in builder-provided text do not break hashing
  const s = audit.append({ ...act(2), target: 'bad\ud800name' });
  assert.equal(s.target, 'bad�name');
  assert.equal(audit.verifyAll().ok, true);
});

test('ts never regresses even when the clock steps back or a caller passes an old ts', (t) => {
  const { c, audit } = setup(t);
  const a = audit.append(act(1));
  c.t -= 60000;
  const b = audit.append(act(2));
  const d = audit.append(act(3, { ts: a.ts - 5000 }));
  assert.equal(b.ts, a.ts);
  assert.equal(d.ts, a.ts);
  assert.equal(audit.verifyAll().ok, true);
});

function threeLineFile(t) {
  const { file, c, audit } = setup(t);
  for (let i = 1; i <= 4; i++) {
    audit.append(act(i));
    c.t += 1000;
  }
  audit.close();
  return { file, ls: lines(file) };
}

test('tamper: edit a field -> hash_mismatch at that line', (t) => {
  const { file, ls } = threeLineFile(t);
  const e = JSON.parse(ls[1]);
  e.user = 'mallory';
  ls[1] = JSON.stringify(e);
  fs.writeFileSync(file, `${ls.join('\n')}\n`);
  const r = verifyChain(file);
  assert.equal(r.ok, false);
  assert.deepEqual(r.firstBad, { file, line: 2, reason: 'hash_mismatch' });
  assert.equal(r.count, 1);
});

test('tamper: delete a line -> prev_mismatch at the following line', (t) => {
  const { file, ls } = threeLineFile(t);
  ls.splice(1, 1);
  fs.writeFileSync(file, `${ls.join('\n')}\n`);
  assert.deepEqual(verifyChain(file).firstBad, { file, line: 2, reason: 'prev_mismatch' });
  // deleting the first line breaks genesis
  const ls2 = lines(file).slice(1);
  fs.writeFileSync(file, `${ls2.join('\n')}\n`);
  assert.deepEqual(verifyChain(file).firstBad, { file, line: 1, reason: 'prev_mismatch' });
});

test('tamper: reorder two lines -> prev_mismatch', (t) => {
  const { file, ls } = threeLineFile(t);
  [ls[1], ls[2]] = [ls[2], ls[1]];
  fs.writeFileSync(file, `${ls.join('\n')}\n`);
  assert.deepEqual(verifyChain(file).firstBad, { file, line: 2, reason: 'prev_mismatch' });
});

test('tamper: truncate mid-line -> bad_json at the last line', (t) => {
  const { file, ls } = threeLineFile(t);
  const text = `${ls.join('\n')}\n`;
  fs.writeFileSync(file, text.slice(0, text.length - 20));
  assert.deepEqual(verifyChain(file).firstBad, { file, line: 4, reason: 'bad_json' });
});

test('tamper: re-chained rewrite verifies but no longer contains the anchored head', (t) => {
  // An agent with a shell can rewrite and re-chain its own log (cooperative control); what it cannot do is keep
  // the head the hub anchored. hasHead / read({after}) expose that.
  const { file, c, audit } = setup(t);
  for (let i = 1; i <= 3; i++) { audit.append(act(i)); c.t += 1000; }
  const anchored = audit.head();
  assert.equal(audit.hasHead(anchored), true);
  assert.equal(audit.read({ after: anchored.hash }).afterIndex, anchored.count - 1);
  audit.close();
  // rewrite line 2 and re-chain everything after it
  const es = lines(file).map((l) => JSON.parse(l));
  es[1].target = 'other';
  let prev = GENESIS;
  const out = es.map(({ hash, ...rest }) => {
    const e = { ...rest, prevHash: prev };
    const h = entryHash(e);
    prev = h;
    return canonicalJson({ ...e, hash: h });
  });
  fs.writeFileSync(file, `${out.join('\n')}\n`);
  assert.equal(verifyChain(file).ok, true, 'a re-chained log verifies locally');
  const reopened = openAudit({ file, now: c.now });
  t.after(() => reopened.close());
  assert.equal(reopened.hasHead(anchored), false);
  const r = reopened.read({ after: anchored.hash });
  assert.equal(r.afterFound, false);
  assert.deepEqual(r.entries, []);
  assert.equal(reopened.hasHead({ hash: GENESIS, count: 0 }), true);
  assert.equal(reopened.hasHead({ hash: 'x', count: 99 }), false);
  assert.equal(reopened.hasHead(null), false);
});

test('verifyFile reports ts_regressed and bad_json for non-entries', () => {
  const a = { ts: 2000, id: 'a', user: null, via: null, builder: null, action: 'x', target: null, argsHash: argsHashOf({}), result: {}, prevHash: GENESIS };
  const ah = entryHash(a);
  const b = { ...a, ts: 1000, id: 'b', prevHash: ah };
  const lines2 = [canonicalJson({ ...a, hash: ah }), canonicalJson({ ...b, hash: entryHash(b) })];
  assert.deepEqual(verifyFile(lines2).firstBad, { file: null, line: 2, reason: 'ts_regressed' });
  assert.deepEqual(verifyFile(['[1,2]']).firstBad.reason, 'bad_json');
  assert.deepEqual(verifyFile(['{"ts":1}']).firstBad.reason, 'bad_json');
  assert.deepEqual(verifyFile([]), { ok: true, count: 0, head: GENESIS, lastTs: -Infinity });
  assert.equal(verifyFile(`${lines2[0]}\n`).ok, true, 'accepts whole file text');
  // a prototype key is refused by canonicalJson -> bad_json, not a crash
  const evil = `{"__proto__":{},"ts":1,"action":"x","prevHash":"${GENESIS}","hash":"${'0'.repeat(64)}"}`;
  assert.equal(verifyFile([evil]).firstBad.reason, 'bad_json');
});

test('rotation at a tiny maxBytes keeps the chain across files; verifyAll passes', (t) => {
  const { dir, file, c, audit } = setup(t, { maxBytes: 900 });
  const all = [];
  for (let i = 1; i <= 12; i++) {
    all.push(audit.append(act(i)));
    c.t += 400; // several rotations within one second exercise the -n name suffix
  }
  const files = fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.jsonl')).sort();
  assert.ok(files.length >= 3, `expected rotated files, got ${files}`);
  for (const f of files) {
    assert.ok(fs.statSync(path.join(path.dirname(file), f)).size <= 900 || lines(path.join(path.dirname(file), f)).length === 1);
    assert.match(f, /^audit(-\d{8}T\d{6}(-\d+)?)?\.jsonl$/);
  }
  const first = JSON.parse(lines(file)[0]);
  assert.equal(first.action, 'audit.rotate');
  assert.ok(files.includes(first.target));
  const v = audit.verifyAll();
  assert.equal(v.ok, true, JSON.stringify(v.firstBad));
  assert.equal(v.count, audit.head().count);
  assert.equal(v.head, all.at(-1).hash);
  // count is chain-wide: 12 actions plus one rotate entry per rotated file
  assert.equal(audit.head().count, 12 + (files.length - 1));
  // reopening recomputes the same head
  audit.close();
  const again = openAudit({ file, now: c.now, maxBytes: 900 });
  t.after(() => again.close());
  assert.deepEqual(again.head(), { hash: all.at(-1).hash, count: 12 + (files.length - 1) });
  // a stray file in the directory is ignored
  fs.writeFileSync(path.join(dir, 'state', 'audit-19990101T000000.jsonl'), 'garbage\n');
  assert.equal(again.verifyAll().ok, true);
  // deleting a rotated file breaks the chain
  const chainOld = JSON.parse(lines(file)[0]).target;
  fs.renameSync(path.join(path.dirname(file), chainOld), path.join(dir, 'moved.jsonl'));
  const broken = again.verifyAll();
  assert.equal(broken.ok, false);
  assert.equal(broken.firstBad.reason, 'prev_mismatch');
});

test('read({after}) returns only later entries across files; since, limit, more', (t) => {
  const { c, audit } = setup(t, { maxBytes: 900 });
  const all = [];
  for (let i = 1; i <= 12; i++) {
    all.push(audit.append(act(i)));
    c.t += 1000;
  }
  const chain = audit.read({ limit: 1000 }).entries;
  assert.equal(chain.length, audit.head().count);
  for (let i = 1; i < chain.length; i++) assert.equal(chain[i].prevHash, chain[i - 1].hash);
  const pivot = all[2];
  const r = audit.read({ after: pivot.hash });
  assert.equal(r.afterFound, true);
  assert.equal(r.afterIndex, chain.findIndex((e) => e.hash === pivot.hash));
  assert.deepEqual(r.entries, chain.slice(r.afterIndex + 1));
  assert.ok(r.entries.some((e) => e.action === 'audit.rotate'), 'crosses a rotation');
  assert.equal(r.more, false);
  assert.deepEqual(r.head, audit.head());
  // after wins over since
  assert.deepEqual(audit.read({ after: pivot.hash, since: 0 }).entries, r.entries);
  // after = head -> nothing new
  const h = audit.read({ after: audit.head().hash });
  assert.deepEqual([h.entries, h.more, h.afterFound], [[], false, true]);
  // limit + more, then continue with after
  const p1 = audit.read({ after: all[0].hash, limit: 3 });
  assert.equal(p1.entries.length, 3);
  assert.equal(p1.more, true);
  const p2 = audit.read({ after: p1.entries.at(-1).hash, limit: 1000 });
  assert.deepEqual([...p1.entries, ...p2.entries], audit.read({ after: all[0].hash }).entries);
  // since: ts >= since
  const s = audit.read({ since: all[9].ts });
  assert.deepEqual(s.entries.filter((e) => e.action !== 'audit.rotate').map((e) => e.id), [all[9].id, all[10].id, all[11].id]);
  assert.ok(s.entries.every((e) => e.ts >= all[9].ts));
  // limit clamped to 1..1000
  assert.equal(audit.read({ limit: 0 }).entries.length, 1);
  assert.equal(audit.read({ limit: 5000 }).entries.length, chain.length);
});

test('file mode 0600, directory created 0700, wider mode tightened', (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'new', 'deeper', 'audit.jsonl');
  const a = openAudit({ file });
  a.append(act(1));
  a.close();
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, 'new')).mode & 0o777, 0o700);
  fs.chmodSync(file, 0o644);
  const b = openAudit({ file });
  b.close();
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  // rotated and new files are 0600 too
  const c = openAudit({ file, maxBytes: 400 });
  for (let i = 0; i < 4; i++) c.append(act(i));
  c.close();
  for (const f of fs.readdirSync(path.dirname(file))) assert.equal(fs.statSync(path.join(path.dirname(file), f)).mode & 0o777, 0o600, f);
});

test('defaults to paths.auditFile() ($LANEBOARD_AUDIT_FILE)', (t) => {
  const dir = tmpDir(t);
  const prev = process.env.LANEBOARD_AUDIT_FILE;
  process.env.LANEBOARD_AUDIT_FILE = path.join(dir, 'env-audit.jsonl');
  t.after(() => { if (prev === undefined) delete process.env.LANEBOARD_AUDIT_FILE; else process.env.LANEBOARD_AUDIT_FILE = prev; });
  const a = openAudit();
  a.append(act(1));
  a.close();
  assert.equal(a.file, path.join(dir, 'env-audit.jsonl'));
  assert.equal(lines(a.file).length, 1);
});

test('reopen continues the chain; a torn tail is not glued onto and stays visible', (t) => {
  const { file, c, audit } = setup(t);
  audit.append(act(1));
  const b = audit.append(act(2));
  audit.close();
  const re = openAudit({ file, now: c.now });
  t.after(() => re.close());
  assert.deepEqual(re.head(), { hash: b.hash, count: 2 });
  const d = re.append(act(3));
  assert.equal(d.prevHash, b.hash);
  assert.equal(re.verifyAll().ok, true);
  // simulate a torn write, then append again
  fs.appendFileSync(file, '{"action":"send-text","argsHash":"ab');
  const e = re.append(act(4));
  assert.equal(e.prevHash, d.hash, 'chains onto the last parsable entry');
  const ls = fs.readFileSync(file, 'utf8').split('\n');
  assert.equal(JSON.parse(ls[4]).hash, e.hash, 'the new entry is on its own line');
  // SR2 L1: the torn line is reported, but it does not stop verification of what follows
  const v = re.verifyAll();
  assert.equal(v.ok, true, JSON.stringify(v.firstBad));
  assert.deepEqual(v.warnings, [{ file, line: 4, reason: 'torn' }]);
  assert.equal(v.count, re.head().count, 'head and verify count the same entries');
  assert.equal(v.head, e.hash);
  assert.ok(re.read({ after: d.hash }).entries.some((x) => x.hash === e.hash), 'read skips the torn line');
});

test('an external write to the file is noticed before the next append', (t) => {
  const { file, audit } = setup(t);
  const a = audit.append(act(1));
  // a non-cooperating writer appended a valid entry behind our back
  const raw = { ...a, id: 'x2', target: 'other', prevHash: a.hash };
  delete raw.hash;
  const x = { ...raw, hash: entryHash(raw) };
  fs.appendFileSync(file, `${canonicalJson(x)}\n`);
  const y = audit.append(act(3));
  assert.equal(y.prevHash, x.hash);
  assert.equal(audit.head().count, 3);
  assert.equal(audit.verifyAll().ok, true);
});

test('interrupted rotation is finished or discarded at open', (t) => {
  const { file, c, audit } = setup(t, { maxBytes: 600 });
  for (let i = 0; i < 6; i++) { audit.append(act(i)); c.t += 1000; }
  audit.close();
  const okHead = verifyChain(file);
  assert.equal(okHead.ok, true);
  // case 1: crash before the old file moved away -> stale .rotating is discarded
  fs.writeFileSync(`${file}.rotating`, 'partial');
  const a = openAudit({ file, now: c.now, maxBytes: 600 });
  a.close();
  assert.equal(fs.existsSync(`${file}.rotating`), false);
  assert.deepEqual(verifyChain(file), okHead);
  // case 2: crash after the rename -> the .rotating file becomes the current file
  const cur = fs.readFileSync(file);
  const first = JSON.parse(cur.toString().split('\n')[0]);
  assert.equal(first.action, 'audit.rotate');
  fs.renameSync(file, `${file}.rotating`);
  const b = openAudit({ file, now: c.now, maxBytes: 600 });
  t.after(() => b.close());
  assert.equal(fs.existsSync(`${file}.rotating`), false);
  assert.deepEqual(b.verifyAll(), okHead);
});

test('createUnauthWarner: at most one line per 10 s, with a counter, no control chars', () => {
  const c = clock(0);
  const out = [];
  const w = createUnauthWarner({ log: { warn: (s) => out.push(s) }, now: c.now });
  assert.equal(w.note('bad-signature'), true);
  for (let i = 0; i < 5; i++) { c.t += 1000; w.note('replay'); }
  assert.equal(out.length, 1);
  assert.equal(w.pending(), 5);
  c.t = 10000;
  w.note('replay\x1b]52;c;x\x07');
  assert.equal(out.length, 2);
  assert.match(out[1], /\+5 more/);
  assert.ok(!/[\x00-\x1f]/.test(out.join('')));
  assert.equal(w.pending(), 0);
});

// ---------------------------------------------------------------------------------------------------------
// SR2 regressions

const MODULE_URL = new URL('../server/fleet/audit.mjs', import.meta.url).href;

function startHolder(file) {
  // A second process that opens the log and keeps it open until killed.
  const code = `import { openAudit } from ${JSON.stringify(MODULE_URL)};
    const a = openAudit({ file: ${JSON.stringify(file)} });
    a.append({ action: 'held', target: 'x' });
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('ready')) resolve(); });
    child.on('exit', (c) => reject(new Error(`holder exited ${c}`)));
  });
  return { child, ready };
}

test('SR2 M1a: a second writer is refused, in this process and in another; a dead holder is taken over', async (t) => {
  const { file, audit } = setup(t);
  audit.append(act(1));
  assert.throws(() => openAudit({ file }), (err) => err.code === 'AUDIT_LOCKED' && /only one writer/.test(err.message));
  const lockText = fs.readFileSync(`${file}.lock`, 'utf8');
  assert.ok(lockText.startsWith(`${process.pid} ${os.hostname().replace(/\s/g, '_') || 'localhost'} `), lockText);
  if (fs.existsSync('/proc/sys/kernel/random/boot_id')) assert.match(lockText, /^\d+ \S+ [0-9a-f-]{8,64} \d+\n$/);
  assert.equal(fs.statSync(`${file}.lock`).mode & 0o777, 0o600);
  audit.close();
  assert.equal(fs.existsSync(`${file}.lock`), false, 'close releases the lock');
  // another live process holds it
  const { child, ready } = startHolder(file);
  t.after(() => child.kill('SIGKILL'));
  await ready;
  assert.throws(() => openAudit({ file }), (err) => err.code === 'AUDIT_LOCKED' && err.message.includes(`pid ${child.pid}`));
  // the holder dies without closing: its lock is stale and is taken over
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGKILL');
  await exited;
  assert.ok(fs.existsSync(`${file}.lock`), 'the dead holder left its lock behind');
  const b = openAudit({ file });
  t.after(() => b.close());
  assert.equal(b.head().count, 2);
  b.append(act(3));
  assert.equal(b.verifyAll().ok, true);
  // a lock from another host, or an unreadable one, is not taken over (same boot: its pids are not ours to see)
  b.close();
  fs.writeFileSync(`${file}.lock`, '1 other-host\n');
  assert.throws(() => openAudit({ file }), (err) => err.code === 'AUDIT_LOCKED' && /other-host/.test(err.message));
  fs.writeFileSync(`${file}.lock`, 'garbage');
  assert.throws(() => openAudit({ file }), (err) => err.code === 'AUDIT_LOCKED' && /unreadable/.test(err.message));
  fs.unlinkSync(`${file}.lock`);
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('audit.jsonl.lock.'));
  assert.deepEqual(leftovers, [], 'no temp lock files left behind');
});

test('SR2 M1a: a writer whose lock was removed or replaced stops writing', (t) => {
  const { file, audit } = setup(t);
  audit.append(act(1));
  fs.unlinkSync(`${file}.lock`);
  assert.throws(() => audit.append(act(2)), (err) => err.code === 'AUDIT_LOCK_LOST');
  assert.throws(() => audit.append(act(3)), (err) => err.code === 'AUDIT_LOCK_LOST', 'stays refused');
  assert.equal(lines(file).length, 1);
});

test('SR2 M1b: a renamed or removed file is never written into; a replaced file is reopened', (t) => {
  const { dir, file, audit } = setup(t);
  const a = audit.append(act(1));
  const moved = path.join(dir, 'moved.jsonl');
  fs.renameSync(file, moved);
  assert.throws(() => audit.append(act(2)), (err) => err.code === 'AUDIT_DETACHED');
  assert.throws(() => audit.head(), (err) => err.code === 'AUDIT_DETACHED');
  assert.equal(lines(moved).length, 1, 'nothing went into the detached inode');
  assert.equal(fs.existsSync(file), false);
  // put a copy back (a new inode): the writer reopens it and continues its chain
  fs.copyFileSync(moved, file);
  const b = audit.append(act(3));
  assert.equal(b.prevHash, a.hash);
  assert.deepEqual(lines(file).map((l) => JSON.parse(l).hash), [a.hash, b.hash]);
  assert.equal(lines(moved).length, 1);
  assert.equal(audit.verifyAll().ok, true);
  fs.unlinkSync(file);
  assert.throws(() => audit.append(act(4)), (err) => err.code === 'AUDIT_DETACHED');
});

test('SR2 M1c: rotation never overwrites an existing rotated file', (t) => {
  const { dir, file, c, audit } = setup(t, { maxBytes: 600 });
  // a file already holds the name the first rotation would pick
  const d = new Date(c.t);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const taken = path.join(dir, 'state', `audit-${stamp}.jsonl`);
  fs.writeFileSync(taken, 'sentinel\n');
  for (let i = 1; i <= 6; i++) audit.append(act(i));
  assert.equal(fs.readFileSync(taken, 'utf8'), 'sentinel\n');
  assert.notEqual(JSON.parse(lines(file)[0]).target, path.basename(taken));
  const v = audit.verifyAll();
  assert.equal(v.ok, true, JSON.stringify(v.firstBad));
  assert.equal(v.count, audit.head().count);
});

test('SR2 L1: a torn tail left in a rotated file does not break verification', (t) => {
  const { file, c, audit } = setup(t, { maxBytes: 700 });
  audit.append(act(1));
  fs.appendFileSync(file, '{"action":"send-te'); // crash mid-write
  for (let i = 2; i <= 8; i++) { audit.append(act(i)); c.t += 1000; }
  const v = audit.verifyAll();
  assert.equal(v.ok, true, JSON.stringify(v.firstBad));
  assert.equal(v.warnings.length, 1);
  assert.equal(v.warnings[0].reason, 'torn');
  assert.equal(v.count, audit.head().count);
  // real tampering after the torn line is still found
  audit.close();
  const ls = lines(file);
  const e = JSON.parse(ls.at(-1));
  e.id = 'forged';
  fs.writeFileSync(file, `${[...ls.slice(0, -1), canonicalJson(e)].join('\n')}\n`);
  assert.equal(verifyChain(file).firstBad.reason, 'hash_mismatch');
  // a torn line at the very end of the current file is still bad_json for a verifier
  const f0 = lines(file)[0];
  assert.deepEqual(verifyFile([f0, '{"action":"x'], JSON.parse(f0).prevHash).firstBad, { file: null, line: 2, reason: 'bad_json' });
  // one torn line mid-file, followed by a chaining entry: a warning, not a failure
  assert.equal(verifyFile([ls[0], '{"action":"se', ls[1]], JSON.parse(ls[0]).prevHash).warnings.length, 1);
});

test('SR2 L2: the writer refuses to extend a chain that does not verify; head counts verified entries', (t) => {
  const { file, audit } = setup(t);
  const a = audit.append(act(1));
  const forged = { ...a, id: 'g', prevHash: a.hash, hash: 'f'.repeat(64) };
  fs.appendFileSync(file, `${canonicalJson(forged)}\n`);
  assert.throws(() => audit.append(act(2)), (err) => err.code === 'AUDIT_CHAIN_INVALID' && /hash_mismatch/.test(err.message));
  assert.deepEqual(audit.head(), { hash: a.hash, count: 1 }, 'head is the last verified entry');
  assert.equal(audit.verifyAll().count, audit.head().count);
  assert.equal(lines(file).length, 2, 'nothing chained onto the forged hash');
  audit.close();
  assert.throws(() => openAudit({ file }).append(act(3)), (err) => err.code === 'AUDIT_CHAIN_INVALID');
});

test('SR2 L3: a line must be exactly canonicalJson of its entry', (t) => {
  const { file, audit } = setup(t);
  audit.append(act(1));
  audit.append(act(2));
  audit.close();
  const ls = lines(file);
  const dup = ls[1].replace(/^\{/, '{"action":"noop","target":"other",');
  assert.equal(JSON.parse(dup).hash, JSON.parse(ls[1]).hash, 'last-wins parse still yields the hashed entry');
  fs.writeFileSync(file, `${ls[0]}\n${dup}\n`);
  assert.deepEqual(verifyChain(file).firstBad, { file, line: 2, reason: 'bad_json' });
  fs.writeFileSync(file, `${ls[0]}\n${ls[1].replace(':', ': ')}\n`);
  assert.deepEqual(verifyChain(file).firstBad, { file, line: 2, reason: 'bad_json' });
});

test('SR2 L4: a caller ts is clamped to at most now + 60 s', (t) => {
  const { c, audit } = setup(t);
  const a = audit.append(act(1, { ts: Number.MAX_SAFE_INTEGER }));
  assert.equal(a.ts, c.t + 60000);
  c.t += 1000;
  const b = audit.append(act(2));
  assert.equal(b.ts, a.ts, 'never regresses');
  c.t += 120000;
  assert.equal(audit.append(act(3)).ts, c.t, 'the pin wears off once the clock passes it');
  assert.equal(audit.append(act(4, { ts: c.t - 10 })).ts, c.t);
});

test('SR2 L6: rotation survives short writes and is undone when the final rename fails', (t) => {
  const { dir, file, c, audit } = setup(t, { maxBytes: 600 });
  const realWrite = fs.writeSync;
  const realRename = fs.renameSync;
  t.after(() => { fs.writeSync = realWrite; fs.renameSync = realRename; });
  fs.writeSync = (fd, buf, off = 0, len = buf.length - off, pos) => realWrite(fd, buf, off, Math.min(len, 7), pos);
  for (let i = 1; i <= 6; i++) { audit.append(act(i)); c.t += 1000; }
  fs.writeSync = realWrite;
  assert.equal(audit.verifyAll().ok, true, 'short writes are looped, also for the rotate entry');
  const before = fs.readdirSync(path.join(dir, 'state')).sort();
  const headBefore = audit.head();
  fs.renameSync = (from, to) => {
    if (from === `${file}.rotating`) throw Object.assign(new Error('EIO injected'), { code: 'EIO' });
    return realRename(from, to);
  };
  let failed = false;
  for (let i = 0; i < 10 && !failed; i++) {
    try { audit.append(act(100 + i)); } catch (err) { failed = err.code === 'EIO'; }
  }
  assert.ok(failed, 'a rotation was attempted');
  fs.renameSync = realRename;
  const after = fs.readdirSync(path.join(dir, 'state')).sort();
  assert.ok(!after.includes('audit.jsonl.rotating'));
  assert.equal(after.filter((f) => f.endsWith('.jsonl')).length, before.filter((f) => f.endsWith('.jsonl')).length, 'the extra rotated name was removed');
  assert.equal(audit.verifyAll().ok, true);
  assert.ok(audit.head().count >= headBefore.count);
  const e = audit.append(act(200));
  assert.equal(e.prevHash, audit.read({ limit: 1000 }).entries.at(-2).hash);
  const v = audit.verifyAll();
  assert.equal(v.ok, true, JSON.stringify(v.firstBad));
  assert.equal(v.count, audit.head().count);
});

test('SR2 L7: an existing wide directory is tightened; a symlinked directory or rotated file is refused', (t) => {
  const dir = tmpDir(t);
  const wide = path.join(dir, 'laneboard');
  fs.mkdirSync(wide, { mode: 0o777 });
  fs.chmodSync(wide, 0o777);
  openAudit({ file: path.join(wide, 'audit.jsonl') }).close();
  assert.equal(fs.statSync(wide).mode & 0o777, 0o700);
  const link = path.join(dir, 'link');
  fs.symlinkSync(wide, link);
  assert.throws(() => openAudit({ file: path.join(link, 'audit.jsonl') }), (err) => err.code === 'AUDIT_UNSAFE_DIR');
  // a rotated file replaced by a symlink is not followed: the chain is broken, the target is not read
  const file = path.join(wide, 'audit.jsonl');
  const a = openAudit({ file, maxBytes: 600 });
  for (let i = 0; i < 4; i++) a.append(act(i));
  a.close();
  const target = JSON.parse(lines(file)[0]).target;
  const real = path.join(wide, target);
  fs.renameSync(real, path.join(dir, 'elsewhere.jsonl'));
  fs.symlinkSync(path.join(dir, 'elsewhere.jsonl'), real);
  const v = verifyChain(file);
  assert.equal(v.ok, false);
  assert.equal(v.firstBad.reason, 'prev_mismatch');
});

test('SR2 L8: an over-long line is bad_json, not a crash; reads stream across rotated files', (t) => {
  const { file, c, audit } = setup(t, { maxBytes: 900 });
  for (let i = 1; i <= 10; i++) { audit.append(act(i)); c.t += 1000; }
  const h = audit.head();
  const all = audit.read({ limit: 1000 }).entries;
  assert.equal(all.length, h.count);
  for (let i = 0; i < all.length; i++) assert.equal(audit.hasHead({ hash: all[i].hash, count: i + 1 }), true, `index ${i}`);
  assert.equal(audit.hasHead({ hash: all[0].hash, count: 2 }), false);
  assert.equal(audit.hasHead({ hash: all.at(-1).hash, count: h.count + 1 }), false);
  assert.equal(audit.read({ after: all[1].hash }).afterIndex, 1);
  assert.equal(audit.read({ since: all.at(-1).ts }).entries.at(-1).hash, all.at(-1).hash);
  audit.close();
  fs.appendFileSync(file, `${'x'.repeat(200 * 1024)}\n`);
  const v = verifyChain(file);
  assert.equal(v.ok, false);
  assert.equal(v.firstBad.reason, 'bad_json');
});

test('SR2 L9: control characters are not stored', (t) => {
  const { file, audit } = setup(t);
  const e = audit.append(act(1, { target: 's1\x1b]52;c;x\x07', user: 'u\nv', result: { ok: false, error: 'a\r\nb c\x9b' } }));
  assert.equal(e.target, 's1�]52;c;x�');
  assert.equal(e.user, 'u v');
  assert.equal(e.result.error, 'a  b�c�');
  assert.ok(!/[\x00-\x1f]/.test(JSON.stringify(audit.read().entries)));
  assert.equal(lines(file).length, 1);
  assert.equal(audit.verifyAll().ok, true);
});

// ---------------------------------------------------------------------------------------------------------
// SR2 re-review regressions (fleet A3-fix2)

const HOST = os.hostname().replace(/\s/g, '_') || 'localhost';
const BOOT_A = '11111111-2222-4333-8444-555555555555';
const BOOT_B = '99999999-8888-4777-8666-555555555555';

// A fake /proc: `pids` maps pid -> {start, signal}; pids not listed are dead. `btime` is /proc/stat's (s).
function fakeProc({ boot = BOOT_A, pids = {}, btime = null, uptime = null, onSignal = null } = {}) {
  const all = { [process.pid]: { start: '4242', signal: 'alive' }, ...pids };
  return {
    read(p) {
      if (p === '/proc/sys/kernel/random/boot_id') return boot === null ? null : `${boot}\n`;
      if (p === '/proc/stat') return btime === null ? null : `cpu 1 2 3\nbtime ${btime}\nprocesses 9\n`;
      const m = /^\/proc\/(\d+)\/stat$/.exec(p);
      if (m && boot !== null && all[m[1]] && all[m[1]].start !== null) {
        // comm with spaces and a ')' inside, as the kernel allows
        const rest = Array.from({ length: 50 }, (_, i) => String(i + 3));
        rest[22 - 3] = all[m[1]].start;
        return `${m[1]} (we ird) name) ${rest.join(' ')}\n`;
      }
      return null;
    },
    signal(pid) {
      if (onSignal) onSignal(pid);
      return all[pid] ? all[pid].signal : 'dead';
    },
    uptime: () => (uptime === null ? NaN : uptime),
  };
}

function lockSetup(t) {
  const dir = tmpDir(t);
  const file = path.join(dir, 'laneboard', 'audit.jsonl');
  fs.mkdirSync(path.dirname(file), { mode: 0o700 });
  return { dir, file, lock: `${file}.lock` };
}

function opens(file, proc) {
  const a = openAudit({ file, proc });
  a.close();
  return true;
}

const lockedErr = (err) => err.code === 'AUDIT_LOCKED';

test('SR2 M2: the lock records pid, host, boot id and start time (from /proc, "-" without it)', (t) => {
  const { file, lock } = lockSetup(t);
  const a = openAudit({ file, proc: fakeProc() });
  assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid} ${HOST} ${BOOT_A} 4242\n`, 'field 22 parsed after the last ")"');
  a.close();
  const b = openAudit({ file, proc: fakeProc({ boot: null }) });
  assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid} ${HOST} - -\n`);
  b.close();
});

test('SR2 M2: a lock from an earlier boot is stale, even when its pid is alive now or the hostname changed', (t) => {
  const { file, lock } = lockSetup(t);
  // after a reboot pid 1 is init and answers EPERM; the old hostname may differ
  for (const line of [`1 ${HOST} ${BOOT_B} 77\n`, `1 old-name ${BOOT_B} 77\n`, `${process.pid} ${HOST} ${BOOT_B} 4242\n`]) {
    fs.writeFileSync(lock, line);
    assert.ok(opens(file, fakeProc({ pids: { 1: { start: '1', signal: 'eperm' } } })), line);
    assert.equal(fs.existsSync(lock), false);
  }
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.lock.'));
  assert.deepEqual(leftovers, [], 'no temp or aside files left behind');
});

test('SR2 M2: same boot: a dead pid or a reused pid (other start time) is stale; a live owner is not', (t) => {
  const { file, lock } = lockSetup(t);
  const owner = 4000001;
  const line = `${owner} ${HOST} ${BOOT_A} 500\n`;
  // dead
  fs.writeFileSync(lock, line);
  assert.ok(opens(file, fakeProc()));
  // alive with the recorded start time: live, fail closed
  fs.writeFileSync(lock, line);
  assert.throws(() => openAudit({ file, proc: fakeProc({ pids: { [owner]: { start: '500', signal: 'alive' } } }) }),
    (err) => lockedErr(err) && err.message.includes(`pid ${owner}`));
  assert.throws(() => openAudit({ file, proc: fakeProc({ pids: { [owner]: { start: '500', signal: 'eperm' } } }) }), lockedErr);
  // the pid now belongs to another process (alive or EPERM, different start time): stale
  assert.ok(opens(file, fakeProc({ pids: { [owner]: { start: '900', signal: 'alive' } } })));
  fs.writeFileSync(lock, line);
  assert.ok(opens(file, fakeProc({ pids: { [owner]: { start: '900', signal: 'eperm' } } })));
  // EPERM without a readable start time does not prove the owner is alive
  fs.writeFileSync(lock, line);
  assert.ok(opens(file, fakeProc({ pids: { [owner]: { start: null, signal: 'eperm' } } })));
  // alive, start time unreadable (e.g. hidepid): live
  fs.writeFileSync(lock, line);
  assert.throws(() => openAudit({ file, proc: fakeProc({ pids: { [owner]: { start: null, signal: 'alive' } } }) }), lockedErr);
  // same boot, another host (another container on this kernel): live
  fs.writeFileSync(lock, `${owner} other-host ${BOOT_A} 500\n`);
  assert.throws(() => openAudit({ file, proc: fakeProc() }), (err) => lockedErr(err) && /other-host/.test(err.message));
  fs.unlinkSync(lock);
});

test('SR2 M2: without /proc (or for an old-format lock) pid liveness and the boot time decide', (t) => {
  const { file, lock } = lockSetup(t);
  const owner = 4000002;
  const nowS = Math.floor(Date.now() / 1000);
  const noProc = (extra = {}) => fakeProc({ boot: null, ...extra });
  // old format, alive: live; EPERM counts as alive when no start time was recorded
  fs.writeFileSync(lock, `${owner} ${HOST}\n`);
  assert.throws(() => openAudit({ file, proc: noProc({ pids: { [owner]: { start: null, signal: 'eperm' } } }) }), lockedErr);
  assert.throws(() => openAudit({ file, proc: fakeProc({ pids: { [owner]: { start: null, signal: 'eperm' } } }) }), lockedErr,
    'an old-format lock on a /proc system: no start time to compare');
  // old format, dead: stale
  assert.ok(opens(file, noProc()));
  // a lock written before the current boot (btime from /proc/stat, else now - uptime): stale even if "alive"
  for (const proc of [noProc({ btime: nowS, pids: { [owner]: { start: null, signal: 'eperm' } } }),
    noProc({ uptime: 60, pids: { [owner]: { start: null, signal: 'eperm' } } })]) {
    fs.writeFileSync(lock, `${owner} other-host - -\n`);
    fs.utimesSync(lock, nowS - 3600, nowS - 3600);
    assert.ok(opens(file, proc));
  }
  // written after the current boot, other host: live
  fs.writeFileSync(lock, `${owner} other-host - -\n`);
  assert.throws(() => openAudit({ file, proc: noProc({ btime: nowS - 3600 }) }), lockedErr);
  fs.unlinkSync(lock);
});

test('SR2 M2: an unreadable lock is stale only when it is older than the current boot', (t) => {
  const { file, lock } = lockSetup(t);
  const nowS = Math.floor(Date.now() / 1000);
  for (const junk of ['', 'garbage', '0 host\n']) {
    fs.writeFileSync(lock, junk);
    assert.throws(() => openAudit({ file, proc: fakeProc({ btime: nowS - 3600 }) }), (err) => lockedErr(err) && /unreadable/.test(err.message));
    fs.utimesSync(lock, nowS - 7200, nowS - 7200);
    assert.ok(opens(file, fakeProc({ btime: nowS - 3600 })), JSON.stringify(junk));
  }
});

test('SR2 L10: two openers taking over the same stale lock: one wins, the winner keeps its lock', (t) => {
  const { file, lock } = lockSetup(t);
  const dead = 4000003;
  fs.writeFileSync(lock, `${dead} ${HOST} ${BOOT_A} 500\n`);
  let winner = null;
  // B judges the lock stale; while it does, A (another boot id view: sees it stale too) takes over first
  const procB = fakeProc({
    onSignal(pid) {
      if (pid === dead && winner === null) winner = openAudit({ file, proc: fakeProc({ boot: BOOT_B }) });
    },
  });
  t.after(() => winner?.close());
  assert.throws(() => openAudit({ file, proc: procB }), (err) => lockedErr(err) && /took over the stale lock first/.test(err.message));
  assert.ok(winner, 'A opened');
  const e = winner.append(act(1));
  assert.equal(e.prevHash, GENESIS, 'the winner still holds its lock and writes');
  assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid} ${HOST} ${BOOT_B} 4242\n`);
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.lock.'));
  assert.deepEqual(leftovers, []);
});

test('SR2 L11: only a single torn prefix per gap is tolerated; inserted lines are bad_json', (t) => {
  const { file, audit } = setup(t);
  const a = audit.append(act(1));
  const b = audit.append(act(2));
  audit.close();
  const [l1, l2] = lines(file);
  const v = (mid) => verifyFile([l1, ...mid, l2], a.prevHash);
  assert.equal(v(['{"action":"send-text","argsHash":"0']).ok, true);
  assert.equal(v(['{"act']).ok, true, 'a prefix shorter than the key');
  const fake = '{"action":"kill","target":"prod","user":"alice","ts":1}';
  for (const mid of [[fake], ['not even json'], ['{"ts":1,"id":"to'], ['{"action":"a', '{"action":"b'], [fake, '{"action":"x']]) {
    const r = v(mid);
    assert.equal(r.ok, false, JSON.stringify(mid));
    assert.equal(r.firstBad.reason, 'bad_json');
  }
  // the writer refuses to extend a log with an inserted line
  fs.writeFileSync(file, `${l1}\n${fake}\n${l2}\n`);
  const re = openAudit({ file });
  t.after(() => re.close());
  assert.throws(() => re.append(act(3)), (err) => err.code === 'AUDIT_CHAIN_INVALID' && /bad_json/.test(err.message));
  assert.equal(b.prevHash, a.hash);
});

test('SR2 L12: control characters are removed from result keys; colliding keys are refused', (t) => {
  const { audit } = setup(t);
  const e = audit.append(act(1, { result: { 'k\x1b[2J': 1, nested: { 'a\nb': 'x' } } }));
  assert.deepEqual(Object.keys(e.result).sort(), ['k�[2J', 'nested']);
  assert.deepEqual(Object.keys(e.result.nested), ['a b']);
  assert.ok(!/[\x00-\x1f]/.test(JSON.stringify(audit.read().entries)));
  assert.throws(() => audit.append(act(2, { result: { 'a\nb': 1, 'a b': 2 } })), /collide/);
  assert.equal(audit.verifyAll().ok, true);
});

test('SR2 L13: a wide directory is tightened only when created here or named laneboard; others are refused', (t) => {
  const dir = tmpDir(t);
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.chmodSync(home, 0o755);
  assert.throws(() => openAudit({ file: path.join(home, 'audit.jsonl') }), (err) => err.code === 'AUDIT_UNSAFE_DIR' && /other users/.test(err.message));
  assert.equal(fs.statSync(home).mode & 0o777, 0o755, 'left alone');
  assert.equal(fs.existsSync(path.join(home, 'audit.jsonl')), false);
  const lb = path.join(dir, 'laneboard');
  fs.mkdirSync(lb);
  fs.chmodSync(lb, 0o755);
  openAudit({ file: path.join(lb, 'audit.jsonl') }).close();
  assert.equal(fs.statSync(lb).mode & 0o777, 0o700);
});
