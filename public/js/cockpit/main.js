// The cockpit on a page (cockpit spec protocols.md §1, screens.md §4, D17, D93):
// once the board says it has a cockpit, draw the button and the pane and open
// the room link; without one, `data-cockpit="unconfigured"` and nothing else
// changes (the board works as today).
//
//   initCockpit({ page: 'app' | 'wall', configured })   // configured(cb): cb(true|false) once
//
// On the app, `configured` is `boardSaysCockpit`: the board's /ws hello as the
// store keeps it, once docs/plans/cockpit/build/patches/T15-store-hello-cockpit.diff
// is applied (the store is fenced), else the same flag from GET /api/v1/hello
// (server/routes/cockpit-hello.mjs, build B107).
import { store, subscribe } from '../core/store.js';
import { COCKPIT_PREFIX } from '../core/cockpit-constants.js';
import { createRoomLink } from './link.js';
import { createPane } from './pane.js';
import { tooOld } from './fit.js';
import { createWallHold } from './wall-hold.js';
import { installAppView } from './app-view.js';

/** cb(true|false) once: the board's word on whether it has a cockpit (D93). */
export function boardSaysCockpit(cb) {
  let done = false;
  let unsub = () => {};
  const finish = (v) => {
    if (done) return;
    done = true;
    unsub();
    cb(v === true);
  };
  if (typeof store.source.cockpit === 'boolean') { finish(store.source.cockpit); return; }
  unsub = subscribe((change, s) => {
    if ((change.type === 'hello' || change.type === 'fleet') && typeof s.source.cockpit === 'boolean') finish(s.source.cockpit);
  });
  Promise.resolve()
    .then(() => fetch('/api/v1/hello'))
    .then((r) => (r && r.ok ? r.json() : null))
    .then((h) => { if (h && typeof h.cockpit === 'boolean') finish(h.cockpit); })
    .catch(() => { /* no word from this board: no button, as with `false` until one comes */ });
}

/** The room link's URL on the page's own origin (protocols.md §2: ws:// only on loopback pages). */
export function roomLinkUrl(loc = location) {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}${COCKPIT_PREFIX}/ws`;
}

let started = null;

export function initCockpit({ page = 'app', configured = boardSaysCockpit } = {}) {
  if (started) return started;
  started = {};
  // The app's handle (screens.md §9, D221); the Wall page sets its own.
  if (page === 'app') installAppView();
  configured((yes) => {
    if (!yes) {
      document.documentElement.dataset.cockpit = 'unconfigured';
      return;
    }
    // The Wall page has one layout until the Canvas slice (screens.md §1, Q-O22 b).
    if (page === 'wall') document.documentElement.dataset.cockpitLayout = 'wall';
    let link = null;
    // D250: below the browser floor the pane only says so, and no room link is opened.
    const old = tooOld(globalThis);
    // The pane and a running turn hold the Wall's tour and idle timer (screens.md §2, D4).
    const wallHold = createWallHold();
    const pane = createPane({
      page,
      unsupported: old,
      onRetryNow: () => link?.retryNow(),
      onPrompt: (m) => link?.send(m) ?? false,
      onStop: (m) => link?.send(m) ?? false,
      onNew: (m) => link?.send(m) ?? false,
      onGap: () => link?.gap(),
      onOpenChange: (open) => wallHold.pane(open),
      onTurnChange: (running) => wallHold.turn(running),
    });
    started.pane = pane;
    if (old) return;
    link = createRoomLink({
      url: roomLinkUrl(),
      page,
      onState: (s) => pane.setLink(s),
      onMessage: (m) => pane.apply(m),
    });
    started.link = link;
    link.start();
  });
  return started;
}
