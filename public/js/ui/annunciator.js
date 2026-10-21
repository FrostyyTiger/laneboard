// The annunciator (fleet plan §4 2.5, task D7): eight fixed alarm tiles in a
// 2x4 grid in the 40px header (#ann). ISA-18.2 style states:
//   normal  dark (grey text-3), empty count
//   unack   filled --pN, --text-inv text, 1 Hz flash in phase with every other
//           unacknowledged element (components.js syncFlash); with
//           prefers-reduced-motion: no flash, solid fill plus an UNACK tag
//   ack     filled, steady
// A click toggles the scope filter `s=<tile>` through the router
// (aria-pressed). `a` on a focused tile, the context menu or a long press
// sends `ack-alarm` with target '*' and args {tile, builder?} through act()
// (tier click, no dialog). The data is alarms(store), fed by §7's
// `{type:'alarms', alarms}` messages; GET /api/alarms fills it on (re)connect.
//
// Pure at import time. The tile model is core/alarm-tiles.js; tileView below
// is the pure per-tile view model (tested in test/annunciator.test.mjs).
// Builder-provided text (alarm text, targets) only ever reaches the DOM via
// textContent / setAttribute.
import { $ } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { act } from '../core/actions.js';
import { alarms, ingest, store, subscribe } from '../core/store.js';
import { currentRoute, navigate, onRoute } from '../core/router.js';
import { TILES, TILE_META, ackRequest, tileFromParam, tileLabel, tileModel, tileParam, tileTone } from '../core/alarm-tiles.js';
import { syncFlash } from './components.js';
import { toast } from './toast.js';

/** Long-press time for the touch ACK, ms. */
export const LONG_PRESS_MS = 600;
/** Most member lines in a tile's tooltip. */
const TITLE_LINES = 6;

/**
 * One tile's view: {tile, label, n, p, state, pressed, aria, title}. `n` is ''
 * when clear; `p` is the lamp priority as a string (tileTone), or '' when clear. Pure.
 */
export function tileView(t, route = null) {
  const sel = tileFromParam(route?.s ?? null);
  const aria = tileLabel(t);
  const lines = [aria];
  for (const a of (t?.members ?? []).slice(0, TITLE_LINES)) {
    const who = [a.builder, a.target].filter((x) => typeof x === 'string' && x).join('/');
    const text = typeof a.text === 'string' ? a.text : '';
    lines.push([who, text].filter(Boolean).join(' · ').slice(0, 160));
  }
  if ((t?.n ?? 0) > TITLE_LINES) lines.push(`+${t.n - TITLE_LINES} more`);
  return {
    tile: t.tile,
    label: t.tile,
    n: t.n ? String(t.n) : '',
    p: tileTone(t) == null ? '' : String(tileTone(t)),
    state: t.state,
    pressed: sel === t.tile,
    aria,
    title: lines.join('\n'),
  };
}

let root = null;
const nodes = new Map(); // tile -> {btn, n}
let lastModel = [];
let pressTimer = 0;
let pressFired = false;

function buildTiles(box) {
  box.textContent = '';
  nodes.clear();
  for (const tile of TILES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ann-tile';
    btn.dataset.tile = tile;
    btn.dataset.state = 'normal';
    btn.setAttribute('aria-pressed', 'false');
    const ic = icon(TILE_META[tile].icon, { size: 's', cls: 'ann-i' });
    const label = document.createElement('span');
    label.className = 'ann-label';
    label.textContent = tile;
    const n = document.createElement('span');
    n.className = 'ann-n';
    const tag = document.createElement('span');
    tag.className = 'ann-tag';
    tag.textContent = 'UNACK';
    tag.setAttribute('aria-hidden', 'true');
    btn.append(ic, label, n, tag);
    box.append(btn);
    nodes.set(tile, { btn, n });
  }
}

/** Update the tiles in place (no rebuild, so the flash phase is kept). */
export function renderAnnunciator(route) {
  if (!root) return;
  lastModel = tileModel(alarms(store));
  const r = route ?? currentRoute();
  for (const t of lastModel) {
    const node = nodes.get(t.tile);
    if (!node) continue;
    const v = tileView(t, r);
    const { btn } = node;
    const was = btn.dataset.state;
    btn.dataset.state = v.state;
    if (v.p) btn.dataset.p = v.p;
    else delete btn.dataset.p;
    if (v.state === 'unack') {
      if (!('unack' in btn.dataset)) {
        btn.dataset.unack = '';
        syncFlash(btn);
      } else if (was !== 'unack') syncFlash(btn);
    } else if ('unack' in btn.dataset) {
      delete btn.dataset.unack;
      btn.style.animationDelay = '';
    }
    if (node.n.textContent !== v.n) node.n.textContent = v.n;
    btn.setAttribute('aria-pressed', v.pressed ? 'true' : 'false');
    btn.setAttribute('aria-label', v.aria);
    btn.title = v.title;
  }
}

/** Toggle the `s=<tile>` scope filter. */
export function toggleTileFilter(tile) {
  const param = tileParam(tile);
  if (!param) return;
  const cur = currentRoute().s;
  navigate({ s: cur === param ? null : param });
}

/** Ack every alarm of a tile (scoped to the current builder filter, if any). */
export async function ackTile(tile) {
  const t = lastModel.find((x) => x.tile === tile);
  if (!t || t.state !== 'unack') return null;
  const req = ackRequest(tile, currentRoute().b);
  if (!req) return null;
  const res = await act(req.target, 'ack-alarm', req.args);
  if (res?.ok === false) toast(`ACK ${tile} failed: ${String(res.error ?? 'error').slice(0, 120)}`, { kind: 'err' });
  return res;
}

/** Ack every unacknowledged tile (the global `A`, for D8's keymap). */
export async function ackAllVisible() {
  const out = [];
  for (const t of lastModel) if (t.state === 'unack') out.push(await ackTile(t.tile));
  return out;
}

/** The current tile model (for the rail, the palette, D8's n/N). */
export function annunciatorModel() {
  return lastModel;
}

function tileFrom(e) {
  const btn = e.target?.closest?.('.ann-tile');
  return btn && root?.contains(btn) ? btn.dataset.tile : null;
}

function cancelPress() {
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = 0;
}

/** The first alarm list (GET /api/alarms) after a (re)connect; frames keep it current. */
function loadAlarms() {
  fetch('/api/alarms', { headers: { 'x-laneboard': '1' } })
    .then((r) => (r && r.ok ? r.json() : null))
    .then((j) => { if (j && Array.isArray(j.alarms)) ingest(store, { type: 'alarms', alarms: j.alarms }); })
    .catch(() => { /* the next alarms frame fills it */ });
}

/** Wire #ann once, run by boot(). */
export function init() {
  root = $('ann');
  if (!root) return;
  buildTiles(root);
  renderAnnunciator();

  root.addEventListener('click', (e) => {
    const tile = tileFrom(e);
    if (!tile) return;
    if (pressFired) { pressFired = false; e.preventDefault(); return; }
    toggleTileFilter(tile);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'a' || e.metaKey || e.ctrlKey || e.altKey) return;
    const tile = tileFrom(e);
    if (!tile) return;
    e.preventDefault();
    e.stopPropagation();
    ackTile(tile);
  });
  root.addEventListener('contextmenu', (e) => {
    const tile = tileFrom(e);
    if (!tile) return;
    e.preventDefault();
    ackTile(tile);
  });
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const tile = tileFrom(e);
    if (!tile) return;
    cancelPress();
    pressFired = false;
    pressTimer = setTimeout(() => { pressTimer = 0; pressFired = true; ackTile(tile); }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) root.addEventListener(type, cancelPress);

  onRoute((route) => renderAnnunciator(route));
  subscribe((change) => {
    if (change.type === 'alarms') renderAnnunciator();
    else if (change.type === 'status' && change.status === 'open') loadAlarms();
  });
  loadAlarms();
}
