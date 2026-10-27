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
//     .count, .epoch, .seq
//     .close()            every link closed 1001 `room stopping`
//
// opts: `session` (session.mjs), `store` (store.mjs, loaded), `audit`
// (openAudit's instance or null), `config` (the room's), `log(line)`,
// `clientIds` (store.load()'s once-only ids, §11.7.1 step 6).
//
// An upgrade is taken, then checked (link-checks.mjs, D135: a refusal is a
// close code, never an HTTP status); a refused link gets the close and no
// frame. An accepted link waits for `hello` (§2.2), answers `welcome` and one
// `snapshot` (in parts of at most 512 KB, D140), then gets every `seq`'d
// message. T14 adds the replay after a gap, the heartbeat, silence, the
// no-hello and size close codes and `GET /sent`.
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { warnRateLimited } from '../security.mjs';
import { atConnection, atInbound, atOutbound, atUpgrade } from './faults.mjs';
import { linkRefusal } from './link-checks.mjs';
import { BOARD_USER, promptLine } from './audit-lines.mjs';
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
/** A text frame the link reads at all (T14 closes 4413 above 64 KB). */
export const MAX_FRAME_BYTES = 1024 * 1024;
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

export function createLink({ session, store, audit = null, config, log = () => {}, clientIds = [] }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const links = new Set(); // accepted links: {ws, auth, welcomed, rec}
  const epoch = `r-${randomBytes(3).toString('hex')}`;
  const allowInsecure = config.cockpit?.allowInsecure === true;
  const stt = config.cockpit?.stt ?? {};
  let seq = 0;
  let status = null;
  // D95: each prompt's clientId for 10 min → the turn.prompt that answered it.
  const once = new Map();
  const pending = new Set(); // clientIds accepted whose turn.prompt has not gone yet
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

  function sendTo(link, msg) {
    if (link.ws.readyState !== link.ws.OPEN) return;
    if (atOutbound(msg, link)) return;
    try { link.ws.send(JSON.stringify(msg)); } catch { /* closing */ }
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
    if (atOutbound(out, null)) return; // B18: counted in seq, sent to no link
    const text = JSON.stringify(out);
    for (const link of links) {
      if (!link.welcomed || link.ws.readyState !== link.ws.OPEN) continue;
      try { link.ws.send(text); } catch { /* closing */ }
    }
  }

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
    const link = { ws, auth: req.auth, welcomed: false, rec };
    links.add(link);
    ws.on('message', (raw, isBinary) => onFrame(link, raw, isBinary));
    ws.on('close', (code) => {
      links.delete(link);
      rec.closeCode = code;
    });
    ws.on('error', () => { links.delete(link); });
    log(`cockpit: link open (${req.auth?.kind ?? '?'}, ${links.size} open)`);
  }

  // ---------------------------------------------------------------- in

  function onFrame(link, raw, isBinary) {
    if (isBinary) return; // audio is C2's (§6); T14 closes a binary frame without an utterance
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (atInbound(msg, link)) return;
    // §2.2: the hello is the first frame; nothing else is read before it (T14: 4001 after 5 s).
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
        const r = session.stop(msg.turnId);
        if (!r.ok) sendTo(link, { type: 'error', re: msg.seq, code: r.code, message: `stop: ${r.code === 'unknown-id' ? 'no such turn' : 'the turn is not running'}` });
        return;
      }
      case 'new': {
        const r = session.newConversation();
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
    const now = clock.now();
    const conversation = store.conversation ?? session.conversation ?? nextConversation(null);
    const startedAt = store.startedAt ?? session.startedAt ?? isoAt(now);
    sendTo(link, {
      type: 'welcome', re: msg.seq, protocol: PROTOCOL, screen: SCREEN_NAME, epoch, seq,
      conversation, resume: 'snapshot',
      config: { stt: stt.url && stt.url !== 'none' ? 'on' : 'none', languages: languageList(stt.language), maxPromptChars: MAX_PROMPT_CHARS },
      // B96: no `focus` was ever seen for this screen: nothing counts as "since you looked".
      status, lookedAt: isoAt(now), now: isoAt(now),
    });
    for (const part of snapshotParts({ seq, conversation, startedAt, turns: store.turns() })) sendTo(link, part);
    link.welcomed = true;
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
    if (session.phase !== 'up') {
      // §3.1, §11.7 (D31): no session up, nothing held for later.
      const line = promptLine(audit, { text, result: { ok: false, status: 'agent-down' } });
      if (!line.ok) log(`cockpit: audit append failed for cockpit.prompt: ${line.reason}`);
      refuse('agent-down');
      return;
    }
    const bridge = session.bridge;
    const running = bridge.turn;
    const delivery = running ? 'queued' : 'new';
    const turnId = running ? running.turnId : `t-${pad(bridge.turnCount + 1, 4)}`;
    // D166: the line first; a prompt the log cannot hold never reaches the agent.
    const line = promptLine(audit, { turnId, text, result: { ok: true, source: msg.source, delivery, chars: text.length } });
    if (!line.ok) {
      log(`cockpit: audit append failed for cockpit.prompt: ${line.reason}`);
      refuse('audit-unavailable');
      return;
    }
    pending.add(msg.clientId);
    const r = await session.prompt({
      clientId: msg.clientId, screen: SCREEN_NAME, text, source: msg.source, lang: msg.lang, about: msg.about, receivedAt,
    });
    if (!r.ok) {
      pending.delete(msg.clientId);
      refuse(r.code ?? 'agent-down');
    }
  }

  function close() {
    for (const link of links) {
      try { link.ws.close(1001, 'room stopping'); } catch { /* gone */ }
    }
    links.clear();
    wss.close();
  }

  return {
    handleUpgrade, emit, close,
    get count() { return links.size; },
    get epoch() { return epoch; },
    get seq() { return seq; },
  };
}
