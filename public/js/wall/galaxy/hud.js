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

import { MAX_LINES, captionLines, coverOf } from '../caption.js';
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
 * What a tapped thing's sheet says (night 3 T11, README §7 Night 3 C3): the
 * person asked, so every line `captionLines` has (a calm site's status,
 * bars, facts and counts too, which the tour's plate drops from 3 m), worst
 * first as it ranks them: the trouble word, the count by severity, the next
 * problems, then the rest. A site's kicker is `galaxyCaption`'s; a planet's
 * (anything below a site) names the site it is in (`ROOM · IN HV2`). The
 * plate's own type steps: the sheet is the plate, so nothing new competes
 * for the eye. `sheet: true` on the answer. Pure.
 */
export function sheetCaption(node, model, index = null, count = null) {
  const nodes = nodeList(model).filter((n) => n && typeof n.id === 'string');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kind = node?.kind || 'node';
  const cap = captionLines(node, model, index, count);
  const sheet = { ...galaxyCaption(cap, kind), lines: cap.lines, sheet: true };
  if (kind === 'site') return sheet;
  // The nearest site above it, if any.
  const seen = new Set();
  let site = null;
  for (let p = byId.get(node?.parent); p && !seen.has(p.id); p = byId.get(p.parent)) {
    seen.add(p.id);
    if (p.kind === 'site') { site = p; break; }
  }
  return site ? { ...sheet, kicker: `${sheet.kicker} · IN ${String(site.label ?? site.id).toUpperCase()}` } : sheet;
}

/**
 * The problem `heldId` belongs to in `model` (bannerModel): a test that is
 * true for the held node, the topmost node in trouble above it, and
 * everything in trouble under that. Null when nothing is held or the held
 * thing is calm. Pure.
 */
function heldProblem(model, heldId) {
  const nodes = Array.isArray(model?.nodes) ? model.nodes : null;
  if (!nodes || typeof heldId !== 'string') return null;
  const byId = new Map(nodes.filter((n) => n && typeof n.id === 'string').map((n) => [n.id, n]));
  const bad = (n) => Boolean(n) && TROUBLE.includes(n.status);
  let root = byId.get(heldId);
  if (!bad(root)) return null;
  const seen = new Set([root.id]);
  while (bad(byId.get(root.parent)) && !seen.has(root.parent)) {
    root = byId.get(root.parent);
    seen.add(root.id);
  }
  // A node is in the held problem when the walk up through trouble reaches its root.
  return (n) => {
    const walked = new Set();
    for (let m = n; bad(m) && !walked.has(m.id); m = byId.get(m.parent)) {
      if (m.id === root.id) return true;
      walked.add(m.id);
    }
    return false;
  };
}

/**
 * Whether the fleet line, fed `bannerModel(model, heldId)`, still names the
 * held problem (night 3 T20, reviews/r11-dreamer.md galaxy 3): no other
 * problem it may step down to, so it would say what the plate's hero says.
 * Then the line drops out while the plate is up (frame.js `echo`, wall.css)
 * rather than make three reds of one thing; it is back as the plate goes.
 * Pure.
 */
export function bannerEcho(model, heldId) {
  const inHeld = heldProblem(model, heldId);
  if (!inHeld) return false;
  const w = worstLine(bannerModel(model, heldId));
  if (w.step === 'calm') return false;
  return inHeld(model.nodes.find((n) => n?.id === w.id));
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
 * visit to the crit system; the line drops out under the plate instead
 * (`bannerEcho`, T20). Pure.
 */
export function bannerModel(model, heldId) {
  const inHeld = heldProblem(model, heldId);
  if (!inHeld) return model;
  const masked = { ...model, nodes: model.nodes.map((n) => (n && inHeld(n) ? { ...n, status: 'ok' } : n)) };
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
 * remembered in the calm voice (night 3 T18: `hv1 · vm-c ok · was down 6m`,
 * grey, a small red glyph, never the 3 m step; a live problem takes the line
 * over it, honest before steady: a flap shows the live warn) until the tour's next overview at least `minMs` after it
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
 * What the fleet line remembers of a cleared crit (night 3 T18, frame.js
 * `clearedLine`): `hold` (`{ id, status, since, clearedAt }`) as `{ id,
 * status, forMs }`, how long it was in trouble (from when this page first
 * saw it). Null with no hold. Pure.
 */
export function clearedOf(hold) {
  if (!hold) return null;
  return { id: hold.id, status: hold.status, forMs: Math.max(0, hold.clearedAt - (hold.since ?? hold.clearedAt)) };
}

/**
 * `cap` with the feed's grey line (night 3 T5, galaxy/fresh.js): once no map
 * frame came for 30 s the plate says the data is old, first after the trouble
 * word (a `fact`-like row in the line step, never in a status hue), the last
 * row giving way past MAX_LINES. `cap` itself while the data is fresh. Pure.
 */
export function staleCaption(cap, fresh) {
  if (!fresh?.line) return cap;
  const lines = Array.isArray(cap?.lines) ? cap.lines : [];
  const at = lines[0]?.step === 'hero' ? 1 : 0;
  const row = { kind: 'stale', step: 'line', label: 'data', text: fresh.line };
  return { ...cap, lines: [...lines.slice(0, at), row, ...lines.slice(at)].slice(0, MAX_LINES) };
}

/**
 * Wires `caption` (`show(leg, cap)`, `hide()`), `frame` (`update(model)`,
 * `live(on)`, `plate(on)` while a plate shows) and, when given, `lock` (`lockOn(leg)`, `release()`) to `tour`
 * (`onLeg(cb)`). `update(model)` gives both the newest
 * model (the frame's with a crit that just cleared as `clearedOf`, so the
 * line remembers it quietly, and through `bannerModel`, so it never repeats the held
 * caption), `live(on)` the socket's state, `fresh(f)` the feed's (fresh.js:
 * the tag's word, and the caption's grey line from the next leg on), `park(site)` shows a parked system's
 * caption (`?at=`, for stills) without a tour, `open(leg)` a tapped site's or planet's sheet (sheetCaption)
 * (its brackets at once, its plate at `leg.arriveMs`), and `covers()` the boxes the
 * words take over the canvas (for the labels, T6; the tag top right since T18,
 * so neither a name nor a held planet sits on it; the warn-step fleet line
 * too), `fleetCover()` the fleet line's at either step, `tagCover()` the tag's alone.
 * `size()` is the stage's css size (stage.js, the scene's `size`); the line's
 * and the tag's boxes are read again only when it or their words change
 * (T29: both are asked for twice a frame, after the lock's style writes).
 * `now()` is the clock the crit hold counts on, `timers` the plate's arrival
 * waits on (both injectable for tests).
 */
export function createHud({ caption, frame, tour = null, lock = null, size = null, now = Date.now, timers = globalThis }) {
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
    frame.update(bannerModel(latest, heldId), { cleared: clearedOf(hold), echo: bannerEcho(latest, heldId) });
  };
  // One headline per trouble frame (night 3 T4): the far line steps down
  // while the plate is up, from the leg's arrival (the plate comes with the
  // camera; in the flight the banner is still the only headline) until the
  // next leg.
  let plateTimer = null;
  // Whether the plate is up, and the node its hero names (the lock's target
  // while the plate says trouble): that node's own name gives way (T20).
  let plateOn = false, heroId = null;
  // The feed's state (fresh.js), the last one given.
  let feedState = null;
  const plate = (on, atMs = 0) => {
    if (plateTimer != null) { timers.clearTimeout(plateTimer); plateTimer = null; }
    const set = (up) => { plateOn = up; frame.plate?.(up); };
    // The last plate fades as the next leg starts: the banner is the headline again until the camera arrives.
    set(Boolean(on) && !(atMs > 0));
    if (on && atMs > 0) plateTimer = timers.setTimeout(() => { plateTimer = null; set(true); }, atMs);
  };
  const say = (leg) => {
    if (leg?.kind === 'overview' && hold && now() - hold.clearedAt >= CRIT_HOLD.minMs) hold = null;
    const node = legNode(leg, latest);
    if (node) {
      const cap = staleCaption(leg.sheet
        ? sheetCaption(node, latest, leg.index ?? null, leg.count ?? null)
        : galaxyCaption(captionLines(node, latest, leg.index ?? null, leg.count ?? null), node.kind || 'node'), feedState);
      const target = lockTarget(node, latest);
      heldId = target[0]?.id ?? null;
      // A planet, not the site: a site in trouble itself has the hero say its status (`CRIT`), its name on the plate's name line.
      heroId = heldId !== node.id && cap.lines.some((l) => l.step === 'hero' && l.id === heldId) ? heldId : null;
      feed();
      plate(true, leg.arriveMs);
      caption.show(leg, cap);
      // The brackets take the trouble word's hue (a parked leg has no status of its own).
      const lead = cap.lines.find((l) => l.kind === 'trouble');
      // A tapped site (T10) is locked at once (`lockMs` 0, `cut`), the plate still waiting for the camera.
      lock?.lockOn({ ...leg, arriveMs: leg.lockMs ?? leg.arriveMs, node, status: lead?.status ?? leg.status ?? node.status, target });
    } else {
      heldId = null;
      heroId = null;
      feed();
      plate(false);
      caption.hide();
      lock?.release();
    }
  };
  const off = tour ? tour.onLeg(say) : () => {};
  // Below the far step frame.js gives no cover, but the warn line's words
  // (and a cleared crit's, T18) are there all the same: the names keep off them too (round 42, seen with
  // T20: `CLOUD` ran into `▲ REMOTE · OFFICE-PRINTER`). Read again only when
  // the line's words or the window change, never per frame.
  let lineSeen = null, lineBox = null;
  const fleetCover = () => {
    if (frame.hushed?.()) return null;
    const far = frame.cover?.() ?? null;
    if (far) return far;
    const f = frame.el?.fleet;
    const line = f?.querySelector?.('.wall-fleet-line');
    if (!f || !(f.dataset.step === 'line' || f.dataset.tone === 'cleared') || !line) return null;
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
        // The same crit (or one flapping back within its hold) keeps its start: "was down 6m" counts from it.
        const same = crit?.id === far.id ? crit : hold?.id === far.id ? hold : null;
        crit = { id: far.id, status: far.status, since: same?.since ?? now() };
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
    fresh: (f) => {
      if (!f || typeof f.text !== 'string') return;
      feedState = f;
      if (frame.fresh) frame.fresh(f);
      else frame.live(f.state === 'live');
    },
    park: (leg) => say({ arriveMs: 0, ...leg, kind: 'site' }),
    // A finger took the camera (night 3 T7, touch.js): the words of an overview leg, no plate, no lock.
    release: () => say({ kind: 'overview' }),
    // A finger tapped a site (night 3 T10) or a planet in an open system (T11): its sheet (every line,
    // sheetCaption) as the camera gets there, its brackets at once.
    open: (leg) => say({ arriveMs: 0, ...leg, kind: 'site', lockMs: 0, cut: true, sheet: true }),
    covers: () => [caption.cover?.(), fleetCover(), tagCover()].filter(Boolean),
    // The node the plate's hero names while the plate is up, or null: labels.js does not name it twice (T20).
    named: () => (plateOn ? heroId : null),
    fleetCover,
    tagCover,
    stop: () => { off(); plate(false); },
  };
}
