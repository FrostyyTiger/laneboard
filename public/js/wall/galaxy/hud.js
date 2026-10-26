// The galaxy's words (Wall plan night 2 T5, README §3): the Wall's caption
// and frame (caption.js, frame.js) over the WebGL canvas, as on wall.html.
// The caption names a system as the camera gets there (fed from the tour's
// legs with `captionLines` from the newest model) and fades when it leaves;
// the frame keeps the vignette, the clock, the fleet's worst line and the tag
// still while the camera moves. The sketch's own caption and clock are not
// ported: one type system for both pages.
//
// `createHud` takes the caption, the frame and the tour (injectable, so
// test/wall-galaxy-hud.test.mjs drives it with fakes); galaxy/main.js makes
// the real ones.

import { captionLines } from '../caption.js';

/** The node a site leg is about in `model`, or null (an overview leg, or a site the model no longer has). */
export function legNode(leg, model) {
  if (leg?.kind !== 'site') return null;
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  return nodes.find((n) => n?.id === leg.id) ?? null;
}

/**
 * Wires `caption` (`show(leg, cap)`, `hide()`) and `frame` (`update(model)`,
 * `live(on)`) to `tour` (`onLeg(cb)`). `update(model)` gives both the newest
 * model, `live(on)` the socket's state, `park(site)` shows a parked system's
 * caption (`?at=`, for stills) without a tour, and `covers()` the boxes the
 * words take over the canvas (for the labels, T6).
 */
export function createHud({ caption, frame, tour = null }) {
  let latest = null;
  const say = (leg) => {
    const node = legNode(leg, latest);
    if (node) caption.show(leg, captionLines(node, latest, leg.index ?? null, leg.count ?? null));
    else caption.hide();
  };
  const off = tour ? tour.onLeg(say) : () => {};
  return {
    update: (model) => {
      if (!model || typeof model !== 'object') return;
      latest = model;
      frame.update(model);
    },
    live: (on) => frame.live(Boolean(on)),
    park: (leg) => say({ arriveMs: 0, ...leg, kind: 'site' }),
    covers: () => [caption.cover?.(), frame.cover?.()].filter(Boolean),
    stop: () => off(),
  };
}
