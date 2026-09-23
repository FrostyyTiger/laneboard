// The status line on a fresh ~/.claude (v3 Stage 2). HOME points at a scratch
// directory before config is imported, so nothing real is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-sl-'));
process.env.HOME = home;
const sl = await import('../server/collector/statusline.mjs');
const { config } = await import('../server/config.mjs');

test('config really points at the scratch home', () => {
  assert.equal(config.statuslinePath, path.join(home, '.claude', 'statusline-command.sh'));
});

test('no status line yet: the laneboard installs its own, sidecar included', async () => {
  const r = await sl.ensureStatusline();
  assert.deepEqual(r, { installed: true, fresh: true });
  const st = fs.statSync(config.statuslinePath);
  assert.ok(st.mode & 0o100, 'it must be executable');
  assert.ok(sl.isInstalled(fs.readFileSync(config.statuslinePath, 'utf8')));
  // Idempotent: the second run finds the sidecar and does nothing.
  assert.equal((await sl.ensureStatusline()).installed, false);
});

test('the installed script prints one line and mirrors stdin to the cache', () => {
  const input = JSON.stringify({
    session_id: 'abc-123', model: { display_name: 'Haiku' }, cwd: '/nowhere/example-repo-bauplan',
    context_window: { used_percentage: 7.9 }, rate_limits: { five_hour: { used_percentage: 33.3 } },
  });
  const out = execFileSync('bash', [config.statuslinePath], { input, env: { ...process.env, HOME: home, LANEBOARD_REPO_PREFIXES: 'example-repo-' } }).toString();
  assert.equal(out, 'Haiku · bauplan · ctx 7% · 5h 33%');
  const cached = JSON.parse(fs.readFileSync(path.join(home, '.cache/laneboard/status/abc-123.json'), 'utf8'));
  assert.equal(cached.session_id, 'abc-123');
});

test('an existing script is appended to after a backup, never replaced', async () => {
  const own = '#!/bin/bash\ninput=$(cat)\nprintf "mine"\n';
  fs.writeFileSync(config.statuslinePath, own);
  const r = await sl.ensureStatusline();
  assert.equal(r.installed, true);
  assert.equal(fs.readFileSync(r.backup, 'utf8'), own);
  const next = fs.readFileSync(config.statuslinePath, 'utf8');
  assert.ok(sl.isInstalled(next));
  assert.ok(next.trimEnd().endsWith('printf "mine"'), 'its own output stays last');
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
