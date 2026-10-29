// The node card's manners (Wall plan night 5 T20, README §7 Night 5 D5-D6): the site's tint only as
// its 2 px top edge, a 150 ms fade in and out on the frame clock, the galaxy dimmed slightly behind it
// (under the frame's words); it closes on ×, Esc, an empty tap, a second tap on its node, a sideways
// swipe on it, the idle minute (the tour takes the page back, B237/B239 unchanged) and a Back to the
// overview; a labelled region with a heading and named buttons; focus goes to the heading when it
// shows and back to the opener (or the Back control after a canvas tap) when it closes
// (r45-accessibility #1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CARD_SWIPE, cardTint, createCard } from '../public/js/wall/galaxy/card.js';
import { LOOK, oklchCss, tintOf } from '../public/js/wall/galaxy/palette.js';
import { IDLE } from '../public/js/wall/galaxy/director.js';
import { TAP } from '../public/js/wall/galaxy/touch.js';
import { BA, SKY, listening, page } from './helpers/galaxy-page.mjs';

const all = (e) => [e, ...e.children.flatMap(all)];
const byClass = (root, cls) => all(root).find((e) => e.className === cls);
const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

/** A card on a fake document whose elements take focus, with the keys Esc comes on and a clock. */
function shell(opts = {}) {
  let now = 1000;
  const doc = { activeElement: null, body: null };
  const focusable = (e) => { e.focus = () => { doc.activeElement = e; }; return e; };
  doc.createElement = (t) => focusable(listening(t));
  const root = listening('main');
  const under = listening('canvas');
  root.append(listening('canvas'), under);
  const keys = listening('body');
  const back = focusable(listening('button'));
  let closed = 0;
  const card = createCard(root, {
    screenOf: () => ({ x: 400, y: 400, r: 10 }), size: () => ({ W: 1368, H: 912 }),
    doc, keys, under, focusBack: () => back, clock: () => now,
    onClose: () => { closed += 1; card.close(); },
    ...opts,
  });
  return { card, doc, root, under, keys, back, closed: () => closed, step: (ms) => { now += ms; card.draw(); } };
}
const info = { id: 'builder:builder-a', name: 'builder-a', kind: 'builder', tone: 'calm', tint: 'oklch(70% 0.045 180)' };

test('cardTint: a site\'s tint from palette.js\'s table, as CSS (its top edge), null for a site the world lacks', () => {
  const world = { byId: new Map([['lab', { index: 0 }], ['cloud', { index: 2 }]]) };
  const [h, c] = tintOf(2);
  assert.equal(cardTint(world, 'cloud'), oklchCss([LOOK.tintL, c, h]));
  assert.notEqual(cardTint(world, 'lab'), cardTint(world, 'cloud'), 'neighbours differ');
  assert.equal(cardTint(world, 'nowhere'), null);
  assert.equal(cardTint(null, 'lab'), null);
});

test('the shell: a labelled region with a heading and named buttons; focus in on show, back to the opener on close', () => {
  const s = shell();
  const opener = s.doc.createElement('button');
  opener.focus();
  s.card.open(info);
  assert.equal(s.doc.activeElement, opener, 'nothing moves while it is not shown yet');
  s.step(16);
  const { el, heading } = s.card;
  assert.deepEqual([el.tagName, el.getAttribute('role'), el.getAttribute('aria-label')], ['SECTION', 'region', 'builder-a, builder']);
  assert.deepEqual([heading.getAttribute('role'), heading.getAttribute('aria-level'), heading.getAttribute('tabindex'), heading.textContent],
    ['heading', '2', '-1', 'builder-a']);
  assert.equal(s.doc.activeElement, heading, 'focus on the heading once it shows');
  for (const b of all(el).filter((e) => e.tagName === 'BUTTON')) {
    assert.ok((b.getAttribute('aria-label') ?? b.textContent).trim().length > 0, 'every button has a name');
  }
  assert.equal(byClass(el, 'galaxy-card-x').getAttribute('aria-label'), 'Close');
  assert.deepEqual([el.dataset.tinted, el.style.setProperty != null], ['1', true], 'its site\'s tint on the top edge');
  s.card.close();
  assert.equal(s.doc.activeElement, opener, 'focus back on the opener');
  // Opened after a canvas tap (nothing focused): focus goes to the Back control on close.
  s.doc.activeElement = null;
  s.card.open(info);
  s.step(16);
  s.card.close();
  assert.equal(s.doc.activeElement, s.back, 'no opener: the Back control');
});

test('the shell: Esc and a sideways swipe close it, a downward one or a tap does not; the click after a swipe presses nothing', () => {
  const s = shell();
  s.card.open(info);
  s.step(16);
  s.keys.dispatch('keydown', { key: 'Enter' });
  assert.equal(s.closed(), 0);
  s.keys.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual([s.closed(), s.card.shown(), s.doc.activeElement], [1, false, s.back], 'Esc closes, focus back');
  s.keys.dispatch('keydown', { key: 'Escape' });
  assert.equal(s.closed(), 1, 'Esc with no card does nothing');

  s.card.open(info);
  s.step(16);
  const el = s.card.el;
  const swipe = (id, dx, dy) => {
    el.dispatch('pointerdown', { pointerId: id, clientX: 500, clientY: 300 });
    for (let i = 1; i <= 8; i++) el.dispatch('pointermove', { pointerId: id, clientX: 500 + (dx * i) / 8, clientY: 300 + (dy * i) / 8 });
    el.dispatch('pointerup', { pointerId: id, clientX: 500 + dx, clientY: 300 + dy });
    return el.dispatch('click');
  };
  assert.equal(swipe(1, 20, 4).stopped, true, 'a tap on the card stops at it (never the stage) and is no swipe');
  assert.equal(s.closed(), 1);
  swipe(2, 30, 120);
  assert.equal(s.closed(), 1, 'down, not sideways: still open');
  swipe(3, -CARD_SWIPE.swipePx - 10, 20);
  assert.equal(s.closed(), 2, 'a sideways swipe closes it');
  assert.equal(s.card.shown(), false);
});

test('the shell: a 150 ms fade in and out on the frame clock, the dim under the frame\'s words with it; none with reduced motion', () => {
  const s = shell();
  const { el, dimEl } = s.card;
  assert.equal(s.root.children.indexOf(dimEl), 1, 'the dim before `under` (the veil): the frame\'s words stay over it');
  s.card.open(info);
  s.step(0);
  assert.deepEqual([el.hidden, dimEl.hidden, Number(el.style.opacity)], [false, false, 0], 'shown, from clear');
  s.step(CARD_SWIPE.fadeMs / 2);
  const mid = Number(el.style.opacity);
  assert.ok(mid > 0.5 && mid < 1, `eased out, more than half way at half time (${mid})`);
  assert.equal(dimEl.style.opacity, el.style.opacity, 'the dim fades with it');
  s.step(CARD_SWIPE.fadeMs);
  assert.equal(el.style.opacity, '', 'fully in: no opacity left on it');
  s.card.close();
  assert.deepEqual([s.card.shown(), el.hidden, el.dataset.leaving, el.hasAttribute('inert')], [false, false, '1', true],
    'closed for the page at once (inert), still fading');
  s.step(CARD_SWIPE.fadeMs / 2);
  assert.ok(Number(el.style.opacity) < 0.5, 'fading out');
  s.step(CARD_SWIPE.fadeMs / 2);
  assert.deepEqual([el.hidden, dimEl.hidden, s.card.leaderEl.hidden, el.hasAttribute('inert'), el.dataset.leaving], [true, true, true, false, undefined]);
  // A new card while one fades out: the old one gives way at once.
  s.card.open(info);
  s.step(16);
  s.card.close();
  s.card.open({ ...info, id: 'builder:builder-b', name: 'builder-b' });
  assert.deepEqual([el.hidden, el.dataset.leaving], [true, undefined]);

  const r = shell({ reduced: true });
  r.card.open(info);
  r.step(0);
  assert.equal(r.card.el.style.opacity, '', 'reduced motion: there at once');
  r.card.close();
  assert.deepEqual([r.card.el.hidden, r.card.dimEl.hidden], [true, true], 'and gone at once');
});

test('the page, on a fake clock: the card closes each of the seven ways, focus in on show and back on close', () => {
  const p = page();
  p.toBuilder();
  const x = () => byClass(p.card.el, 'galaxy-card-x');
  const reopen = () => {
    p.tapAt(70, p.cam.screenOf(BA));
    p.run(TAP.doubleMs + 100);
    assert.deepEqual([p.card.selected(), p.card.el.hidden], [BA, false], 'builder-a\'s card again, the camera already there');
  };
  const closedBy = (how, act) => {
    assert.equal(p.doc.activeElement, p.card.heading, `${how}: focus on the heading while it shows`);
    const n = p.moves.length;
    act();
    p.run(CARD_SWIPE.fadeMs + 32);
    assert.deepEqual([p.card.shown(), p.card.el.hidden, p.card.dimEl.hidden], [false, true, true], `${how} closes it`);
    return n;
  };
  assert.equal(p.card.el.dataset.tinted, '1', 'its site\'s tint on its top edge');

  // 1. ×.
  closedBy('×', () => x().dispatch('click'));
  assert.equal(p.doc.activeElement, p.button, 'a canvas tap opened it: focus to the Back control');
  assert.deepEqual([p.place().level, p.place().planet, p.galaxy.moonsOpen()], ['planet', BA, BA], 'the pick stays; only the card goes');
  reopen();
  // 2. Esc.
  closedBy('Esc', () => p.keys.dispatch('keydown', { key: 'Escape' }));
  reopen();
  // 3. An empty tap: the card goes, and nothing else (no step, no move: night 5 T12).
  assert.ok(p.isSky(SKY));
  const moved = closedBy('an empty tap', () => { p.tapAt(71, SKY); p.run(TAP.doubleMs + 50); });
  assert.deepEqual([p.place().level, p.place().planet, p.moves.length], ['planet', BA, moved], 'no step, no camera move');
  reopen();
  // 4. A second tap on its node (a third opens it again: reopen).
  closedBy('a second tap on its node', () => { p.tapAt(72, p.cam.screenOf(BA)); p.run(TAP.doubleMs + 50); });
  assert.deepEqual([p.place().level, p.place().planet], ['planet', BA]);
  reopen();
  // 5. A sideways swipe on the card: the stage never sees it (no turn).
  const turned = p.cam.want().turned ?? null;
  const swiped = closedBy('a sideways swipe', () => {
    const el = p.card.el;
    el.dispatch('pointerdown', { pointerId: 73, clientX: 300, clientY: 300 });
    for (let i = 1; i <= 6; i++) { el.dispatch('pointermove', { pointerId: 73, clientX: 300 + 20 * i, clientY: 304 }); p.tick(16); }
    el.dispatch('pointerup', { pointerId: 73, clientX: 420, clientY: 304 });
  });
  assert.deepEqual([p.cam.want().turned ?? null, p.moves.length], [turned, swiped], 'the camera did not turn (the stage never saw it)');
  reopen();
  // 6. Back to the overview (planet → system → overview): the system's card, then none.
  p.press();
  p.run(16);
  assert.equal(p.card.selected(), 'lab', 'one step: the system\'s card');
  p.run(4000);
  closedBy('Back to the overview', () => p.press());
  assert.equal(p.place().level, 'overview');
  // 7. The idle minute, on the Wall's own page (the tour's role: the cockpit's explore page never
  // hands back): the tour takes the page back (B237: counted from the last touch) and the card goes.
  const w = page({ role: 'tour' });
  w.run(200);
  w.tapAt(80, SKY); // the waking touch: swallowed
  w.run(3000);
  assert.equal(w.touch.mode(), 'explore');
  w.tapAt(81, w.cam.screenOf('lab'));
  w.run(4000);
  assert.deepEqual([w.card.selected(), w.card.el.hidden], ['lab', false]);
  w.run(IDLE.ms - 4000 - 500);
  assert.deepEqual([w.card.shown(), w.resumed()], [true, 0], 'still up just before the minute');
  w.run(1000 + CARD_SWIPE.fadeMs + 32);
  assert.deepEqual([w.resumed(), w.card.shown(), w.card.el.hidden, w.card.dimEl.hidden], [1, false, true, true], 'the idle minute closes it as the tour resumes');
});

test('galaxy/main.js gives the card its manners: the dim under the veil, focus back to Back, reduced motion, the tint; wall.css adds rules only', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /under: document\.getElementById\('galaxy-show-veil'\),/);
  assert.match(js, /focusBack: \(\) => backEl,/);
  assert.match(js, /\n\s*reduced,\n\s*\}\) : null;/);
  assert.match(js, /tint: cardTint\(galaxy\.world, site\)/);
  assert.match(read('galaxy.html'), /id="galaxy-show-veil"/, 'the veil the dim goes before');
  const css = read('css/wall.css');
  const tail = css.slice(css.indexOf('/* The card\'s manners (night 5 T20'));
  assert.ok(tail.length > 0 && css.indexOf('/* The card\'s manners') > css.lastIndexOf('.galaxy-card-note[hidden]'), 'added after the card\'s rules');
  assert.match(tail, /\.galaxy-card\[data-tinted\] \{ border-top-color: var\(--galaxy-card-tint\); \}/);
  assert.doesNotMatch(tail, /transition|animation|backdrop/, 'the fade is card.js\'s (the sheets keep 120 ms, no animations, no glass filter)');
  const card = fs.readFileSync(new URL('../public/js/wall/galaxy/card.js', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /innerHTML|\.style\s*=|cssText/, 'no innerHTML, no wholesale style');
});
