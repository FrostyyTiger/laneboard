// Agent-stack slots: which exist, which lane owns which. 30 s, read-only:
// one `docker ps -a` filtered to the agent compose projects, joined with the
// lane records. An up slot with no lane and no recent use is shown as an
// orphan (about 200 MB) and nothing more; stopping it is a human's call.
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { run } from '../util.mjs';
import * as store from '../lanes/store.mjs';

export const SLOT_COUNT = 5;
const ORPHAN_AFTER_MS = 60 * 60 * 1000;
const BASE = { pg: 15432, redis: 16379, s3: 19000 };

/** Slot N's host ports: +100 per slot above 1. */
export function slotPorts(n) {
  const d = (Number(n) - 1) * 100;
  return { pg: BASE.pg + d, redis: BASE.redis + d, s3: BASE.s3 + d };
}

/** "2026-09-21 08:54:26 +0000 UTC" -> ms, or NaN. */
export function parseDockerTime(text) {
  const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-])(\d\d)(\d\d)/.exec(String(text || '').trim());
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`) : NaN;
}

/**
 * `docker ps -a --format '{{.Label "com.docker.compose.project"}}\t{{.Names}}\t{{.State}}\t{{.CreatedAt}}'`
 * rows -> Map(slot -> { containers[], up, createdAt }).
 */
export function parseSlotRows(text) {
  const bySlot = new Map();
  for (const line of String(text).split('\n')) {
    const [project, name, state, created] = line.split('\t');
    const m = /^agent([1-9])$/.exec(project || '');
    if (!m) continue;
    const n = Number(m[1]);
    if (!bySlot.has(n)) bySlot.set(n, { containers: [], up: false, createdAt: null });
    const s = bySlot.get(n);
    s.containers.push({ name, state });
    if (state === 'running') s.up = true;
    const t = parseDockerTime(created);
    if (Number.isFinite(t) && (s.createdAt == null || t < s.createdAt)) s.createdAt = t;
  }
  return bySlot;
}

/** Join docker's view with the lane records. Pure. */
export function buildSlots(bySlot, records, now = Date.now()) {
  const activeBySlot = new Map(store.active(records).map((r) => [Number(r.slot), r]));
  const retiredBySlot = new Map();
  for (const r of records) if (r.retiredAt && r.slot != null) retiredBySlot.set(Number(r.slot), r);
  const out = [];
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const d = bySlot.get(n);
    const lane = activeBySlot.get(n) ?? null;
    const exists = Boolean(d);
    const up = Boolean(d?.up);
    let owner;
    let orphan = false;
    if (lane) owner = `lane ${lane.id}`;
    else if (config.reservedSlots.includes(n)) owner = 'reserved (manual work)';
    else if (!exists) owner = null;
    else {
      const recent = d.createdAt != null && now - d.createdAt < ORPHAN_AFTER_MS;
      orphan = up && !recent;
      owner = orphan ? 'orphan, ~200 MB' : 'no lane';
    }
    out.push({
      slot: n,
      exists,
      up,
      lane: lane?.id ?? null,
      lastLane: !lane ? (retiredBySlot.get(n)?.id ?? null) : null,
      owner,
      orphan,
      laneSlot: config.laneSlots.includes(n),
      ports: slotPorts(n),
      containers: d?.containers ?? [],
    });
  }
  return out;
}

let slots = [];
let at = 0;
let dockerOk = true;

export function snapshot() {
  return { slots, at, dockerOk };
}

export async function refresh() {
  const r = await run('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project',
    '--format', '{{.Label "com.docker.compose.project"}}\t{{.Names}}\t{{.State}}\t{{.CreatedAt}}'], { timeout: 8000 });
  dockerOk = r.ok;
  if (!r.ok) return snapshot();
  slots = buildSlots(parseSlotRows(r.stdout), store.readAll());
  at = Date.now();
  return snapshot();
}

export function start() {
  const tick = () => refresh().catch((err) => log.error('slots refresh failed', String(err)));
  const first = setTimeout(tick, 4000);
  first.unref();
  const timer = setInterval(tick, config.slotsPollMs);
  timer.unref();
}
