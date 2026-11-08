// Half a screen (Wall plan night 4 D, T41): galaxy.html at 50 % width, a split
// with the cockpit's canvas, keeps the 3 m check and its touch targets. Seen at
// 684 x 912 (half the tablet): the names, the trouble and the caption read; the
// one break was the far line's why, which had no band of its own and ran left
// into the clock. Every target is sized in px, not in vmin, so a narrower stage
// (a smaller vmin) never takes one under night 2's 48 px floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FLEET_FAR, fleetSize } from '../public/js/wall/frame.js';
import { HERO_PLATE, STEPS, heroEms, heroPlateVw, heroSize } from '../public/js/wall/caption.js';
import { BACK, TAP, hitRadius } from '../public/js/wall/galaxy/touch.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const css = fs.readFileSync(path.join(PUBLIC, 'css', 'wall.css'), 'utf8');
const rule = (sel) => {
  const at = css.indexOf(`\n${sel} {`);
  assert.ok(at >= 0, sel);
  return css.slice(at, css.indexOf('}', at));
};

// Half the tablet, half a 1080p screen, and the whole tablet for comparison; and the cockpit's split
// (screens.md §1, D284): the wall half at 1368x912 is 759 px wide, 1271 px with the canvas folded.
const STAGES = [[684, 912], [759, 912], [960, 1080], [1271, 912], [1368, 912]];
const FLOOR = 48;

test('half a screen: the far line and the why under it keep one band, clear of the clock', () => {
  const band = new RegExp(`max-width: ${FLEET_FAR.maxVw}vw;`);
  assert.match(rule('.wall-fleet[data-step="far"] .wall-fleet-line'), band);
  const sub = rule('.wall-fleet[data-step="far"] .wall-fleet-sub');
  assert.match(sub, band, 'the why is cut at the line\'s band, not at its own length');
  assert.match(sub, /margin-left: auto;/, 'and stays flush right');
  assert.match(rule('.wall-fleet-sub-why'), /text-overflow: ellipsis;/);

  // The clock: 6.9vmin, "10:07" measured 2.1 em wide in Barlow Condensed (r47 still); 2.3 em to be safe.
  const clockVmin = Number(rule('.wall-clock-time').match(/font-size: ([\d.]+)vmin;/)[1]);
  for (const [w, h] of STAGES) {
    const vmin = Math.min(w, h) / 100, vw = w / 100;
    const clockRight = 6 * vw + 2.3 * clockVmin * vmin;
    const bandLeft = w - 6 * vw - FLEET_FAR.maxVw * vw;
    assert.ok(bandLeft - clockRight >= 2.4 * vmin, `${w}x${h}: ${Math.round(bandLeft - clockRight)} px between clock and band`);
  }
});

test('half a screen: the far word stays at a 3 m step at 684 px and in the cockpit\'s split (759, 1271 px)', () => {
  for (const w of [684, 759, 1271]) {
    // Half the tablet: the demo's word is smaller than on the whole tablet, still far above the name step.
    const half = fleetSize('hv2 · storage', w, 912);
    assert.ok(half >= STEPS.heroMin && half > STEPS.name, `${w}: hv2 · storage at ${half}vmin`);
    // 3 m check from the still: at half the width the word is 62 css px, the 3 m floor is about 40 (night 1's Q3).
    assert.ok((half * Math.min(w, 912)) / 100 >= 40, `${w}: ${Math.round((half * Math.min(w, 912)) / 100)} px`);
  }
});

test('half a screen: every touch target is sized in px, at night 2\'s 48 px floor or above', () => {
  assert.ok(TAP.radiusPx * 2 >= FLOOR, 'the finger\'s disc');
  assert.ok(hitRadius('touch') >= FLOOR && hitRadius('pen') >= FLOOR, 'a finger\'s reach (night 5 T11), in px whatever the stage');
  assert.ok(BACK.hitPx >= FLOOR);
  const back = rule('.galaxy-back');
  assert.match(back, new RegExp(`min-width: ${BACK.hitPx}px;`));
  assert.match(back, new RegExp(`min-height: ${BACK.hitPx}px;`));
  // A pin's ✕ (cockpit c4 §3.4): 48x48 px, its header row 48 px.
  const x = rule('.galaxy-pin-remove');
  assert.match(x, /width: 48px;/);
  assert.match(x, /height: 48px;/);
  assert.match(rule('.galaxy-pin-head'), /height: 48px;/);
  // Their words have a px floor too, so a small vmin does not shrink them under what a finger reads.
  assert.match(back, /font-size: max\(2\.7vmin, 20px\);/);
  assert.match(x, /font-size: 24px;/);
});

test('half a screen: a narrow stage widens the trouble plate to the far band, so an 11-letter name is not cut', () => {
  assert.equal(heroPlateVw(1368, 912), HERO_PLATE.maxVw, 'landscape: unchanged');
  assert.equal(heroPlateVw(684, 912), HERO_PLATE.narrowVw);
  assert.equal(HERO_PLATE.narrowVw, FLEET_FAR.maxVw, 'one band for both big words');
  assert.match(css, new RegExp(`@media \\(max-aspect-ratio: 1/1\\) \\{\\s*\\.wall-caption\\[data-hero\\] \\{ max-width: ${HERO_PLATE.narrowVw}vw; \\}`));
  // `FEAT-SEARCH` (r47 film: `FEAT-SEAR…` at 56vw) now fits above the floor, its glyph and letters inside the band.
  const [w, h] = STAGES[0];
  const size = heroSize('FEAT-SEARCH', w, h);
  const avail = (HERO_PLATE.narrowVw * w) / Math.min(w, h) - HERO_PLATE.padVmin;
  assert.ok(size > STEPS.heroMin, `${size}vmin`);
  assert.ok(size * heroEms('FEAT-SEARCH') <= avail + 0.5, `${size} vmin fits ${avail} vmin`);
  // The plate's right edge stays left of the back control (right 6vw, at least BACK.hitPx + its padding wide).
  const plateRight = (6 + HERO_PLATE.narrowVw) * (w / 100);
  assert.ok(plateRight <= w - (6 * w) / 100 - BACK.hitPx - 2.4 * 2 * (Math.min(w, h) / 100), `${Math.round(plateRight)} px`);
});

test('half a screen: the tag and the manual line rise above the plate, in order, on the stage', () => {
  const narrow = css.slice(css.indexOf('@media (max-aspect-ratio: 1/1) {'));
  const top = (sel) => Number(narrow.match(new RegExp(`${sel.replace(/[.]/g, '\\.')} \\{ top: calc\\(8vh - ([\\d.]+)vmin\\); \\}`))[1]);
  const tag = top('.wall-tag'), manual = top('.galaxy-manual');
  for (const [w, h] of STAGES.filter(([a, b]) => a < b)) {
    const vh = h / 100, vmin = Math.min(w, h) / 100, line = 1.7 * vmin;
    const tagTop = 8 * vh - tag * vmin, manualTop = 8 * vh - manual * vmin;
    assert.ok(tagTop >= 0, 'the tag on the stage');
    assert.ok(manualTop - (tagTop + line) >= 0.9 * vmin, 'the manual line under the tag, a gap between');
    assert.ok(manualTop + line <= 8 * vh, 'both end above the plate\'s top');
    assert.ok(Math.abs((tag - manual) - 2.7) < 0.01, 'the same 2.7vmin apart as at the plate\'s line');
  }
});
