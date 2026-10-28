// A turn in the pane (cockpit spec c1-talk.md §3, §5.1; protocols.md §3.1-§3.2;
// D227, D270): the label rows, the prompt block and the reply, built from a turn
// as the room's snapshot carries it (protocols.md §2.2) and kept up to date by
// the turn's messages as they come. Text only, never markup: every string the
// room sends goes in as textContent (no innerHTML).
//
//   const t = createTurn(doc, turn, { offset, onFirstSentence })
//                                     // turn: a snapshot turn, or {clientId, prompt, at, delivery};
//                                     // offset: the page's clock minus the room's (welcome.now, §9);
//                                     // onFirstSentence(): once, when the reply's first sentence is drawn (B9)
//   t.node                            // [data-turn-id] (set once the room names the turn)
//   t.confirm(msg)                    // the turn.prompt echo: the turnId, `· SENDING` goes
//   t.delta(msg) / t.block(msg)       // text.delta appends, text.block replaces (§3 "Streaming")
//   t.toolStart(msg) / t.toolEnd(msg) // a call joins its tool line or starts one (§5, §5.1)
//   t.end(msg)                        // turn.end: the cursor goes, running calls lose `●`;
//                                     // `stopped` adds the `STOPPED AT 07:03` line (c1-talk.md §8)
//   t.freeze()                        // STOP (§8): the turn's text stays as it is now;
//                                     // nothing it sends later is drawn
//   t.draw()                          // the text changed since the last draw goes to the DOM
//   t.tick(nowMs)                     // the age in the `AGENT` label row, from 3 s (§9, D235);
//                                     // true when it made the row (the turn grew)
//   t.startMs                         // the turn's start on the page's clock (null before the room names it)
//   t.fail(code, message, buttons)    // the grey error line under the prompt (§10), `NOT SENT` for E1;
//                                     // buttons: [{label, onTap, disabled, made}], each a `<button>` in
//                                     // the line (`made(button)` once it exists: E9's 60 s wait)
//   t.unfail()                        // the line goes, the label loses its word (a late echo)
//   t.endError(code, message, buttons) // the error end's line (§10 E2-E8) at the turn's end, under the
//                                     // reply and before its queued prompts; again: replaced in place
//   t.endState                        // the turn's `turn.end` (snapshot or message), null while it runs
//   t.retrying(msg)                   // E5's grey row at the reply's end, replaced on each retry,
//                                     // gone with the first text and at the turn's end
//   t.prompt / t.clientId             // the prompt's text and the screen's clientId
//   t.hasError()                      // an error line shows
//   t.queuePrompt(p)                  // a prompt sent during the turn (c1-talk.md §8): its block at the
//                                     // turn's end, `· QUEUED` (or `NOT SENT` and its line when cancelled);
//                                     // p: {clientId, text, at, state, why}
//   t.takePrompt(msg)                 // prompt.taken `taken`: `· QUEUED` goes, the block before item `atBlock`
//   t.cancelPrompt(msg)               // prompt.taken `cancelled`: `NOT SENT`, its line, RETRY and EDIT
//   t.removePrompt(clientId)          // a queued block leaves the turn (taken as the next turn, EDIT)
//   t.at                              // the turn's own time as it was given (the label row's)
//
// The reply's text is md.js's blocks drawn by reply.js (T19); its tool lines are
// tool-words.js's words in a `<button>` each (T20).
// `draw()` is the pane's once-per-frame flush (c1-talk.md §3: drawn at most once
// per animation frame), so `delta()` only keeps the text.
import { hhmm, turnAgeText } from '../core/cockpit-time.js';
import { AGE_FROM_MS } from '../core/cockpit-constants.js';
import { parse } from '../core/md.js';
import { drawText } from './reply.js';
import { retryingText } from './errors.js';
import { canFold, lineText, anyRunning, callRow, isDenied, wholeInput } from '../core/tool-words.js';

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

/** c1-talk.md §8: the line under a queued prompt that was not sent, by `why`. */
export const PROMPT_WHY = Object.freeze({ stopped: 'Dropped by STOP.', 'not-taken': 'The agent did not read this.' });

/** The words of `[data-turn-delivery]` (D270). */
export const DELIVERY_WORDS = Object.freeze({ sending: 'SENDING', queued: 'QUEUED', 'not-sent': 'NOT SENT' });

/**
 * The stopped line under a stopped turn (c1-talk.md §8 "What a stopped turn looks like", D262): `[data-turn-stopped]`,
 * its words in capitals as written (`text-transform: none`), 16 px `--text-3` with the
 * cockpit's rule (§3, D227). `ms` is the turn's end on the page's clock (build B200).
 */
export function stoppedText(ms, forced) {
  return `STOPPED AT ${hhmm(ms)}${forced ? ' (FORCED)' : ''}`;
}

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
 * An error line in a turn (c1-talk.md §10, D227): `[data-turn-error="<code>"]`, 18 px mono
 * `--text-1` on `--bg-sunken` with the cockpit's `--line-strong` rule; its message as text,
 * its buttons under it. The buttons keep the focus where it was (D132: `preventDefault()` on
 * `pointerdown` and `mousedown`), so the on-screen keyboard stays up; `EDIT` moves it itself.
 */
export function errorLine(doc, code, message, buttons = []) {
  const box = el(doc, 'div', 'ck-err', { 'data-turn-error': code });
  const text = el(doc, 'p', 'ck-err-text');
  text.textContent = message;
  box.append(text);
  if (buttons.length) {
    const row = el(doc, 'div', 'ck-err-btns');
    for (const b of buttons) {
      const n = el(doc, 'button', 'ck-btn ck-err-btn', { type: 'button' });
      n.textContent = b.label;
      if (b.disabled) n.disabled = true;
      const keep = (e) => e.preventDefault();
      n.addEventListener('pointerdown', keep);
      n.addEventListener('mousedown', keep);
      n.addEventListener('click', () => { if (!n.disabled) b.onTap(n); });
      b.made?.(n);
      row.append(n);
    }
    box.append(row);
  }
  return box;
}

/** A room time (ISO, epoch ms) on the page's clock; a number given by the page itself stays as it is. */
const pageMs = (at, offset) => {
  if (typeof at === 'number') return at;
  const ms = Date.parse(at ?? '');
  return Number.isFinite(ms) ? ms + offset : null;
};

/**
 * Has the reply's first sentence been drawn whole? (README B9's end, D235): the first
 * `.`, `?` or `!` followed by white space after at least 12 characters in the first
 * paragraph (c5-c6.md §1 "A sentence ends"), or that paragraph ended (a blank line
 * after it, or the block complete).
 */
export function firstSentenceDone(text, done = false) {
  const para = /\n[ \t]*\n/.exec(text);
  if (para && para.index > 0) return true;
  if (done && text.trim() !== '') return true;
  for (const m of text.matchAll(/[.?!](?=\s)/g)) if (m.index >= 12) return true;
  return false;
}

/**
 * When the reply's label row says it was: the turn's first item (a call's
 * start or the end), else the turn's own time (build B110).
 */
function replyAt(turn) {
  for (const it of turn.items ?? []) if (it?.startedAt) return it.startedAt;
  return turn.end?.at ?? turn.at;
}

/**
 * One tool line (c1-talk.md §5, D24, D226): a `<button type="button">` 48 px tall,
 * its words a text span; the `●` glyph and `+`/`−` are the stylesheet's (so the
 * line's textContent is its words alone); opened, one row per call under the words.
 */
export function toolLine(doc, opts = {}) {
  const node = el(doc, 'button', 'ck-tool', { type: 'button', 'data-tool-line': '', 'aria-expanded': 'false' });
  const words = el(doc, 'span', 'ck-tool-words');
  node.append(words);
  const calls = [];
  let open = false;
  let drawn = null;

  function draw() {
    // A turn that ended with calls still running: they lose `●` and `…` (§5.1 `turn.end`).
    const stopped = { stopped: line.stopped, byStop: line.byStop };
    const running = anyRunning(calls) && !line.stopped;
    const text = lineText(calls, { ...opts, ...stopped });
    const rows = open ? calls.map((c) => callRow(c, stopped)) : [];
    const denied = isDenied(calls);
    const key = `${text}\n${running}\n${denied}\n${rows.join('\n')}`;
    if (key === drawn) return;
    drawn = key;
    words.textContent = text;
    node.toggleAttribute('data-running', running);
    // §5.2's `tried` line (D125): `[data-tool-line][data-denied="true"]`.
    if (denied) node.setAttribute('data-denied', 'true');
    else node.removeAttribute('data-denied');
    node.setAttribute('aria-expanded', String(open));
    for (const r of [...node.querySelectorAll('.ck-tool-row')]) r.remove();
    for (const [i, t] of rows.entries()) {
      const r = el(doc, 'span', 'ck-tool-row', { 'data-tool-row': '' });
      if (wholeInput(calls[i])) r.classList.add('ck-tool-whole');
      r.textContent = t;
      node.append(r);
    }
  }
  node.addEventListener('click', () => {
    open = !open;
    draw();
  });

  const lastCall = () => calls.at(-1) ?? null;
  const push = (c) => { calls.push(c); };
  const line = { node, calls, stopped: false, byStop: false, lastCall, add: push, draw };
  return line;
}

/**
 * One turn: `[data-turn-id]` holding its prompt block and everything under it (T91).
 * opts: `offset`, `onFirstSentence`, `startMs` (the age's start on the page's clock when it
 * is not the turn's own time: a queued prompt's turn counts from its take), `promptButtons(item)`
 * (the `RETRY`/`EDIT` of a cancelled prompt: [{label, onTap}], item {clientId, prompt, remove()}).
 */
export function createTurn(doc, turn, opts = {}) {
  const offset = Number.isFinite(opts.offset) ? opts.offset : 0;
  const promptButtons = typeof opts.promptButtons === 'function' ? opts.promptButtons : () => [];
  let onFirstSentence = typeof opts.onFirstSentence === 'function' ? opts.onFirstSentence : null;
  const box = el(doc, 'section', 'ck-turn');
  let turnId = null;
  let promptLabel = null;
  let agentLabel = null; // the `AGENT` label row: with the first item, or at 3 s (§9)
  let ageNode = null; // its ` · ` and `[data-turn-age]`, from 3 s
  let reply = null;
  let startMs = Number.isFinite(opts.startMs) ? opts.startMs : pageMs(turn.at, offset);
  let endMs = turn.end ? pageMs(turn.end.at, offset) : null;
  const blocks = new Map(); // blockIndex → {node, text, drawn}
  const placed = new Map(); // blockIndex → the node standing at it (a text block, a tool line)
  const lines = []; // the turn's tool lines, in the order they started
  const callsById = new Map(); // toolUseId → {call, line}
  let streaming = null; // the blockIndex the cursor follows
  let ended = Boolean(turn.end);
  let frozen = turn.state === 'stopping'; // STOP tapped (§8): nothing the turn sends from here is drawn
  let stoppedNode = null;
  let endState = turn.end ?? null;
  let endLine = null; // §10: the error end's line
  let retryRow = null; // §10 E5

  const setId = (id) => {
    if (typeof id !== 'string' || !id) return;
    turnId = id;
    box.setAttribute('data-turn-id', id);
  };

  let promptBlock = null;
  let errLine = null;

  setId(turn.turnId);
  if (typeof turn.prompt === 'string') {
    promptLabel = labelRow(doc, 'YOU', turn.at);
    if (turn.delivery) setDelivery(doc, promptLabel, turn.delivery);
    promptBlock = el(doc, 'div', 'ck-prompt');
    promptBlock.textContent = turn.prompt;
    // §8: a queued prompt's text is --text-2 until the agent takes it.
    promptBlock.classList.toggle('ck-queued', turn.delivery === 'queued');
    box.append(promptLabel, promptBlock);
  }

  // §8: prompts sent during this turn. Queued and cancelled ones wait in `queueBox`, after
  // everything the turn draws (the block stays the turn's last item while queued); a taken
  // one stands in the reply before the item at its `atBlock`.
  const promptItems = new Map(); // clientId → {clientId, prompt, at, node, label, text, err, state}
  let queueBox = null;
  let takes = 0; // prompts placed in the reply, so two taken at one atBlock keep their send order

  /** §10: the error line under the prompt block; `not-sent` (E1) also sets the label's `NOT SENT`. */
  let unsent = false; // E1: the room never had the prompt, so no agent works on it
  function fail(code, message, buttons) {
    unfail();
    errLine = errorLine(doc, code, message, buttons);
    box.insertBefore(errLine, promptBlock ? promptBlock.nextSibling : null);
    if (code !== 'not-sent') return;
    if (promptLabel) setDelivery(doc, promptLabel, 'not-sent');
    // The `AGENT` row the 3 s age made while the block waited goes with it: nothing ran (build B174).
    unsent = true;
    if (agentLabel && !reply) {
      agentLabel.remove();
      agentLabel = null;
      ageNode = null;
    }
  }
  function unfail() {
    errLine?.remove();
    errLine = null;
    unsent = false;
  }

  /** The `AGENT` label row (c1-talk.md §3, §9): made once, with the first item or at 3 s. */
  function agentRow(at) {
    if (!agentLabel) {
      agentLabel = labelRow(doc, 'AGENT', at);
      box.insertBefore(agentLabel, queueBox);
    }
    return agentLabel;
  }

  /** The reply under its `AGENT` label row, made on the turn's first item (c1-talk.md §5.1). */
  function replyBox(at) {
    if (!reply) {
      agentRow(at);
      reply = el(doc, 'div', 'ck-reply', { 'data-reply': '' });
      box.insertBefore(reply, queueBox); // after the AGENT row, before the queued prompts
    }
    return reply;
  }

  /**
   * The turn's age (c1-talk.md §9, D235): running, from its start to now; ended, the total
   * from its start to its end, both room times moved onto the page's clock. From 3 s it is
   * ` · 0:03` at the end of the `AGENT` row, the row made then if no item came yet.
   */
  function tick(nowMs) {
    if (startMs === null || unsent) return false;
    const ms = ended ? (endMs === null ? null : endMs - startMs) : nowMs - startMs;
    if (ms === null || ms < AGE_FROM_MS) return false;
    let made = false;
    if (!agentLabel) {
      if (ended) return false; // a turn that ended with nothing drawn has no row to carry it
      agentRow(turn.at ?? startMs);
      made = true;
    }
    if (!ageNode) {
      const sep = el(doc, 'span', 'ck-age-sep');
      sep.textContent = ' · ';
      const age = el(doc, 'span', 'ck-age', { 'data-turn-age': '' });
      ageNode = { sep, age };
      agentLabel.append(sep, age);
    }
    const t = turnAgeText(ms);
    if (ageNode.age.textContent !== t) ageNode.age.textContent = t;
    return made;
  }

  /** `node` at its `blockIndex` place: above every item with a higher index (§5.1 "Place"). */
  function place(i, node) {
    placed.set(i, node);
    const after = [...placed.keys()].filter((k) => k > i).sort((x, y) => x - y)[0];
    reply.insertBefore(node, after === undefined ? (retryRow?.parentNode === reply ? retryRow : null) : placed.get(after));
  }

  /** The reply's block `i`, made and placed by `blockIndex` on its first use (protocols.md §3.2). */
  function blockOf(i, at) {
    let b = blocks.get(i);
    if (b) return b;
    replyBox(at);
    // `done`: the block is complete (its text.block, the turn's end), so its last line is a
    // whole line; `ui`: the block's own state across redraws (reply.js).
    b = { node: el(doc, 'div', 'ck-block'), text: '', drawn: null, done: false, drawnDone: false, host: null, ui: { expanded: new Set() } };
    blocks.set(i, b);
    place(i, b.node);
    return b;
  }

  /**
   * A call (a tool.start or a snapshot's tool item): it joins the line whose last
   * call stands one index above it, of the same tool (§5.1 "The fold rule"), else
   * starts a line at its own `blockIndex` place.
   */
  function addCall(it) {
    if (typeof it.toolUseId !== 'string' || callsById.has(it.toolUseId)) return;
    const c = {
      tool: it.tool, input: it.input, blockIndex: it.blockIndex ?? 0, startedAt: it.startedAt,
      endedAt: it.endedAt ?? null, isError: it.isError, denied: it.denied,
    };
    replyBox(replyAt(turn) ?? it.startedAt);
    let line = lines.find((l) => canFold(l.lastCall(), c));
    const fresh = !line;
    if (fresh) {
      line = toolLine(doc);
      lines.push(line);
    }
    line.add(c);
    if (fresh) {
      // A new line goes in with its words: never an empty row, even between frames.
      line.draw();
      place(c.blockIndex, line.node);
    }
    callsById.set(it.toolUseId, { call: c, line });
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
  const calls = (turn.items ?? [])
    .filter((it) => it?.kind === 'tool')
    .sort((a, b) => (a.blockIndex ?? 0) - (b.blockIndex ?? 0));
  for (const it of calls) addCall(it);
  // §8 "Across a reload" (D124): the turn's prompt items, each as the page that sent it drew it.
  for (const it of turn.items ?? []) {
    if (it?.kind !== 'prompt' || typeof it.clientId !== 'string' || typeof it.text !== 'string') continue;
    const item = queuePrompt({ clientId: it.clientId, text: it.text, at: it.at, state: it.state, why: it.why });
    if (it.state === 'taken') placeTaken(item, Number.isInteger(it.atBlock) ? it.atBlock : 0);
  }
  if (ended) for (const l of lines) l.stopped = true;
  if (turn.end?.state === 'stopped') stoppedLine(turn.end);
  // A snapshot taken while the reply streams: the cursor on its last block (c1-talk.md §3).
  if (!ended && !frozen && turn.state === 'answering' && texts.length) {
    follow(texts.at(-1).blockIndex ?? 0);
    blocks.get(streaming).done = false;
  }

  let cursorAt = null; // the element holding `ck-streaming`
  function draw() {
    for (const l of lines) l.draw();
    for (const b of blocks.values()) {
      if (b.drawn === b.text && b.drawnDone === b.done) continue;
      // md.js on the block's whole text, at most once per frame (c1-talk.md §3, D146).
      b.host = drawText(doc, b.node, parse(b.text, { done: b.done }), b.ui);
      b.drawn = b.text;
      b.drawnDone = b.done;
    }
    if (onFirstSentence) {
      // B9's end mark: the first text block's drawn text holds its first sentence whole.
      const first = [...blocks.entries()].sort((x, y) => x[0] - y[0])[0]?.[1];
      if (first && first.drawn !== null && first.drawn.trim() !== '' && firstSentenceDone(first.drawn, first.drawnDone || ended)) {
        const f = onFirstSentence;
        onFirstSentence = null;
        f();
      }
    }
    const want = streaming === null ? null : blocks.get(streaming)?.host ?? null;
    if (cursorAt !== want) {
      cursorAt?.classList.remove('ck-streaming');
      want?.classList.add('ck-streaming');
      cursorAt = want;
    }
  }
  draw();
  tick(Date.now());

  /** §10: the error end's line at the turn's end, before the prompts queued in it (they are not the reply). */
  function endError(code, message, buttons) {
    const n = errorLine(doc, code, message, buttons);
    if (endLine) endLine.replaceWith(n);
    else box.insertBefore(n, queueBox);
    endLine = n;
  }

  /** §10 E5: not an error line, a tool-line-style row in `--text-3` at the reply's end. */
  function retrying(msg) {
    if (ended || frozen) return;
    replyBox(Date.now());
    if (!retryRow) retryRow = el(doc, 'p', 'ck-retrying', { 'data-turn-retrying': '' });
    retryRow.textContent = retryingText(msg);
    reply.append(retryRow); // after every item so far; a later item is placed above it
  }
  function unretry() {
    retryRow?.remove();
    retryRow = null;
  }

  /**
   * §8 "What a stopped turn looks like": `STOPPED AT 07:03` (or `(FORCED)`) under the cut
   * text, before the prompts queued in the turn (they are not the reply); running tool
   * lines end in ` · stopped`.
   */
  function stoppedLine(e) {
    for (const l of lines) l.byStop = true;
    if (stoppedNode) return;
    const ms = pageMs(e.at, offset) ?? Date.now();
    stoppedNode = el(doc, 'p', 'ck-stopped', { 'data-turn-stopped': '' });
    stoppedNode.textContent = stoppedText(ms, e.forced === true);
    box.insertBefore(stoppedNode, queueBox);
  }

  /** A prompt item's label word, its text's colour and its line, for its state (§8). */
  function setPromptState(item, state, why) {
    item.state = state;
    item.err?.remove();
    item.err = null;
    item.text.classList.toggle('ck-queued', state === 'queued');
    if (state === 'queued') setDelivery(doc, item.label, 'queued');
    else if (state === 'cancelled') {
      setDelivery(doc, item.label, 'not-sent');
      item.err = errorLine(doc, 'not-sent', PROMPT_WHY[why] ?? PROMPT_WHY['not-taken'], promptButtons(item));
      item.node.append(item.err);
    } else setDelivery(doc, item.label, null);
  }

  function queuePrompt(p) {
    const old = promptItems.get(p.clientId);
    if (old) return old;
    if (!queueBox) {
      queueBox = el(doc, 'div', 'ck-queue');
      box.append(queueBox);
    }
    const node = el(doc, 'div', 'ck-pitem');
    const label = labelRow(doc, 'YOU', p.at);
    const text = el(doc, 'div', 'ck-prompt');
    text.textContent = p.text;
    node.append(label, text);
    const item = {
      clientId: p.clientId, prompt: p.text, at: p.at, node, label, text, err: null, state: null,
      remove: () => removePrompt(p.clientId),
    };
    promptItems.set(p.clientId, item);
    queueBox.append(node);
    setPromptState(item, p.state === 'cancelled' || p.state === 'taken' ? p.state : 'queued', p.why);
    return item;
  }

  /** §8 "Taken": the block before the turn's first item with `blockIndex` ≥ `atBlock`. */
  function placeTaken(item, atBlock) {
    replyBox(item.at);
    takes += 1;
    place(atBlock - 0.5 + takes * 1e-6, item.node);
    setPromptState(item, 'taken');
  }

  function removePrompt(clientId) {
    const item = promptItems.get(clientId);
    if (!item) return null;
    promptItems.delete(clientId);
    for (const [k, n] of placed) if (n === item.node) placed.delete(k);
    item.node.remove();
    return item;
  }

  /** prompt.taken `taken`: this turn's own prompt (taken as the next turn) or one queued in it. */
  function takePrompt(msg) {
    if (msg.clientId && msg.clientId === turn.clientId && promptLabel) {
      setDelivery(doc, promptLabel, null);
      promptBlock.classList.remove('ck-queued');
      return true;
    }
    const item = promptItems.get(msg.clientId);
    if (!item) return false;
    if (item.state !== 'queued') return true; // applied already (a snapshot newer than the message)
    placeTaken(item, Number.isInteger(msg.atBlock) ? msg.atBlock : 0);
    return true;
  }

  function cancelPrompt(msg) {
    const item = promptItems.get(msg.clientId);
    if (!item) return false;
    setPromptState(item, 'cancelled', msg.why);
    return true;
  }

  /** The room has the prompt: its turnId, and the label's delivery word for `queued` or none. */
  function confirmed(msg) {
    setId(msg.turnId);
    if (promptLabel) setDelivery(doc, promptLabel, msg.delivery === 'queued' ? 'queued' : null);
    // §9 "Where the age counts from": the echo's `at`, moved onto the page's clock.
    if (msg.delivery !== 'queued') startMs = pageMs(msg.at, offset) ?? startMs;
  }
  function delta(msg) {
    if (ended || frozen) return;
    unretry(); // E5's row goes when text arrives
    const b = blockOf(msg.blockIndex, msg.sentAt);
    b.text += msg.text;
    follow(msg.blockIndex);
  }
  /** The complete block replaces what the deltas built (a lost delta cannot leave wrong text). */
  function block(msg) {
    if (frozen) return;
    unretry();
    const b = blockOf(msg.blockIndex, Date.now());
    b.text = msg.text;
    b.done = true;
    if (streaming === msg.blockIndex) follow(null);
  }
  function toolStart(msg) {
    if (ended || frozen) return;
    addCall(msg);
  }
  /**
   * A refused call learnt at its tool.end, in a line it had folded into (claude-code says
   * so only after the start): it leaves for a line of its own (§5.2, D125; build B156).
   * The line keeps its place; when the refused call was its first, the line becomes the
   * `tried` line and the calls after it move to a new line at the first one's index.
   */
  function splitDenied(rec) {
    const { line, call } = rec;
    if (line.calls.length < 2) return;
    const at = line.calls.indexOf(call);
    const moved = at === 0 ? line.calls.splice(1) : line.calls.splice(at, 1);
    const fresh = toolLine(doc);
    for (const c of moved) fresh.add(c);
    lines.push(fresh);
    for (const r of callsById.values()) if (moved.includes(r.call)) r.line = fresh;
    fresh.draw();
    place(moved[0].blockIndex, fresh.node);
  }
  /** The call ends: its ms and ok|failed; `●` goes once no call of its line runs (§5.1). */
  function toolEnd(msg) {
    const rec = callsById.get(msg.toolUseId);
    if (!rec || frozen) return;
    rec.call.endedAt = msg.endedAt;
    rec.call.isError = msg.isError;
    rec.call.denied = msg.denied;
    if (msg.denied === true) splitDenied(rec);
  }
  function end(msg = {}) {
    ended = true;
    endState = msg;
    unretry();
    endMs = pageMs(msg.at, offset) ?? Date.now();
    for (const b of blocks.values()) b.done = true;
    // §5.1 `turn.end`: running calls lose `●` (and their `…`).
    for (const l of lines) l.stopped = true;
    follow(null);
    tick(endMs);
    if (msg.state === 'stopped') stoppedLine({ at: msg.at, forced: msg.forced });
  }
  /** STOP (§8 "What a stopped turn looks like"): the text stays as it was at the tap, and the `▍` cursor goes. */
  function freeze() {
    frozen = true;
    follow(null);
  }

  return {
    node: box,
    get turnId() { return turnId; },
    get ended() { return ended; },
    get startMs() { return startMs; },
    get endState() { return endState; },
    prompt: turn.prompt ?? null,
    clientId: turn.clientId ?? null,
    at: turn.at ?? null,
    queuePrompt, takePrompt, cancelPrompt, removePrompt,
    holdsPrompt: (clientId) => promptItems.has(clientId),
    hasError: () => errLine !== null,
    /** Is any reply text on screen? (`answering` waits for it, pane.js B140). */
    hasText: () => [...blocks.values()].some((b) => b.drawn !== null && b.drawn !== ''),
    confirm(msg) { unfail(); confirmed(msg); },
    fail, unfail, endError, retrying, delta, block, toolStart, toolEnd, end, freeze, draw, tick,
    /** Does this turn hold the call? (a tool.end naming another is not this turn's, §5.1). */
    hasCall: (id) => callsById.has(id),
  };
}

/** A whole turn from a snapshot (protocols.md §2.2). */
export function turnNode(doc, turn) {
  return createTurn(doc, turn).node;
}
