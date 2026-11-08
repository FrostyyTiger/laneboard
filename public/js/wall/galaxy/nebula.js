// A site's nebula as a cloud with a direction (Wall plan night 2 T17,
// reviews/r8-film-ui.md 4): not one round radial glow but two or three
// offset, elongated lobes lying in the galaxy's plane, stretched along the
// arm's tangent at the site, so each cloud runs with its arm and no two are
// the same shape. Two crits are no longer twins in brightness either: the
// newest crit is the hottest, older ones a step quieter (still louder than
// any warn), so the eye has a first target.
//
// Pure: no DOM, no three. The scene (scene.js) draws the lobes and eases
// the peaks; this module only says where, how big and how bright.

import { ARM, hash } from './layout.js';

/**
 * The lobes, as shares of the nebula's size (NEBULA[tone].size, the old
 * round nebula's diameter): the main lobe is `len` long and `wid` across;
 * the side lobes sit `along` before and after it on the tangent, a little
 * `across` it, `len` long and `wid` wide, turned off the tangent by
 * `turn` rad (either way), `share` of the main lobe's strength. Lying flat they are seen at a slant (about 0.78 at the
 * overview), so they are longer than the round one was to keep its weight.
 * No lobe reaches past `reach` of the size from its star; most of a lobe's
 * light lies inside 0.6 of its half-extent (scene.js cloudTexture's mask),
 * only a faint rim goes further. Two crit nebulae's rims touch only when
 * their stars are under 2 x reach x 435 = 609 apart (night 5's 0.64x
 * nebulae; MIN_SITE_GAP allows 448; the large demo's closest pair is 978).
 */
export const LOBES = Object.freeze({
  main: Object.freeze({ len: 1.3, wid: [0.8, 0.92], share: 0.9 }),
  side: Object.freeze({ along: [0.26, 0.36], across: 0.16, turn: [0.12, 0.36], len: [0.56, 0.7], wid: [0.44, 0.56], share: [0.5, 0.68] }),
  /** Below this a site's hash gives it two lobes (one side lobe), above three. */
  three: 0.35,
  reach: 0.7,
});

/**
 * The newest crit's peak is 1; each older crit is `step` quieter, never
 * under `floor` (with NEBULA.crit 0.85 against warn 0.7, the floor keeps
 * every crit above every warn).
 */
export const PEAK = Object.freeze({ step: 0.12, floor: 0.84 });

/**
 * The arm's direction at a star at `home` (world x/z), as a unit vector in
 * the plane: the derivative of layout.js armPoint's spiral through that
 * point (radius grows ARM.step while the angle grows ARM.turn), pointing
 * outward along the arm.
 */
export function armTangent(home) {
  const x = Number(home?.x) || 0, z = Number(home?.z) || 0;
  const r = Math.hypot(x, z);
  if (!r) return { x: 1, z: 0 };
  const c = x / r, s = z / r;
  const tx = ARM.step * c - r * ARM.turn * s, tz = ARM.step * s + r * ARM.turn * c;
  const l = Math.hypot(tx, tz);
  return { x: tx / l, z: tz / l };
}

const lerp = ([a, b], k) => a + (b - a) * k;

/**
 * The lobes of the nebula round the site `id`, the same on every load:
 * `[{ along, across, len, wid, turn, share, flip }]`, `along`/`across` the
 * lobe's centre from the star (shares of the size, on the tangent and the
 * in-plane normal), `len`/`wid` its extent along and across, `turn` its
 * angle off the tangent (rad, round the up axis), `share` its
 * strength against the nebula's, `flip` which way round its texture lies
 * (0..3: turned half round and/or mirrored, so the lobes do not repeat).
 * The first lobe is the main one, on the star.
 */
export function nebulaLobes(id) {
  const h = (k) => hash(`${id}~neb~${k}`);
  const { main, side } = LOBES;
  const lobes = [{ along: 0, across: 0, len: main.len, wid: lerp(main.wid, h('w')), turn: 0, share: main.share, flip: Math.floor(h('f') * 4) }];
  const sides = h('n') < LOBES.three ? [h('d') < 0.5 ? -1 : 1] : [-1, 1];
  for (const dir of sides) {
    const len = lerp(side.len, h(`l${dir}`));
    // The centre plus half the length stays inside the reach.
    const along = Math.min(lerp(side.along, h(`a${dir}`)), LOBES.reach - len / 2);
    lobes.push({
      along: dir * along,
      across: (h(`c${dir}`) - 0.5) * 2 * side.across,
      len,
      wid: lerp(side.wid, h(`w${dir}`)),
      turn: (h(`t${dir}`) < 0.5 ? -1 : 1) * lerp(side.turn, h(`u${dir}`)),
      share: lerp(side.share, h(`s${dir}`)),
      flip: Math.floor(h(`f${dir}`) * 4),
    });
  }
  return lobes;
}

/**
 * How bright each site's nebula peaks (1: as NEBULA says), from
 * `[{ id, tone, since }]` (`since`: when the site turned to its tone, in
 * the scene's clock): the crits ranked newest first, 1 for the newest and
 * PEAK.step quieter per place after, never under PEAK.floor. A tie keeps
 * the given order (the tour's: the first visited is the hottest). Every
 * other tone peaks at 1, its strength is its tone's. → Map id → peak.
 */
export function nebulaPeaks(sites) {
  const out = new Map();
  const crits = [];
  (Array.isArray(sites) ? sites : []).forEach((s, i) => {
    if (s.tone === 'crit') crits.push({ id: s.id, since: Number(s.since) || 0, i });
    else out.set(s.id, 1);
  });
  crits.sort((a, b) => b.since - a.since || a.i - b.i);
  crits.forEach((c, rank) => out.set(c.id, Math.max(PEAK.floor, 1 - PEAK.step * rank)));
  return out;
}
