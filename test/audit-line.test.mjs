// The startup line for an audit log that could not be opened (runs T32, review
// r33 #2): the reason from fleet/audit.mjs stands next to the code, so a
// mode-775 state dir says what to change instead of only `AUDIT_UNSAFE_DIR`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAudit } from '../server/fleet/audit.mjs';
import { auditErrorLine } from '../server/boot/audit-line.mjs';

test('auditErrorLine: a mode-775 dir gives the reason next to AUDIT_UNSAFE_DIR on one line', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-audit-line-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wide = path.join(dir, 'lb');
  fs.mkdirSync(wide);
  fs.chmodSync(wide, 0o775);
  let err;
  try { openAudit({ file: path.join(wide, 'audit.jsonl') }); } catch (e) { err = e; }
  assert.equal(err?.code, 'AUDIT_UNSAFE_DIR');
  const line = auditErrorLine(err);
  assert.match(line, /^laneboard: audit: .*lb is accessible to other users; put the audit log in a private directory \(chmod 700 it/);
  assert.match(line, /\(AUDIT_UNSAFE_DIR\); every action is refused until it is fixed$/);
  assert.ok(!line.includes('\n'));
});

test('auditErrorLine: a held lock keeps the boot line, other errors give null', () => {
  const locked = Object.assign(new Error('audit: /s/audit.jsonl.lock is held by pid 42 on h (set LANEBOARD_AUDIT_FILE)'), { code: 'AUDIT_LOCKED' });
  assert.equal(auditErrorLine(locked), `laneboard: ${locked.message}`);
  assert.equal(auditErrorLine(Object.assign(new Error('x'), { code: 'EACCES' })), null);
  assert.equal(auditErrorLine(new Error('boom')), null);
  assert.match(auditErrorLine(Object.assign(new Error(''), { code: 'AUDIT_BROKEN' })), /^laneboard: the audit log could not be opened \(AUDIT_BROKEN\)/);
});
