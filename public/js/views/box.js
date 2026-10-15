// The Box view (fleet plan §4 D11): one row per builder (link state, version
// and clock skew, latency, last seen, a direct link), each builder's latest
// health sample (§7 O6) with 60-point sparklines, and today's box blocks
// (guard, CI queue, agent slots) for the local builder below.
//
// Pure at import time. boxModel/healthModel and the small helpers are pure and
// tested in test/view-box.test.mjs; renderBox()/boxBlocks() touch the document
// only when called. Every builder-provided string reaches the page through
// textContent, setAttribute or title, never as markup. The direct link is the
// hub's configured `directUrl` (fleet.builders[].directUrl, never a builder's
// own claim), and only an http(s) URL with no credentials becomes a link.
import { $, el } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { deriveCode } from '../core/keys.js';
import { store } from '../core/store.js';
import { lamp, panel, plate, segbar } from '../ui/components.js';
import { sparkline } from '../ui/spark.js';

// ---------------------------------------------------------------- model

/** Points per sparkline (10 s samples: the last 10 minutes). */
export const SPARK_POINTS = 60;
/** |clockSkewMs| above this gets ▲ (signed requests fail at ±60 s, §3 2.10). */
export const CLOCK_WARN_MS = 30_000;
/** How long a fetched history counts as fresh before it is fetched again. */
export const HISTORY_TTL_MS = 60_000;
/** Caps on what one builder's sample may put on screen. */
const MAX_ALARMS = 20;
const MAX_FS = 8;
const MAX_TEXT = 200;

/** Link state -> lamp priority, short word (≤5 chars) and the long word. */
export const STATE_INFO = Object.freeze({
  up: { p: 'ok', word: 'UP', long: 'up' },
  stale: { p: '3', word: 'STALE', long: 'stale' },
  down: { p: '1', word: 'DOWN', long: 'down' },
  connecting: { p: 'off', word: 'CONN', long: 'connecting' },
  misconfigured: { p: '1', word: 'MCFG', long: 'misconfigured (wrong builder id)' },
  incompatible: { p: '2', word: 'INCMP', long: 'incompatible (read-only)' },
});
const UNKNOWN_STATE = Object.freeze({ p: 'off', word: '—', long: 'unknown' });

/** The client store's local status -> a link state. */
const LOCAL_STATE = Object.freeze({ live: 'up', stale: 'stale', down: 'down', connecting: 'connecting' });

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (finite(v) ? v : null);
const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : null);
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** The STATE_INFO entry for a link state (unknown -> a grey dash). */
export function stateInfo(state) {
  return (typeof state === 'string' && own(STATE_INFO, state)) || UNKNOWN_STATE;
}

/**
 * A direct link, or null. Only http: / https: with no user:password part; the
 * result is the parsed, normalised href (never the raw string).
 */
export function safeDirectUrl(raw) {
  if (typeof raw !== 'string' || raw === '' || raw.length > 2048) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return u.href;
}

/** A duration for a table cell: 840ms, 12s, 4m, 3h, 2d; null -> '—'. */
export function fmtDuration(ms) {
  if (!finite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Signed clock skew: +1.2s, -45s; null -> '—'. */
export function fmtSkew(ms) {
  if (!finite(ms)) return '—';
  const sign = ms < 0 ? '-' : '+';
  const a = Math.abs(ms);
  return a < 1000 ? `${sign}${Math.round(a)}ms` : `${sign}${(a / 1000).toFixed(a < 10_000 ? 1 : 0)}s`;
}

/** True when the version differs from the hub's (any skew but `same`). */
export function versionWarn(skew) {
  return typeof skew === 'string' && skew !== 'same';
}

/** True when |clockSkewMs| is past CLOCK_WARN_MS. */
export function clockWarn(ms) {
  return finite(ms) && Math.abs(ms) > CLOCK_WARN_MS;
}

/** A health alarm level -> lamp priority (§7: health-crit is P2, health-warn P3). */
export function healthAlarmP(level) {
  return level === 'crit' ? '2' : level === 'warn' ? '3' : 'off';
}

function cleanAlarms(list) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_ALARMS) break;
    if (!a || typeof a !== 'object') continue;
    const level = a.level === 'crit' ? 'crit' : a.level === 'warn' ? 'warn' : null;
    if (!level) continue;
    const key = str(a.key, 80) ?? '';
    out.push({ key, level, p: healthAlarmP(level), text: str(a.text) ?? key });
  }
  // Worst first: crit before warn, otherwise as sent.
  return out.sort((x, y) => (x.level === y.level ? 0 : x.level === 'crit' ? -1 : 1));
}

/**
 * One §7 health sample -> what the Box shows, or null when there is none.
 * Missing parts are null (rendered as '—'); nothing here is trusted.
 */
export function healthModel(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  const mem = h.mem && typeof h.mem === 'object' ? h.mem : {};
  const swap = h.swap && typeof h.swap === 'object' ? h.swap : {};
  const psi = h.psi && typeof h.psi === 'object' ? h.psi : {};
  const cpu = h.cpu && typeof h.cpu === 'object' ? h.cpu : {};
  const swapTotal = num(swap.totalMb);
  const swapUsed = num(swap.usedMb);
  const fs = [];
  for (const f of Array.isArray(h.fs) ? h.fs : []) {
    if (fs.length >= MAX_FS) break;
    if (!f || typeof f !== 'object') continue;
    fs.push({ mount: str(f.mount, 40) ?? '?', usedPct: num(f.usedPct), availMb: num(f.availMb), sizeMb: num(f.sizeMb) });
  }
  const d = h.docker && typeof h.docker === 'object' ? h.docker : null;
  const sl = h.slots && typeof h.slots === 'object' ? h.slots : null;
  const ts = h.tailscale && typeof h.tailscale === 'object' ? h.tailscale : null;
  return {
    at: num(h.at),
    vcpu: num(h.vcpu),
    cpuPct: num(cpu.busyPct),
    iowaitPct: num(cpu.iowaitPct),
    stealPct: num(cpu.stealPct),
    load1: Array.isArray(h.load) ? num(h.load[0]) : null,
    loadPerCpu: num(h.loadPerCpu),
    memAvailPct: num(mem.availPct),
    memAvailMb: num(mem.availMb),
    memTotalMb: num(mem.totalMb),
    swapTotalMb: swapTotal,
    swapUsedMb: swapUsed,
    swapUsedPct: swapTotal && swapUsed !== null ? Math.round((swapUsed / swapTotal) * 1000) / 10 : null,
    swapInPerSec: num(swap.inPerSec),
    psiCpu: num(psi.cpu?.some10),
    psiMemFull: num(psi.memory?.full10),
    psiIoFull: num(psi.io?.full10),
    fs,
    docker: d ? { ok: d.ok === true, running: num(d.running), unhealthy: num(d.unhealthy), restarting: num(d.restarting) } : null,
    slots: sl ? { total: num(sl.total), inUse: num(sl.inUse) } : null,
    rebootRequired: h.rebootRequired === true,
    tailscale: ts ? { online: ts.online === true, state: str(ts.backendState, 40) } : null,
    alarms: cleanAlarms(h.alarms),
  };
}

/** The alarm for a metric key (fs keys are `fsUsedPct:<mount>`), or null. */
export function alarmFor(health, key) {
  return health?.alarms?.find((a) => a.key === key) ?? null;
}

/** Series pickers for the sparklines: [field, label, sample -> value]. */
export const SERIES = Object.freeze([
  ['cpu', 'cpu %', (s) => num(s?.cpu?.busyPct)],
  ['mem', 'mem used %', (s) => (finite(s?.mem?.availPct) ? Math.round((100 - s.mem.availPct) * 10) / 10 : null)],
  ['load', 'load per cpu', (s) => num(s?.loadPerCpu)],
  ['swapIn', 'swap-in pages/s', (s) => num(s?.swap?.inPerSec)],
  ['psiIo', 'io pressure full %', (s) => num(s?.psi?.io?.full10)],
]);

/** Samples (oldest first) -> {cpu:[..60], mem, load, swapIn, psiIo}. */
export function seriesOf(samples, points = SPARK_POINTS) {
  const list = (Array.isArray(samples) ? samples : []).filter((s) => s && typeof s === 'object').slice(-points);
  const out = {};
  for (const [k, , pick] of SERIES) out[k] = list.map(pick);
  return out;
}

/** The local builder's link state from the client store's status. */
function localState(b, s) {
  if (s.source?.kind === 'local') return own(LOCAL_STATE, s.source.status === 'open' ? 'live' : s.source.status === 'closed' ? 'down' : 'connecting');
  return typeof b.state === 'string' ? b.state : (own(LOCAL_STATE, b.status) ?? null);
}

/**
 * The Box model. `s` is the client store (§1 F8b). Hub source: one row per
 * hub `fleet` row; local source: the one builder of this page. Options:
 * now (ms), scope (a builder id or 'all'), history (id -> samples).
 * -> {hub, scope, hubVersion, rows: [Row], local: Row|null}
 */
export function boxModel(st, opts = {}) {
  const s = st ?? store;
  const now = opts.now ?? Date.now();
  const scope = opts.scope ?? 'all';
  const history = opts.history ?? null;
  const hub = s?.source?.kind === 'hub';
  const all = [...(s?.builders?.values?.() ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rows = [];
  for (const b of all) {
    if (scope && scope !== 'all' && b.id !== scope) continue;
    const state = hub ? (typeof b.state === 'string' ? b.state : null) : localState(b, s);
    const info = stateInfo(state);
    const health = healthModel(b.health);
    // Hub: the snapshot age the hub reports. Local: time since the last frame.
    const ageMs = hub ? num(b.ageMs) : (b.lastMsgAt ? Math.max(0, now - b.lastMsgAt) : null);
    const caps = hub ? b.capabilities : (s.source?.hello?.capabilities ?? b.capabilities);
    const worst = health?.alarms?.[0] ?? null;
    // The lamp: the link state, unless the link is up and health alarms.
    const p = state === 'up' && worst ? worst.p : info.p;
    rows.push({
      id: b.id,
      code: str(b.code, 12) || deriveCode(b.id),
      state,
      p,
      word: info.word,
      stateText: info.long,
      stale: state !== 'up',
      ageMs,
      latencyMs: hub ? num(b.latencyMs) : null,
      version: str(b.version, 40),
      versionSkew: hub ? str(b.versionSkew, 10) : null,
      versionWarn: hub && versionWarn(b.versionSkew),
      clockSkewMs: num(b.clockSkewMs),
      clockWarn: clockWarn(b.clockSkewMs),
      // Only the hub's configured URL; a local page is already on its builder.
      directUrl: hub ? safeDirectUrl(b.directUrl) : null,
      controls: hub ? b.controls === true : true,
      hasHealth: Array.isArray(caps) && caps.includes('health'),
      health,
      series: seriesOf(history?.get?.(b.id) ?? (b.health ? [b.health] : [])),
      box: b.box ?? null,
      vitals: b.vitals ?? null,
    });
  }
  let local = null;
  if (!hub) local = rows[0] ?? null;
  else if (rows.length === 1 && scope && scope !== 'all') local = rows[0];
  return { hub, scope: scope || 'all', hubVersion: str(s?.hub?.version, 40), rows, local };
}

// ---------------------------------------------------------------- history

/** id -> {samples: [], fetchedAt, loading}. */
const hist = new Map();

/** The history URL for a builder: the hub read proxy, or the builder's own route. */
export function historyUrl(id, hub) {
  return hub ? `/api/fleet/${encodeURIComponent(id)}/v1/health?history=1` : '/api/v1/health?history=1';
}

/** Merge samples into a history, oldest first, by `at`, capped at SPARK_POINTS. */
export function mergeSamples(old, more) {
  const byAt = new Map();
  for (const x of [...(old ?? []), ...(more ?? [])]) {
    if (x && typeof x === 'object' && finite(x.at)) byAt.set(x.at, x);
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at).slice(-SPARK_POINTS);
}

/** Every builder's history, with each one's latest live sample merged in. */
function histories(s) {
  const out = new Map();
  for (const b of s.builders.values()) {
    const h = hist.get(b.id);
    const merged = mergeSamples(h?.samples, b.health ? [b.health] : []);
    if (h) h.samples = merged;
    out.set(b.id, merged);
  }
  return out;
}

/**
 * Fetch the health history of every builder that offers it and has none
 * fresher than HISTORY_TTL_MS. Failures are quiet: the live samples still
 * fill the sparklines. Resolves when every started fetch is done.
 */
export function refreshHistory(st, opts = {}) {
  const s = st ?? store;
  const now = opts.now ?? Date.now();
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const onDone = opts.onDone ?? null;
  if (typeof fetchImpl !== 'function') return Promise.resolve();
  const hub = s.source?.kind === 'hub';
  const jobs = [];
  for (const row of boxModel(s, { now }).rows) {
    if (!row.hasHealth || row.state !== 'up') continue;
    const h = hist.get(row.id) ?? { samples: [], fetchedAt: -Infinity, loading: false };
    hist.set(row.id, h);
    if (h.loading || now - h.fetchedAt < HISTORY_TTL_MS) continue;
    h.loading = true;
    h.fetchedAt = now;
    jobs.push(Promise.resolve()
      .then(() => fetchImpl(historyUrl(row.id, hub), { headers: { accept: 'application/json' } }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((body) => {
        const list = Array.isArray(body?.history) ? body.history.slice(-SPARK_POINTS) : [];
        h.samples = mergeSamples(h.samples, list);
      })
      .catch(() => {})
      .finally(() => { h.loading = false; }));
  }
  if (!jobs.length) return Promise.resolve();
  return Promise.all(jobs).then(() => { if (typeof onDone === 'function') onDone(); });
}

/** Forget the fetched histories (tests). */
export function resetHistory() {
  hist.clear();
}

// ---------------------------------------------------------------- render

const MB_G = (mb) => (finite(mb) ? `${(mb / 1024).toFixed(mb < 10_240 ? 1 : 0)}G` : '—');
const pct = (v) => (finite(v) ? `${Math.round(v)}%` : '—');

function td(cls, ...kids) {
  const c = el('td', cls);
  for (const k of kids) if (k != null) c.append(k);
  return c;
}

/** A ▲ mark with its words (guardrail 5: colour carries a shape and text). */
function warnMark(text) {
  const m = el('span', 'box-warn', '▲');
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', text);
  m.title = text;
  return m;
}

/** A used/free meter as a segbar: grey used part, p2 when its metric alarms. */
export function meterMix(usedPct, level = null) {
  if (!finite(usedPct)) return { p1: 0, p2: 0, run: 0, ok: 0, off: 0, dead: 0, total: 0 };
  const used = Math.max(0, Math.min(100, Math.round(usedPct)));
  const alarming = level === 'crit' || level === 'warn';
  return { p1: 0, p2: alarming ? used : 0, run: alarming ? 0 : used, ok: 0, off: 100 - used, dead: 0, total: 100 };
}

function meter(label, usedPct, alarm) {
  const wrap = el('span', 'box-meter');
  const text = alarm ? `${label} ${pct(usedPct)}: ${alarm.text}` : `${label} ${pct(usedPct)}`;
  wrap.append(segbar(meterMix(usedPct, alarm?.level), { label: text }));
  wrap.append(el('span', 'box-v', pct(usedPct)));
  if (alarm) wrap.append(warnMark(alarm.text));
  return wrap;
}

function spark(row, key) {
  const def = SERIES.find(([k]) => k === key);
  const values = row.series?.[key] ?? [];
  return sparkline(values, { label: `${row.code} ${def ? def[1] : key}`, min: key === 'cpu' || key === 'mem' ? 0 : undefined, max: key === 'cpu' || key === 'mem' ? 100 : undefined });
}

function headRow(cols) {
  const tr = el('tr');
  for (const [text, title, cls] of cols) {
    const th = el('th', cls ?? null, text);
    th.setAttribute('scope', 'col');
    if (title) th.title = title;
    tr.append(th);
  }
  const thead = el('thead');
  thead.append(tr);
  return thead;
}

function table(label, cols) {
  const wrap = el('div', 'dt-wrap');
  const t = el('table', 'dt box-dt');
  t.setAttribute('aria-label', label);
  const body = el('tbody');
  t.append(headRow(cols), body);
  wrap.append(t);
  return { wrap, body };
}

function builderCell(row) {
  const c = el('span', 'box-b');
  c.append(lamp(row.p, { label: `${row.id}: ${row.stateText}${row.health?.alarms?.length ? `, ${row.health.alarms.length} health alarm(s)` : ''}` }));
  c.append(plate(row.code, { title: row.id }));
  return c;
}

function linkCell(row) {
  if (!row.directUrl) return el('span', 'box-dim', '—');
  const a = el('a', 'box-link');
  a.href = row.directUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  const text = `Open ${row.id} directly (${row.directUrl})`;
  a.title = text;
  a.setAttribute('aria-label', text);
  a.append(icon('external', { size: 's', label: text }));
  return a;
}

/** The builders table: link state, version and clock skew, latency, last seen, direct link. */
export function buildersPanel(m) {
  const p = panel({ name: 'BUILDERS', scope: m.scope === 'all' ? 'ALL' : m.scope, n: m.rows.length });
  if (!m.rows.length) {
    p.body.append(el('p', 'empty', m.hub ? 'No builders from the hub yet.' : 'Waiting for the first snapshot…'));
    return p.root;
  }
  const { wrap, body } = table('Builders', [
    ['BLDR', 'Builder'], ['STATE', 'Link state'], ['VER', m.hubVersion ? `Version (hub ${m.hubVersion})` : 'Version'],
    ['CLK', 'Clock skew against the hub', 'num'], ['LAT', 'Latency', 'num'], ['SEEN', 'Last seen (snapshot age)', 'num'],
    ['LINK', 'Direct link to the builder'],
  ]);
  for (const row of m.rows) {
    const tr = el('tr');
    if (row.stale) tr.classList.add('is-stale');
    tr.dataset.builder = row.id;
    tr.dataset.state = row.state ?? 'unknown';
    const st = el('span', 'box-state', row.word);
    st.title = row.stateText;
    const ver = el('span', 'box-ver', row.version ?? '—');
    ver.title = row.version ? `version ${row.version}${row.versionSkew ? `, skew ${row.versionSkew}` : ''}` : 'version unknown';
    const verCell = td(null, ver);
    if (row.versionWarn) verCell.append(warnMark(`version skew against the hub: ${row.versionSkew}`));
    const clk = td('num', el('span', null, fmtSkew(row.clockSkewMs)));
    if (row.clockWarn) clk.append(warnMark(`clock skew ${fmtSkew(row.clockSkewMs)}: signed requests fail past 60 s`));
    tr.append(
      td(null, builderCell(row)),
      td(null, st),
      verCell,
      clk,
      td('num', el('span', null, fmtDuration(row.latencyMs))),
      td('num', el('span', null, fmtDuration(row.ageMs))),
      td(null, linkCell(row)),
    );
    body.append(tr);
  }
  p.body.append(wrap);
  return p.root;
}

function metricCell(text, title, sparkNode = null, alarm = null) {
  const c = el('span', 'box-metric');
  const v = el('span', 'box-v', text);
  v.title = alarm ? `${title}: ${alarm.text}` : title;
  c.append(v);
  if (alarm) c.append(warnMark(alarm.text));
  if (sparkNode) c.append(sparkNode);
  return c;
}

function alarmLamps(h) {
  const c = el('span', 'box-alarms');
  if (!h.alarms.length) {
    c.append(lamp('ok', { label: 'no health alarms' }));
    return c;
  }
  for (const a of h.alarms) c.append(lamp(a.p, { label: `${a.level}: ${a.text}` }));
  return c;
}

/** The health table: one row per builder with a sample. */
export function healthPanel(m) {
  const rows = m.rows.filter((r) => r.health);
  const p = panel({ name: 'HEALTH', scope: m.scope === 'all' ? 'ALL' : m.scope, n: rows.length });
  if (!rows.length) {
    p.body.append(el('p', 'empty', 'No health samples yet (the builder sends one every 10 s).'));
    return p.root;
  }
  const { wrap, body } = table('Builder health', [
    ['BLDR', 'Builder'], ['ALRM', 'Health alarms'], ['CPU', 'CPU busy, last 10 min'], ['LOAD', 'Load per vCPU'],
    ['MEM', 'Memory used (MemAvailable)'], ['SWAP', 'Swap used and swap-in rate'], ['PSI', 'Pressure: cpu some / mem full / io full (avg10)'],
    ['DISK', 'Disk used per mount'], ['DOCK', 'Docker containers'], ['SLOT', 'Agent slots in use'], ['RBT', 'Reboot required'],
  ]);
  for (const row of rows) {
    const h = row.health;
    const tr = el('tr');
    if (row.stale) tr.classList.add('is-stale');
    tr.dataset.builder = row.id;
    const disks = el('span', 'box-disks');
    for (const f of h.fs) {
      const d = el('span', 'box-disk');
      d.append(el('span', 'box-k', f.mount));
      d.append(meter(`disk ${f.mount}`, f.usedPct, alarmFor(h, `fsUsedPct:${f.mount}`)));
      d.title = `${f.mount}: ${pct(f.usedPct)} used, ${MB_G(f.availMb)} free`;
      disks.append(d);
    }
    if (!h.fs.length) disks.append(el('span', 'box-dim', '—'));
    const memUsed = finite(h.memAvailPct) ? 100 - h.memAvailPct : null;
    const mem = el('span', 'box-metric');
    mem.append(meter('mem used', memUsed, alarmFor(h, 'memAvailPct')), spark(row, 'mem'));
    mem.title = `${MB_G(h.memAvailMb)} available of ${MB_G(h.memTotalMb)}`;
    const swap = el('span', 'box-metric');
    swap.append(meter('swap used', h.swapUsedPct, null));
    swap.append(metricCell(finite(h.swapInPerSec) ? `${Math.round(h.swapInPerSec)}/s` : '—', 'swap-in pages per second', spark(row, 'swapIn'), alarmFor(h, 'swapInPerSec')));
    const psiAlarm = alarmFor(h, 'psiMemFull10') ?? alarmFor(h, 'psiIoFull10') ?? alarmFor(h, 'psiCpuSome10');
    const psiText = [h.psiCpu, h.psiMemFull, h.psiIoFull].map((v) => (finite(v) ? `${Math.round(v)}` : '—')).join('/');
    const dk = h.docker;
    const dockAlarm = alarmFor(h, 'dockerUnhealthy');
    const dockText = dk ? `${dk.running ?? '—'}${dk.unhealthy ? ` ${dk.unhealthy}✗` : ''}` : '—';
    const dockTitle = dk ? `${dk.running ?? '?'} running, ${dk.unhealthy ?? 0} unhealthy, ${dk.restarting ?? 0} restarting` : 'docker not readable';
    const sl = h.slots;
    tr.append(
      td(null, builderCell(row)),
      td(null, alarmLamps(h)),
      td(null, metricCell(pct(h.cpuPct), `cpu ${pct(h.cpuPct)}, iowait ${pct(h.iowaitPct)}, steal ${pct(h.stealPct)}`, spark(row, 'cpu'))),
      td(null, metricCell(finite(h.loadPerCpu) ? h.loadPerCpu.toFixed(2) : '—', `load ${finite(h.load1) ? h.load1.toFixed(2) : '—'} on ${h.vcpu ?? '?'} vCPU`, spark(row, 'load'), alarmFor(h, 'loadPerCpu'))),
      td(null, mem),
      td(null, swap),
      td(null, metricCell(psiText, 'pressure avg10: cpu some / memory full / io full', spark(row, 'psiIo'), psiAlarm)),
      td(null, disks),
      td(null, metricCell(dockText, dockTitle, null, dockAlarm)),
      td('num', metricCell(sl && finite(sl.total) ? `${sl.inUse ?? 0}/${sl.total}` : '—', 'agent slots in use / total')),
      td(null, h.rebootRequired ? metricCell('REBT', 'reboot required', null, alarmFor(h, 'rebootRequired') ?? { text: 'reboot required' }) : el('span', 'box-dim', '—')),
    );
    body.append(tr);
  }
  p.body.append(wrap);
  return p.root;
}

function vitalTile(k, v, sub) {
  const d = el('div', 'vital');
  d.append(el('div', 'k', k));
  const vv = el('div', 'v', v);
  if (sub) vv.append(el('small', null, ` ${sub}`));
  d.append(vv);
  return d;
}

/** Today's vitals tiles (the 2 s collector), for the local builder. */
function vitalsBlock(v, title = 'This box') {
  const vit = el('section', 'mblock');
  vit.append(el('h3', 'rail-h', title));
  const grid = el('div', 'vitals vitals-wide');
  grid.append(vitalTile('cpu', v.cpuPct == null ? '—' : `${v.cpuPct}%`, Array.isArray(v.load) && finite(v.load[0]) ? `load ${v.load[0].toFixed(2)}` : ''));
  if (v.mem) grid.append(vitalTile('mem', MB_G(v.mem.usedMb), `/ ${(v.mem.totalMb / 1024).toFixed(0)}G`));
  if (v.mem) grid.append(vitalTile('swap', MB_G(v.mem.swapUsedMb), `/ ${(v.mem.swapTotalMb / 1024).toFixed(0)}G`));
  if (v.disk) grid.append(vitalTile('disk', `${(v.disk.availMb / 1024).toFixed(0)}G`, 'free'));
  if (v.gpu) grid.append(vitalTile('gpu', `${v.gpu.utilPct}%`, MB_G(v.gpu.memUsedMb)));
  if (finite(v.claudeRssMb)) grid.append(vitalTile('claude', MB_G(v.claudeRssMb), `${v.sessionCount ?? 0} sessions`));
  if (finite(v.laneboardRssMb)) grid.append(vitalTile('laneboard', `${v.laneboardRssMb}MB`, ''));
  vit.append(grid);
  return vit;
}

/** The builder the Box view is scoped to (`b=`), or 'all'. */
let scope = 'all';
function scopeOf(route) {
  const b = route?.b;
  return typeof b === 'string' && b && b !== 'all' ? b : 'all';
}

export function renderBox() {
  const host = $('box-body');
  if (!host || store.view !== 'box') return;
  const m = boxModel(store, { scope, history: histories(store) });
  host.textContent = '';
  host.append(buildersPanel(m), healthPanel(m));
  const local = m.local;
  if (local) {
    // Local source: the page's own builder; hub: the one builder in scope.
    const vitals = m.hub ? local.vitals : store.vitals;
    const box = m.hub ? local.box : store.box;
    if (vitals) host.append(vitalsBlock(vitals, m.hub ? `Box ${local.code}` : 'This box'));
    for (const b of boxBlocks(box)) host.append(b);
  } else if (m.hub && m.rows.length) {
    host.append(el('p', 'empty', 'Pick one builder (b=) for its guard, CI queue and agent slots.'));
  }
}

/** The guard, the CI queue and the slots: Box sections, and rail blocks on the 49". */
export function boxBlocks(box) {
  const b = box === undefined ? store.box : box;
  if (!b) return [el('p', 'empty', 'Waiting for the collectors…')];
  const blocks = [guardBlock(b.guard), ciBlock(b.ci), slotsBlock(b.slots)].filter(Boolean);
  // With every provider off there is nothing to say here, and saying nothing
  // is better than three empty headings.
  return blocks.length ? blocks : [el('p', 'empty', 'No guard, no agent slots and no CI configured — see docs/config.md.')];
}

function guardBlock(g) {
  // No guard provider: no block at all, rather than an empty one that implies
  // something is being watched.
  if (!g || g.provider === 'none') return null;
  const sec = el('section', 'mblock');
  const h = el('h3', 'rail-h', 'Guard');
  h.append(el('span', `guard ${g.ok ? 'guard-ok' : 'guard-danger'}`, g.ok ? 'guard ok' : 'DANGER'));
  sec.append(h);
  const probes = Array.isArray(g.health) ? g.health : [];
  // The guard's findings first: this block exists for them.
  for (const f of [...(Array.isArray(g.preventive) ? g.preventive : []), ...(Array.isArray(g.detective) ? g.detective : [])]) {
    const line = el('div', 'marker-line mk-danger');
    line.append(el('span', 'mk-kind', 'danger'));
    line.append(el('span', 'mk-text', `${f?.session || `pid ${f?.pid}`}: ${f?.reason}`));
    sec.append(line);
  }
  const rows = el('div', 'kv');
  const health = (label, x) => {
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', String(label ?? '')));
    r.append(el('span', `kv-v ${x?.ok ? 'ok' : 'bad'}`, x?.ok ? `${x.status}` : (x?.status ? `${x.status}` : 'down')));
    rows.append(r);
  };
  for (const p of probes) health(p?.name, p);
  for (const c of Array.isArray(g.containers) ? g.containers : []) {
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', String(c?.name ?? '').replace(/-1$/, '')));
    r.append(el('span', `kv-v ${c?.state === 'running' ? '' : 'dim'}`, String(c?.status ?? '')));
    rows.append(r);
  }
  sec.append(rows);
  return sec;
}

function ciBlock(ci) {
  if (!ci || ci.provider === 'none') return null;
  const sec = el('section', 'mblock');
  const q = ci?.queue;
  const h = el('h3', 'rail-h', 'CI queue');
  if (q) h.append(el('span', 'count', `${q.running} running · ${q.queued} queued`));
  sec.append(h);
  if (ci?.auth && ci.auth.ok === false) sec.append(el('p', 'empty', 'gh not logged in on this host — run `gh auth login`.'));
  if (!q) { if (ci?.auth?.ok !== false) sec.append(el('p', 'empty', 'Not checked yet.')); return sec; }
  const rows = el('div', 'kv');
  for (const r of (Array.isArray(q.runs) ? q.runs : []).slice(0, 8)) {
    const row = el('div', 'kv-row');
    const status = String(r?.status ?? '');
    const verdict = status !== 'completed' ? status.replace('_', ' ') : (r.conclusion || 'done');
    row.append(el('span', 'kv-k', String(r?.name ?? '')));
    row.append(el('span', 'kv-b', String(r?.branch || '')));
    row.append(el('span', `kv-v ${r?.conclusion === 'success' ? 'ok' : r?.conclusion === 'failure' ? 'bad' : status !== 'completed' ? 'run' : 'dim'}`, String(verdict)));
    rows.append(row);
  }
  sec.append(rows);
  return sec;
}

function slotsBlock(slots) {
  // No slot provider: no slots, and no empty block implying there are some.
  if (!Array.isArray(slots) || !slots.length) return null;
  const sec = el('section', 'mblock');
  sec.append(el('h3', 'rail-h', 'Agent slots'));
  const rows = el('div', 'kv');
  for (const x of slots) {
    if (!x || (!x.exists && !x.laneSlot)) continue;
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', `slot ${x.slot} :${x.ports?.pg ?? '?'}`));
    r.append(el('span', `kv-v ${x.orphan ? 'warn' : x.up ? 'ok' : 'dim'}`, String(x.owner || (x.up ? 'up' : 'free'))));
    rows.append(r);
  }
  sec.append(rows);
  return sec;
}

// ---------------------------------------------------------------- the view

let mounted = false;
let pending = null;

function scheduleRender() {
  if (pending !== null) return;
  pending = setTimeout(() => {
    pending = null;
    if (mounted) renderBox();
  }, 200);
}

function refreshBox() {
  refreshHistory(store, { onDone: () => { if (mounted) renderBox(); } }).catch(() => {});
}

export default {
  id: 'box',
  icon: 'box',
  title: 'Box',
  short: 'BOX',
  /** Paint into #box-body (the section keeps its head) and fetch the health history. */
  mount: (_el, ctx = {}) => {
    mounted = true;
    scope = scopeOf(ctx.route);
    renderBox();
    refreshBox();
  },
  unmount: () => {
    mounted = false;
    if (pending !== null) clearTimeout(pending);
    pending = null;
  },
  /** Store changes (fleet rows, health samples) and route changes in the view. */
  update: (_store, ctx = {}) => {
    if (ctx.route) {
      const next = scopeOf(ctx.route);
      if (next !== scope) {
        scope = next;
        renderBox();
      }
    }
    scheduleRender();
    refreshBox();
  },
};
