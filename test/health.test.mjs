// Builder health collector + /api/v1/health (fleet plan §7.3.3, O6). Runs on
// the /proc fixtures under test/fixtures/proc/ through injected readers:
// never needs Docker, Tailscale or a particular kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import * as h from '../server/collector/health.mjs';
import routeModule, { body as routeBody, PATH } from '../server/routes/health.mjs';
import * as v1 from '../server/fleet/api-v1.mjs';
import { createContext } from '../server/modules.mjs';
import { defaults as obsDefaults } from '../server/config/observability.mjs';
import { boot } from './helpers/boot.mjs';

const FIX = path.join(import.meta.dirname, 'fixtures', 'proc');
const fx = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const CFG = obsDefaults().health;

/** A readFile over the fixtures: `set` picks the .1 or .2 counters. */
function procReader(set = 1, overrides = {}) {
  const map = {
    [h.PROC_FILES.stat]: `stat.${set}`,
    [h.PROC_FILES.meminfo]: 'meminfo',
    [h.PROC_FILES.vmstat]: `vmstat.${set}`,
    [h.PROC_FILES.loadavg]: 'loadavg',
    [h.PROC_FILES.uptime]: 'uptime',
    [h.PROC_FILES.psiCpu]: 'pressure-cpu',
    [h.PROC_FILES.psiMemory]: 'pressure-memory',
    [h.PROC_FILES.psiIo]: 'pressure-io',
  };
  return async (p) => {
    if (Object.hasOwn(overrides, p)) {
      const v = overrides[p];
      if (v instanceof Error) throw v;
      return v;
    }
    if (!map[p]) throw Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
    return fx(map[p]);
  };
}

// 100 GiB disk with 4 KiB blocks: 90% used.
const STATFS = { bsize: 4096, blocks: 26214400, bfree: 2621440, bavail: 2621440 };
const statfsOk = async () => STATFS;

function deps(extra = {}) {
  let t = 1_000_000;
  return {
    cfg: CFG,
    vcpu: 4,
    statfs: statfsOk,
    exists: () => false,
    dockerGet: async () => JSON.parse(fx('docker-containers.json')),
    tailscale: async () => h.parseTailscale(fx('tailscale-status.json')),
    slots: () => [{ slot: 1, lane: 'a' }, { slot: 2, lane: null }, { slot: 3, lane: 'b' }],
    now: () => t,
    tick(ms) { t += ms; },
    worktreeDir: '/srv/code',
    ...extra,
  };
}

// --- parsers ----------------------------------------------------------------

test('parseStat reads the aggregate cpu line; cpuDelta does the maths', () => {
  const a = h.parseStat(fx('stat.1'));
  const b = h.parseStat(fx('stat.2'));
  assert.deepEqual(a, { total: 171000 + 1700 + 49500 + 11478000 + 3200 + 0 + 600 + 700, idle: 11478000, iowait: 3200, steal: 700 });
  assert.equal(b.total - a.total, 1000);
  assert.deepEqual(h.cpuDelta(a, b), { busyPct: 65, iowaitPct: 5, stealPct: 3 });
  assert.deepEqual(h.cpuDelta(null, b), { busyPct: null, iowaitPct: null, stealPct: null });
  assert.deepEqual(h.cpuDelta(b, b), { busyPct: null, iowaitPct: null, stealPct: null });
  assert.equal(h.parseStat('intr 1 2 3\n'), null);
  assert.equal(h.parseStat(''), null);
});

test('parseMeminfo and parseVmstat; swapRate in pages/s', () => {
  assert.deepEqual(h.parseMeminfo(fx('meminfo')), {
    memTotalKb: 16384000, memAvailableKb: 4096000, swapTotalKb: 4194304, swapFreeKb: 3145728,
  });
  const v1s = h.parseVmstat(fx('vmstat.1'));
  const v2s = h.parseVmstat(fx('vmstat.2'));
  assert.deepEqual(v1s, { pswpin: 1000, pswpout: 2000 });
  assert.deepEqual(h.swapRate(v1s, v2s, 10_000), { inPerSec: 60, outPerSec: 10 });
  assert.deepEqual(h.swapRate(v1s, v2s, 0), { inPerSec: null, outPerSec: null });
  // A counter reset (reboot between samples) gives null, never a negative rate.
  assert.deepEqual(h.swapRate(v2s, v1s, 10_000), { inPerSec: null, outPerSec: null });
});

test('parsePressure with and without a full line', () => {
  const cpu = h.parsePressure(fx('pressure-cpu'));
  assert.deepEqual(cpu, { some: { avg10: 62.5, avg60: 40.25, avg300: 20, total: 41762283 }, full: null });
  const mem = h.parsePressure(fx('pressure-memory'));
  assert.deepEqual(mem.full, { avg10: 6.5, avg60: 3.25, avg300: 1, total: 654321 });
  assert.equal(mem.some.avg10, 12);
  assert.equal(h.parsePressure(''), null);
  assert.equal(h.parsePressure('garbage'), null);
});

test('parseLoadavg and parseUptime', () => {
  assert.deepEqual(h.parseLoadavg(fx('loadavg')), [6, 4.5, 3]);
  assert.equal(h.parseUptime(fx('uptime')), 123456.78);
  assert.equal(h.parseLoadavg('x'), null);
  assert.equal(h.parseUptime(''), null);
});

test('fsEntry uses df arithmetic', () => {
  assert.deepEqual(h.fsEntry('/', '/', STATFS), { mount: '/', path: '/', sizeMb: 102400, availMb: 10240, usedPct: 90 });
});

test('dockerCounts counts by State and the (unhealthy) text', () => {
  assert.deepEqual(h.dockerCounts(JSON.parse(fx('docker-containers.json'))), { ok: false, running: 3, unhealthy: 1, restarting: 1 });
  assert.deepEqual(h.dockerCounts([]), { ok: true, running: 0, unhealthy: 0, restarting: 0 });
  assert.equal(h.dockerCounts({}), null);
});

test('tailscale output is reduced to {online, backendState}: no IPs, no names', () => {
  const raw = fx('tailscale-status.json');
  assert.match(raw, /192\.0\.2\./); // the fixture really carries them
  const t = h.parseTailscale(raw);
  assert.deepEqual(t, { online: true, backendState: 'Running' });
  const s = JSON.stringify(t);
  for (const bad of ['192.0.2', '2001:db8', 'example.invalid', 'builder-a', 'acme']) assert.ok(!s.includes(bad), bad);
  assert.equal(h.parseTailscale('not json'), null);
});

test('tailscaleStatus runs the read-only status command; throttled runs at most once per 60 s', async () => {
  const calls = [];
  const runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { ok: true, stdout: fx('tailscale-status.json') };
  };
  assert.deepEqual(await h.tailscaleStatus({ runner }), { online: true, backendState: 'Running' });
  assert.deepEqual(calls[0], ['tailscale', 'status', '--json', '--self', '--peers=false']);
  await assert.rejects(h.tailscaleStatus({ runner: async () => ({ ok: false, stdout: '' }) }));

  let n = 0;
  const get = h.throttled(async () => ({ online: true, backendState: `n${++n}` }), 60_000);
  assert.equal((await get(0)).backendState, 'n1');
  assert.equal((await get(59_999)).backendState, 'n1');
  assert.equal((await get(60_000)).backendState, 'n2');
  assert.equal(n, 2);
});

// --- docker request ---------------------------------------------------------

function fakeRequest(record, { status = 200, payload = '[]', error = null } = {}) {
  return (opts, cb) => {
    record.push(opts);
    const req = new EventEmitter();
    req.end = () => {
      if (error) { setImmediate(() => req.emit('error', error)); return; }
      const res = new EventEmitter();
      res.statusCode = status;
      setImmediate(() => {
        cb(res);
        res.emit('data', Buffer.from(payload));
        res.emit('end');
      });
    };
    req.destroy = (err) => setImmediate(() => req.emit('error', err ?? new Error('destroyed')));
    req.write = () => { throw new Error('the docker request never sends a body'); };
    return req;
  };
}

test('dockerGet issues only GET /containers/json on the socket, with a 2 s timeout', async () => {
  const seen = [];
  const list = await h.dockerGet('/run/docker-test.sock', { request: fakeRequest(seen, { payload: fx('docker-containers.json') }) });
  assert.equal(list.length, 5);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].path, '/containers/json');
  assert.equal(seen[0].socketPath, '/run/docker-test.sock');
  assert.equal(seen[0].timeout, 2000);
  assert.equal(seen[0].host, undefined);
  await assert.rejects(h.dockerGet('/x', { request: fakeRequest([], { status: 500 }) }), /status 500/);
  const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  await assert.rejects(h.dockerGet('/x', { request: fakeRequest([], { error: eacces }) }), (e) => e.code === 'EACCES');
});

// --- thresholds and debounce -------------------------------------------------

function sampleWith(over = {}) {
  return {
    swap: { inPerSec: 0 }, mem: { availPct: 50 }, loadPerCpu: 0.5,
    psi: { cpu: { some10: 0 }, memory: { some10: 0, full10: 0 }, io: { some10: 0, full10: 0 } },
    fs: [{ mount: '/', usedPct: 10 }], docker: { unhealthy: 0 }, rebootRequired: false,
    ...over,
  };
}

test('evaluate: threshold levels per key, both directions, warn-only keys', () => {
  assert.deepEqual(h.evaluate(sampleWith(), CFG), []);
  const lv = (over) => Object.fromEntries(h.evaluate(sampleWith(over), CFG).map((a) => [a.key, a.level]));
  assert.deepEqual(lv({ swap: { inPerSec: 50 } }), { swapInPerSec: 'warn' });
  assert.deepEqual(lv({ swap: { inPerSec: 500 } }), { swapInPerSec: 'crit' });
  assert.deepEqual(lv({ mem: { availPct: 15 } }), {}); // "< 15"
  assert.deepEqual(lv({ mem: { availPct: 14.9 } }), { memAvailPct: 'warn' });
  assert.deepEqual(lv({ mem: { availPct: 4 } }), { memAvailPct: 'crit' });
  assert.deepEqual(lv({ loadPerCpu: 3 }), { loadPerCpu: 'crit' });
  assert.deepEqual(lv({ fs: [{ mount: '/', usedPct: 85 }, { mount: 'docker', usedPct: 96 }] }), { 'fsUsedPct:/': 'warn', 'fsUsedPct:docker': 'crit' });
  assert.deepEqual(lv({ docker: { unhealthy: 7 } }), { dockerUnhealthy: 'warn' }); // never crit
  assert.deepEqual(lv({ docker: null }), {});
  assert.deepEqual(lv({ rebootRequired: true }), { rebootRequired: 'warn' });
  assert.deepEqual(lv({ psi: { cpu: { some10: 80 }, memory: { full10: 5 }, io: { full10: 30 } } }), { psiCpuSome10: 'crit', psiMemFull10: 'warn', psiIoFull10: 'crit' });
  // Null values never raise.
  assert.deepEqual(lv({ swap: { inPerSec: null }, mem: { availPct: null }, loadPerCpu: null }), {});
  const [a] = h.evaluate(sampleWith({ swap: { inPerSec: 600 } }), CFG);
  assert.deepEqual(a, { key: 'swapInPerSec', level: 'crit', value: 600, threshold: 500, text: 'swap-in 600 pages/s' });
  // Thresholds come from the config.
  const custom = { thresholds: { ...CFG.thresholds, loadPerCpu: { warn: 0.4, crit: null } } };
  assert.deepEqual(Object.fromEntries(h.evaluate(sampleWith(), custom).map((x) => [x.key, x.level])), { loadPerCpu: 'warn' });
});

test('debounce: a level must hold for 2 consecutive samples', () => {
  const d = h.createDebounce(2);
  const w = { key: 'k', level: 'warn', value: 1, threshold: 1, text: 'w' };
  const c = { key: 'k', level: 'crit', value: 9, threshold: 5, text: 'c' };
  assert.deepEqual(d.push([w]), []); // one sample: not yet
  assert.deepEqual(d.push([]), []); // broken
  assert.deepEqual(d.push([w]), []);
  assert.deepEqual(d.push([w]).map((a) => a.level), ['warn']);
  assert.deepEqual(d.push([c]).map((a) => a.level), ['warn']); // warn→crit raises warn
  const both = d.push([c]);
  assert.deepEqual(both.map((a) => a.level), ['crit']);
  assert.equal(both[0].threshold, 5);
  assert.deepEqual(d.push([]), []); // clears at once
});

// --- ring ---------------------------------------------------------------------

test('the ring is capped at 360 and history is thinned, newest kept', () => {
  h._reset();
  assert.equal(h._ringSize(), 360);
  for (let i = 0; i < 500; i++) h._push({ at: i });
  const all = h.history({ max: 1000 });
  assert.equal(all.length, 360);
  assert.equal(all[0].at, 140);
  assert.equal(all.at(-1).at, 499);
  assert.equal(h.latest().at, 499);
  const thin = h.history();
  assert.ok(thin.length <= h.HISTORY_POINTS);
  assert.equal(thin.at(-1).at, 499);
  assert.ok(thin.every((s, i) => i === 0 || s.at > thin[i - 1].at));
  assert.ok(h.history({ since: 490, max: 1000 }).every((s) => s.at >= 490));
  assert.equal(h.history({ since: 490, max: 1000 }).length, 10);
  const ring = h.createRing(1e9);
  assert.equal(ring.size, h.RING_HARD_MAX);
  h._reset();
});

// --- sampleOnce ---------------------------------------------------------------

test('sampleOnce builds the §7.3.3 sample from the fixtures', async () => {
  const state = { debounce: h.createDebounce(2) };
  const d = deps({ state });
  const first = await h.sampleOnce({ ...d, readFile: procReader(1) });
  assert.deepEqual(first.cpu, { busyPct: null, iowaitPct: null, stealPct: null });
  d.tick(10_000);
  const s = await h.sampleOnce({ ...d, readFile: procReader(2) });
  assert.deepEqual(Object.keys(s).sort(), ['alarms', 'at', 'cpu', 'docker', 'fs', 'load', 'loadPerCpu', 'mem', 'psi', 'rebootRequired', 'slots', 'swap', 'tailscale', 'uptimeS', 'vcpu'].sort());
  assert.equal(s.at, 1_010_000);
  assert.equal(s.uptimeS, 123456.78);
  assert.equal(s.vcpu, 4);
  assert.deepEqual(s.cpu, { busyPct: 65, iowaitPct: 5, stealPct: 3 });
  assert.deepEqual(s.load, [6, 4.5, 3]);
  assert.equal(s.loadPerCpu, 1.5);
  assert.deepEqual(s.mem, { totalMb: 16000, availMb: 4000, availPct: 25 });
  assert.deepEqual(s.swap, { totalMb: 4096, usedMb: 1024, inPerSec: 60, outPerSec: 10 });
  assert.deepEqual(s.psi, { cpu: { some10: 62.5 }, memory: { some10: 12, full10: 6.5 }, io: { some10: 3, full10: 1.25 } });
  assert.deepEqual(s.fs.map((f) => [f.mount, f.path, f.usedPct]), [['/', '/', 90], ['docker', '/var/lib/docker', 90], ['worktrees', '/srv/code', 90]]);
  assert.deepEqual(s.docker, { ok: false, running: 3, unhealthy: 1, restarting: 1 });
  assert.deepEqual(s.slots, { total: 3, inUse: 2 });
  assert.equal(s.rebootRequired, false);
  assert.deepEqual(s.tailscale, { online: true, backendState: 'Running' });
  // Second sample: everything that breached in both samples is raised (cpu
  // pressure 62.5, load 1.5/cpu, mem full 6.5, disks at 90%, 1 unhealthy);
  // swap-in had no rate on the first sample, so it waits.
  const keys = Object.fromEntries(s.alarms.map((a) => [a.key, a.level]));
  assert.deepEqual(keys, {
    psiMemFull10: 'warn', psiCpuSome10: 'warn', loadPerCpu: 'warn',
    'fsUsedPct:/': 'warn', 'fsUsedPct:docker': 'warn', 'fsUsedPct:worktrees': 'warn', dockerUnhealthy: 'warn',
  });
  for (const a of s.alarms) assert.deepEqual(Object.keys(a).sort(), ['key', 'level', 'text']);
  const wire = JSON.stringify(s);
  for (const bad of ['192.0.2', 'example.invalid', 'builder-a', 'slot1-db']) assert.ok(!wire.includes(bad), bad);
});

test('sampleOnce degrades to null when Docker or Tailscale throws, and skips a missing docker root', async () => {
  h._reset();
  const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' });
  const s = await h.sampleOnce(deps({
    readFile: procReader(1),
    dockerGet: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
    tailscale: async () => { throw new Error('tailscale not installed'); },
    slots: () => { throw new Error('no slots'); },
    statfs: async (p) => { if (p === '/var/lib/docker') throw enoent; return STATFS; },
  }));
  assert.equal(s.docker, null);
  assert.equal(s.tailscale, null);
  assert.equal(s.slots, null);
  assert.deepEqual(s.fs.map((f) => f.mount), ['/', 'worktrees']);
  assert.ok(Array.isArray(s.alarms));
});

test('sampleOnce without PSI or with unreadable /proc files gives nulls, not a throw', async () => {
  const boom = Object.assign(new Error('EACCES'), { code: 'EACCES' });
  const s = await h.sampleOnce(deps({
    readFile: procReader(1, { [h.PROC_FILES.psiCpu]: boom, [h.PROC_FILES.psiMemory]: boom, [h.PROC_FILES.psiIo]: boom, [h.PROC_FILES.meminfo]: '' }),
    dockerGet: null,
    tailscale: null,
    slots: null,
    exists: () => true,
  }));
  assert.deepEqual(s.psi, { cpu: { some10: null }, memory: { some10: null, full10: null }, io: { some10: null, full10: null } });
  assert.deepEqual(s.mem, { totalMb: null, availMb: null, availPct: null });
  assert.equal(s.docker, null);
  assert.equal(s.tailscale, null);
  assert.equal(s.rebootRequired, true);
  // No debounce state given: raw alarms.
  assert.ok(s.alarms.some((a) => a.key === 'rebootRequired' && a.level === 'warn'));
});

// --- route --------------------------------------------------------------------

function fakeSrc(samples) {
  return { latest: () => samples.at(-1) ?? null, history: ({ since }) => samples.filter((s) => since == null || s.at >= since) };
}

test('route body: {latest} and with ?history=1 {latest, history}', () => {
  const src = fakeSrc([{ at: 1 }, { at: 2 }, { at: 3 }]);
  assert.deepEqual(routeBody('/api/v1/health', src), { latest: { at: 3 } });
  assert.deepEqual(routeBody('/api/v1/health?history=1', src), { latest: { at: 3 }, history: [{ at: 1 }, { at: 2 }, { at: 3 }] });
  assert.deepEqual(routeBody('/api/v1/health?history=1&since=2', src).history, [{ at: 2 }, { at: 3 }]);
  assert.deepEqual(routeBody('/api/v1/health', fakeSrc([])), { latest: null });
});

test('route module: builder only, GET only, adds the health capability, streams health messages', async () => {
  v1._reset();
  h._reset();
  assert.deepEqual(routeModule.modes, ['builder']);
  const routes = [];
  const sent = [];
  const ctx = createContext({
    config: { health: { ...CFG, tailscale: false, dockerSocket: null, sampleMs: 1000 }, codeDir: '/srv/code' },
    ws: { send: (m) => sent.push(m) },
    slots: { snapshot: () => ({ slots: [{ lane: 'x' }] }) },
  }, { route: (method, p, handler) => routes.push({ method, p, handler }), upgradeHandlers: [] });
  routeModule.register(ctx);
  assert.deepEqual(routes.map((r) => [r.method, r.p]), [['GET', PATH]]);
  assert.ok(v1.hello().capabilities.includes('health'));
  routeModule.start(ctx);
  try {
    for (let i = 0; i < 100 && !sent.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent[0].type, 'health');
    assert.equal(typeof sent[0].health.at, 'number');
    assert.deepEqual(sent[0].health.slots, { total: 1, inUse: 1 });
    const chunks = [];
    const res = { writeHead() {}, setHeader() {}, end(buf) { chunks.push(String(buf)); } };
    routes[0].handler({ method: 'GET', url: `${PATH}?history=1`, headers: {} }, res);
    const out = JSON.parse(chunks.join(''));
    assert.deepEqual(Object.keys(out).sort(), ['history', 'latest']);
    assert.equal(out.latest.at, sent[0].health.at);
    assert.ok(out.history.length >= 1);
  } finally {
    routeModule.stop();
    h._reset();
    v1._reset();
  }
});

test('boot: a builder serves /api/v1/health?history=1 as {latest, history} and lists the capability', async () => {
  const b = await boot({ config: { fleet: { id: 'builder-a', code: 'BA' }, health: { tailscale: false, dockerSocket: null } } });
  try {
    const hello = await (await fetch(`${b.url}/api/v1/hello`, { headers: { 'X-Laneboard': '1' } })).json();
    assert.ok(hello.capabilities.includes('health'));
    let j = null;
    for (let i = 0; i < 50; i++) {
      const r = await fetch(`${b.url}/api/v1/health?history=1`, { headers: { 'X-Laneboard': '1' } });
      assert.equal(r.status, 200);
      j = await r.json();
      if (j.latest) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.deepEqual(Object.keys(j).sort(), ['history', 'latest']);
    assert.ok(j.latest, 'a first sample is taken at start');
    assert.ok(Array.isArray(j.history) && j.history.length >= 1);
    assert.equal(j.latest.docker, null);
    assert.equal(j.latest.tailscale, null);
    const post = await fetch(`${b.url}/api/v1/health`, { method: 'POST', headers: { 'X-Laneboard': '1' } });
    assert.ok(post.status >= 400, `POST health gave ${post.status}`);
  } finally {
    await b.stop();
  }
});
