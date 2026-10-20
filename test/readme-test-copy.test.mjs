// README's "second copy for testing" stays isolated (runs T13, reviews 14 #1
// and 20 #1): the command sets a temp state dir and audit file, and every env
// var it names is a real one (documented in docs/config.md and read by code).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function testCopySection() {
  const readme = read('README.md');
  const at = readme.indexOf('A second copy for testing');
  assert.ok(at >= 0, 'README has the second-copy section');
  const end = readme.indexOf('\n## ', at);
  return readme.slice(at, end < 0 ? undefined : end);
}

function sourceOf(dir) {
  const out = [];
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true, recursive: true })) {
    if (ent.isFile() && ent.name.endsWith('.mjs')) out.push(fs.readFileSync(path.join(ent.parentPath ?? ent.path, ent.name), 'utf8'));
  }
  return out.join('\n');
}

test('the test copy sets a temp state dir and audit file', () => {
  const section = testCopySection();
  const block = section.match(/```bash\n([\s\S]*?)```/)?.[1] ?? '';
  assert.match(block, /tmp=\$\(mktemp -d\)/);
  assert.match(block, /LANEBOARD_STATE_DIR="\$tmp"/);
  assert.match(block, /LANEBOARD_AUDIT_FILE="\$tmp\/audit\.jsonl"/);
  assert.match(block, /LANEBOARD_DB=:memory:/);
  assert.match(block, /LANEBOARD_CONFIG=\/dev\/null/);
});

test('the section says how to point the CLI at the copy and how to stop it', () => {
  const section = testCopySection();
  assert.match(section, /LANEBOARD_URL=http:\/\/127\.0\.0\.1:7788/);
  assert.match(section, /Ctrl-C/);
});

test('every env var the section names is documented and read by the code', () => {
  const names = [...new Set(testCopySection().match(/LANEBOARD_[A-Z0-9_]+/g))];
  assert.ok(names.length >= 6, names.join(' '));
  const docs = read('docs/config.md');
  const code = sourceOf('server') + read('bin/laneboard');
  for (const name of names) {
    if (name !== 'LANEBOARD_URL') assert.ok(docs.includes(`\`${name}\``), `${name} in docs/config.md`);
    assert.ok(code.includes(name), `${name} read by server/ or bin/laneboard`);
  }
});
