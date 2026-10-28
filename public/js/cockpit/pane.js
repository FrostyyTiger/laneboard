// The cockpit button and the pane (cockpit spec c1-talk.md §1-§2, §1.2, §5.1, §10.1;
// screens.md §4, §7; D17, D26, D116, D118, D158, D235, D249, D250, D267). DOM only, no innerHTML:
// every text goes in as textContent.
//
//   const pane = createPane({ doc, page: 'app' | 'wall', onRetryNow, unsupported });
//   unsupported: true in a browser below the floor (fit.js tooOld, D250): the header and
//   one line, no input row
//   pane.setLink(state)        the room link's state (link.js): data-cockpit, the status line
//   pane.apply(msg)            one room message (welcome, snapshot, turn.prompt, turn.state,
//                              text.delta, text.block, tool.start, tool.end, turn.retrying,
//                              turn.end, status: only its `agent-back` for E2, c1-talk.md §10)
//   onPrompt(msg)              SEND: the `prompt` to the room (protocols.md §3.1); the block is
//                              drawn at the tap with `· SENDING` until the room's echo (B8)
//   onStop(msg)                STOP: the `stop` to the room (protocols.md §3.3)
//   onGap()                    a message the pane cannot place: the link closes 4000 `gap` and
//                              the snapshot redraws (D119; protocols.md §3.4's unknown `clientId`)
//   pane.open() / .close() / .isOpen()
//
// The root (<html>) carries data-cockpit, data-pane, data-turn and data-keyboard (README.md
// "Selectors tests use"); the pane is [data-cockpit-conversation].
import { sinceText } from '../core/cockpit-time.js';
import { AGE_FROM_MS, CONFIRM_WAIT_MS, MAX_PROMPT_CHARS, PANE_SLIDE_MS, STOP_GUARD_MS, TICK_MS } from '../core/cockpit-constants.js';
import { createTurn } from './turns.js';
import { endButtons, endText, GO_ON_TEXT } from './errors.js';
import { canSend, inputHeight, isSendKey, lengthNote, linesFromScroll, INPUT_ONE_LINE_PX, restoreDraft } from './draft.js';
import { focusNow } from './focus.js';
import { paneFit, TOO_OLD_TEXT } from './fit.js';
import { inputCap, KEYBOARD_ROW_PX, watchKeyboard } from './keyboard.js';
import { TAP_SLOP_TOUCH } from '../views/map/interact.js';

/** c1-talk.md §2: the header's three words for the five turn states (D56). */
export const TURN_WORDS = Object.freeze({
  idle: 'READY', thinking: '● WORKING', working: '● WORKING', answering: '● WORKING', stopping: '● STOPPING',
});

/** c1-talk.md §5.1 (D118): the conversation's own lines. */
export const LINES = Object.freeze({
  connecting: 'Connecting to the cockpit room…',
  emptyVoice: 'Nothing said yet. Type a question, or hold the talk button and speak.',
  emptyNone: 'Nothing said yet. Type a question below.',
  // screens.md §7: a reload while the room is down
  downFresh: 'The conversation shows again when the room is back.',
  // c1-talk.md §10 E1
  notSent: 'Not sent: the room did not confirm within 5 s.',
  // screens.md §7: the line slot's `room-down` message while SEND is disabled for it
  roomDown: 'Sending and voice come back with the room.',
});

/** c1-talk.md §8: the turn states during which the slot is `STOP` with an empty input ("One slot, two jobs"). */
const RUNNING = new Set(['thinking', 'working', 'answering']);

/**
 * c1-talk.md §8 ("One slot, two jobs", D268): what the `SEND` slot is. `send` while idle or with a draft;
 * during a turn with an empty input `stop`, but `wait` until STOP_GUARD_MS after the latest
 * send, so `STOP` never appears under a sending finger.
 */
export function slotState({ turn, draft, sinceSendMs }) {
  if (!RUNNING.has(turn) || draft.trim() !== '') return 'send';
  return sinceSendMs !== null && sinceSendMs < STOP_GUARD_MS ? 'wait' : 'stop';
}

/** protocols.md §3.1: `p-` and 8 hex characters from crypto.getRandomValues. */
export function newClientId(cryptoImpl = globalThis.crypto) {
  const b = cryptoImpl.getRandomValues(new Uint8Array(4));
  return `p-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** c1-talk.md §1 "the conversation is pinned while its last pixel is within 48 px" (§4). */
const PIN_PX = 48;

/** The room-down status line of c1-talk.md §10.1 row 2 (screens.md §7). */
export function roomDownText({ since, retryAt, trying }, nowMs) {
  const head = `Cockpit room unreachable ${sinceText(since, nowMs)}.`;
  if (trying) return `${head} Retrying now…`;
  if (retryAt == null) return head;
  return `${head} Retrying in ${Math.max(0, Math.ceil((retryAt - nowMs) / 1000))} s.`;
}

const el = (doc, tag, cls, attrs = {}) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const button = (doc, cls, attr, label) => {
  const b = el(doc, 'button', cls, attr ? { type: 'button', [attr]: '' } : { type: 'button' });
  b.textContent = label;
  return b;
};

export function createPane(opts = {}) {
  const doc = opts.doc ?? document;
  const page = opts.page ?? 'app';
  const onRetryNow = opts.onRetryNow ?? (() => {});
  const onOpenChange = opts.onOpenChange ?? (() => {});
  const onPrompt = opts.onPrompt ?? (() => false);
  const onStop = opts.onStop ?? (() => false);
  const onGap = opts.onGap ?? (() => {});
  const focus = opts.focus ?? (() => focusNow({ page, doc }));
  const now = opts.now ?? (() => Date.now());
  const unsupported = opts.unsupported === true;
  const root = doc.documentElement;
  const win = doc.defaultView;

  // --- the pane: header, status line, conversation, input row (c1-talk.md §1)
  const pane = el(doc, 'section', 'ck-pane', { 'data-cockpit-conversation': '', 'aria-label': 'Cockpit' });
  pane.hidden = true;
  pane.inert = true;

  const head = el(doc, 'header', 'ck-head');
  const title = el(doc, 'span', 'ck-title');
  title.textContent = 'COCKPIT';
  const turnWord = el(doc, 'span', 'ck-turnword', { 'data-cockpit-turn': '' });
  turnWord.textContent = TURN_WORDS.idle;
  const headBtns = el(doc, 'span', 'ck-headbtns');
  // NEW waits for T29 (c1-talk.md §11): drawn in its rect, disabled until then (build B111).
  const newBtn = button(doc, 'ck-btn ck-new', 'data-cockpit-new', 'NEW');
  newBtn.disabled = true;
  const closeBtn = button(doc, 'ck-btn ck-close', 'data-cockpit-close', 'CLOSE');
  headBtns.append(newBtn, closeBtn);
  head.append(title, turnWord, headBtns);

  const status = el(doc, 'div', 'ck-status', { 'data-cockpit-status': '' });
  status.hidden = true;
  const statusText = el(doc, 'p', 'ck-status-text');
  const retryBtn = button(doc, 'ck-btn ck-retry', null, 'RETRY NOW');
  retryBtn.hidden = true;
  status.append(statusText, retryBtn);

  const convo = el(doc, 'div', 'ck-convo');
  const note = el(doc, 'p', 'ck-note');
  note.textContent = LINES.connecting;
  const turnsBox = el(doc, 'div', 'ck-turns');
  convo.append(note, turnsBox);
  // `↓ NEW` floats over the conversation, 16 px above what is under it (c1-talk.md §1.1, §4):
  // the band holds the scroller and the button, so the button follows the band's bottom edge.
  const band = el(doc, 'div', 'ck-band');
  const follow = button(doc, 'ck-btn ck-follow', 'data-cockpit-follow', '↓ NEW');
  follow.setAttribute('aria-label', 'Jump to the newest');
  follow.hidden = true;
  band.append(convo, follow);

  // The line slot on the input row's top edge (c1-talk.md §1.1, D133): one message, the
  // highest that holds. C1 builds `room-down` (screens.md §7) and `length` (§7); `error` and
  // `hint` come with the talk button (C2).
  const lineSlot = el(doc, 'p', 'ck-line', { 'data-cockpit-line': '' });
  lineSlot.hidden = true;

  const row = el(doc, 'div', 'ck-row');
  const input = el(doc, 'textarea', 'ck-input', {
    'data-cockpit-input': '', rows: '1', placeholder: 'Type a message', enterkeyhint: 'send',
    autocapitalize: 'sentences', spellcheck: 'true', 'aria-label': 'Message to the agent',
  });
  const send = button(doc, 'ck-btn ck-send', 'data-cockpit-send', 'SEND');
  // §8 (D268): `STOP`'s face, a `■` glyph and the word; `SEND` is the button's own text.
  const stopGlyph = el(doc, 'span', 'ck-stop-glyph', { 'aria-hidden': 'true' });
  stopGlyph.textContent = '■';
  const stopWord = el(doc, 'span', 'ck-stop-word');
  stopWord.textContent = 'STOP';
  send.dataset.send = 'send';
  send.disabled = true;
  row.append(input, send);
  if (unsupported) {
    // D250: the header and, in the conversation's place, the one line; no input row.
    const old = el(doc, 'p', 'ck-unsupported', { 'data-cockpit-unsupported': '' });
    old.textContent = TOO_OLD_TEXT;
    turnWord.hidden = true; // no room behind this pane: no turn state to show (build B133)
    pane.append(head, old);
  } else {
    pane.append(head, status, band, lineSlot, row);
  }

  // --- the opener above the talk button's place (screens.md §4, D116)
  const opener = button(doc, 'ck-btn ck-open', 'data-cockpit-open', 'CHAT');
  opener.setAttribute('aria-label', 'Open the cockpit');

  doc.body.append(pane);

  let open = false;
  let link = { status: 'connecting', since: null, retryAt: null, trying: false, welcome: null };
  let stt = 'none';
  let drawnTurns = null; // null until the first snapshot
  const views = new Map(); // turnId → createTurn() view
  const sending = new Map(); // clientId → the view drawn at the tap, until the room's echo
  const waits = new Map(); // clientId → its E1 timer (c1-talk.md §10)
  const notSent = new Map(); // clientId → the view showing E1, until EDIT or a late echo
  const steering = new WeakSet(); // views drawn at a SEND during a turn: no turn of their own (§8)
  const promptSeq = new Map(); // the link seq of a sent prompt → its clientId (an `error` names it in `re`)
  const dirty = new Set(); // views whose text changed since the last frame
  let frame = null;
  // `answering` waits for the frame that draws its text (c1-talk.md §3: "reply text is streaming"),
  // so `data-turn` never says answering over an empty reply (build B140).
  let heldTurn = null;
  let heldTurnId = null; // the turn whose drawn text releases `heldTurn`
  let pinned = true;
  let hideTimer = null;
  let tick = null;
  let ageTimer = null;
  let clockOffset = 0; // the page's clock minus the room's, from welcome.now (c1-talk.md §9)
  const exited = new Set(); // views whose E2 line still says the agent is being started again (§10)
  let fit = null;
  const madeInert = new Set(); // what this pane made inert, given back as it was

  root.dataset.pane = 'closed';

  /**
   * D249: under 900 px the open pane covers the view, which is `inert` until the pane
   * closes. Everything on the page but the pane and its opener is the view (on the app
   * `#shell`, the Map's container, on the Wall page the galaxy's stage). The attribute,
   * not the property, so a browser without `inert` never gets here (D250).
   */
  function coverView(on) {
    if (on) {
      for (const n of doc.body.children) {
        if (n === pane || n === opener || n.tagName === 'SCRIPT' || n.hasAttribute('inert')) continue;
        n.setAttribute('inert', '');
        madeInert.add(n);
      }
    } else {
      for (const n of madeInert) n.removeAttribute('inert');
      madeInert.clear();
    }
  }

  const setTurn = (state) => {
    heldTurn = null;
    const s = Object.hasOwn(TURN_WORDS, state) ? state : 'idle';
    root.dataset.turn = s;
    turnWord.textContent = TURN_WORDS[s];
    sendState(); // §8: the slot follows the turn
  };

  let maxChars = MAX_PROMPT_CHARS; // welcome.config.maxPromptChars (protocols.md §2.1)
  let lastSendAt = null; // the page's clock at the latest send (D268)
  let guardTimer = null;
  let stopPress = null; // the pointer pressed on the slot while it read STOP (D268)

  function sendState() {
    const was = send.dataset.send;
    const since = lastSendAt === null ? null : now() - lastSendAt;
    const face = slotState({ turn: root.dataset.turn, draft: input.value, sinceSendMs: since });
    send.dataset.send = face;
    if (face !== was) {
      if (face === 'stop') send.replaceChildren(stopGlyph, stopWord);
      else send.textContent = 'SEND';
    }
    if (face === 'stop') {
      // §8 "How STOP looks and acts": enabled while the link is live; its name `Stop`.
      send.disabled = link.status !== 'live';
      send.inert = false;
      send.removeAttribute('aria-disabled');
      send.setAttribute('aria-label', 'Stop');
    } else if (face === 'wait') {
      // D268: `SEND` in --text-3, inert: a tap in the second does nothing at all.
      send.disabled = false;
      send.inert = true;
      send.setAttribute('aria-disabled', 'true');
      send.removeAttribute('aria-label');
      if (guardTimer === null) {
        guardTimer = win.setTimeout(() => { guardTimer = null; sendState(); }, Math.max(1, STOP_GUARD_MS - since));
      }
    } else {
      // c1-talk.md §7: disabled while the input holds only white space, above the length
      // limit, and while the room is down; D118: until `live`.
      send.disabled = link.status !== 'live' || !canSend(input.value, maxChars);
      send.inert = false;
      send.removeAttribute('aria-disabled');
      send.removeAttribute('aria-label');
    }
    if (was === 'stop' && face !== 'stop') stopPress = null;
  }

  /**
   * The line slot (c1-talk.md §1.1): the highest message that holds, or none. Its height and
   * the input's growth lift the conversation's bottom; the scroll area's bottom padding
   * keeps the last item clear of the opener, `max(0, 64 − lift)` (D267).
   */
  function drawLine() {
    // D133: `room-down` outranks `length`; the length note waits under it and shows again
    // when the room is back, if the draft is still over the limit.
    const down = link.status === 'room-down' && link.since != null && !link.refused;
    const note = lengthNote(input.value.length, maxChars);
    const [kind, text] = down ? ['room-down', LINES.roomDown] : note !== null ? ['length', note] : [null, ''];
    if (kind === null) {
      lineSlot.hidden = true;
      delete lineSlot.dataset.line;
      lineSlot.textContent = '';
    } else {
      lineSlot.hidden = false;
      lineSlot.dataset.line = kind;
      if (lineSlot.textContent !== text) lineSlot.textContent = text;
    }
  }

  /**
   * c1-talk.md §7: the input grows with its text, 64 px for one line, +39.2 px a line up to
   * 4 (181.6 px), then scrolls inside; it grows upwards, the row with it, `SEND` at the row's
   * bottom (§7). Read at the one-line height, so the count is the text's own.
   */
  function grow() {
    const wasAtEnd = pinned;
    input.style.height = `${INPUT_ONE_LINE_PX}px`;
    const border = input.offsetHeight - input.clientHeight;
    let h = inputHeight(linesFromScroll(input.scrollHeight, border));
    if (keyboardUp()) h = Math.min(h, inputCap(oneLineLeft()));
    input.style.height = `${h}px`;
    // Past its cap the text scrolls inside, the caret line in sight (§7.1).
    if (doc.activeElement === input && input.selectionEnd === input.value.length) input.scrollTop = input.scrollHeight;
    pane.style.setProperty('--ck-grow', `${h - INPUT_ONE_LINE_PX}px`);
    pane.style.setProperty('--ck-lift', `${(lineSlot.hidden ? 0 : lineSlot.offsetHeight) + h - INPUT_ONE_LINE_PX}px`);
    if (wasAtEnd) toEnd(); // the pin rule (§1.1): at its end it stays at its end
  }

  /** §7.1: the keyboard layout holds while `data-keyboard` is `up` or `held` (D131). */
  const keyboardUp = () => root.dataset.keyboard === 'up' || root.dataset.keyboard === 'held';

  /**
   * §7.1's `left`: the conversation's height with a one-line input, the keyboard up: the
   * pane less its header, the status line, the line slot and the 88 px row.
   */
  function oneLineLeft() {
    const shown = (n) => (n.hidden ? 0 : n.offsetHeight);
    return pane.getBoundingClientRect().height - head.offsetHeight - shown(status) - shown(lineSlot) - KEYBOARD_ROW_PX;
  }

  /** Everything the draft decides: SEND, the line slot, the input's height. */
  function draftChanged() {
    sendState();
    drawLine();
    grow();
  }

  function drawStatus() {
    const t = now();
    if (link.status === 'room-down' && link.since != null && !link.refused) {
      status.hidden = false;
      status.dataset.status = 'room-down';
      statusText.textContent = roomDownText(link, t);
      retryBtn.hidden = false;
      retryBtn.disabled = Boolean(link.trying);
    } else {
      status.hidden = true;
      delete status.dataset.status;
      statusText.textContent = '';
      retryBtn.hidden = true;
    }
    pane.classList.toggle('ck-has-status', !status.hidden);
  }

  function drawNote() {
    if (drawnTurns === null) {
      // A fresh page: the line until the snapshot (D118); the room down before any snapshot:
      // the Connecting… line goes and screens.md §7's reload line takes its place.
      note.hidden = false;
      note.textContent = link.status === 'room-down' ? LINES.downFresh : LINES.connecting;
    } else if (drawnTurns === 0) {
      note.hidden = false;
      note.textContent = stt === 'on' ? LINES.emptyVoice : LINES.emptyNone;
    } else {
      note.hidden = true;
    }
  }

  const atEnd = () => convo.scrollHeight - convo.scrollTop - convo.clientHeight <= PIN_PX;
  const toEnd = () => { convo.scrollTop = convo.scrollHeight; };
  /**
   * c1-talk.md §4: pinned, new text scrolls the view along; scrolled up (a drag, D26), the
   * view stays and `↓ NEW` shows once something new came. Back at the end by hand, pinned
   * again and `↓ NEW` gone.
   */
  const grew = () => {
    if (pinned) toEnd();
    else follow.hidden = false;
  };
  convo.addEventListener('scroll', () => {
    pinned = atEnd();
    if (pinned) follow.hidden = true;
  }, { passive: true });
  // A tap jumps to the end at once (docs/design.md rule 5: no smooth scroll) and pins again.
  follow.addEventListener('click', () => {
    pinned = true;
    follow.hidden = true;
    toEnd();
  });

  /** The running turn, if any: the last view that has not ended. */
  const runningView = () => {
    let last = null;
    for (const v of views.values()) last = v;
    for (const v of sending.values()) if (!steering.has(v)) last = v;
    return last && !last.ended ? last : null;
  };

  /**
   * c1-talk.md §9 (D235): every turn's age redrawn each second of the running turn's own
   * count, so `0:03` shows at 3 s and not up to a second later (build B159).
   */
  function ageTick() {
    if (ageTimer !== null) { win.clearTimeout(ageTimer); ageTimer = null; }
    const v = runningView();
    if (!v) return;
    const t = now();
    if (v.tick(t)) grew(); // the `AGENT` row came at 3 s: the conversation grew
    if (v.startMs === null) { ageTimer = win.setTimeout(ageTick, TICK_MS); return; }
    const ms = t - v.startMs;
    const wait = ms < AGE_FROM_MS ? AGE_FROM_MS - ms : TICK_MS - (ms % TICK_MS);
    ageTimer = win.setTimeout(ageTick, Math.max(1, wait));
  }

  function drawSnapshot(snap) {
    const turns = Array.isArray(snap.turns) ? snap.turns : [];
    const frag = doc.createDocumentFragment();
    views.clear();
    exited.clear();
    for (const [i, t] of turns.entries()) {
      const v = createTurn(doc, t, { offset: clockOffset, promptButtons });
      if (v.turnId) views.set(v.turnId, v);
      // E2 after a load: back once a later turn ran, or the room said so (build B205).
      drawEnd(v, i < turns.length - 1 || agentBack);
      if (t.clientId) sending.delete(t.clientId); // the room had it: the snapshot's block is the one
      frag.append(v.node);
    }
    // A prompt drawn at the tap that the room has not echoed yet stays at the end (build B136),
    // after the blocks showing E1 (build B171).
    for (const [id, v] of notSent) {
      if (turns.some((t) => t?.clientId === id)) { notSent.delete(id); continue; }
      frag.append(v.node);
    }
    for (const v of sending.values()) frag.append(v.node);
    turnsBox.replaceChildren(frag);
    drawnTurns = turns.length + sending.size + notSent.size;
    const running = turns.findLast?.((t) => t && !t.end && t.state && t.state !== 'done');
    setTurn(running ? running.state : 'idle');
    drawNote();
    grew();
    ageTick();
  }

  /** c1-talk.md §3 "Streaming": the reply drawn at most once per animation frame. */
  function drawFrame() {
    frame = null;
    for (const v of dirty) v.draw();
    dirty.clear();
    // The room sends `turn.state` and the first delta as two frames; an animation frame
    // between them must not release `answering` over a reply still empty (S-C1-04).
    if (heldTurn !== null && views.get(heldTurnId)?.hasText()) setTurn(heldTurn);
    grew();
  }
  function changed(v) {
    dirty.add(v);
    if (frame === null) frame = win.requestAnimationFrame(drawFrame);
  }

  function appendTurn(v) {
    turnsBox.append(v.node);
    drawnTurns = (drawnTurns ?? 0) + 1;
    drawNote();
  }

  /**
   * SEND (c1-talk.md §7 "On send", B8 ≤ 0.1 s): the block at the end with
   * `YOU · 07:02 · SENDING`, the input emptied, pinned to the end, `data-turn="thinking"`;
   * then the `prompt` (protocols.md §3.1). Focus stays where it was.
   */
  function sendNow() {
    const text = input.value.trim();
    if (send.disabled || send.dataset.send !== 'send' || text === '') return;
    input.value = '';
    lastSendAt = now(); // D268: the slot is not `STOP` for a second after a send
    draftChanged();
    sendPrompt(text, newClientId());
  }

  /**
   * One `prompt` with its block drawn at once (B8): SEND's, and E1's `RETRY` with the
   * block's own `clientId` (D95, D259: the room may hold it; a resend starts nothing).
   */
  function sendPrompt(text, clientId) {
    const sentAt = now();
    // README B9: from the SEND tap to the reply's first sentence drawn; measured, never asserted (D235).
    win.performance?.mark?.('cockpit:B9:start');
    // A send during a turn steers it (§8): its block waits for the room's `queued` echo and
    // counts no age of its own; the header stays the running turn's.
    const during = runningView() !== null;
    const v = createTurn(doc, { clientId, prompt: text, at: sentAt, delivery: 'sending' }, {
      offset: clockOffset,
      promptButtons,
      startMs: during ? Number.NaN : undefined,
      onFirstSentence: () => {
        try {
          win.performance.mark('cockpit:B9:end');
          win.performance.measure('cockpit:B9', 'cockpit:B9:start', 'cockpit:B9:end');
        } catch { /* no marks in this browser: nothing to measure */ }
      },
    });
    if (during) steering.add(v);
    sending.set(clientId, v);
    appendTurn(v);
    if (!during) setTurn('thinking');
    pinned = true;
    follow.hidden = true;
    toEnd();
    ageTick();
    const seq = onPrompt({ type: 'prompt', clientId, text, source: 'typed', lang: null, about: null, sentAt, focus: focus() });
    if (typeof seq === 'number') promptSeq.set(seq, clientId);
    waitForEcho(clientId);
  }

  /**
   * E1 (c1-talk.md §10): no `turn.prompt` 5 s after the send while the link is up.
   * The 5 s count while the link is live; a link that is not live at the mark waits, and the
   * count starts again once it is (build B169; the room-down grace itself is screens.md §7).
   */
  function waitForEcho(clientId) {
    win.clearTimeout(waits.get(clientId));
    waits.set(clientId, win.setTimeout(() => {
      waits.delete(clientId);
      if (!sending.has(clientId)) return;
      if (link.status !== 'live') { waits.set(clientId, null); return; }
      showNotSent(clientId, LINES.notSent);
    }, CONFIRM_WAIT_MS));
  }

  /**
   * The block reads `YOU · 07:02 · NOT SENT`, under it the grey line with `RETRY` and `EDIT`;
   * the header `READY`; nothing is sent again on its own (§10).
   */
  function showNotSent(clientId, message) {
    const v = sending.get(clientId);
    if (!v) return;
    sending.delete(clientId);
    waits.delete(clientId);
    notSent.set(clientId, v);
    v.fail('not-sent', message, [
      { label: 'RETRY', onTap: () => retry(v) },
      { label: 'EDIT', onTap: () => edit(v) },
    ]);
    if (!runningView()) setTurn('idle');
    grew();
  }

  /**
   * §8: a queued prompt not sent (`Dropped by STOP.`, `The agent did not read this.`):
   * `RETRY` sends its text with a new `clientId` (D259), `EDIT` as E1's.
   */
  function promptButtons(item) {
    return [
      { label: 'RETRY', onTap: () => { if (link.status === 'live') { lastSendAt = now(); sendState(); sendPrompt(item.prompt, newClientId()); } } },
      { label: 'EDIT', onTap: () => editText(item.prompt, () => item.remove()) },
    ];
  }

  /**
   * The error end of a turn (§10 E2-E8): its exact line and buttons, under the reply. Every
   * button that sends makes a new `clientId` (D259) and acts only on a tap (§10 "Nothing is ever sent again on its own").
   */
  function drawEnd(v, back = false) {
    const end = v.endState;
    if (end?.state !== 'error') return;
    if (end.code === 'agent-exited' && !back) exited.add(v);
    else exited.delete(v);
    const tap = (text) => () => {
      if (link.status !== 'live') return;
      lastSendAt = now(); // D268: a RETRY is a send
      sendState();
      sendPrompt(text, newClientId());
    };
    const buttons = endButtons(end.code, back).map((label) => ({ label, onTap: tap(label === 'GO ON' ? GO_ON_TEXT : v.prompt) }));
    v.endError(end.code, endText(end, { back, nowMs: now(), offset: clockOffset }), buttons);
  }

  /** E2's second line (§10, protocols.md §3.5 `agent-back`): every cut turn says the agent is back, with `RETRY`. */
  let agentBack = false; // the room said `agent-back` since this page's last welcome
  function backNow() {
    agentBack = true;
    for (const v of [...exited]) drawEnd(v, true);
    grew();
  }

  /** E1 `RETRY`: the same text with the same `clientId`, as a new block; the failed one stays (§10). */
  function retry(v) {
    if (link.status !== 'live' || sending.has(v.clientId)) return;
    lastSendAt = now(); // D268: a RETRY is a send
    sendState();
    sendPrompt(v.prompt, v.clientId);
  }

  /**
   * `EDIT` (§10, D271), all in the tap's own `click` task: the block goes, its text back in the
   * input before a kept draft, the input focused with the caret after the restored text.
   */
  function edit(v) {
    for (const [id, w] of notSent) if (w === v) notSent.delete(id);
    editText(v.prompt, () => {
      v.node.remove();
      drawnTurns = Math.max(0, (drawnTurns ?? 1) - 1);
    });
  }

  /** `EDIT`'s own part: `drop()` takes the block away, `text` goes back into the input. */
  function editText(text, drop) {
    drop();
    drawNote();
    const { value, caret } = restoreDraft(text, input.value);
    input.value = value;
    draftChanged();
    input.focus({ preventScroll: true });
    input.setSelectionRange(caret, caret);
    pinned = true;
    toEnd();
  }

  /** The room's echo (protocols.md §3.1): the sender's block loses `· SENDING`; other screens draw it. */
  function promptEcho(msg) {
    win.clearTimeout(waits.get(msg.clientId));
    waits.delete(msg.clientId);
    // An echo after E1 (the room had it after all): the line goes, the block is confirmed (build B170).
    const mine = sending.get(msg.clientId) ?? notSent.get(msg.clientId);
    if (mine) {
      sending.delete(msg.clientId);
      notSent.delete(msg.clientId);
      const host = msg.delivery === 'queued' ? views.get(msg.turnId) : null;
      if (host) {
        // §8: the block becomes the running turn's queued prompt, its label time the send's.
        mine.node.remove();
        drawnTurns = Math.max(0, (drawnTurns ?? 1) - 1);
        host.queuePrompt({ clientId: msg.clientId, text: mine.prompt, at: mine.at, state: 'queued' });
        grew();
        return;
      }
      mine.confirm(msg.delivery === 'queued' ? { ...msg, turnId: null } : msg);
      if (mine.turnId && msg.delivery !== 'queued') views.set(mine.turnId, mine);
      ageTick();
      return;
    }
    if (msg.from === 'queued' && takeAsNextTurn(msg)) return;
    if (msg.delivery === 'queued') {
      // Another screen's prompt during the turn (§12): queued in it as this screen's would be.
      views.get(msg.turnId)?.queuePrompt({ clientId: msg.clientId, text: msg.text, at: msg.at, state: 'queued' });
      grew();
      return;
    }
    // A known turn is a resend's answer.
    if (views.has(msg.turnId)) return;
    const v = createTurn(doc, { turnId: msg.turnId, prompt: msg.text, at: msg.at }, { offset: clockOffset, promptButtons });
    views.set(msg.turnId, v);
    appendTurn(v);
    grew();
    ageTick();
  }

  /**
   * §8 "The turn ends first" (D258): the queued block this screen holds leaves its turn and
   * becomes the new turn's prompt, its label time kept (the send), `· QUEUED` until the
   * `prompt.taken`; its age counts from now. No block held: false, drawn as any prompt.
   */
  function takeAsNextTurn(msg) {
    let item = null;
    for (const v of views.values()) if ((item = v.removePrompt(msg.clientId))) break;
    if (!item) return false;
    const v = createTurn(doc, { turnId: msg.turnId, clientId: msg.clientId, prompt: item.prompt, at: item.at, delivery: 'queued' }, {
      offset: clockOffset, startMs: now(), promptButtons,
    });
    views.set(msg.turnId, v);
    turnsBox.append(v.node);
    grew();
    ageTick();
    return true;
  }

  /** prompt.taken (protocols.md §3.4): taken into its turn, or cancelled; unknown: D119's gap. */
  function promptTaken(msg) {
    const v = views.get(msg.turnId);
    const ok = v && (msg.state === 'taken' ? v.takePrompt(msg) : msg.state === 'cancelled' ? v.cancelPrompt(msg) : true);
    if (!ok) { onGap(); return; }
    changed(v);
    grew(); // the pin rule (§4) in the same task: the block moved or its line came
  }

  /**
   * STOP (§8, D268): acts on `pointerup` only when that pointer's `pointerdown` landed on the
   * slot while it read `STOP` and the lift is within TAP_SLOP_TOUCH of it; a keyboard
   * activation (`click` with `detail` 0) and `Ctrl+C` with the input empty act at once.
   */
  function stopNow() {
    if (send.dataset.send !== 'stop' || send.disabled) return;
    const v = runningView();
    if (!v?.turnId) return;
    setTurn('stopping');
    v.freeze(); // §8: the text stays as it was at the tap
    changed(v);
    onStop({ type: 'stop', turnId: v.turnId });
  }
  send.addEventListener('pointerdown', (e) => {
    stopPress = send.dataset.send === 'stop' ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  });
  send.addEventListener('pointerup', (e) => {
    const p = stopPress;
    stopPress = null;
    if (!p || p.id !== e.pointerId || send.dataset.send !== 'stop') return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP_TOUCH) return;
    stopNow();
  });
  send.addEventListener('pointercancel', () => { stopPress = null; });

  /**
   * B142: the slide starts in the frame of the tap. A new CSS transition waits pending for the
   * compositor (about two frames on the Wall page); its start time set to the timeline's now
   * keeps the 120 ms slide and leaves B7's 200 ms for the tap itself (c1-talk.md §2).
   */
  function startSlideNow() {
    for (const a of pane.getAnimations?.() ?? []) if (a.pending) a.startTime = doc.timeline.currentTime;
  }

  function setOpen(want) {
    if (want === open) return;
    open = want;
    if (hideTimer !== null) { win.clearTimeout(hideTimer); hideTimer = null; }
    if (open) {
      pane.hidden = false;
      pane.inert = false;
      void pane.getBoundingClientRect(); // the closed transform is in place before the slide starts
      root.dataset.pane = 'open';
      startSlideNow();
      opener.textContent = 'CLOSE';
      opener.setAttribute('aria-label', 'Close the cockpit');
      grow(); // a draft kept since the last close: its height, now the pane lays out
      if (pinned) toEnd(); // the latest turn in sight (c1-talk.md §2)
      // Focus only with a fine pointer, so a touch screen's keyboard does not cover the pane (D20).
      if (win.matchMedia?.('(pointer: fine)').matches) input.focus({ preventScroll: true });
    } else {
      if (pane.contains(doc.activeElement)) doc.activeElement.blur();
      root.dataset.pane = 'closed';
      startSlideNow();
      opener.textContent = 'CHAT';
      opener.setAttribute('aria-label', 'Open the cockpit');
      pane.inert = true;
      // Hidden once the 120 ms slide is out (0 ms with reduced motion, then at once).
      const dur = parseFloat(win.getComputedStyle(pane).transitionDuration) || 0;
      hideTimer = win.setTimeout(() => { hideTimer = null; if (!open) pane.hidden = true; }, dur > 0 ? PANE_SLIDE_MS + 30 : 0);
    }
    coverView(open && fit === 'full');
    onOpenChange(open);
  }

  /**
   * c1-talk.md §1.2: the pane's width follows the viewport in the same frame, with no
   * slide (the width is not animated); below the floor neither corner control is drawn
   * and an open pane closes as with CLOSE, the draft and a running turn untouched (D250).
   */
  function applyFit() {
    const was = fit;
    fit = paneFit(win.innerWidth, floorHeight());
    if (fit === was) return;
    root.dataset.cockpitFit = fit;
    if (fit === 'none') {
      setOpen(false);
      opener.remove();
    } else {
      if (!opener.isConnected) doc.body.append(opener);
      coverView(open && fit === 'full');
    }
  }

  /**
   * §1.2's floor is on the layout viewport "so the on-screen keyboard never trips it"; a
   * browser that shrinks the layout for the keyboard (and a window made shorter with the
   * input focused, §7.1) is measured by H, the tallest it was at this width (build B181).
   */
  function floorHeight() {
    if (keyboard && doc.activeElement === input) return keyboard.tallest();
    return win.innerHeight;
  }

  // §7.1 (D130, D131): the keyboard layout in the first frame after the event, the input's
  // cap with it, the conversation pinned to its end if it was (grow() keeps the pin).
  const keyboard = unsupported ? null : watchKeyboard({ win, input, onChange: () => { if (open) grow(); } });

  /**
   * D132: a tap on a control in the pane leaves the focus in the input, so the keyboard
   * does not drop and the row does not move between `pointerdown` and `pointerup`.
   */
  const keepFocus = (e) => {
    if (e.target.closest?.('button') && doc.activeElement === input) e.preventDefault();
  };
  pane.addEventListener('pointerdown', keepFocus);
  pane.addEventListener('mousedown', keepFocus);

  /**
   * §7.1 "Putting it away": a tap on the conversation outside a control, or on the header
   * outside its buttons, blurs the input (`pointerup` within TAP_SLOP_TOUCH of its
   * `pointerdown`); a drag that scrolls the conversation does not (it ends in `pointercancel`
   * or farther away).
   */
  let tapAt = null;
  pane.addEventListener('pointerdown', (e) => {
    tapAt = null;
    if (e.target.closest?.('button, textarea, input, a')) return;
    if (!convo.contains(e.target) && !head.contains(e.target)) return;
    tapAt = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  pane.addEventListener('pointerup', (e) => {
    const t = tapAt;
    tapAt = null;
    if (!t || t.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP_TOUCH) return;
    if (doc.activeElement === input) input.blur();
  });
  pane.addEventListener('pointercancel', () => { tapAt = null; });

  opener.addEventListener('click', () => setOpen(!open));
  closeBtn.addEventListener('click', () => setOpen(false));
  retryBtn.addEventListener('click', () => onRetryNow());
  send.addEventListener('click', (e) => {
    if (send.dataset.send === 'stop') { if (e.detail === 0) stopNow(); return; }
    sendNow();
  });
  input.addEventListener('input', draftChanged);
  // §7 "Keys": Enter sends, Shift+Enter breaks the line. An Enter that cannot send
  // (white space, too long, the room down) does nothing: no line break either (build B172).
  input.addEventListener('keydown', (e) => {
    // §8: Ctrl+C with the input empty is STOP (a key is not a bouncing finger).
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'c' || e.key === 'C') && input.value === '' && send.dataset.send === 'stop') {
      e.preventDefault();
      stopNow();
      return;
    }
    if (!isSendKey(e)) return;
    e.preventDefault();
    sendNow();
  });
  // Esc closes the pane, the draft stays (c1-talk.md §2, §7); before the shell's own Esc.
  win.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setOpen(false);
  }, true);

  function render() {
    root.dataset.cockpit = link.status;
    drawStatus();
    drawNote();
    sendState();
    drawLine();
    newBtn.disabled = true;
    turnWord.classList.toggle('ck-grey', link.status !== 'live');
    const counting = link.status === 'room-down' && !link.refused;
    if (counting && tick === null) tick = win.setInterval(drawStatus, TICK_MS);
    if (!counting && tick !== null) { win.clearInterval(tick); tick = null; }
    if (open) grow(); // the status line came or went: the input's cap with the keyboard up (§7.1)
  }

  render();
  applyFit();
  win.addEventListener('resize', () => { applyFit(); if (open) grow(); });

  function setLink(state) {
    link = state;
    render();
    // E1's count starts again for every prompt whose 5 s ran out while the link was not live.
    if (link.status === 'live') for (const [id, t] of waits) if (t === null) waitForEcho(id);
  }

  /** One room message (c1-talk.md §3, §5.1; protocols.md §3.1-§3.2). */
  function apply(msg) {
    switch (msg.type) {
      case 'welcome':
        agentBack = false;
        if (msg.status?.code === 'agent-back') backNow();
        stt = msg.config?.stt === 'on' ? 'on' : 'none';
        if (Number.isInteger(msg.config?.maxPromptChars) && msg.config.maxPromptChars > 0) maxChars = msg.config.maxPromptChars;
        draftChanged();
        {
          // §9 "Where the age counts from": the page's Date.now() at the welcome minus welcome.now.
          const roomNow = Date.parse(msg.now ?? '');
          if (Number.isFinite(roomNow)) clockOffset = now() - roomNow;
        }
        drawNote();
        return;
      case 'snapshot':
        drawSnapshot(msg);
        return;
      case 'turn.prompt':
        // A new turn runs on a session that is up: a cut turn's agent is back (§10 E2).
        if (msg.delivery === 'new' && exited.size) backNow();
        promptEcho(msg);
        return;
      case 'prompt.taken':
        promptTaken(msg);
        return;
      case 'error': {
        // protocols.md §3.1: `bad-message` on a prompt (empty, too long, a bad focus) is E1 at once.
        const id = promptSeq.get(msg.re);
        if (id && msg.code === 'bad-message') showNotSent(id, LINES.notSent);
        return;
      }
      case 'turn.state':
        if (msg.state === 'stopping') {
          // Another screen's STOP (§12): this one keeps the text as it was then too (§8).
          const v = views.get(msg.turnId);
          if (v) { v.freeze(); changed(v); }
        }
        // A state the room sent before it read this screen's `stop` does not undo `● STOPPING`
        // (protocols.md §3.3: the turn stays `stopping` until its `turn.end`).
        else if (root.dataset.turn === 'stopping' && msg.turnId === runningView()?.turnId) return;
        if (msg.state !== 'answering') { setTurn(msg.state); return; }
        heldTurn = msg.state;
        heldTurnId = msg.turnId;
        if (frame === null) frame = win.requestAnimationFrame(drawFrame);
        return;
      case 'text.delta':
      case 'text.block': {
        const v = views.get(msg.turnId);
        if (!v) return;
        if (msg.type === 'text.delta') v.delta(msg); else v.block(msg);
        changed(v);
        return;
      }
      case 'tool.start': {
        const v = views.get(msg.turnId);
        if (!v) return;
        v.toolStart(msg);
        changed(v);
        return;
      }
      case 'tool.end': {
        const v = views.get(msg.turnId);
        if (!v?.hasCall(msg.toolUseId)) return;
        v.toolEnd(msg);
        changed(v);
        return;
      }
      case 'status':
        // The status line itself is T28's (§10.1); here only E2's `agent-back`.
        if (msg.status?.code === 'agent-back') backNow();
        return;
      case 'turn.retrying': {
        const v = views.get(msg.turnId);
        if (!v) return;
        v.retrying(msg);
        grew();
        return;
      }
      case 'turn.end': {
        const v = views.get(msg.turnId);
        if (v) {
          v.end(msg);
          if (msg.code === 'agent-exited') agentBack = false;
          drawEnd(v);
          changed(v);
        }
        setTurn('idle');
        ageTick();
        return;
      }
      default:
    }
  }

  return {
    setLink, apply, page,
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => open,
    elements: { pane, opener, input, send, status, convo, follow, lineSlot },
  };
}
