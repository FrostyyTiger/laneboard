// Lane records: ~/lanes/<id>/lane.json, one per launched lane, kept after
// retirement with `retiredAt` set. Nothing lane-related is written inside a
// worktree — an untracked file there would show the lane as dirty.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';

/**
 * A lane id becomes a tmux session name, a directory under ~/lanes and the
 * suffix of a worktree path, so it is the session-name rule narrowed to what is
 * safe in all three: no spaces, no parens, no leading dot or dash.
 */
export const LANE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export function isLaneId(id) {
  return typeof id === 'string' && LANE_ID_RE.test(id) && !id.includes('..');
}

export function laneDir(id) {
  return path.join(config.lanesDir, id);
}

export function laneFile(id) {
  return path.join(laneDir(id), 'lane.json');
}

/** Every lane.json under ~/lanes, retired ones included. Unreadable ones are skipped. */
export function readAll() {
  let entries;
  try {
    entries = fs.readdirSync(config.lanesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !isLaneId(e.name)) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(laneFile(e.name), 'utf8'));
      if (rec && rec.id === e.name) out.push(rec);
    } catch { /* no lane.json: a v2 lane folder, not a launched lane */ }
  }
  return out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function read(id) {
  if (!isLaneId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(laneFile(id), 'utf8'));
  } catch {
    return null;
  }
}

export function active(records = readAll()) {
  return records.filter((r) => !r.retiredAt);
}

/** Atomic write: tmp + rename, so a crash never leaves half a record. */
export async function write(rec) {
  if (!isLaneId(rec?.id)) throw new Error(`invalid lane id: ${rec?.id}`);
  await fsp.mkdir(laneDir(rec.id), { recursive: true });
  const tmp = `${laneFile(rec.id)}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(rec, null, 2)}\n`);
  await fsp.rename(tmp, laneFile(rec.id));
  rootsCache = null;
  return rec;
}

export async function writePrompt(id, text) {
  await fsp.mkdir(laneDir(id), { recursive: true });
  await fsp.writeFile(path.join(laneDir(id), 'prompt.txt'), text);
}

/**
 * Which slot is held by what. A slot is held by an active lane, or — when the
 * agent stack reports a compose project for it that no lane owns — by whoever
 * started it by hand. Taking a slot someone else is using would share a
 * database with a test suite that drops tenants, so an unowned running slot
 * counts as taken.
 *
 * `stackSlots`: slot numbers the agent stack says exist (any container state).
 */
export function slotOwners(records, stackSlots = []) {
  const owners = new Map();
  for (const r of active(records)) {
    if (r.slot != null) owners.set(Number(r.slot), `lane ${r.id}`);
  }
  for (const n of stackSlots) {
    if (!owners.has(Number(n))) owners.set(Number(n), `agent${n} (running, no lane)`);
  }
  return owners;
}

/** The first free lane slot, or null. */
export function freeSlot(owners, slots = config.laneSlots) {
  return slots.find((n) => !owners.has(n)) ?? null;
}

// --- worktree root -> lane id ------------------------------------------------
//
// collector/lanes.mjs names a lane from its worktree's basename. A launched
// lane's record is the better authority — it knows its own id whatever the
// repo prefix — so lanes.mjs asks here first.

let rootsCache = null;
let rootsAt = 0;

export function idForRoot(root) {
  if (!root) return null;
  if (!rootsCache || Date.now() - rootsAt > 30_000) {
    rootsCache = new Map(readAll().map((r) => [r.root, r.id]));
    rootsAt = Date.now();
  }
  return rootsCache.get(root) ?? null;
}

export function _resetCache() {
  rootsCache = null;
}
