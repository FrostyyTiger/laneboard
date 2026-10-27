// The conversation on disk (spec protocols.md §11.7.1, D154, D155, pending
// Q-O24; security.md §6). The room keeps what the screens draw, so a room
// restart gives the screens the same conversation and the next prompt goes to
// the same session.
//
//   createStore({stateDir, log}) → store
//     .load({now, session})  room start, before the link accepts an upgrade:
//                            steps 1-6 of §11.7.1 → {conversation, startedAt,
//                            turns, lastTurn, clientIds, cutTurn}
//     .begin({conversation, startedAt, reason})  a conversation starts (the
//                            first, `owner`, `forced`): the current file moves
//                            to old/ and a new one gets its `conversation` line
//     .apply(msg)            one room → screen message, as the bridge emits it:
//                            the turn changes in memory and, at §11.7.1's write
//                            points, one line is appended
//     .retain(now)           step 4-5 and old/'s 30 days (also on the timer)
//     .every(ms)             the retention timer on the room clock; .close() ends it
//     .turns(), .conversation, .startedAt
//
// Files (§11.7.1): `{stateDir}/cockpit/` 0700, `conversation.jsonl` and
// `old/*.jsonl` 0600, one JSON object per line, one write per line. Never
// written (§11.7.1, security.md §6): `text.delta` (a block is written at its
// end), `stt.*`, drafts, tool output, the seq'd buffer.
import fs from 'node:fs';
import path from 'node:path';
import * as clock from './clock.mjs';
import { isoAt } from './iso.mjs';
import { checkTurn } from './protocol.mjs';

/** §11.7.1 (pending Q-O24 a): turns and old conversations are kept this long. */
export const KEEP_MS = 30 * 24 * 3600 * 1000;
/** §11.7.1: the retention run, after the one at room start. */
export const RETAIN_EVERY_MS = 3_600_000;
/** §11.7.1 step 6 (D95): clientIds this recent go back into the once-only memory. */
export const ONCE_MS = 10 * 60 * 1000;

const TURN_STATES = new Set(['thinking', 'working', 'answering', 'stopping']);
const END_KEYS = ['state', 'at', 'forced', 'code', 'steps', 'detail'];
const TURN_NO = /^t-(\d+)$/;

export const cockpitDir = (stateDir) => path.join(stateDir, 'cockpit');
export const conversationFilePath = (stateDir) => path.join(cockpitDir(stateDir), 'conversation.jsonl');
export const oldDirPath = (stateDir) => path.join(cockpitDir(stateDir), 'old');

const ms = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : null;
};
/** A turn's age for retention (§11.7.1 step 4): its `end.at`, or `at` without an end. */
const turnTime = (t) => ms(t.end?.at) ?? ms(t.at);

/**
 * Read a conversation file: its `conversation` line (the last one, B85) and,
 * per `turnId` and per speak-up `id`, the last line (§11.7.1). A line that does
 * not parse, or parses to no known line, is skipped with one log line.
 */
export function readConversationFile(file, log = () => {}) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code !== 'ENOENT') log(`cockpit: cannot read ${path.basename(file)}: ${err.code ?? err.message}`);
    return null;
  }
  const out = { conversation: null, turns: new Map(), speakups: new Map() };
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    const o = parseLine(lines[i]);
    if (!o) {
      log(`cockpit: ${path.basename(file)} line ${i + 1} unreadable`);
      continue;
    }
    if (o.kind === 'conversation') out.conversation = { conversation: o.conversation, startedAt: o.startedAt, reason: o.reason };
    else if (o.kind === 'turn') {
      // The last line of a turnId wins; its place stays the first line's.
      out.turns.set(o.turn.turnId, o.turn);
    } else out.speakups.set(o.speakup.id, o.speakup);
  }
  return out;
}

function parseLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  if (o.kind === 'conversation') {
    return typeof o.conversation === 'string' && typeof o.startedAt === 'string' ? o : null;
  }
  if (o.kind === 'turn') return o.turn && checkTurn(o.turn).ok ? o : null;
  if (o.kind === 'speakup') return o.speakup && typeof o.speakup.id === 'string' ? o : null;
  return null;
}

const turnLine = (turn) => `${JSON.stringify({ kind: 'turn', turn })}\n`;
const conversationLine = (c) => `${JSON.stringify({ kind: 'conversation', conversation: c.conversation, startedAt: c.startedAt, reason: c.reason })}\n`;
const speakupLine = (s) => `${JSON.stringify({ kind: 'speakup', speakup: s })}\n`;

/** Write `text` to `file` whole: a `.tmp` beside it, fsync, renamed over (§11.7.1 step 5). */
function writeWhole(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

/** A free name in old/ for `conversation` (B86: c-0001 comes back after a lost session.json). */
function oldName(dir, conversation) {
  const safe = /^[A-Za-z0-9-]{1,64}$/.test(conversation ?? '') ? conversation : 'unknown';
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? `${safe}.jsonl` : `${safe}.${n}.jsonl`;
    if (!fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
}

/** The newest time a file in old/ holds (its conversation start, turns, speak-ups); else its mtime. */
function newestIn(file) {
  const read = readConversationFile(file);
  let newest = null;
  const see = (t) => { if (t !== null && (newest === null || t > newest)) newest = t; };
  if (read) {
    see(ms(read.conversation?.startedAt));
    for (const t of read.turns.values()) see(turnTime(t));
    for (const s of read.speakups.values()) see(ms(s.at));
  }
  if (newest === null) {
    try { newest = fs.statSync(file).mtimeMs; } catch { newest = null; }
  }
  return newest;
}

export function createStore({ stateDir, log = () => {} }) {
  const dir = cockpitDir(stateDir);
  const file = conversationFilePath(stateDir);
  const oldDir = oldDirPath(stateDir);
  let head = null; // {conversation, startedAt, reason}
  const turns = new Map(); // turnId → turn, in the order they started
  const speakups = new Map();
  const texts = new Map(); // turnId → Map(blockIndex → text item) for deltas
  let failed = false;
  let timer = null;

  const ensureDir = () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  function append(line) {
    try {
      ensureDir();
      // One write per line (§11.7.1), so a crash tears at most the last one.
      fs.appendFileSync(file, line, { mode: 0o600 });
      failed = false;
    } catch (err) {
      if (!failed) log(`cockpit: cannot write conversation.jsonl: ${err.code ?? err.message}`);
      failed = true;
    }
  }

  function rewrite() {
    if (!head) return;
    let text = conversationLine(head);
    for (const t of turns.values()) text += turnLine(t);
    for (const s of speakups.values()) text += speakupLine(s);
    try {
      ensureDir();
      writeWhole(file, text);
    } catch (err) {
      log(`cockpit: cannot rewrite conversation.jsonl: ${err.code ?? err.message}`);
    }
  }

  /** The current file to old/ (§11.7.1: renamed at `conversation.new`, or with no session.json). */
  function moveToOld(conversation) {
    if (!fs.existsSync(file)) return;
    try {
      fs.mkdirSync(oldDir, { recursive: true, mode: 0o700 });
      const to = oldName(oldDir, conversation);
      fs.renameSync(file, to);
      log(`cockpit: conversation ${conversation ?? '(none)'} moved to old/${path.basename(to)}`);
    } catch (err) {
      log(`cockpit: cannot move conversation.jsonl to old/: ${err.code ?? err.message}`);
    }
  }

  function reset() {
    turns.clear();
    speakups.clear();
    texts.clear();
  }

  // ------------------------------------------------------------ room start

  /**
   * §11.7.1 "At room start", steps 1-6 (step 7, the epoch, is the link's).
   * `session` is session.json's record (session.mjs readSessionFile) or null;
   * `now` the room's start time (ms).
   */
  function load({ now = clock.now(), session = null } = {}) {
    reset();
    head = null;
    // Step 1: per turnId the last line; unreadable lines skipped and logged.
    const read = readConversationFile(file, log);
    const onDisk = read?.conversation?.conversation ?? null;
    if (!session) {
      // Step 2: no session.json, a new session (§11.7); the file goes to old/ first.
      if (read) moveToOld(onDisk);
      return result(now, false);
    }
    if (!read || onDisk !== session.conversation) {
      // Step 2: the agent still has its context; the screens show `Nothing said yet.` (D118).
      log(read
        ? `cockpit: conversation.jsonl holds ${onDisk ?? 'no conversation'}, not ${session.conversation}; the conversation starts empty`
        : `cockpit: no conversation.jsonl for ${session.conversation}; the conversation starts empty`);
      if (read) moveToOld(onDisk); // B87: kept in old/, not overwritten
      head = { conversation: session.conversation, startedAt: session.startedAt, reason: 'first' };
      rewrite();
      return result(now, false);
    }
    head = read.conversation;
    let cut = false;
    for (const [id, t] of read.turns) {
      if (!t.end) {
        // Step 3 (D155): it was running when the room went; the child died with it.
        cut = true;
        const at = isoAt(now);
        t.state = 'error';
        t.end = { state: 'error', code: 'agent-exited', at };
        for (const it of t.items) {
          if (it.kind === 'prompt' && it.state === 'queued') {
            it.state = 'cancelled';
            it.why = 'not-taken';
          }
        }
        placePrompts(t.items);
      }
      turns.set(id, t);
    }
    for (const [id, s] of read.speakups) speakups.set(id, s);
    // Steps 4-5: older than 30 days out; the file rewritten one line per turn.
    dropOld(now);
    rewrite();
    return result(now, cut);
  }

  function result(now, cutTurn) {
    let lastTurn = 0;
    const clientIds = [];
    for (const t of turns.values()) {
      const m = TURN_NO.exec(t.turnId);
      if (m) lastTurn = Math.max(lastTurn, Number(m[1]));
      // Step 6 (D95): a RETRY after a restart never runs a prompt twice.
      if (t.clientId && ms(t.at) !== null && now - ms(t.at) <= ONCE_MS) clientIds.push(t.clientId);
      for (const it of t.items) {
        if (it.kind === 'prompt' && ms(it.at) !== null && now - ms(it.at) <= ONCE_MS) clientIds.push(it.clientId);
      }
    }
    return {
      conversation: head?.conversation ?? null,
      startedAt: head?.startedAt ?? null,
      turns: [...turns.values()],
      lastTurn,
      clientIds,
      cutTurn,
    };
  }

  function dropOld(now) {
    let dropped = 0;
    for (const [id, t] of turns) {
      const at = turnTime(t);
      if (at !== null && now - at > KEEP_MS) {
        turns.delete(id);
        texts.delete(id);
        dropped += 1;
      }
    }
    for (const [id, s] of speakups) {
      const at = ms(s.at);
      if (at !== null && now - at > KEEP_MS) {
        speakups.delete(id);
        dropped += 1;
      }
    }
    return dropped;
  }

  /** Retention (§11.7.1, security.md §6): at room start and every 3 600 s. */
  function retain(now = clock.now()) {
    if (dropOld(now) > 0) rewrite();
    let names = [];
    try { names = fs.readdirSync(oldDir); } catch { return; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const f = path.join(oldDir, name);
      const newest = newestIn(f);
      if (newest !== null && now - newest > KEEP_MS) {
        try {
          fs.unlinkSync(f);
          log(`cockpit: old/${name} is older than 30 days, deleted`);
        } catch (err) {
          log(`cockpit: cannot delete old/${name}: ${err.code ?? err.message}`);
        }
      }
    }
  }

  // --------------------------------------------------------- a conversation

  /** A conversation starts (§3.6, §11.7): `reason` `first`, `owner` or `forced`. */
  function begin({ conversation, startedAt, reason }) {
    if (head?.conversation === conversation) return;
    moveToOld(head?.conversation ?? readConversationFile(file)?.conversation?.conversation ?? null);
    reset();
    head = { conversation, startedAt, reason };
    rewrite();
  }

  // ------------------------------------------------------------- the fold

  /**
   * §2.2's prompt items in place: `taken` before the first item with
   * `blockIndex` ≥ `atBlock`, `queued` and `cancelled` after every other item,
   * in send order.
   */
  function placePrompts(items) {
    const produced = items.filter((it) => it.kind !== 'prompt');
    const taken = items.filter((it) => it.kind === 'prompt' && it.state === 'taken');
    const rest = items.filter((it) => it.kind === 'prompt' && it.state !== 'taken');
    const out = [...produced];
    for (const p of taken) {
      let i = out.findIndex((it) => it.kind !== 'prompt' && it.blockIndex >= p.atBlock);
      if (i < 0) i = out.length;
      out.splice(i, 0, p);
    }
    items.splice(0, items.length, ...out, ...rest);
  }

  function textItem(t, blockIndex) {
    let byBlock = texts.get(t.turnId);
    if (!byBlock) texts.set(t.turnId, (byBlock = new Map()));
    let item = byBlock.get(blockIndex);
    if (!item) {
      item = { kind: 'text', blockIndex, text: '' };
      byBlock.set(blockIndex, item);
      t.items.push(item);
      placePrompts(t.items);
    }
    return item;
  }

  const write = (t) => append(turnLine(t));

  /** One room → screen message (already redacted by the bridge, D127). */
  function apply(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'conversation.new') {
      begin({ conversation: msg.conversation, startedAt: msg.at, reason: msg.reason });
      return;
    }
    if (msg.type === 'turn.prompt') {
      if (msg.delivery === 'queued') {
        const t = turns.get(msg.turnId);
        if (!t) return;
        t.items.push({
          kind: 'prompt', clientId: msg.clientId, text: msg.text, source: msg.source,
          lang: msg.lang, about: msg.about, at: msg.at, state: 'queued',
        });
        placePrompts(t.items);
        write(t);
        return;
      }
      if (msg.from === 'queued' && msg.clientId) {
        // §3.4 "Taken as the next turn": the prompt leaves the old turn's items (B88).
        for (const old of turns.values()) {
          const i = old.items.findIndex((it) => it.kind === 'prompt' && it.clientId === msg.clientId);
          if (i >= 0) {
            old.items.splice(i, 1);
            write(old);
            break;
          }
        }
      }
      const t = {
        turnId: msg.turnId, clientId: msg.clientId ?? null, source: msg.source, lang: msg.lang ?? null,
        about: msg.about ?? null, prompt: msg.text, at: msg.at, state: 'thinking', items: [],
        ...(msg.source === 'speak-up' ? { speakup: msg.speakup } : {}),
      };
      turns.set(t.turnId, t);
      write(t);
      return;
    }
    const t = turns.get(msg.turnId);
    if (!t) return;
    switch (msg.type) {
      case 'turn.state':
        if (!t.end && TURN_STATES.has(msg.state)) t.state = msg.state;
        return;
      case 'text.delta':
        // Memory only: a reply that streams for minutes is written at its blocks' ends.
        textItem(t, msg.blockIndex).text += msg.text;
        return;
      case 'text.block':
        textItem(t, msg.blockIndex).text = msg.text;
        write(t);
        return;
      case 'tool.start':
        t.items.push({
          kind: 'tool', blockIndex: msg.blockIndex, toolUseId: msg.toolUseId, tool: msg.tool,
          input: msg.input, startedAt: msg.startedAt,
        });
        placePrompts(t.items);
        return;
      case 'tool.end': {
        const it = t.items.find((x) => x.kind === 'tool' && x.toolUseId === msg.toolUseId);
        if (!it) return;
        it.endedAt = msg.endedAt;
        it.isError = msg.isError === true;
        if (msg.denied === true) it.denied = true; // B89
        write(t);
        return;
      }
      case 'prompt.taken': {
        const it = t.items.find((x) => x.kind === 'prompt' && x.clientId === msg.clientId);
        if (!it) return; // taken as the next turn: it is that turn's own prompt
        it.state = msg.state;
        delete it.atBlock;
        delete it.why;
        if (msg.state === 'taken') it.atBlock = msg.atBlock;
        else it.why = msg.why;
        placePrompts(t.items);
        write(t);
        return;
      }
      case 'turn.end': {
        const end = {};
        for (const k of END_KEYS) if (msg[k] !== undefined) end[k] = msg[k];
        t.state = msg.state;
        t.end = end;
        texts.delete(t.turnId);
        write(t);
        return;
      }
      default:
    }
  }

  return {
    load,
    begin,
    apply,
    retain,
    every(everyMs = RETAIN_EVERY_MS) {
      if (timer) clock.clearInterval(timer);
      timer = clock.setInterval(() => retain(clock.now()), everyMs);
      timer.inner?.unref?.();
      return timer;
    },
    close() {
      if (timer) clock.clearInterval(timer);
      timer = null;
    },
    turns: () => [...turns.values()],
    get conversation() { return head?.conversation ?? null; },
    get startedAt() { return head?.startedAt ?? null; },
  };
}
