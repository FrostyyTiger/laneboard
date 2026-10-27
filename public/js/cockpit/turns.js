// A turn in the pane (cockpit spec c1-talk.md §3, §5.1; protocols.md §3.1-§3.2;
// D227, D270): the label rows, the prompt block and the reply, built from a turn
// as the room's snapshot carries it (protocols.md §2.2) and kept up to date by
// the turn's messages as they come. Text only, never markup: every string the
// room sends goes in as textContent (no innerHTML).
//
//   const t = createTurn(doc, turn)   // turn: a snapshot turn, or {clientId, prompt, at, delivery}
//   t.node                            // [data-turn-id] (set once the room names the turn)
//   t.confirm(msg)                    // the turn.prompt echo: the turnId, `· SENDING` goes
//   t.delta(msg) / t.block(msg)       // text.delta appends, text.block replaces (§3 "Streaming")
//   t.end(msg)                        // turn.end: the cursor goes
//   t.draw()                          // the text changed since the last draw goes to the DOM
//
// The reply's text is md.js's blocks drawn by reply.js (T19); tool lines come with T20.
// `draw()` is the pane's once-per-frame flush (c1-talk.md §3: drawn at most once
// per animation frame), so `delta()` only keeps the text.
import { hhmm } from '../core/cockpit-time.js';
import { parse } from '../core/md.js';
import { drawText } from './reply.js';

const el = (doc, tag, cls, attrs = {}) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const timeOf = (at) => {
  const ms = typeof at === 'number' ? at : Date.parse(at ?? '');
  return Number.isFinite(ms) ? hhmm(ms) : null;
};

/** The words of `[data-turn-delivery]` (D270). */
export const DELIVERY_WORDS = Object.freeze({ sending: 'SENDING', queued: 'QUEUED', 'not-sent': 'NOT SENT' });

/** The label row `YOU · 07:02` / `AGENT · 07:02` (c1-talk.md §3, D227). */
export function labelRow(doc, who, at) {
  const row = el(doc, 'div', 'ck-label', { 'data-turn-label': '' });
  const t = timeOf(at);
  row.textContent = t ? `${who} · ${t}` : who;
  return row;
}

/**
 * The delivery word at the end of a prompt's label row (c1-talk.md §3, D270):
 * ` · ` stays the row's 16 px `--text-3`, the word is its own 18 px span.
 * `null` takes it away (a row with no word has no such span).
 */
export function setDelivery(doc, row, delivery) {
  // The row's own words are its text node; its element children are only these two spans.
  for (const c of [...row.children]) c.remove();
  if (!Object.hasOwn(DELIVERY_WORDS, delivery ?? '')) return;
  const sep = el(doc, 'span', 'ck-delivery-sep');
  sep.textContent = ' · ';
  const word = el(doc, 'span', 'ck-delivery', { 'data-turn-delivery': delivery });
  word.textContent = DELIVERY_WORDS[delivery];
  row.append(sep, word);
}

/**
 * When the reply's label row says it was: the turn's first item (a call's
 * start or the end), else the turn's own time (build B110).
 */
function replyAt(turn) {
  for (const it of turn.items ?? []) if (it?.startedAt) return it.startedAt;
  return turn.end?.at ?? turn.at;
}

/** One turn: `[data-turn-id]` holding its prompt block and everything under it (T91). */
export function createTurn(doc, turn) {
  const box = el(doc, 'section', 'ck-turn');
  let turnId = null;
  let promptLabel = null;
  let reply = null;
  const blocks = new Map(); // blockIndex → {node, text, drawn}
  let streaming = null; // the blockIndex the cursor follows
  let ended = Boolean(turn.end);

  const setId = (id) => {
    if (typeof id !== 'string' || !id) return;
    turnId = id;
    box.setAttribute('data-turn-id', id);
  };

  setId(turn.turnId);
  if (typeof turn.prompt === 'string') {
    promptLabel = labelRow(doc, 'YOU', turn.at);
    if (turn.delivery) setDelivery(doc, promptLabel, turn.delivery);
    const p = el(doc, 'div', 'ck-prompt');
    p.textContent = turn.prompt;
    box.append(promptLabel, p);
  }

  /** The reply's block `i`, made and placed by `blockIndex` on its first use (protocols.md §3.2). */
  function blockOf(i, at) {
    let b = blocks.get(i);
    if (b) return b;
    if (!reply) {
      reply = el(doc, 'div', 'ck-reply', { 'data-reply': '' });
      box.append(labelRow(doc, 'AGENT', at), reply);
    }
    // `done`: the block is complete (its text.block, the turn's end), so its last line is a
    // whole line; `ui`: the block's own state across redraws (reply.js).
    b = { node: el(doc, 'div', 'ck-block'), text: '', drawn: null, done: false, drawnDone: false, host: null, ui: { expanded: new Set() } };
    blocks.set(i, b);
    const after = [...blocks.keys()].filter((k) => k > i).sort((x, y) => x - y)[0];
    reply.insertBefore(b.node, after === undefined ? null : blocks.get(after).node);
    return b;
  }

  /** The cursor follows block `i` (null: no cursor); placed on its last character's element by draw(). */
  function follow(i) {
    streaming = i;
  }

  const texts = (turn.items ?? [])
    .filter((it) => it?.kind === 'text' && typeof it.text === 'string')
    .sort((a, b) => (a.blockIndex ?? 0) - (b.blockIndex ?? 0));
  for (const it of texts) {
    const b = blockOf(it.blockIndex ?? 0, replyAt(turn));
    b.text = it.text;
    b.done = true;
  }
  // A snapshot taken while the reply streams: the cursor on its last block (c1-talk.md §3).
  if (!ended && turn.state === 'answering' && texts.length) {
    follow(texts.at(-1).blockIndex ?? 0);
    blocks.get(streaming).done = false;
  }

  let cursorAt = null; // the element holding `ck-streaming`
  function draw() {
    for (const b of blocks.values()) {
      if (b.drawn === b.text && b.drawnDone === b.done) continue;
      // md.js on the block's whole text, at most once per frame (c1-talk.md §3, D146).
      b.host = drawText(doc, b.node, parse(b.text, { done: b.done }), b.ui);
      b.drawn = b.text;
      b.drawnDone = b.done;
    }
    const want = streaming === null ? null : blocks.get(streaming)?.host ?? null;
    if (cursorAt !== want) {
      cursorAt?.classList.remove('ck-streaming');
      want?.classList.add('ck-streaming');
      cursorAt = want;
    }
  }
  draw();

  /** The room has the prompt: its turnId, and the label's delivery word for `queued` or none. */
  function confirmed(msg) {
    setId(msg.turnId);
    if (promptLabel) setDelivery(doc, promptLabel, msg.delivery === 'queued' ? 'queued' : null);
  }
  function delta(msg) {
    if (ended) return;
    const b = blockOf(msg.blockIndex, msg.sentAt);
    b.text += msg.text;
    follow(msg.blockIndex);
  }
  /** The complete block replaces what the deltas built (a lost delta cannot leave wrong text). */
  function block(msg) {
    const b = blockOf(msg.blockIndex, Date.now());
    b.text = msg.text;
    b.done = true;
    if (streaming === msg.blockIndex) follow(null);
  }
  function end() {
    ended = true;
    for (const b of blocks.values()) b.done = true;
    follow(null);
  }

  return {
    node: box,
    get turnId() { return turnId; },
    get ended() { return ended; },
    confirm: confirmed, delta, block, end, draw,
  };
}

/** A whole turn from a snapshot (protocols.md §2.2). */
export function turnNode(doc, turn) {
  return createTurn(doc, turn).node;
}
