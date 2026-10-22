// Names come from config or the hostname only (runs night 5 T10, stranger r49 a).
// With no config file, the Map's title and the builder's id and code are the
// hostname's, whatever else the shell exports (a loop's $LANEBOARD_RUN), there is
// no fleet block, and a lane's branch still shows. docs/config.md lists every
// variable the board and its CLI read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildConfig } from '../server/config.mjs';
import { build as buildMap } from '../server/map.mjs';
import { sanitizeId, deriveCode } from '../server/fleet/keys.mjs';

const NOW = 1_800_000_000_000;
const ENV = { LANEBOARD_CONFIG: '/dev/null', LANEBOARD_RUN: 'run-x/3', LANEBOARD_RUN_FILE: '/tmp/run-x.jsonl' };

test('no config: the hostname names the board, never another environment variable', () => {
  const c = buildConfig({ env: ENV });
  const host = os.hostname();
  assert.equal(c.hostname, host);
  assert.equal(c.fleet.id, sanitizeId(host));
  assert.equal(c.fleet.code, deriveCode(sanitizeId(host)));
  assert.equal(c.fleet.ingressPort, null, 'no fleet block: no ingress listener');
  assert.deepEqual(c.fleet.builders, []);
  assert.equal(c.mode, 'builder');

  const snapshot = {
    sessions: [{ name: 's1', state: 'working' }],
    lanes: [{ id: 'docs', branch: 'feat/docs', sessions: ['s1'] }],
  };
  const m = buildMap({ topology: null, snapshot, now: NOW, builderId: c.fleet.id, code: c.fleet.code, hostname: c.hostname });
  assert.equal(m.title, host);
  assert.equal(m.nodes.find((n) => n.kind === 'core').label, host);
  assert.deepEqual(m.fleet.builders.map((b) => b.id), [c.fleet.id], 'a fleet of one: this machine');
  const lane = m.nodes.find((n) => n.kind === 'lane');
  assert.equal(lane.detail.Branch, 'feat/docs', 'the branch still shows');
  assert.doesNotMatch(JSON.stringify(m), /run-x/, 'the run id in the shell names nothing');
});

test('docs/config.md lists every LANEBOARD_* variable the code reads, in its Environment variables section', () => {
  const root = new URL('../', import.meta.url);
  const docs = fs.readFileSync(new URL('docs/config.md', root), 'utf8');
  const at = docs.indexOf('\n## Environment variables');
  assert.ok(at > 0, 'the section exists');
  const section = docs.slice(at);
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ['server', 'public/js']) walk(fileURLToPath(new URL(d, root)));
  files.push(fileURLToPath(new URL('bin/laneboard', root)), fileURLToPath(new URL('bin/laneboardctl', root)));
  const vars = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bLANEBOARD_[A-Z0-9_]*[A-Z0-9]\b/g)) vars.add(m[0]);
  assert.ok(vars.size > 30, `found ${vars.size}`);
  const missing = [...vars].filter((v) => !section.includes(`\`${v}\``));
  assert.deepEqual(missing, []);
  assert.match(section, /`LANEBOARD_RUN` \| the `laneboard run` CLI/);
});
