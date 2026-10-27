// The cockpit button and the pane (cockpit spec c1-talk.md §1-§2, §5.1, §10.1;
// screens.md §4, §7; D17, D116, D118, D158, D267). DOM only, no innerHTML:
// every text goes in as textContent.
//
//   const pane = createPane({ doc, page: 'app' | 'wall', onRetryNow });
//   pane.setLink(state)        the room link's state (link.js): data-cockpit, the status line
//   pane.apply(msg)            one room message (welcome, snapshot, turn.state)
//   pane.open() / .close() / .isOpen()
//
// The root (<html>) carries data-cockpit, data-pane and data-turn (README.md
// "Selectors tests use"); the pane is [data-cockpit-conversation].
import { sinceText } from '../core/cockpit-time.js';
import { PANE_SLIDE_MS, TICK_MS } from '../core/cockpit-constants.js';
import { turnNode } from './turns.js';

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
  const now = opts.now ?? (() => Date.now());
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
  pane.append(head, status, convo, row);

  // --- the opener above the talk button's place (screens.md §4, D116)
  const opener = button(doc, 'ck-btn ck-open', 'data-cockpit-open', 'CHAT');
  opener.setAttribute('aria-label', 'Open the cockpit');

  doc.body.append(pane, opener);

  let open = false;
  let link = { status: 'connecting', since: null, retryAt: null, trying: false, welcome: null };
  let stt = 'none';
  let drawnTurns = null; // null until the first snapshot
  let pinned = true;
  let hideTimer = null;
  let tick = null;

  root.dataset.pane = 'closed';

  const setTurn = (state) => {
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
    for (const t of turns) frag.append(turnNode(doc, t));
    turnsBox.replaceChildren(frag);
    drawnTurns = turns.length;
    const running = turns.findLast?.((t) => t && !t.end && t.state && t.state !== 'done');
    setTurn(running ? running.state : 'idle');
    drawNote();
    if (pinned) toEnd();
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
      opener.textContent = 'CLOSE';
      opener.setAttribute('aria-label', 'Close the cockpit');
      if (pinned) toEnd(); // the latest turn in sight (c1-talk.md §2)
      // Focus only with a fine pointer, so a touch screen's keyboard does not cover the pane (D20).
      if (win.matchMedia?.('(pointer: fine)').matches) input.focus({ preventScroll: true });
    } else {
      if (pane.contains(doc.activeElement)) doc.activeElement.blur();
      root.dataset.pane = 'closed';
      opener.textContent = 'CHAT';
      opener.setAttribute('aria-label', 'Open the cockpit');
      pane.inert = true;
      // Hidden once the 120 ms slide is out (0 ms with reduced motion, then at once).
      const dur = parseFloat(win.getComputedStyle(pane).transitionDuration) || 0;
      hideTimer = win.setTimeout(() => { hideTimer = null; if (!open) pane.hidden = true; }, dur > 0 ? PANE_SLIDE_MS + 30 : 0);
    }
    onOpenChange(open);
  }

  opener.addEventListener('click', () => setOpen(!open));
  closeBtn.addEventListener('click', () => setOpen(false));
  retryBtn.addEventListener('click', () => onRetryNow());
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

  function setLink(state) {
    link = state;
    render();
  }

  /** One room message: welcome (the empty line's variant), snapshot, turn.state (c1-talk.md §5.1). */
  function apply(msg) {
    if (msg.type === 'welcome') {
      stt = msg.config?.stt === 'on' ? 'on' : 'none';
      drawNote();
    } else if (msg.type === 'snapshot') {
      drawSnapshot(msg);
    } else if (msg.type === 'turn.state') {
      setTurn(msg.state);
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
