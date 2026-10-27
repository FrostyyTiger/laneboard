// The cockpit button and the pane (cockpit spec c1-talk.md §1-§2, §1.2, §5.1, §10.1;
// screens.md §4, §7; D17, D116, D118, D158, D249, D250, D267). DOM only, no innerHTML:
// every text goes in as textContent.
//
//   const pane = createPane({ doc, page: 'app' | 'wall', onRetryNow, unsupported });
//   unsupported: true in a browser below the floor (fit.js tooOld, D250): the header and
//   one line, no input row
//   pane.setLink(state)        the room link's state (link.js): data-cockpit, the status line
//   pane.apply(msg)            one room message (welcome, snapshot, turn.prompt, turn.state,
//                              text.delta, text.block, turn.end)
//   onPrompt(msg)              SEND: the `prompt` to the room (protocols.md §3.1); the block is
//                              drawn at the tap with `· SENDING` until the room's echo (B8)
//   pane.open() / .close() / .isOpen()
//
// The root (<html>) carries data-cockpit, data-pane and data-turn (README.md
// "Selectors tests use"); the pane is [data-cockpit-conversation].
import { sinceText } from '../core/cockpit-time.js';
import { PANE_SLIDE_MS, TICK_MS } from '../core/cockpit-constants.js';
import { createTurn } from './turns.js';
import { focusNow } from './focus.js';
import { paneFit, TOO_OLD_TEXT } from './fit.js';

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
});

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

  const row = el(doc, 'div', 'ck-row');
  const input = el(doc, 'textarea', 'ck-input', {
    'data-cockpit-input': '', rows: '1', placeholder: 'Type a message', enterkeyhint: 'send',
    autocapitalize: 'sentences', spellcheck: 'true', 'aria-label': 'Message to the agent',
  });
  const send = button(doc, 'ck-btn ck-send', 'data-cockpit-send', 'SEND');
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
    pane.append(head, status, convo, row);
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
  const dirty = new Set(); // views whose text changed since the last frame
  let frame = null;
  // `answering` waits for the frame that draws its text (c1-talk.md §3: "reply text is streaming"),
  // so `data-turn` never says answering over an empty reply (build B140).
  let heldTurn = null;
  let pinned = true;
  let hideTimer = null;
  let tick = null;
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
  };

  function sendState() {
    // c1-talk.md §7: disabled while the input holds only white space and while the room is down;
    // D118: until `live`.
    send.disabled = link.status !== 'live' || input.value.trim() === '';
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
  convo.addEventListener('scroll', () => { pinned = atEnd(); }, { passive: true });

  function drawSnapshot(snap) {
    const turns = Array.isArray(snap.turns) ? snap.turns : [];
    const frag = doc.createDocumentFragment();
    views.clear();
    for (const t of turns) {
      const v = createTurn(doc, t);
      if (v.turnId) views.set(v.turnId, v);
      if (t.clientId) sending.delete(t.clientId); // the room had it: the snapshot's block is the one
      frag.append(v.node);
    }
    // A prompt drawn at the tap that the room has not echoed yet stays at the end (build B136).
    for (const v of sending.values()) frag.append(v.node);
    turnsBox.replaceChildren(frag);
    drawnTurns = turns.length + sending.size;
    const running = turns.findLast?.((t) => t && !t.end && t.state && t.state !== 'done');
    setTurn(running ? running.state : 'idle');
    drawNote();
    if (pinned) toEnd();
  }

  /** c1-talk.md §3 "Streaming": the reply drawn at most once per animation frame. */
  function drawFrame() {
    frame = null;
    for (const v of dirty) v.draw();
    dirty.clear();
    if (heldTurn !== null) setTurn(heldTurn);
    if (pinned) toEnd();
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
    if (send.disabled || text === '') return;
    const clientId = newClientId();
    const sentAt = now();
    const v = createTurn(doc, { clientId, prompt: text, at: sentAt, delivery: 'sending' });
    sending.set(clientId, v);
    appendTurn(v);
    input.value = '';
    sendState();
    setTurn('thinking');
    pinned = true;
    toEnd();
    onPrompt({ type: 'prompt', clientId, text, source: 'typed', lang: null, about: null, sentAt, focus: focus() });
  }

  /** The room's echo (protocols.md §3.1): the sender's block loses `· SENDING`; other screens draw it. */
  function promptEcho(msg) {
    const mine = sending.get(msg.clientId);
    if (mine) {
      sending.delete(msg.clientId);
      mine.confirm(msg);
      if (mine.turnId && msg.delivery !== 'queued') views.set(mine.turnId, mine);
      return;
    }
    // A queued prompt from another screen is T25's (c1-talk.md §8); a known turn is a resend's answer.
    if (msg.delivery === 'queued' || views.has(msg.turnId)) return;
    const v = createTurn(doc, { turnId: msg.turnId, prompt: msg.text, at: msg.at });
    views.set(msg.turnId, v);
    appendTurn(v);
    if (pinned) toEnd();
  }

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
    fit = paneFit(win.innerWidth, win.innerHeight);
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

  opener.addEventListener('click', () => setOpen(!open));
  closeBtn.addEventListener('click', () => setOpen(false));
  retryBtn.addEventListener('click', () => onRetryNow());
  send.addEventListener('click', sendNow);
  input.addEventListener('input', sendState);
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
    newBtn.disabled = true;
    turnWord.classList.toggle('ck-grey', link.status !== 'live');
    const counting = link.status === 'room-down' && !link.refused;
    if (counting && tick === null) tick = win.setInterval(drawStatus, TICK_MS);
    if (!counting && tick !== null) { win.clearInterval(tick); tick = null; }
  }

  render();
  applyFit();
  win.addEventListener('resize', applyFit);

  function setLink(state) {
    link = state;
    render();
  }

  /** One room message (c1-talk.md §3, §5.1; protocols.md §3.1-§3.2). */
  function apply(msg) {
    switch (msg.type) {
      case 'welcome':
        stt = msg.config?.stt === 'on' ? 'on' : 'none';
        drawNote();
        return;
      case 'snapshot':
        drawSnapshot(msg);
        return;
      case 'turn.prompt':
        promptEcho(msg);
        return;
      case 'turn.state':
        if (msg.state !== 'answering') { setTurn(msg.state); return; }
        heldTurn = msg.state;
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
      case 'turn.end': {
        const v = views.get(msg.turnId);
        if (v) { v.end(msg); changed(v); }
        setTurn('idle');
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
    elements: { pane, opener, input, send, status, convo },
  };
}
