// The room link `/api/cockpit/ws` (spec protocols.md §2.1-§2.2, §3.1-§3.3,
// §3.6; security.md §2.3; D94, D95, D135, D212): one WebSocket per page, the
// room's side.
//
//   createLink(opts) → link
//     .handleUpgrade(req, socket, head, url)  ctx.upgrade's handler: true for
//                         /api/cockpit/ws (taken), false for any other path
//     .emit(msg)          a room → screen message of the session (no `seq`
//                         yet): folded into the store, numbered, sent to
//                         every link that has its `welcome`
//     .conversationStarted({conversation, reason, from})  the session's new
//                         conversation is up: its `cockpit.new` line
//     .count, .epoch, .seq
//     .close()            every link closed 1001 `room stopping`
//
// opts: `session` (session.mjs), `store` (store.mjs, loaded), `audit`
// (openAudit's instance or null), `config` (the room's), `log(line)`,
// `clientIds` (store.load()'s once-only ids, §11.7.1 step 6), `pingMs`
// (PING_MS; tests shorten it), `auditWarn(action, reason)` (an audit append
// that failed: by default createFailWarner on `log`; the room passes its
// stderr one, screens.md §6.4).
//
// An upgrade is taken, then checked (link-checks.mjs, D135: a refusal is a
// close code, never an HTTP status); a refused link gets the close and no
// frame. An accepted link waits for `hello` (§2.2), answers `welcome` and one
// `snapshot` (in parts of at most 512 KB, D140), then gets every `seq`'d
// message. A reconnect with its `epoch` and `lastSeq` gets the missed
// messages from the replay buffer instead (D94). Every welcomed link gets a
// `heartbeat` every 10 s on the room clock (D10) and a WebSocket ping every
// 30 s (as server/ws.mjs); §2.3's close codes: 4001 no hello, 4002, 4408 too
// slow, 4413 too big, 4429 too many, 1011 internal, 1001 at shutdown.
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { warnRateLimited } from '../security.mjs';
import { atConnection, atInbound, atOutbound, atUpgrade } from './faults.mjs';
import { linkRefusal } from './link-checks.mjs';
import { BOARD_USER, createFailWarner, newLine, promptLine, stopLine } from './audit-lines.mjs';
import { createPromptRate } from './prompt-rate.mjs';
import { checkMessage, MAX_PROMPT_CHARS } from './protocol.mjs';
import { nextConversation } from './session.mjs';
import { ONCE_MS } from './store.mjs';
import * as clock from './clock.mjs';
import { isoAt } from './iso.mjs';

export const LINK_PATH = '/api/cockpit/ws';
/** §2.2: the protocol this room speaks. */
export const PROTOCOL = 1;
/** §2.2 (D27): the turns a snapshot carries. */
export const SNAPSHOT_TURNS = 50;
/** §2.2 (D140): a snapshot frame, and what a turn may take of it. */
export const PART_MAX_BYTES = 512 * 1024;
export const TURN_MAX_BYTES = 448 * 1024;
/** §2.2: a cut turn's longest text items keep this many characters. */
export const CUT_TEXT_KEEP = 4_000;
/** §8 (D99): a text frame from the screen, and a binary one; over either: 4413. */
export const MAX_TEXT_BYTES = 64 * 1024;
export const MAX_BINARY_BYTES = 6_400;
/** §8: unsent data per link; over it: 4408. */
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** §8: text messages per second per link; three passes in 60 s: 4429. */
export const INBOUND_PER_SEC = 50;
export const PASSES_TO_CLOSE = 3;
export const PASS_WINDOW_MS = 60_000;
/** §2.2 (D94): the `seq`'d messages kept for a replay. */
export const REPLAY_MAX = 2_000;
/** §2.2 (D10): the heartbeat, on the room clock. */
export const HEARTBEAT_MS = 10_000;
/** §2.2: a WebSocket ping, on the real clock (B102). */
export const PING_MS = 30_000;
/** §2.3: no `hello` this long after the open: 4001. */
export const HELLO_MS = 5_000;
/** Without pairing every screen is the board's (D212, D37: no names drawn). */
export const SCREEN_NAME = BOARD_USER;

const pad = (n, w) => String(n).padStart(w, '0');
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

/** `stt.language` as welcome's list (`["auto"]` for `auto`, D48). */
export function languageList(lang) {
  if (Array.isArray(lang)) return lang.slice();
  return typeof lang === 'string' && lang ? [lang] : ['auto'];
}

/**
 * §2.2: a turn whose JSON passes TURN_MAX_BYTES, cut for the snapshot only:
 * every tool input `{"…":"cut"}`, then its longest text items keep their last
 * 4 000 characters after `… `, until it fits.
 */
export function cutForSnapshot(turn) {
  if (bytes(turn) <= TURN_MAX_BYTES) return turn;
  const t = structuredClone(turn);
  for (const it of t.items) if (it.kind === 'tool') it.input = { '…': 'cut' };
  const texts = t.items.filter((it) => it.kind === 'text' && it.text.length > CUT_TEXT_KEEP)
    .sort((a, b) => b.text.length - a.text.length);
  for (const it of texts) {
    if (bytes(t) <= TURN_MAX_BYTES) break;
    it.text = `… ${it.text.slice(-CUT_TEXT_KEEP)}`;
  }
  return t;
}

/**
 * §2.2's snapshot as frames: the last 50 turns, cut between turns, oldest
 * first; every part carries every field; pins and cards complete in the last.
 */
export function snapshotParts({ seq, conversation, startedAt, turns }) {
  const shown = turns.slice(-SNAPSHOT_TURNS).map(cutForSnapshot);
  const base = { type: 'snapshot', seq, part: 1, parts: 1, conversation, startedAt, olderTurns: turns.length - shown.length };
  const room = PART_MAX_BYTES - bytes({ ...base, turns: [], pins: [], cards: [] }) - 64;
  const groups = [[]];
  let size = 0;
  for (const t of shown) {
    const n = bytes(t) + 1;
    if (groups.at(-1).length && size + n > room) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1).push(t);
    size += n;
  }
  return groups.map((g, i) => ({ ...base, part: i + 1, parts: groups.length, turns: g, pins: [], cards: [] }));
}

/**
 * §2.3 4413 for a text frame over 64 KB: `ws` refuses it at its header
 * (maxPayload, nothing buffered) and would close 1009; a listener put ahead
 * of its own on the receiver closes 4413 `too big` first, and `ws`'s close
 * then finds the link closing and does nothing (B101).
 */
function closeTooBigFirst(ws) {
  const receiver = ws._receiver;
  if (!receiver?.prependListener) return;
  receiver.prependListener('error', (err) => {
    if (err?.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
      try { ws.close(4413, 'too big'); } catch { /* gone */ }
    }
  });
}

export function createLink({ session, store, audit = null, config, log = () => {}, clientIds = [], pingMs = PING_MS, auditWarn = null }) {
  const auditFailed = auditWarn ?? createFailWarner({ write: log });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_TEXT_BYTES, autoPong: false });
  const links = new Set(); // accepted links: {ws, auth, welcomed, rec, alive, helloTimer, rate}
  const epoch = `r-${randomBytes(3).toString('hex')}`;
  const allowInsecure = config.cockpit?.allowInsecure === true;
  const stt = config.cockpit?.stt ?? {};
  let seq = 0;
  let status = null;
  // D94: the last REPLAY_MAX `seq`'d messages, oldest first, as sent (B103).
  const kept = [];
  // D95: each prompt's clientId for 10 min → the turn.prompt that answered it.
  const once = new Map();
  const pending = new Set(); // clientIds accepted whose turn.prompt has not gone yet
  let askedNew = null; // the owner's `new`, until its conversation is up: {from, stoppedTurn}
  // D228: 10 prompts a minute per device token; without pairing every link is the one screen (B179).
  const rate = createPromptRate({ now: () => clock.now() });
  seedOnce(clientIds);

  function seedOnce(ids) {
    const want = new Set(ids);
    for (const t of store.turns()) {
      if (t.clientId && want.has(t.clientId)) {
        remember(echoOf(t, { turnId: t.turnId, clientId: t.clientId, text: t.prompt, source: t.source, lang: t.lang, about: t.about, at: t.at, delivery: 'new' }));
      }
      for (const it of t.items) {
        if (it.kind === 'prompt' && want.has(it.clientId)) {
          remember(echoOf(t, { turnId: t.turnId, clientId: it.clientId, text: it.text, source: it.source, lang: it.lang, about: it.about, at: it.at, delivery: 'queued' }));
        }
      }
    }
  }

  function echoOf(_t, f) {
    const receivedAt = Date.parse(f.at);
    return {
      type: 'turn.prompt', turnId: f.turnId, clientId: f.clientId, screen: SCREEN_NAME, text: f.text,
      source: f.source, lang: f.lang ?? null, about: f.about ?? null, at: f.at,
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : clock.now(), delivery: f.delivery,
    };
  }

  function remember(msg) {
    if (!msg.clientId) return;
    const { seq: _drop, ...rest } = msg;
    once.set(msg.clientId, { msg: rest, until: (rest.receivedAt ?? clock.now()) + ONCE_MS });
  }

  function known(clientId) {
    const hit = once.get(clientId);
    if (!hit) return null;
    if (hit.until < clock.now()) {
      once.delete(clientId);
      return null;
    }
    return hit.msg;
  }

  // ---------------------------------------------------------------- out

  /** One frame to one link; §8: past 4 MB unsent, the link closes 4408. */
  function deliver(link, text) {
    if (link.ws.readyState !== link.ws.OPEN) return;
    try { link.ws.send(text); } catch { return; /* closing */ }
    if (link.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      log(`cockpit: link too slow (${link.ws.bufferedAmount} bytes unsent), closed 4408`);
      try { link.ws.close(4408, 'too slow'); } catch { /* gone */ }
    }
  }

  function sendTo(link, msg) {
    if (link.ws.readyState !== link.ws.OPEN) return;
    if (atOutbound(msg, link)) return;
    deliver(link, JSON.stringify(msg));
  }

  /** A session message: into the store, numbered, to every link past its welcome. */
  function emit(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'status') status = msg.status ?? null;
    store.apply(msg);
    const { type, ...rest } = msg;
    seq += 1;
    const out = { type, seq, ...rest };
    if (type === 'turn.prompt') {
      remember(out);
      pending.delete(out.clientId);
    }
    const text = JSON.stringify(out);
    kept.push({ seq, text, msg: out });
    if (kept.length > REPLAY_MAX) kept.shift();
    if (atOutbound(out, null)) return; // B18: counted in seq, kept, sent to no link
    for (const link of links) if (link.welcomed) deliver(link, text);
  }

  // ---------------------------------------------------------------- timers

  // D10: every welcomed link hears from the room at least every 10 s.
  const heartbeat = clock.setInterval(() => {
    const at = isoAt(clock.now());
    for (const link of links) if (link.welcomed) sendTo(link, { type: 'heartbeat', at });
  }, HEARTBEAT_MS);
  heartbeat?.inner?.unref?.();
  // §2.2: a ping every 30 s; a link that has not answered the previous one is dropped.
  const pinger = setInterval(() => {
    for (const link of links) {
      if (atOutbound({ type: 'ping' }, link)) { link.alive = true; continue; } // a silent link (stand-ins.md §1.2)
      if (!link.alive) {
        log('cockpit: link did not answer its ping, dropped');
        link.ws.terminate();
        continue;
      }
      link.alive = false;
      try { link.ws.ping(); } catch { /* closing */ }
    }
  }, pingMs);
  pinger.unref();

  // ---------------------------------------------------------------- upgrade

  function handleUpgrade(req, socket, head, url) {
    const pathname = url?.pathname ?? String(req.url ?? '').split('?')[0];
    if (pathname !== LINK_PATH) return false;
    if (atUpgrade(req, socket, 'ws')) return true;
    wss.handleUpgrade(req, socket, head, (ws) => accept(req, ws));
    return true;
  }

  function accept(req, ws) {
    const rec = { atMs: Date.now(), accepted: false, closeCode: null };
    // D135: the checks run on the open link, before any frame is read.
    const refused = linkRefusal(req, { config, links: links.size, allowInsecure });
    if (refused) {
      rec.closeCode = refused.code;
      atConnection(rec);
      warnRateLimited((reason, detail) => log(`cockpit: link refused (${reason}) ${detail}`), `link-${refused.code}`,
        `${refused.code} origin=${JSON.stringify(String(req.headers?.origin ?? '').slice(0, 80))}`);
      ws.close(refused.code, refused.reason);
      return;
    }
    rec.accepted = true;
    atConnection(rec);
    const link = { ws, auth: req.auth, welcomed: false, rec, alive: true, helloTimer: null, rate: { start: 0, n: 0, passed: false, passes: [] } };
    links.add(link);
    closeTooBigFirst(ws);
    // §2.3: 4001 when no `hello` came 5 s after the open.
    link.helloTimer = clock.setTimeout(() => {
      link.helloTimer = null;
      if (!link.welcomed) ws.close(4001, 'no hello');
    }, HELLO_MS);
    ws.on('message', (raw, isBinary) => {
      try {
        onFrame(link, raw, isBinary);
      } catch (err) {
        // §2.3: an exception in the handler closes 1011.
        log(`cockpit: link handler failed: ${err?.message ?? err}`);
        try { ws.close(1011, 'internal'); } catch { /* gone */ }
      }
    });
    ws.on('pong', () => { link.alive = true; });
    // autoPong is off so a silent link (stand-ins.md §1.2) answers no ping either.
    ws.on('ping', (data) => {
      if (!atOutbound({ type: 'pong' }, link)) {
        try { ws.pong(data); } catch { /* closing */ }
      }
    });
    const gone = () => {
      links.delete(link);
      if (link.helloTimer) clock.clearTimeout(link.helloTimer);
      link.helloTimer = null;
    };
    ws.on('close', (code) => {
      gone();
      rec.closeCode = code;
    });
    ws.on('error', gone);
    log(`cockpit: link open (${req.auth?.kind ?? '?'}, ${links.size} open)`);
  }

  // ---------------------------------------------------------------- in

  /**
   * §8: 50 text messages per second per link; each one over is `error`
   * `too-many` and dropped. A second in which the limit was passed is one
   * pass (B104); the third pass in 60 s closes 4429. Real time, as the ping.
   */
  function overRate(link, msg) {
    const r = link.rate;
    const t = Date.now();
    if (t - r.start >= 1000) { r.start = t; r.n = 0; r.passed = false; }
    if (++r.n <= INBOUND_PER_SEC) return false;
    if (!r.passed) {
      r.passed = true;
      r.passes = r.passes.filter((at) => t - at < PASS_WINDOW_MS);
      r.passes.push(t);
      if (r.passes.length >= PASSES_TO_CLOSE) {
        log('cockpit: link over its rate limit 3 times in 60 s, closed 4429');
        link.ws.close(4429, 'too many');
        return true;
      }
    }
    const re = Number.isInteger(msg?.seq) && msg.seq >= 1 ? msg.seq : null;
    if (re !== null) sendTo(link, { type: 'error', re, code: 'too-many', message: `over ${INBOUND_PER_SEC} messages a second` });
    return true;
  }

  function onFrame(link, raw, isBinary) {
    if (isBinary) {
      // §8: a binary frame over 6 400 bytes closes 4413; audio itself is C2's (§6), dropped until then.
      if (raw.length > MAX_BINARY_BYTES) link.ws.close(4413, 'too big');
      return;
    }
    if (link.ws.readyState !== link.ws.OPEN) return;
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (atInbound(msg, link)) return;
    if (overRate(link, msg)) return;
    // §2.2: the hello is the first frame; nothing else is read before it (4001 after 5 s).
    if (!link.welcomed && msg?.type !== 'hello') return;
    const reSeq = Number.isInteger(msg?.seq) && msg.seq >= 1 ? msg.seq : null;
    const checked = checkMessage(msg, 'in', { maxPromptChars: MAX_PROMPT_CHARS, languages: languageList(stt.language) });
    if (!checked.ok) {
      // A message without a link `seq` cannot be answered (`re`); it is dropped (B97).
      if (reSeq !== null) sendTo(link, { type: 'error', re: reSeq, code: checked.code, message: checked.message.slice(0, 500) });
      return;
    }
    if (!link.welcomed) return hello(link, msg);
    switch (msg.type) {
      case 'hello':
        sendTo(link, { type: 'error', re: msg.seq, code: 'not-now', message: 'hello: the link already has its welcome' });
        return;
      case 'prompt':
        prompt(link, msg).catch((err) => log(`cockpit: prompt failed: ${err?.message ?? err}`));
        return;
      case 'stop': {
        // screens.md §6.4: the line before the bridge is asked; D166: a stop never waits for the log.
        const running = session.bridge?.turn;
        // D165 (T60): one line per stop that does something; a stop of a turn already stopping
        // changes nothing (session.mjs answers ok) and writes no line, so a burst of `stop`
        // frames for one turn is one chained line.
        if (running && running.turnId === msg.turnId && session.stopping?.turnId !== msg.turnId) {
          const line = stopLine(audit, { turnId: msg.turnId, cancelQueued: session.bridge.ready?.canCancelQueued === true });
          if (!line.ok) auditFailed('cockpit.stop', line.reason);
        }
        const r = session.stop(msg.turnId);
        if (!r.ok) sendTo(link, { type: 'error', re: msg.seq, code: r.code, message: `stop: ${r.code === 'unknown-id' ? 'no such turn' : 'the turn is not running'}` });
        return;
      }
      case 'new': {
        const asked = { from: session.conversation ?? null, stoppedTurn: session.bridge?.turn?.turnId ?? null };
        const r = session.newConversation();
        if (r.ok) askedNew = asked; // its line once the conversation is up (conversationStarted)
        if (!r.ok) sendTo(link, { type: 'error', re: msg.seq, code: r.code, message: 'new: a new conversation is already starting' });
        return;
      }
      default:
        // Valid messages of later slices (focus, history, show.result, audio …) change nothing yet (B98).
    }
  }

  function hello(link, msg) {
    if (msg.protocol !== PROTOCOL) {
      link.ws.close(4002, `protocol ${msg.protocol}`);
      return;
    }
    if (link.helloTimer) clock.clearTimeout(link.helloTimer);
    link.helloTimer = null;
    const now = clock.now();
    const conversation = store.conversation ?? session.conversation ?? nextConversation(null);
    const startedAt = store.startedAt ?? session.startedAt ?? isoAt(now);
    const missed = replayFrom(msg);
    sendTo(link, {
      type: 'welcome', re: msg.seq, protocol: PROTOCOL, screen: SCREEN_NAME, epoch, seq,
      conversation, resume: missed ? 'replay' : 'snapshot',
      config: { stt: stt.url && stt.url !== 'none' ? 'on' : 'none', languages: languageList(stt.language), maxPromptChars: MAX_PROMPT_CHARS },
      // B96: no `focus` was ever seen for this screen: nothing counts as "since you looked".
      status, lookedAt: isoAt(now), now: isoAt(now),
    });
    if (missed) {
      for (const k of missed) if (!atOutbound(k.msg, link)) deliver(link, k.text);
    } else {
      for (const part of snapshotParts({ seq, conversation, startedAt, turns: store.turns() })) sendTo(link, part);
    }
    link.welcomed = true;
  }

  /**
   * §2.2 (D94): the kept messages `lastSeq + 1 … seq` when the `epoch` is
   * this room's and `lastSeq + 1` is still kept (none missed: `[]`); else
   * null, and the link gets a snapshot (a fresh page, a room restart, too far
   * behind, or a `lastSeq` this room never sent).
   */
  function replayFrom(hello) {
    if (hello.epoch !== epoch || !Number.isInteger(hello.lastSeq)) return null;
    if (hello.lastSeq > seq) return null;
    const oldest = seq - kept.length + 1;
    if (hello.lastSeq + 1 < oldest) return null;
    return kept.slice(hello.lastSeq + 1 - oldest);
  }

  /** §3.1: the echo is the confirmation; the audit line before it (screens.md §6.4). */
  async function prompt(link, msg) {
    const receivedAt = clock.now();
    const again = known(msg.clientId);
    if (again) {
      // D95: a known clientId starts nothing; the same echo, to this link only, without `seq`.
      sendTo(link, again);
      return;
    }
    if (pending.has(msg.clientId)) return; // its echo is on the way to every link
    const text = msg.text.trim();
    const refuse = (code) => sendTo(link, { type: 'prompt.refused', re: msg.seq, clientId: msg.clientId, code });
    // D165: the refusals a minute held back ride on the token's next `cockpit.prompt` line.
    const writeLine = (fields) => {
      const held = rate.takeHeld(SCREEN_NAME);
      const result = held ? { ...fields.result, refusedSince: held } : fields.result;
      const line = promptLine(audit, { ...fields, result });
      if (!line.ok) rate.putBack(SCREEN_NAME, held);
      return line;
    };
    // D228: the 11th prompt in 60 s on the room clock is refused, counted nowhere, and nothing
    // reaches the agent; a known clientId (above) never gets here.
    const slot = rate.take(SCREEN_NAME);
    if (!slot) {
      if (rate.refusal(SCREEN_NAME).line) {
        const line = writeLine({ text, result: { ok: false, status: 'too-many' } });
        if (!line.ok) auditFailed('cockpit.prompt', line.reason);
      }
      refuse('too-many');
      return;
    }
    if (session.phase !== 'up') {
      // §3.1, §11.7 (D31): no session up, nothing held for later; a refused prompt is not counted (D228).
      rate.giveBack(slot);
      const line = writeLine({ text, result: { ok: false, status: 'agent-down' } });
      if (!line.ok) auditFailed('cockpit.prompt', line.reason);
      refuse('agent-down');
      return;
    }
    const bridge = session.bridge;
    const running = bridge.turn;
    const delivery = running ? 'queued' : 'new';
    const turnId = running ? running.turnId : `t-${pad(bridge.turnCount + 1, 4)}`;
    // D166: the line first; a prompt the log cannot hold never reaches the agent.
    const line = writeLine({ turnId, text, result: { ok: true, source: msg.source, delivery, chars: text.length } });
    if (!line.ok) {
      rate.giveBack(slot);
      auditFailed('cockpit.prompt', line.reason);
      refuse('audit-unavailable');
      return;
    }
    pending.add(msg.clientId);
    const r = await session.prompt({
      clientId: msg.clientId, screen: SCREEN_NAME, text, source: msg.source, lang: msg.lang, about: msg.about, receivedAt,
    });
    if (!r.ok) {
      pending.delete(msg.clientId);
      rate.giveBack(slot);
      refuse(r.code ?? 'agent-down');
    }
  }

  /**
   * screens.md §6.4 `cockpit.new`, written once the new conversation has
   * started: the owner's START (`reason` `owner`, with the turn it stopped)
   * or the room's forced fresh start (`user` `room`). The first conversation
   * of a room (`reason` null) is no `new`. D166: it never waits for the log.
   */
  function conversationStarted({ conversation, reason, from = null }) {
    if (reason !== 'owner' && reason !== 'forced') return;
    const asked = reason === 'owner' ? askedNew : null;
    askedNew = null;
    const line = newLine(audit, { conversation, reason, from: asked?.from ?? from, stoppedTurn: asked?.stoppedTurn ?? null });
    if (!line.ok) auditFailed('cockpit.new', line.reason);
  }

  function close() {
    clock.clearInterval(heartbeat);
    clearInterval(pinger);
    for (const link of links) {
      if (link.helloTimer) clock.clearTimeout(link.helloTimer);
      try { link.ws.close(1001, 'room stopping'); } catch { /* gone */ }
    }
    links.clear();
    wss.close();
  }

  return {
    handleUpgrade, emit, close, conversationStarted,
    get count() { return links.size; },
    get epoch() { return epoch; },
    get seq() { return seq; },
  };
}
