import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  fs.appendFileSync(file, '{"ts":12,"id":"tor');
  const e = re.append(act(4));
  assert.equal(e.prevHash, d.hash, 'chains onto the last parsable entry');
  const ls = fs.readFileSync(file, 'utf8').split('\n');
  assert.equal(JSON.parse(ls[4]).hash, e.hash, 'the new entry is on its own line');
  const v = re.verifyAll();
  assert.equal(v.ok, false);
  assert.deepEqual(v.firstBad, { file, line: 4, reason: 'bad_json' });
  assert.ok(re.read({ after: d.hash }).entries.some((x) => x.hash === e.hash), 'read skips the torn line');
});

test('an external write to the file is noticed before the next append', (t) => {
  const { file, audit } = setup(t);
  audit.append(act(1));
  // another writer (e.g. a second process) appended a valid entry
  const other = openAudit({ file });
  const x = other.append(act(2));
  other.close();
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
