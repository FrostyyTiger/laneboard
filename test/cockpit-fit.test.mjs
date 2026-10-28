// The cockpit's fit to the screen (cockpit spec c1-talk.md §1.2, D249, D250):
// public/js/cockpit/fit.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paneFit, tooOld, TOO_OLD_TEXT } from '../public/js/cockpit/fit.js';

test('the pane is 608 px from 900 px wide, the whole width from 700, not offered below', () => {
  assert.equal(paneFit(1368, 912), 'side');
  assert.equal(paneFit(1024, 768), 'side');
  assert.equal(paneFit(900, 600), 'side');
  assert.equal(paneFit(899, 600), 'full');
  assert.equal(paneFit(800, 1280), 'full');
  assert.equal(paneFit(700, 560), 'full');
  assert.equal(paneFit(699, 900), 'none');
  assert.equal(paneFit(640, 900), 'none');
});

test('a window under 560 px tall is below the floor at any width', () => {
  assert.equal(paneFit(1368, 559), 'none');
  assert.equal(paneFit(800, 559), 'none');
  assert.equal(paneFit(1368, 560), 'side');
});

test('no size at all is below the floor', () => {
  assert.equal(paneFit(undefined, undefined), 'none');
  assert.equal(paneFit(NaN, 900), 'none');
});

function browser({ ws = true, min = true, inert = true } = {}) {
  function HTMLElement() {}
  if (inert) HTMLElement.prototype.inert = false;
  return {
    WebSocket: ws ? function WebSocket() {} : undefined,
    CSS: { supports: (p, v) => p === 'width' && v === 'min(1px, 100vw)' && min },
    HTMLElement,
  };
}

test('a browser with WebSocket, CSS min() and inert runs the cockpit', () => {
  assert.equal(tooOld(browser()), false);
});

test('each missing feature of D250 makes the browser too old', () => {
  assert.equal(tooOld(browser({ ws: false })), true);
  assert.equal(tooOld(browser({ min: false })), true);
  assert.equal(tooOld(browser({ inert: false })), true);
  assert.equal(tooOld({ WebSocket() {}, HTMLElement: browser().HTMLElement }), true, 'no CSS.supports');
});

test('the too-old line is the spec\'s, word for word', () => {
  assert.equal(TOO_OLD_TEXT, 'This browser is too old for the cockpit. It needs Chrome 108 or Safari 16 or newer.');
});
