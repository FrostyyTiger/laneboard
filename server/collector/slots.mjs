// The slots block on the Box: which slots exist, and which lane owns which.
//
// 30 s, read-only, and provider-agnostic: the slot provider says what exists,
// this file joins that with the lane records. An up slot with no lane and no
// recent use is shown as an orphan (about 200 MB) and nothing more; stopping
// it is a human's call.
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { slots as provider } from '../providers/index.mjs';
import * as store from '../lanes/store.mjs';

const ORPHAN_AFTER_MS = 60 * 60 * 1000;

/** Join the provider's view with the lane records. Pure. */
export function buildSlots(bySlot, records, now = Date.now(), count = provider.slotCount) {
  const activeBySlot = new Map(store.active(records).map((r) => [Number(r.slot), r]));
  const retiredBySlot = new Map();
  for (const r of records) if (r.retiredAt && r.slot != null) retiredBySlot.set(Number(r.slot), r);
  const out = [];
  for (let n = 1; n <= count; n++) {
    const d = bySlot.get(n);
    const lane = activeBySlot.get(n) ?? null;
    const exists = Boolean(d);
    const up = Boolean(d?.up);
    let owner;
    let orphan = false;
    if (lane) owner = `lane ${lane.id}`;
    else if (config.slots.reservedSlots.includes(n)) owner = 'reserved (manual work)';
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
      laneSlot: config.slots.laneSlots.includes(n),
      ports: provider.ports(n),
      containers: d?.containers ?? [],
    });
  }
  return out;
}

let slots = [];
let at = 0;
let ok = true;

export function snapshot() {
  return { slots, at, dockerOk: ok, provider: provider.name };
}

export async function refresh() {
  const r = await provider.list();
  ok = r.ok;
  if (!r.ok) return snapshot();
  slots = buildSlots(r.bySlot, store.readAll());
  at = Date.now();
  return snapshot();
}

export function start() {
  // With no slot provider there is nothing to poll and nothing to show.
  if (!provider.available) return;
  const tick = () => refresh().catch((err) => log.error('slots refresh failed', String(err)));
  const first = setTimeout(tick, 4000);
  first.unref();
  const timer = setInterval(tick, config.slotsPollMs);
  timer.unref();
}
