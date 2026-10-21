// The annunciator's alarm -> tile model (fleet plan §4 2.5, task D7).
//
// Eight fixed tiles, in this order, each covering some of §7's alarm kinds
// (server/fleet/alarms.mjs KINDS; the server's own copy of this map is
// server/fleet/alarms.mjs KIND_TO_TILE, used by `ack-alarm *` with {tile}).
// `review` (P4) has no tile: it lives in the Inbox; `reboot` and
// `health-warn` have none either: the Box shows them.
//
// Pure: no DOM, no store. Tested in test/annunciator.test.mjs. Alarms come
// from builders and the hub as §7 sends them:
//   {id, kind, priority:'P1'..'P4', builder, target, text, since, acked, ackedBy, ackedAt}
// Nothing here interprets `text` or `target`; the UI renders them as text.
import { BUILDER_ID_RX, fkey } from './keys.js';

/** The tiles, in display order (also the `args.tile` values of ack-alarm). */
export const TILES = Object.freeze(['NEED', 'APPR', 'BLKD', 'STCK', 'CI-F', 'DOWN', 'BUDG', 'CONF']);

/**
 * §7 alarm kind -> tile. Kinds not listed have no tile: `review` lives in the
 * Inbox, `reboot` and `health-warn` in the Box (runs night 4 T38: a host that
 * wants a reboot is not a builder that is down, so a fresh copy with its link
 * up shows DOWN 0). DOWN counts a lost or stale link, a crit host check and an
 * audit fork.
 */
export const KIND_TO_TILE = Object.freeze({
  'needs-input': 'NEED', 'review-overdue': 'NEED',
  'approval': 'APPR',
  'blocked': 'BLKD', 'failed': 'BLKD', 'danger': 'BLKD',
  'stuck': 'STCK',
  'ci-red-main': 'CI-F', 'ci-red': 'CI-F',
  'builder-down': 'DOWN', 'builder-stale': 'DOWN', 'health-crit': 'DOWN', 'audit-fork': 'DOWN',
  'budget-warn': 'BUDG', 'budget-exceeded': 'BUDG',
  'conflict': 'CONF',
});

/** Per tile: the long name (aria-label, title), the icon (tablet), the noun for the count. */
export const TILE_META = Object.freeze({
  'NEED': Object.freeze({ name: 'Needs input', icon: 's-question', noun: 'lane' }),
  'APPR': Object.freeze({ name: 'Approval', icon: 'approval', noun: 'request' }),
  'BLKD': Object.freeze({ name: 'Blocked', icon: 'blocked', noun: 'lane' }),
  'STCK': Object.freeze({ name: 'Stuck', icon: 'stuck', noun: 'lane' }),
  'CI-F': Object.freeze({ name: 'CI failing', icon: 'ci-fail', noun: 'check' }),
  'DOWN': Object.freeze({ name: 'Builder down', icon: 'builder-down', noun: 'alarm' }),
  'BUDG': Object.freeze({ name: 'Budget', icon: 'budget', noun: 'alarm' }),
  'CONF': Object.freeze({ name: 'Conflict', icon: 'conflict', noun: 'conflict' }),
});

/**
 * The lamp priority each tile draws in, fixed by what the tile means
 * (docs/design.md, the colour rule): broken (BLKD, DOWN) is the red p1 with
 * the ■ mark, everything else wants you and is the amber p2 with the ▲ mark.
 * The members' own priorities still order them (tileModel `p`), but no tile
 * draws in p3 any more: BUDG went cyan (runs night 4 T13), and DOWN flapped
 * red/blue as a demo builder went down and stale (runs T38).
 */
export const TILE_FIXED_P = Object.freeze({
  'NEED': 2, 'APPR': 2, 'BLKD': 1, 'STCK': 2, 'CI-F': 2, 'DOWN': 1, 'BUDG': 2, 'CONF': 2,
});

/** The status shape of a lamp priority: 1 -> ■ (broken), 2 -> ▲ (wants you). */
export const TONE_MARK = Object.freeze({ 1: '\u25a0', 2: '\u25b2' });

/** The lamp priority a tile draws in: its fixed one, else its worst member's; null when clear. */
export function tileTone(t) {
  if (!t || t.p == null) return null;
  return Object.hasOwn(TILE_FIXED_P, t.tile) ? TILE_FIXED_P[t.tile] : t.p;
}

/** The tile of an alarm kind, or null (own keys only, never an inherited member). */
export function tileOf(kind) {
  return typeof kind === 'string' && Object.hasOwn(KIND_TO_TILE, kind) ? KIND_TO_TILE[kind] : null;
}

/** Alarm priority -> lamp `data-p`: P1 -> 1, P2 -> 2, P3 and P4 -> 3; anything else -> 3. */
export function alarmP(priority) {
  const m = /^P([1-4])$/.exec(String(priority ?? ''));
  if (!m) return 3;
  return Math.min(3, Number(m[1]));
}

/** The route `s=` value of a tile (the router takes lowercase only): 'CI-F' -> 'ci-f'. */
export function tileParam(tile) {
  return TILES.includes(tile) ? tile.toLowerCase() : null;
}

/** A route `s=` value -> its tile, or null when it names none. */
export function tileFromParam(s) {
  if (typeof s !== 'string') return null;
  const t = s.toUpperCase();
  return TILES.includes(t) ? t : null;
}

/**
 * The fleet key an alarm points at (`builder/target`), when the target names
 * a session or lane; null for builder-wide alarms (target empty or '*').
 */
export function alarmKey(alarm) {
  if (!alarm || typeof alarm !== 'object') return null;
  const { builder, target } = alarm;
  if (typeof builder !== 'string' || !BUILDER_ID_RX.test(builder)) return null;
  if (typeof target !== 'string' || target === '' || target === '*') return null;
  try { return fkey(builder, target); } catch { return null; }
}

/**
 * alarms -> [{tile, p, state, n, members}] for the 8 tiles, in TILES order.
 * - members: the tile's alarms, worst priority first, then oldest first;
 * - n: how many; p: the max priority over the members (1 worst), null when none;
 * - state: 'normal' (none), 'unack' (any member unacknowledged), else 'ack'.
 * Unknown kinds, `review` and malformed entries are skipped; a repeated id counts once.
 */
export function tileModel(alarms) {
  const by = new Map(TILES.map((t) => [t, []]));
  const seen = new Set();
  for (const a of Array.isArray(alarms) ? alarms : []) {
    if (!a || typeof a !== 'object') continue;
    const tile = tileOf(a.kind);
    if (!tile) continue;
    if (typeof a.id === 'string') {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
    }
    by.get(tile).push(a);
  }
  return TILES.map((tile) => {
    const members = by.get(tile).slice().sort((x, y) => alarmP(x.priority) - alarmP(y.priority)
      || (Number(x.since) || 0) - (Number(y.since) || 0));
    const n = members.length;
    const p = n ? Math.min(...members.map((a) => alarmP(a.priority))) : null;
    const state = !n ? 'normal' : members.some((a) => a.acked !== true) ? 'unack' : 'ack';
    return { tile, p, state, n, members };
  });
}

/** The accessible name of a tile: "Stuck: 2 lanes, unacknowledged". */
export function tileLabel(t) {
  const meta = TILE_META[t?.tile];
  if (!meta) return '';
  if (!t.n) return `${meta.name}: clear`;
  const words = `${t.n} ${meta.noun}${t.n === 1 ? '' : 's'}`;
  return `${meta.name}: ${words}${t.state === 'unack' ? ', unacknowledged' : ', acknowledged'}`;
}

/** The fleet keys of a tile's members (for the `s=<tile>` scope filter). */
export function tileKeys(model, tile) {
  const t = (Array.isArray(model) ? model : []).find((x) => x.tile === tile);
  const out = new Set();
  for (const a of t?.members ?? []) {
    const k = alarmKey(a);
    if (k) out.add(k);
  }
  return out;
}

/**
 * The ack-alarm request for a tile: target '*', args {tile, builder?}
 * (README §3.5; the hub and builder both validate this exact shape).
 */
export function ackRequest(tile, builder = null) {
  if (!TILES.includes(tile)) return null;
  const args = { tile };
  if (typeof builder === 'string' && builder !== 'all' && BUILDER_ID_RX.test(builder)) args.builder = builder;
  return { target: '*', args };
}
