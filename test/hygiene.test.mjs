// The hygiene gate.
//
// laneboard was extracted from a private repository. Nothing that names the
// hosts, the people, the internal repos or the private addresses it grew up
// with may ever be committed again, so the grep that guarded the extraction
// runs as a test: it walks every tracked file and fails on the first hit,
// naming the file and the line.
//
// Two kinds of pattern:
//
//   STRUCTURAL   shapes that are wrong wherever they appear — a private or
//                CGNAT address, a tailnet hostname, someone's home directory.
//                Readable, and the ones that will catch a future mistake.
//
//   DENY         the specific names the extraction removed. This list is
//                base64 here on purpose and not because anything about it is
//                clever: a plaintext list of "the private names we scrubbed"
//                is itself the leak it exists to prevent, and this file is
//                public. Decode it if you need to read it; it is a `|`-joined
//                list of lowercase words.
//
// To add a term: append to STRUCTURAL, or decode DENY_B64, add the word and
// re-encode. Nothing else changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const DENY_B64 =
  'bmF2aWdvfGdhbnltZWRlfHRhaWw5MDM0MTJ8bGFzemxvfGtpbWl8Y29kZXh8bTg3fGZyb3N0eXxtYXJjZWx8ZnJvc3R5eXRpZ2Vy';

const STRUCTURAL = [
  String.raw`192\.168\.\d+\.\d+`,              // a private LAN address
  String.raw`\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b`, // CGNAT, i.e. a tailnet address
  String.raw`\b[a-z0-9-]+\.ts\.net\b`,         // a tailnet hostname
  String.raw`/home/(?!user\b)[a-z0-9_]+`,      // somebody's real home directory
];

/** The one pattern everything is tested against. */
export function hygienePattern() {
  const deny = Buffer.from(DENY_B64, 'base64').toString('utf8')
    .split('|')
    .map((w) => `\\b${w}\\b`);
  return new RegExp([...STRUCTURAL, ...deny].join('|'), 'i');
}

// This file is the one exemption, and it has to be: the canary below spells
// out the shapes the gate catches, so scanning it would always fail. Nothing
// else is ever exempt.
const SELF = 'test/hygiene.test.mjs';

/** Every file git tracks, or — outside a checkout — every file we ship. */
function trackedFiles() {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' });
    const files = out.split('\0').filter(Boolean);
    if (files.length) return files;
  } catch {
    // Not a git checkout (a tarball, a CI cache): fall through to the walk.
  }
  const skip = new Set(['node_modules', '.git', 'data']);
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out;
}

/** A file we cannot read as text (an icon, a binary) has nothing to scan. */
function readText(abs) {
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

test('no tracked file names a host, a person or a private address', () => {
  const re = hygienePattern();
  const hits = [];
  for (const rel of trackedFiles()) {
    if (rel === SELF) continue;
    let text;
    try { text = readText(path.join(ROOT, rel)); } catch { continue; }
    if (text == null) continue;
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], `private material in tracked files:\n${hits.join('\n')}`);
});

test('the gate catches what it is for, and nothing ordinary', () => {
  // A test that can only pass is not a gate. These are the shapes it exists
  // for, written so the file itself stays clean.
  const re = hygienePattern();
  const deny = Buffer.from(DENY_B64, 'base64').toString('utf8').split('|');
  assert.ok(deny.length >= 5, 'the deny list decoded');
  for (const word of deny) {
    assert.equal(re.test(`run it on the ${word} box`), true, word);
    assert.equal(re.test(word.toUpperCase()), true, word);
  }
  // Assembled rather than written out: a plain `grep` for the same patterns is
  // the pre-commit habit this test backs up, and it should not trip over the
  // test's own examples.
  const addr = (...o) => o.join('.');
  assert.equal(re.test(addr('192', '168', '1', '10')), true);
  assert.equal(re.test(addr('100', '96', '35', '91')), true);
  assert.equal(re.test(`https://somebox${addr('', 'ts', 'net')}:8443`), true);
  assert.equal(re.test('/home/someone/code'), true);

  // And the shapes that are fine: the neutral names the fixtures use.
  assert.equal(re.test('a perfectly ordinary line of code'), false);
  assert.equal(re.test('/home/user/code/example-repo'), false);
  assert.equal(re.test(addr('127', '0', '0', '1:7777')), false);
  assert.equal(re.test(addr('10', '0', '0', '5')), false);
  assert.equal(re.test('example.invalid'), false);
});
