// The galaxy's words (Wall plan night 2 T5, README §3): the Wall's caption
// and frame (caption.js, frame.js) over the WebGL canvas, as on wall.html.
// The caption names a system as the camera gets there (fed from the tour's
// legs with `captionLines` from the newest model) and fades when it leaves;
// the frame keeps the vignette, the clock, the fleet's worst line and the tag
// still while the camera moves; the lock (galaxy/lock.js, T9) closes on the
// node the caption's trouble word names, a leader joining the two. The sketch's own caption and clock are not
// ported: one type system for both pages.
//
// `createHud` takes the caption, the frame and the tour (injectable, so
// test/wall-galaxy-hud.test.mjs drives it with fakes); galaxy/main.js makes
// the real ones.

import { captionLines, coverOf } from '../caption.js';
import { worstLine } from '../frame.js';
import { lockTarget } from '../lock.js';
import { TROUBLE } from '../../views/map/model.js';

/** The node a site leg is about in `model`, or null (an overview leg, or a site the model no longer has). */
export function legNode(leg, model) {
  if (leg?.kind !== 'site') return null;
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  return nodes.find((n) => n?.id === leg.id) ?? null;
}

/**
 * What the galaxy's plate says (T25, reviews/r26-skeptic.md 8): `cap` from
 * `captionLines`, cut for the wall. A calm hold is the kicker and the name,
 * nothing else: its status, bars, facts and counts are lists nobody reads
 * from 3 m and none of them calls for anything. A hold in trouble keeps its
 * lines. Every galaxy leg is a site, so a numbered kicker loses its
 * ` · SITE` (`TARGET 04 / 05`); an unnumbered one keeps its kind, the only
 * word it has. Pure.
 */
export function galaxyCaption(cap, kind = 'site') {
  const tail = ` · ${String(kind).toUpperCase()}`;
  const kicker = /TARGET \d/.test(cap.kicker) && cap.kicker.endsWith(tail)
    ? cap.kicker.slice(0, -tail.length)
    : cap.kicker;
  return { ...cap, kicker, lines: cap.mark ? cap.lines : [] };
}

/**
 * The model the fleet line is fed while `heldId` is the lock's target (T23,
 * reviews/r21-operator.md 5): when the line would name the problem the
 * caption already holds, the banner steps down to the next one. The held
 * problem (the held node, up to the topmost node in trouble above it, and
 * everything in trouble under that) reads calm in a copy of `model`, so
 * `worstLine` names the next and counts `+N more` past the two. `model`
 * itself when nothing is held, the held thing is calm, the line names
 * another problem anyway, or there is no other problem (the line never says
 * "all calm" while the caption says trouble). Nor does it step down a size
 * (T30, reviews/r43-stranger.md galaxy 1): past a held crit only to another
 * crit, never to a warn, or the 3 m line went red, yellow, red with every
 * visit to the crit system; repeating the caption is the lesser harm. Pure.
 */
export function bannerModel(model, heldId) {
  const nodes = Array.isArray(model?.nodes) ? model.nodes : null;
  if (!nodes || typeof heldId !== 'string') return model;
  const byId = new Map(nodes.filter((n) => n && typeof n.id === 'string').map((n) => [n.id, n]));
  const bad = (n) => Boolean(n) && TROUBLE.includes(n.status);
  let root = byId.get(heldId);
  if (!bad(root)) return model;
  const seen = new Set([root.id]);
  while (bad(byId.get(root.parent)) && !seen.has(root.parent)) {
    root = byId.get(root.parent);
    seen.add(root.id);
  }
  // A node is in the held problem when the walk up through trouble reaches its root.
  const inHeld = (n) => {
    const walked = new Set();
    for (let m = n; bad(m) && !walked.has(m.id); m = byId.get(m.parent)) {
      if (m.id === root.id) return true;
      walked.add(m.id);
    }
    return false;
  };
  const masked = { ...model, nodes: nodes.map((n) => (n && inHeld(n) ? { ...n, status: 'ok' } : n)) };
  const before = worstLine(model);
  const after = worstLine(masked);
  // Masking another problem leaves the line as it was: then it was not the held one.
  if (after.step === 'calm' || after.text === before.text || after.step !== before.step) return model;
  return masked;
}

/**
 * How long a crit that cleared stays on the fleet line (T30,
 * reviews/r43-stranger.md galaxy 1): a contact that drops and comes back
 * within seconds made the line flip red, yellow, red. A crit that clears is
 * held, dimmed, until the tour's next overview at least `minMs` after it
 * cleared (the end of the cycle it cleared in, or the one after); a crit
 * that comes back, or a newer one, takes the line at once. Without a tour
 * (a parked `?at=`) it is held `minMs`.
 */
export const CRIT_HOLD = Object.freeze({ minMs: 30000 });

const nodeList = (model) => (Array.isArray(model?.nodes) ? model.nodes : []);

/**
 * The node the fleet line speaks for while it is at the far step (crit or
 * down), as `worstLine` picks it, or null below that. Pure.
 */
export function farNode(model) {
  const w = worstLine(model);
  if (w.step !== 'far') return null;
  return nodeList(model).find((n) => n && typeof n.id === 'string'
    && String(n.label ?? n.id) === w.name && n.status === w.status) ?? null;
}

/** `12s`, `3m`: how long ago, in the fleet line's words. */
export const agoText = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
};

/**
 * `model` with a cleared crit still on it (T30): `hold` (`{ id, status,
 * clearedAt }`) puts its node back at its old status with the why `cleared
 * 12s ago`, so `worstLine` keeps the line at the far step. `model` itself
 * with no hold, or when the node is gone. Pure.
 */
export function heldModel(model, hold, now) {
  if (!hold) return model;
  const nodes = nodeList(model);
  if (!nodes.some((n) => n?.id === hold.id)) return model;
  const why = `cleared ${agoText(now - hold.clearedAt)} ago`;
  return { ...model, nodes: nodes.map((n) => (n?.id === hold.id ? { ...n, status: hold.status, why } : n)) };
}

/**
 * Wires `caption` (`show(leg, cap)`, `hide()`), `frame` (`update(model)`,
 * `live(on)`) and, when given, `lock` (`lockOn(leg)`, `release()`) to `tour`
 * (`onLeg(cb)`). `update(model)` gives both the newest
 * model (the frame's through `heldModel`, so a crit that just cleared stays
 * on its line, dimmed, and `bannerModel`, so the line never repeats the held
 * caption), `live(on)` the socket's state, `park(site)` shows a parked system's
 * caption (`?at=`, for stills) without a tour, and `covers()` the boxes the
 * words take over the canvas (for the labels, T6; the tag top right since T18,
 * so neither a name nor a held planet sits on it; the warn-step fleet line
 * too), `fleetCover()` the fleet line's at either step, `tagCover()` the tag's alone.
 * `size()` is the stage's css size (stage.js, the scene's `size`); the line's
 * and the tag's boxes are read again only when it or their words change
 * (T29: both are asked for twice a frame, after the lock's style writes).
 * `now()` is the clock the crit hold counts on (injectable for tests).
 */
export function createHud({ caption, frame, tour = null, lock = null, size = null, now = () => Date.now() }) {
  const stage = size ?? (() => ({ W: globalThis.innerWidth, H: globalThis.innerHeight }));
  let latest = null;
  // The lock target's node (lockTarget's first), as the leg's caption and
  // brackets name it: the fleet line steps past its problem (bannerModel).
  // The frame is fed again only when the model, the held thing or the
  // cleared crit's hold changes.
  let heldId = null, fedFor = null, fedHeld = null, fedHold = null;
  // The far line's node in the newest model, and a crit that cleared (CRIT_HOLD).
  let crit = null, hold = null;
  const feed = () => {
    if (!latest || (fedFor === latest && fedHeld === heldId && fedHold === hold)) return;
    fedFor = latest;
    fedHeld = heldId;
    fedHold = hold;
    const kept = heldModel(latest, hold, now());
    const fed = bannerModel(kept, heldId);
    // Dimmed while the line is the cleared crit (wall.css), not when the caption holds it and the line steps past.
    const fleet = frame.el?.fleet;
    if (fleet?.dataset) {
      if (kept !== latest && fed === kept) fleet.dataset.held = '1';
      else delete fleet.dataset.held;
    }
    frame.update(fed);
  };
  const say = (leg) => {
    if (leg?.kind === 'overview' && hold && now() - hold.clearedAt >= CRIT_HOLD.minMs) hold = null;
    const node = legNode(leg, latest);
    if (node) {
      const cap = galaxyCaption(captionLines(node, latest, leg.index ?? null, leg.count ?? null), node.kind || 'node');
      const target = lockTarget(node, latest);
      heldId = target[0]?.id ?? null;
      feed();
      caption.show(leg, cap);
      // The brackets take the trouble word's hue (a parked leg has no status of its own).
      const lead = cap.lines.find((l) => l.kind === 'trouble');
      lock?.lockOn({ ...leg, node, status: lead?.status ?? leg.status ?? node.status, target });
    } else {
      heldId = null;
      feed();
      caption.hide();
      lock?.release();
    }
  };
  const off = tour ? tour.onLeg(say) : () => {};
  // Below the far step frame.js gives no cover, but the warn line's words
  // are there all the same: the names keep off them too (round 42, seen with
  // T20: `CLOUD` ran into `▲ REMOTE · OFFICE-PRINTER`). Read again only when
  // the line's words or the window change, never per frame.
  let lineSeen = null, lineBox = null;
  const fleetCover = () => {
    const far = frame.cover?.() ?? null;
    if (far) return far;
    const f = frame.el?.fleet;
    const line = f?.querySelector?.('.wall-fleet-line');
    if (!f || f.dataset.step !== 'line' || !line) return null;
    const { W, H } = stage();
    const k = `${line.dataset.key}|${W}x${H}`;
    if (k !== lineSeen) {
      lineSeen = k;
      lineBox = coverOf({ left: f.offsetLeft, top: f.offsetTop, width: f.offsetWidth, height: f.offsetHeight });
    }
    return lineBox;
  };
  // The tag never moves: its box changes only with its words (title, live) or the stage.
  let tagSeen = null, tagBox = null;
  const tagCover = () => {
    const t = frame.el?.tag;
    if (!t) return null;
    const { W, H } = stage();
    const k = `${t.textContent}|${W}x${H}`;
    if (k !== tagSeen) {
      tagSeen = k;
      tagBox = coverOf({ left: t.offsetLeft, top: t.offsetTop, width: t.offsetWidth, height: t.offsetHeight });
    }
    return tagBox;
  };
  return {
    update: (model) => {
      if (!model || typeof model !== 'object') return;
      latest = model;
      const far = farNode(model);
      if (far) {
        crit = { id: far.id, status: far.status };
        hold = null;
      } else if (crit) {
        hold = { ...crit, clearedAt: now() };
        crit = null;
      } else if (hold && !tour && now() - hold.clearedAt >= CRIT_HOLD.minMs) {
        hold = null;
      }
      feed();
    },
    live: (on) => frame.live(Boolean(on)),
    park: (leg) => say({ arriveMs: 0, ...leg, kind: 'site' }),
    covers: () => [caption.cover?.(), fleetCover(), tagCover()].filter(Boolean),
    fleetCover,
    tagCover,
    stop: () => off(),
  };
}
