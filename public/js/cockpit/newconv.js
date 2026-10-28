// A new conversation in the pane (cockpit spec c1-talk.md §11, protocols.md §3.6;
// pending Q-O2, built as its recommendation d: `NEW` only, no handover note). DOM only, no
// innerHTML.
//
//   const bar = createNewBar({ doc, onStart, onHide, setTimer, clearTimer });
//   bar.node                 [data-cockpit-newbar], in the status line's slot (§11 "Ask first")
//   bar.show() / .hide()     shown: `KEEP`, a second `NEW` or NEWBAR_MS without a tap hide it
//   bar.toggle()             the `NEW` tap: shows the bar, or hides it on the second tap
//   bar.start() / .keep()    what `START` and `KEEP` do (the buttons call them)
//   bar.isShown()            true while it shows
//   onStart()                `START` was tapped: the pane sends `new` (protocols.md §3.6)
//   onHide()                 the bar came or went: the pane lays its conversation out again
//
//   dividerText(reason, ms, timeZone)   `NEW CONVERSATION · 07:10`, the forced one's tail
//   createDivider(doc, msg, offset)     the divider row for a `conversation.new`
import { NEWBAR_MS } from '../core/cockpit-constants.js';
import { hhmm } from '../core/cockpit-time.js';

/** c1-talk.md §11 "Ask first": the bar's question. */
export const NEWBAR_TEXT = 'Start a new conversation? Cards, jobs and notes stay.';

/** c1-talk.md §11 "Forced fresh start": the second divider's tail. */
export const FORCED_TAIL = ' · THE OLD ONE COULD NOT GO ON';

/** `NEW CONVERSATION · 07:10` (`reason` `owner`), with FORCED_TAIL for `forced` (protocols.md §3.6). */
export function dividerText(reason, ms, timeZone) {
  return `NEW CONVERSATION · ${hhmm(ms, timeZone)}${reason === 'forced' ? FORCED_TAIL : ''}`;
}

const el = (doc, tag, cls, attrs = {}) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * c1-talk.md §11 "The divider": a 48 px row, `--line` rules either side of 16 px caps
 * `--text-3`; the time is the room's `at` on the page's clock (`offset`, as a turn's label, §9).
 */
export function createDivider(doc, msg, offset = 0) {
  const at = Date.parse(msg?.at ?? '');
  const ms = (Number.isFinite(at) ? at : Date.now() - offset) + offset;
  const row = el(doc, 'div', 'ck-divider', { 'data-cockpit-divider': msg?.reason === 'forced' ? 'forced' : 'owner' });
  const words = el(doc, 'span', 'ck-divider-text');
  words.textContent = dividerText(msg?.reason, ms);
  row.append(words);
  return row;
}

export function createNewBar(opts = {}) {
  const doc = opts.doc ?? document;
  const onStart = opts.onStart ?? (() => {});
  const onHide = opts.onHide ?? (() => {});
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  const node = el(doc, 'div', 'ck-newbar', { 'data-cockpit-newbar': '' });
  const text = el(doc, 'p', 'ck-newbar-text');
  text.textContent = NEWBAR_TEXT;
  // `START`, the one-way action, is the farther from the corner where the hand rests (§11).
  const startBtn = el(doc, 'button', 'ck-btn ck-newbar-btn', { type: 'button', 'data-newbar': 'start' });
  startBtn.textContent = 'START';
  const keepBtn = el(doc, 'button', 'ck-btn ck-newbar-btn', { type: 'button', 'data-newbar': 'keep' });
  keepBtn.textContent = 'KEEP';
  node.append(text, startBtn, keepBtn);
  node.hidden = true;

  let timer = null;
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

  function show() {
    stopTimer();
    // §11 "Ask first": 10 s without a tap hide the bar and nothing changes.
    timer = setTimer(() => { timer = null; hide(); }, NEWBAR_MS);
    if (!node.hidden) return;
    node.hidden = false;
    onHide(false);
  }

  function hide() {
    stopTimer();
    if (node.hidden) return;
    node.hidden = true;
    onHide(true);
  }

  function start() {
    if (node.hidden) return;
    hide();
    onStart();
  }

  startBtn.addEventListener('click', start);
  keepBtn.addEventListener('click', hide);

  return {
    node, show, hide, start,
    keep: hide,
    toggle: () => (node.hidden ? show() : hide()),
    isShown: () => !node.hidden,
  };
}
