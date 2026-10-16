// The Box view (fleet plan §4 D11): the pure model over the client store
// (hub fleet rows and the single local builder), the health model and the
// sparkline history, and the DOM builders run against the fake document.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument } from './helpers/fakedom.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.document = makeDocument();

const B = await import('../public/js/views/box.js');
const { createStore, applyBuilders, applySnapshot, ingest, setSourceKind, setSourceStatus } = await import('../public/js/core/store.js');

const NOW = 1_700_000_000_000;

function hubStore(rows) {
  const s = createStore();
  setSourceKind(s, 'hub');
  ingest(s, { type: 'fleet', hub: { version: '1.4.0', now: NOW }, builders: rows, aggregates: null });
  return s;
}

const row = (id, state, extra = {}) => ({
  id, code: id.toUpperCase().slice(0, 3), state, ageMs: 1200, latencyMs: 42, version: '1.4.0', versionSkew: 'same',
  controls: state === 'up', capabilities: ['health'], directUrl: `https://${id}.example.invalid:8443/`, ...extra,
});

function sample(at, over = {}) {
  return {
    at, uptimeS: 1000, vcpu: 4,
    cpu: { busyPct: 30, iowaitPct: 2, stealPct: 0 }, load: [2, 1.5, 1], loadPerCpu: 0.5,
    mem: { totalMb: 16384, availMb: 8192, availPct: 50 }, swap: { totalMb: 8192, usedMb: 1024, inPerSec: 3, outPerSec: 0 },
    psi: { cpu: { some10: 4 }, memory: { some10: 1, full10: 0.5 }, io: { some10: 2, full10: 1 } },
    fs: [{ mount: '/', path: '/', sizeMb: 100000, availMb: 40000, usedPct: 60 }, { mount: 'docker', path: '/var/lib/docker', sizeMb: 50000, availMb: 4000, usedPct: 92 }],
    docker: { ok: true, running: 5, unhealthy: 0, restarting: 0 },
    slots: { total: 4, inUse: 2 }, rebootRequired: false, tailscale: { online: true, backendState: 'Running' },
    alarms: [], ...over,
  };
}

/** Every node in a fake-DOM subtree. */
function walk(n, out = []) {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
}
const named = (n) => Boolean(n.attrs?.['aria-label'] || n.title);

// --- model ---------------------------------------------------------------------

test('hub rows: up, stale, down, misconfigured, incompatible and connecting map to lamp, word and stale', () => {
  const s = hubStore([
    row('builder-a', 'up'), row('builder-b', 'stale'), row('builder-c', 'down'),
    row('builder-d', 'misconfigured'), row('builder-e', 'incompatible'), row('builder-f', 'connecting'),
  ]);
  const m = B.boxModel(s, { now: NOW });
  assert.equal(m.hub, true);
  assert.equal(m.hubVersion, '1.4.0');
  const by = Object.fromEntries(m.rows.map((r) => [r.id, r]));
  assert.deepEqual(m.rows.map((r) => r.id), ['builder-a', 'builder-b', 'builder-c', 'builder-d', 'builder-e', 'builder-f']);
  assert.deepEqual([by['builder-a'].p, by['builder-a'].word, by['builder-a'].stale], ['ok', 'UP', false]);
  assert.deepEqual([by['builder-b'].p, by['builder-b'].word, by['builder-b'].stale], ['3', 'STALE', true]);
  assert.deepEqual([by['builder-c'].p, by['builder-c'].word, by['builder-c'].stale], ['1', 'DOWN', true]);
  assert.deepEqual([by['builder-d'].p, by['builder-d'].word, by['builder-d'].stale], ['1', 'MCFG', true]);
  assert.match(by['builder-d'].stateText, /misconfigured/);
  assert.deepEqual([by['builder-e'].p, by['builder-e'].word], ['2', 'INCMP']);
  assert.deepEqual([by['builder-f'].p, by['builder-f'].word], ['off', 'CONN']);
  for (const r of m.rows) assert.ok(r.word.length <= 5, `${r.word} is a short label`);
  assert.equal(by['builder-a'].latencyMs, 42);
  assert.equal(by['builder-a'].ageMs, 1200);
  assert.equal(by['builder-a'].code, 'BUI');
  assert.equal(by['builder-a'].controls, true);
  assert.equal(by['builder-c'].controls, false);
  assert.equal(B.stateInfo('constructor').word, '—', 'an unknown state is a grey dash, never a prototype key');
});

test('version skew gets ▲ unless same; clock skew gets ▲ past 30 s', () => {
  const s = hubStore([
    row('builder-a', 'up', { versionSkew: 'minor', version: '1.3.0' }),
    row('builder-b', 'up', { versionSkew: 'same' }),
    row('builder-c', 'up', { versionSkew: null }),
  ]);
  // clockSkewMs is not part of the BuilderRow contract yet; the model reads it when present.
  s.builders.get('builder-a').clockSkewMs = 45_000;
  s.builders.get('builder-b').clockSkewMs = -12_000;
  const by = Object.fromEntries(B.boxModel(s, { now: NOW }).rows.map((r) => [r.id, r]));
  assert.equal(by['builder-a'].versionWarn, true);
  assert.equal(by['builder-b'].versionWarn, false);
  assert.equal(by['builder-c'].versionWarn, false);
  assert.equal(by['builder-a'].clockWarn, true);
  assert.equal(by['builder-b'].clockWarn, false);
  assert.equal(by['builder-c'].clockSkewMs, null);
  assert.equal(B.clockWarn(-30_001), true);
  assert.equal(B.clockWarn(30_000), false);
  assert.equal(B.fmtSkew(45_000), '+45s');
  assert.equal(B.fmtSkew(-1_200), '-1.2s');
  assert.equal(B.fmtSkew(null), '—');
});

test('the direct link is the hub-configured http(s) URL only', () => {
  assert.equal(B.safeDirectUrl('https://builder-a.example.invalid:8443'), 'https://builder-a.example.invalid:8443/');
  assert.equal(B.safeDirectUrl('http://127.0.0.1:7777/'), 'http://127.0.0.1:7777/');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'https://u:p@example.invalid/', '//example.invalid', 'ftp://example.invalid', '', null, 42, 'x'.repeat(3000)]) {
    assert.equal(B.safeDirectUrl(bad), null, `${String(bad).slice(0, 30)} is refused`);
  }
  const s = hubStore([row('builder-a', 'up', { directUrl: 'javascript:alert(1)' }), row('builder-b', 'up')]);
  const [a, b] = B.boxModel(s, { now: NOW }).rows;
  assert.equal(a.directUrl, null);
  assert.equal(b.directUrl, 'https://builder-b.example.invalid:8443/');
  // A local page is on its builder: no link, whatever the builder object holds.
  const l = createStore({ keyMode: 'name' });
  ingest(l, { type: 'hello', builder: { id: 'builder-a', code: 'BA' }, mode: 'builder', version: '1.4.0' });
  l.builders.get('builder-a').directUrl = 'https://evil.example.invalid/';
  assert.equal(B.boxModel(l, { now: NOW }).rows[0].directUrl, null);
});

test('the single local builder is one row, its state from the source status', () => {
  const s = createStore({ keyMode: 'name' });
  ingest(s, { type: 'hello', builder: { id: 'builder-a', code: 'BA' }, mode: 'builder', version: '1.4.0' }, NOW - 5000);
  let m = B.boxModel(s, { now: NOW });
  assert.equal(m.hub, false);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].state, 'connecting');
  setSourceStatus(s, 'open');
  applySnapshot(s, 'builder-a', { sessions: [], lanes: [], attention: [], box: { slots: [] }, vitals: { cpuPct: 3 }, generatedAt: NOW });
  s.builders.get('builder-a').lastMsgAt = NOW - 3000;
  m = B.boxModel(s, { now: NOW });
  const r = m.rows[0];
  assert.deepEqual([r.state, r.p, r.code, r.version, r.ageMs, r.latencyMs, r.versionWarn], ['up', 'ok', 'BA', '1.4.0', 3000, null, false]);
  assert.equal(m.local, r);
  assert.deepEqual(r.box, { slots: [] });
  setSourceStatus(s, 'closed');
  assert.equal(B.boxModel(s, { now: NOW }).rows[0].state, 'down');
});

test('scope b= narrows the rows; a single scoped hub builder carries its box blocks', () => {
  const s = hubStore([row('builder-a', 'up'), row('builder-b', 'down')]);
  const m = B.boxModel(s, { now: NOW, scope: 'builder-b' });
  assert.deepEqual(m.rows.map((r) => r.id), ['builder-b']);
  assert.equal(m.local.id, 'builder-b');
  assert.equal(B.boxModel(s, { now: NOW }).local, null);
});

test('health: the latest sample, alarms worst first, the lamp follows a health alarm while up', () => {
  const s = hubStore([row('builder-a', 'up'), row('builder-b', 'down')]);
  const alarms = [
    { key: 'fsUsedPct:docker', level: 'warn', text: 'disk docker 92% used' },
    { key: 'memAvailPct', level: 'crit', text: 'mem 4% available' },
    { key: 'bogus', level: 'meh', text: 'dropped' },
  ];
  ingest(s, { type: 'health', builder: 'builder-a', health: sample(NOW, { alarms }) });
  ingest(s, { type: 'health', builder: 'builder-b', health: sample(NOW, { alarms }) });
  const [a, b] = B.boxModel(s, { now: NOW }).rows;
  const h = a.health;
  assert.deepEqual(h.alarms.map((x) => [x.key, x.p]), [['memAvailPct', '2'], ['fsUsedPct:docker', '3']]);
  assert.equal(a.p, '2', 'up with a crit health alarm: p2 lamp');
  assert.equal(b.p, '1', 'down stays down whatever the health says');
  assert.deepEqual([h.cpuPct, h.loadPerCpu, h.memAvailPct, h.swapUsedPct, h.swapInPerSec, h.psiIoFull], [30, 0.5, 50, 12.5, 3, 1]);
  assert.deepEqual(h.fs.map((f) => [f.mount, f.usedPct]), [['/', 60], ['docker', 92]]);
  assert.deepEqual(h.slots, { total: 4, inUse: 2 });
  assert.equal(B.alarmFor(h, 'fsUsedPct:docker').level, 'warn');
  assert.equal(B.alarmFor(h, 'cpu'), null);
  assert.equal(B.healthModel(null), null);
  assert.equal(B.healthModel([1]), null);
  const junk = B.healthModel({ cpu: 'x', mem: null, fs: 'no', alarms: {}, docker: 1 });
  assert.deepEqual([junk.cpuPct, junk.fs, junk.alarms, junk.docker], [null, [], [], null]);
  assert.deepEqual(B.meterMix(92, 'warn'), { p1: 0, p2: 92, run: 0, ok: 0, off: 8, dead: 0, total: 100 });
  assert.deepEqual(B.meterMix(60), { p1: 0, p2: 0, run: 60, ok: 0, off: 40, dead: 0, total: 100 });
  assert.equal(B.meterMix(null).total, 0);
});

test('sparkline series: 60 points, merged by `at`, gaps kept as null', () => {
  const list = Array.from({ length: 90 }, (_, i) => sample(NOW + i * 10_000, { cpu: { busyPct: i } }));
  const merged = B.mergeSamples(list.slice(0, 50), list.slice(40));
  assert.equal(merged.length, B.SPARK_POINTS);
  assert.equal(merged.at(-1).at, NOW + 89 * 10_000);
  const ser = B.seriesOf([...merged.slice(0, -1), { at: 1, cpu: {} }]);
  assert.equal(ser.cpu.length, 60);
  assert.equal(ser.cpu.at(-1), null);
  assert.equal(ser.mem[0], 50);
  assert.deepEqual(Object.keys(ser), ['cpu', 'mem', 'load', 'swapIn', 'psiIo']);
});

test('history: fetched through the hub read proxy for up builders with the health capability, once per TTL, quietly', async () => {
  B.resetHistory();
  const s = hubStore([row('builder-a', 'up'), row('builder-b', 'up', { capabilities: [] }), row('builder-c', 'down')]);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ latest: null, history: [sample(NOW - 20_000), sample(NOW - 10_000)] }) };
  };
  let done = 0;
  await B.refreshHistory(s, { now: NOW, fetchImpl, onDone: () => { done++; } });
  assert.deepEqual(urls, ['/api/fleet/builder-a/v1/health?history=1']);
  assert.equal(done, 1);
  await B.refreshHistory(s, { now: NOW + 1000, fetchImpl });
  assert.equal(urls.length, 1, 'fresh history is not fetched again');
  await B.refreshHistory(s, { now: NOW + B.HISTORY_TTL_MS + 1, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(B.historyUrl('builder-a', false), '/api/v1/health?history=1');
  assert.equal(B.historyUrl('a/b', true), '/api/fleet/a%2Fb/v1/health?history=1');
  B.resetHistory();
});

// --- render --------------------------------------------------------------------

test('render: the builders and health tables name every lamp, icon, mark and sparkline', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const s = hubStore([
    row('builder-a', 'up', { versionSkew: 'major', version: evil, code: evil }),
    row('builder-b', 'stale'), row('builder-c', 'down', { directUrl: 'javascript:alert(1)' }), row('builder-d', 'misconfigured'),
  ]);
  s.builders.get('builder-a').clockSkewMs = 40_000;
  ingest(s, { type: 'health', builder: 'builder-a', health: sample(NOW, { rebootRequired: true, alarms: [{ key: 'rebootRequired', level: 'warn', text: evil }, { key: 'fsUsedPct:docker', level: 'warn', text: 'disk docker 92% used' }] }) });
  ingest(s, { type: 'health', builder: 'builder-b', health: sample(NOW) });
  const m = B.boxModel(s, { now: NOW });
  const roots = [B.buildersPanel(m), B.healthPanel(m)];
  const nodes = roots.flatMap((r) => walk(r));
  const icons = nodes.filter((n) => n.tagName === 'SVG');
  const lamps = nodes.filter((n) => n.classList?.contains('lamp'));
  const marks = nodes.filter((n) => n.classList?.contains('box-warn'));
  assert.ok(icons.length >= 10, `sparklines and the link icon render (${icons.length})`);
  assert.ok(lamps.length >= 6, 'a lamp per builder row and per alarm');
  assert.ok(marks.length >= 3, 'version skew, clock skew and alarm marks');
  for (const n of [...icons, ...lamps, ...marks]) assert.ok(named(n), `${n.tagName}.${n.className} has a title or aria-label`);
  // The external-link icon itself carries the label (role img), not aria-hidden.
  const ext = icons.find((n) => n.children.some((c) => String(c.attrs?.href ?? '').endsWith('#i-external')));
  assert.ok(ext && ext.attrs['aria-label'] && ext.attrs.role === 'img');
  // Builder text is text: it shows up verbatim and never becomes markup.
  assert.ok(roots[0].textContent.includes(evil));
  assert.ok(nodes.every((n) => n.tagName !== 'IMG'));
  assert.ok(nodes.every((n) => !n.innerHTML));
  // Only http(s) links, only from the configured directUrl.
  const links = nodes.filter((n) => n.tagName === 'A');
  assert.deepEqual(links.map((a) => a.href), ['https://builder-a.example.invalid:8443/', 'https://builder-b.example.invalid:8443/', 'https://builder-d.example.invalid:8443/']);
  for (const a of links) assert.equal(a.rel, 'noopener noreferrer');
  // Stale and down rows are hatched.
  const trs = walk(roots[0]).filter((n) => n.tagName === 'TR' && n.dataset.builder);
  assert.deepEqual(trs.map((t) => [t.dataset.builder, t.classList.contains('is-stale')]),
    [['builder-a', false], ['builder-b', true], ['builder-c', true], ['builder-d', true]]);
  // Health shows only the builders with a sample.
  const htr = walk(roots[1]).filter((n) => n.tagName === 'TR' && n.dataset.builder);
  assert.deepEqual(htr.map((t) => t.dataset.builder), ['builder-a', 'builder-b']);
  assert.match(roots[1].textContent, /2\/4/);
  assert.match(roots[1].textContent, /REBT/);
});

test('render: empty states say what is missing', () => {
  const s = hubStore([]);
  const m = B.boxModel(s, { now: NOW });
  assert.match(B.buildersPanel(m).textContent, /No builders/);
  assert.match(B.healthPanel(m).textContent, /No health samples/);
  assert.match(B.boxBlocks(null)[0].textContent, /Waiting for the collectors/);
  const blocks = B.boxBlocks({ guard: { provider: 'none' }, ci: { provider: 'none' }, slots: [] });
  assert.match(blocks[0].textContent, /No guard, no agent slots and no CI configured/);
  const ci = B.boxBlocks({ ci: { provider: 'gh', queue: { running: 1, queued: 2, runs: [{ name: 'lint', branch: 'main', status: 'completed', conclusion: 'success' }] } } });
  assert.match(ci[0].textContent, /CI queue.*1 running · 2 queued.*lint/s);
});

test('the view is a registry default export and pure at import time', () => {
  const v = B.default;
  assert.equal(v.id, 'box');
  assert.equal(v.icon, 'box');
  for (const k of ['mount', 'unmount', 'update']) assert.equal(typeof v[k], 'function');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/views/box.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style/);
  assert.doesNotMatch(src, /\bclass\s+\w|\bsuper\b/);
});
