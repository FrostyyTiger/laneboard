// Wall type from distance (Wall plan T15, research Q3): label steps in mm on
// the glass, turned into CSS px for the screen and set on one 4:3 scale.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SCALE, DENSITY, CAP_EM, capMm, pxPerMm, stepFor, stepsFor, screenOf, READ } from '../public/js/wall/type.js';
import { optionsFor, STEPS, labelSize, mapOptions } from '../public/js/wall/variants/radial.js';
import { VARIANTS, mapOptionsFor } from '../public/js/wall/variants.js';

test('capMm: the arc-minute rule (Q3: 16\' at 1 m is 4.7 mm, 20\' at 3 m 17.5 mm)', () => {
  assert.ok(Math.abs(capMm(1, 16) - 4.65) < 0.05);
  assert.ok(Math.abs(capMm(3, 20) - 17.45) < 0.05);
  assert.ok(capMm(2) > capMm(1), 'further needs bigger');
});

test('pxPerMm: the told screen height wins, else the density from devicePixelRatio', () => {
  assert.equal(pxPerMm({ dpr: 2, cssHeight: 912, screenMm: 173 }), 912 / 173);
  assert.equal(pxPerMm({ dpr: 2 }), DENSITY.tablet / 2, 'a 2x screen is the tablet');
  assert.equal(pxPerMm({ dpr: 1 }), DENSITY.desk, 'a 1x screen is a desk monitor');
  assert.equal(pxPerMm({ dpr: 3 }), DENSITY.tablet / 3, 'more device px per CSS px: fewer CSS px per mm');
  assert.equal(pxPerMm({}), DENSITY.desk);
  assert.equal(pxPerMm({ dpr: NaN }), DENSITY.desk);
  assert.equal(pxPerMm({ dpr: 2, cssHeight: 912, screenMm: 0 }), DENSITY.tablet / 2, 'a nonsense size is ignored');
});

test('stepFor: mm to px through the cap height, snapped to the scale', () => {
  const ppm = 5;
  for (const s of SCALE) assert.equal(stepFor((s * CAP_EM) / ppm, ppm), s, `exactly ${s}`);
  assert.equal(stepFor(0, ppm), SCALE[0]);
  assert.equal(stepFor(1000, ppm), SCALE.at(-1), 'never above the scale');
  for (let i = 1; i < SCALE.length; i++) assert.ok(SCALE[i] / SCALE[i - 1] > 1.25 && SCALE[i] / SCALE[i - 1] < 1.42, 'about 4:3 a step');
});

test('stepsFor: a site over a room on every screen, bigger in px where px are smaller', () => {
  assert.ok(READ.site.metres > READ.room.metres, 'sites are read from further');
  const tablet = stepsFor(pxPerMm({ dpr: 2 }));
  const desk = stepsFor(pxPerMm({ dpr: 1 }));
  assert.deepEqual(tablet, { site: 35, room: 15 });
  assert.deepEqual(desk, { site: 26, room: 11 });
  for (let ppm = 1; ppm <= 12; ppm += 0.25) {
    const s = stepsFor(ppm);
    assert.ok(s.site > s.room, `site > room at ${ppm} px/mm`);
    assert.ok(SCALE.includes(s.site) && SCALE.includes(s.room));
  }
  // The tablet's site cap height, in mm on the glass, holds the 1 m read.
  assert.ok((tablet.site * CAP_EM) / pxPerMm({ dpr: 2 }) >= capMm(READ.site.metres) * 0.9);
});

test('screenOf: ?mm= is the screen height, anything else is no size', () => {
  assert.deepEqual(screenOf('?variant=radial&mm=173', { dpr: 2, cssHeight: 912 }), { dpr: 2, cssHeight: 912, screenMm: 173 });
  assert.equal(screenOf('?mm=abc', { dpr: 2 }).screenMm, undefined);
  assert.equal(screenOf('', {}).screenMm, undefined);
});

test('radial: the tablet steps by default, the screen\'s through optionsFor and mapOptionsFor', () => {
  assert.deepEqual(STEPS, stepsFor(pxPerMm({ dpr: 2 })));
  assert.equal(mapOptions.pinLabels, true, 'radial pins its names');
  assert.equal(optionsFor(1.5).labelSize, mapOptions.labelSize, 'no screen: the tablet\'s');
  const desk = optionsFor(16 / 9, { dpr: 1 });
  assert.notEqual(desk.layout, mapOptions.layout, 'the overview fitted to the screen (T17)');
  assert.equal(desk.pinLabels, true);
  assert.deepEqual(desk.labelSize({ id: 'hv1', kind: 'site' }), { px: 26, inward: true });
  assert.equal(desk.labelSize({ kind: 'room' }), 11);
  assert.equal(labelSize({ kind: 'room' }), 15);
  const v = VARIANTS.find((x) => x.id === 'radial');
  const o = mapOptionsFor(v, 1.5, { dpr: 1 });
  assert.equal(o.ambient, v.ambient);
  assert.equal(o.labelSize({ kind: 'builder' }), 11);
  assert.equal(mapOptionsFor(v, 1.5).labelSize, labelSize);
});
