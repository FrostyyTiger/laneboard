// The room link's message checks (spec protocols.md §2.4, D98, D136; the
// protocol itself is docs/cockpit/protocol.md). Every message of §2.4, both
// ways, is one entry of SCREEN or ROOM below: its fields, required, nullable,
// conditional ("with X": required in that case and absent otherwise) or
// optional, each with the value rule of the section §2.4 names. Unknown fields
// are ignored both ways (§2.1), so a newer room can talk to an older page.
//
//   checkMessage(msg, dir, opts)  dir 'in' (screen → room) or 'out' (room →
//                                 screen) → {ok:true} or {ok:false, code,
//                                 field, message}; code 'bad-message' or
//                                 'unknown-type' (§2.3); `message` names the
//                                 field, as `focus.inSight: more than 60 ids`
//   checkItem(item, opts)         one turn item (`json item`, §2.4)
//   checkTurn(turn, opts)         one turn of `snapshot.turns`/`history.turns`
//   SCREEN_TYPES, ROOM_TYPES      the types the room knows, per direction
//
// `opts`: `maxPromptChars` (config, default 8000, D30) and `languages`
// (`cockpit.stt.language` as a list; unset: any language code).
//
// The checks are about shape, not state: a `turnId` the room does not hold is
// `unknown-id` and a `stop` with no running turn `not-now` (§2.3), both the
// link handler's (T13), never this module's.

export const MAX_PROMPT_CHARS = 8000;

// eslint-disable-next-line no-control-regex
const CONTROL_RX = /[\u0000-\u001f\u007f]/;
// ISO 8601 with offset (D59), seconds and milliseconds optional.
const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
// The ids the room and the screens make: `t-0132`, `card-0004`, `r-5f2c9a` …
const ID_RX = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const LANG_RX = /^(?:auto|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/;
const MAX_SEL = 300; // public/js/core/router.js MAX_SEL (c3-see.md §8.1)
const MAX_Q = 200; // router.js MAX_Q
const MAX_IN_SIGHT = 60; // c3-see.md §8.1
const MAX_NODE_ID = 128; // c3-see.md §8.1

// ---------------------------------------------------------------- value rules
// A rule takes (value, ctx) and returns null when the value is good, else the
// reason, which follows the field's path in the error message.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const str = (max = 1_000_000, min = 0) => (v) => {
  if (typeof v !== 'string') return 'not a string';
  if (v.length < min) return min === 1 ? 'empty' : `shorter than ${min} characters`;
  if (v.length > max) return `longer than ${max} characters`;
  return null;
};
/** One line of text: no control characters. */
const line = (max = 1_000_000, min = 0) => (v) => str(max, min)(v) ?? (CONTROL_RX.test(v) ? 'has a control character' : null);
const rx = (re, what) => (v) => (typeof v !== 'string' ? 'not a string' : re.test(v) ? null : `not ${what}`);
const oneOf = (...values) => (v) => (values.includes(v) ? null : `not one of ${values.join(', ')}`);
const int = (min = 0, max = Number.MAX_SAFE_INTEGER) => (v) => {
  if (!Number.isInteger(v)) return 'not an integer';
  if (v < min || v > max) return max === Number.MAX_SAFE_INTEGER ? `below ${min}` : `not ${min} to ${max}`;
  return null;
};
const num = (min = 0) => (v) => (typeof v !== 'number' || !Number.isFinite(v) ? 'not a number' : v < min ? `below ${min}` : null);
const bool = (v) => (typeof v === 'boolean' ? null : 'not true or false');
const obj = (v) => (isObj(v) ? null : 'not an object');
const iso = (v) => (typeof v !== 'string' || !ISO_RX.test(v) || Number.isNaN(Date.parse(v)) ? 'not an ISO 8601 time with offset' : null);
const epochMs = int(0);
const id = rx(ID_RX, 'an id');
const lang = (v, ctx) => {
  const bad = rx(LANG_RX, 'a language code')(v);
  if (bad) return bad;
  return ctx.languages && !ctx.languages.includes(v) ? `not one of ${ctx.languages.join(', ')}` : null;
};
const nodeId = line(MAX_NODE_ID, 1);
/** A list whose every element passes `rule`; the element's index joins the path. */
const list = (rule, max = Infinity, noun = 'entries') => {
  const r = (v, ctx, path) => {
    if (!Array.isArray(v)) return 'not a list';
    if (v.length > max) return `more than ${max} ${noun}`;
    for (let i = 0; i < v.length; i++) {
      const bad = rule(v[i], ctx, `${path}[${i}]`);
      if (bad) return typeof bad === 'object' ? bad : { path: `${path}[${i}]`, reason: bad };
    }
    return null;
  };
  return r;
};
/** A nested object with its own field table; its errors carry the full path. */
const shape = (fields, extra) => (v, ctx, path) => {
  if (!isObj(v)) return 'not an object';
  return walk(v, fields, ctx, path) ?? (extra ? extra(v, ctx, path) : null);
};

// Spec values, each from the section §2.4 names.
const CLIENT_ID = rx(/^p-[0-9a-f]{8}$/, 'p- and 8 hex characters'); // §3.1
const TOOL_USE_ID = rx(/^tu-\d{2,}$/, 'tu- and a counter'); // §11.3, D102
const UTTERANCE = rx(/^u-\d{1,9}$/, 'u- and a counter'); // §6.1
const SPEAKUP_ID = rx(/^su-\d{4,}$/, 'su- and 4 digits'); // §3.9
const CONFIRM_ID = rx(/^cf-\d{4,}$/, 'cf- and 4 digits'); // §3.10
const SPEAK_ID = rx(/^sp-\d{4,}$/, 'sp- and 4 digits'); // §6.3
const DETAIL = str(120); // §3.2: at most 120 characters, drawn as text
const TURN_STATES = ['thinking', 'working', 'answering', 'stopping']; // §3.2, D56
const END_STATES = ['done', 'stopped', 'error'];
const END_CODES = ['agent-exited', 'agent-down', 'not-logged-in', 'step-limit', 'failed']; // §3.2
const STATUS_CODES = ['agent-down', 'not-logged-in', 'tools-down', 'board-down', 'agent-back']; // §3.5
const ERROR_CODES = ['bad-message', 'unknown-type', 'unknown-id', 'too-many', 'not-now', 'not-yours', 'not-a-person', 'too-late']; // §2.3
const REFUSED_CODES = ['agent-down', 'too-many', 'audit-unavailable']; // §3.1
// `in use` is §4's; the Wall's galaxy adds three (B00, docs/wall.md "Show commands").
const SKIP_WHYS = ['in use', 'unsupported', 'not drawn', 'bad-args'];
const SHOW_STATES = ['shown', 'waiting', 'skipped', 'noCamera'];
const SHOW_LINE_STATES = [...SHOW_STATES, 'undone', 'replaced', 'failed']; // c4-show-canvas.md §4
const CARD_SIZES = ['s', 'w', 't', 'l']; // c4-show-canvas.md §8
const CARD_FAULTS = ['not-ready', 'no-answer', 'navigated', 'too-many-messages']; // §5
const TALK_STATES = ['idle', 'listening', 'partial', 'final', 'error', 'off']; // c2-voice.md §3
const JOB_STATES = ['scheduled', 'due', 'running', 'done', 'failed', 'cancelled', 'skipped']; // coworker.md §6.1
const CONFIRM_KINDS = ['job.create', 'job.cancel', 'act'];

// ---------------------------------------------------------------- field tables
// A field is `name: rule` (required), or `name: f(rule, how)` with `how`:
//   null: true        required, may be null (§2.4's `|null`)
//   optional: true    may be missing
//   when: (msg) => b  required when b, absent otherwise (§2.4's "with X")

const f = (rule, how) => ({ rule, ...how });
const nul = (rule) => f(rule, { null: true });
const opt = (rule) => f(rule, { optional: true });
const when = (pred, rule) => f(rule, { when: pred });

// c3-see.md §8.1: the router's own keys, through parseHash's rules; keys it
// does not know are not refused (parseHash drops them; the link handler too).
const ROUTE = shape({
  view: line(32, 1),
  b: opt(line(64, 1)),
  s: opt(line(400, 1)),
  q: opt(line(MAX_Q, 1)),
  sel: opt(line(MAX_SEL, 1)),
  open: opt(oneOf('term', 'transcript')),
  run: opt(line(64, 1)),
});

/** `focus` without `type`, `seq`, `at`: what `prompt.focus` carries (§3.1). */
const FOCUS_FIELDS = {
  page: oneOf('app', 'wall'),
  route: ROUTE,
  wallState: nul(oneOf('tour', 'explore')),
  layout: nul(oneOf('wall', 'switch', 'split', 'canvas')),
  pane: oneOf('open', 'closed', 'column'),
  inSight: list(nodeId, MAX_IN_SIGHT, 'ids'),
};

// The end of a turn, as `turn.end` and a turn's `end` share it (§3.2).
const END_FIELDS = {
  state: oneOf(...END_STATES),
  at: iso,
  forced: when((m) => m.state === 'stopped', bool),
  code: when((m) => m.state === 'error', oneOf(...END_CODES)),
  steps: when((m) => m.state === 'error' && m.code === 'step-limit', int(0)),
  detail: when((m) => m.state === 'error' && (m.code === 'agent-down' || m.code === 'failed'), DETAIL),
};

const SHOW_LINE_FIELDS = {
  blockIndex: int(0),
  showId: id,
  text: str(),
  state: oneOf(...SHOW_LINE_STATES),
  skippedOn: list(line(64, 1)),
  undoable: bool,
};

const PROMPT_ITEM_FIELDS = {
  kind: oneOf('prompt'),
  clientId: CLIENT_ID,
  text: str(),
  source: oneOf('typed', 'spoken'),
  lang: nul(lang),
  about: nul(nodeId),
  at: iso,
  state: oneOf('queued', 'taken', 'cancelled'),
  atBlock: when((m) => m.state === 'taken', int(0)),
  why: when((m) => m.state === 'cancelled', oneOf('stopped', 'not-taken')),
};

const ITEMS = {
  text: { kind: oneOf('text'), blockIndex: int(0), text: str() },
  tool: {
    kind: oneOf('tool'),
    blockIndex: int(0),
    toolUseId: TOOL_USE_ID,
    tool: line(200, 1),
    input: obj,
    startedAt: iso,
    // "once the call ended": both or neither (checked in itemExtra).
    endedAt: opt(iso),
    isError: opt(bool),
    denied: opt(bool),
  },
  show: { kind: oneOf('show'), ...SHOW_LINE_FIELDS },
  prompt: PROMPT_ITEM_FIELDS,
};

function itemExtra(item, ctx, path) {
  if (item.kind !== 'tool') return null;
  if (('endedAt' in item) !== ('isError' in item)) return { path: `${path}.${'endedAt' in item ? 'isError' : 'endedAt'}`, reason: 'missing' };
  if (item.denied === true && item.isError !== true) return { path: `${path}.isError`, reason: 'not true with denied' };
  return null;
}

const ITEM = (v, ctx, path) => {
  if (!isObj(v)) return 'not an object';
  const fields = ITEMS[v.kind];
  if (!fields) return { path: `${path}.kind`, reason: `not one of ${Object.keys(ITEMS).join(', ')}` };
  return walk(v, fields, ctx, path) ?? itemExtra(v, ctx, path);
};

const TURN_FIELDS = {
  turnId: id,
  clientId: nul(CLIENT_ID),
  source: oneOf('typed', 'spoken', 'speak-up'),
  lang: nul(lang),
  about: nul(nodeId),
  prompt: str(),
  at: iso,
  state: oneOf(...TURN_STATES, ...END_STATES),
  items: list(ITEM),
  end: when((t) => END_STATES.includes(t.state), shape(END_FIELDS)),
  speakup: when((t) => t.source === 'speak-up', SPEAKUP_ID),
};
const TURN = shape(TURN_FIELDS, (t, ctx, path) => (
  t.end && t.end.state !== t.state ? { path: `${path}.end.state`, reason: `not the turn's state ${t.state}` } : null
));

// c4-show-canvas.md §3.4: a pin is a card's shape with `node` in place of `size`.
const PIN = shape({ id, node: nodeId, block: line(32, 1), title: str(200), by: line(64, 1), at: iso, fields: obj });
const CARD = shape({
  id,
  block: line(32, 1),
  title: str(200),
  size: oneOf(...CARD_SIZES),
  by: line(64, 1),
  at: iso,
  fields: obj,
  rev: when((c) => c.block === 'custom', int(1)),
  leavesAt: opt(iso),
  grownFrom: opt(oneOf(...CARD_SIZES)),
});

const STATUS = shape({ code: oneOf(...STATUS_CODES), since: iso, detail: opt(DETAIL), blocksSend: opt(bool) });

const SPEAKUP_FIELDS = {
  id: SPEAKUP_ID,
  at: iso,
  tier: oneOf('info', 'needs-you', 'urgent'),
  items: list(shape({
    key: line(300, 1),
    kind: line(32, 1),
    priority: nul(oneOf('P1', 'P2', 'P3', 'P4')),
    target: nul(nodeId),
    builder: nul(line(64, 1)),
    text: line(120),
    since: iso,
    cleared: nul(iso),
    card: nul(id),
  })),
  held: bool,
  agent: oneOf('pending', 'down', 'capped', 'answered'),
  cap: when((m) => m.agent === 'capped', int(1)),
  until: when((m) => m.agent === 'capped', iso),
};

const JOB = shape({
  id,
  kind: oneOf('remind', 'script'),
  title: line(60, 1),
  script: when((j) => j.kind === 'script', line(64, 1)),
  target: nul(nodeId),
  at: iso,
  state: oneOf(...JOB_STATES),
  createdBy: line(64, 1),
  createdAt: iso,
  confirmedBy: nul(line(64, 1)),
  turnId: nul(id),
  card: nul(id),
  firedAt: nul(iso),
  endedAt: nul(iso),
  exit: nul(int(-1_000_000)),
});

const CONFIRM_STATE_FIELDS = {
  confirmId: CONFIRM_ID,
  state: oneOf('open', 'yes', 'no', 'timeout', 'gone'),
  screen: line(64, 1),
  kind: oneOf(...CONFIRM_KINDS),
  job: nul(id),
};

const ROOM_SEQ = int(1);
const LINK_SEQ = int(1);

/** Screen → room (§2.4's first table); every one carries the link's `seq`. */
const SCREEN = {
  hello: {
    seq: LINK_SEQ, page: oneOf('app', 'wall'), protocol: int(1),
    // "both or neither": checked in SCREEN_EXTRA.
    epoch: opt(id), lastSeq: opt(int(0)),
  },
  prompt: {
    seq: LINK_SEQ,
    clientId: CLIENT_ID,
    text: (v, ctx) => {
      if (typeof v !== 'string') return 'not a string';
      if (v.trim() === '') return 'empty';
      return v.length > ctx.maxPromptChars ? `longer than ${ctx.maxPromptChars} characters` : null;
    },
    // A screen never sends `speak-up` (§3.1).
    source: oneOf('typed', 'spoken'),
    lang: nul(lang),
    about: nul(nodeId),
    sentAt: epochMs,
    focus: shape(FOCUS_FIELDS),
  },
  stop: { seq: LINK_SEQ, turnId: id },
  new: { seq: LINK_SEQ },
  history: { seq: LINK_SEQ, before: id, count: int(1, 50) },
  focus: { seq: LINK_SEQ, at: iso, ...FOCUS_FIELDS },
  touched: { seq: LINK_SEQ, at: iso },
  'show.result': {
    seq: LINK_SEQ, showId: id, state: oneOf(...SHOW_STATES),
    why: when((m) => m.state === 'skipped', oneOf(...SKIP_WHYS)),
  },
  undo: { seq: LINK_SEQ, showId: id },
  'pin.close': { seq: LINK_SEQ, pin: id },
  'pin.restore': { seq: LINK_SEQ, pin: id },
  'card.close': { seq: LINK_SEQ, card: id },
  'card.restore': { seq: LINK_SEQ, card: id },
  'card.front': { seq: LINK_SEQ, card: id },
  'card.tick': { seq: LINK_SEQ, card: id, row: int(0), ticked: bool },
  'card.size': { seq: LINK_SEQ, card: id, size: oneOf(...CARD_SIZES) },
  'card.render': { seq: LINK_SEQ, card: id, rev: int(1), readyMs: int(0), minFontPx: num(0), overflow: bool },
  'card.fault': { seq: LINK_SEQ, card: id, rev: int(1), why: oneOf(...CARD_FAULTS) },
  'audio.start': { seq: LINK_SEQ, utterance: UTTERANCE, lang, format: oneOf('pcm-s16le-16000-1') },
  'audio.stop': { seq: LINK_SEQ, utterance: UTTERANCE, reason: oneOf('send', 'fix', 'limit') },
  'audio.cancel': { seq: LINK_SEQ, utterance: UTTERANCE },
  'talk.state': { seq: LINK_SEQ, request: id, talk: oneOf(...TALK_STATES) },
  'confirm.ask': { seq: LINK_SEQ, kind: oneOf('job.cancel'), job: id },
  'confirm.answer': { seq: LINK_SEQ, confirmId: CONFIRM_ID, answer: oneOf('yes', 'no'), typed: nul(str(200)) },
  'speak.result': {
    seq: LINK_SEQ, speakId: SPEAK_ID, state: oneOf('played', 'stopped', 'muted', 'busy', 'blocked', 'failed'),
    why: when((m) => m.state === 'failed', oneOf('fetch', 'decode')),
  },
  'voice.set': { seq: LINK_SEQ, on: bool },
};

const SCREEN_EXTRA = {
  hello: (m) => (('epoch' in m) !== ('lastSeq' in m) ? { path: 'hello.' + ('epoch' in m ? 'lastSeq' : 'epoch'), reason: 'missing (epoch and lastSeq go together)' } : null),
};

/** Room → screen (§2.4's second table). */
const ROOM = {
  welcome: {
    re: LINK_SEQ,
    protocol: int(1),
    screen: line(64, 1),
    epoch: id,
    seq: int(0),
    conversation: id,
    resume: oneOf('replay', 'snapshot'),
    config: shape({
      stt: oneOf('on', 'none'),
      languages: list(lang),
      maxPromptChars: int(1),
      tts: opt(bool),
    }),
    status: nul(STATUS),
    lookedAt: iso,
    now: iso,
  },
  snapshot: {
    seq: int(0),
    part: int(1),
    parts: int(1),
    conversation: id,
    startedAt: iso,
    olderTurns: int(0),
    turns: list(TURN),
    pins: list(PIN),
    cards: list(CARD),
    screens: opt(list(shape({ event: oneOf('paired', 'unpaired'), name: line(64, 1), at: iso }), 20)),
    speakups: opt(list(shape(SPEAKUP_FIELDS))),
    jobs: opt(list(JOB)),
    confirm: f(shape(CONFIRM_STATE_FIELDS), { optional: true, null: true }),
  },
  heartbeat: { at: iso },
  error: { re: LINK_SEQ, code: oneOf(...ERROR_CODES), message: str(500) },
  revoked: { at: iso },
  'turn.prompt': {
    // Absent only on the once-only repeat (D95).
    seq: opt(ROOM_SEQ),
    turnId: id,
    clientId: nul(CLIENT_ID),
    screen: nul(line(64, 1)),
    text: str(),
    source: oneOf('typed', 'spoken', 'speak-up'),
    lang: nul(lang),
    about: nul(nodeId),
    at: iso,
    receivedAt: epochMs,
    delivery: oneOf('new', 'queued'),
    speakup: when((m) => m.source === 'speak-up', SPEAKUP_ID),
    from: opt(oneOf('queued')),
  },
  'prompt.refused': { re: LINK_SEQ, clientId: CLIENT_ID, code: oneOf(...REFUSED_CODES) },
  'turn.state': { seq: ROOM_SEQ, turnId: id, state: oneOf(...TURN_STATES) },
  'text.delta': { seq: ROOM_SEQ, turnId: id, blockIndex: int(0), text: str(), sentAt: epochMs },
  'text.block': { seq: ROOM_SEQ, turnId: id, blockIndex: int(0), text: str() },
  'tool.start': {
    seq: ROOM_SEQ, turnId: id, blockIndex: int(0), toolUseId: TOOL_USE_ID, tool: line(200, 1), input: obj, startedAt: iso,
  },
  'tool.end': { seq: ROOM_SEQ, turnId: id, toolUseId: TOOL_USE_ID, endedAt: iso, isError: bool, denied: bool },
  'turn.retrying': { seq: ROOM_SEQ, turnId: id, attempt: int(1), of: int(1) },
  'turn.end': { seq: ROOM_SEQ, turnId: id, ...END_FIELDS },
  'prompt.taken': {
    seq: ROOM_SEQ, turnId: id, clientId: CLIENT_ID, state: oneOf('taken', 'cancelled'),
    atBlock: when((m) => m.state === 'taken', int(0)),
    why: when((m) => m.state === 'cancelled', oneOf('stopped', 'not-taken')),
  },
  status: { seq: ROOM_SEQ, status: nul(STATUS) },
  'conversation.new': { seq: ROOM_SEQ, conversation: id, reason: oneOf('owner', 'forced'), at: iso },
  'screen.paired': { seq: ROOM_SEQ, name: line(64, 1), at: iso },
  'screen.unpaired': { seq: ROOM_SEQ, name: line(64, 1), at: iso },
  'history.turns': { re: LINK_SEQ, turns: list(TURN), olderTurns: int(0), speakups: opt(list(shape(SPEAKUP_FIELDS))) },
  speakup: { seq: ROOM_SEQ, ...SPEAKUP_FIELDS },
  'confirm.open': {
    confirmId: CONFIRM_ID,
    kind: oneOf(...CONFIRM_KINDS),
    by: oneOf('agent', 'owner'),
    turnId: nul(id),
    what: str(500, 1),
    where: str(500, 1),
    when: str(200, 1),
    why: str(1000, 1),
    verb: line(40, 1),
    destructive: bool,
    typed: nul(str(200, 1)),
    openedAt: iso,
    expiresAt: iso,
  },
  'confirm.state': { seq: ROOM_SEQ, ...CONFIRM_STATE_FIELDS },
  'job.put': { seq: ROOM_SEQ, job: JOB },
  show: { showId: id, turnId: id, cmd: line(32, 1), args: obj, receivedAt: epochMs },
  'show.line': { seq: ROOM_SEQ, turnId: id, ...SHOW_LINE_FIELDS },
  'show.undo': { showId: id },
  'pin.put': { seq: ROOM_SEQ, pin: PIN, replaced: opt(id) },
  'pin.remove': { seq: ROOM_SEQ, pin: id, by: line(64, 1) },
  'card.put': { seq: ROOM_SEQ, card: CARD, receivedAt: epochMs },
  'card.remove': { seq: ROOM_SEQ, card: id, by: line(64, 1) },
  'card.order': { seq: ROOM_SEQ, ids: list(id) },
  'card.data': { card: id, asOf: iso, data: obj },
  'card.state': { seq: ROOM_SEQ, card: id, rev: int(1), off: bool, why: oneOf(...CARD_FAULTS, 'screen-lost') },
  'stt.update': { utterance: UTTERANCE, firm: str(), tail: str(), sentAt: epochMs },
  'stt.final': { utterance: UTTERANCE, text: str(), lang: nul(lang) },
  'stt.error': { utterance: UTTERANCE, error: oneOf('stt-down', 'stt-failed'), detail: line(64, 1) },
  talk: { request: id, action: oneOf('press', 'release') },
  speak: { speakId: SPEAK_ID, turnId: id, text: str(), lang, bytes: int(0), receivedAt: epochMs },
  'speak.failed': {
    turnId: id, why: oneOf('timeout', 'refused', 'too-big', 'status', 'no-voice'),
    status: when((m) => m.why === 'status', int(100, 599)),
  },
  voice: { on: bool, night: bool, nightOn: bool },
};

const ROOM_EXTRA = {
  snapshot: (m) => (m.part > m.parts ? { path: 'snapshot.part', reason: `above parts ${m.parts}` } : null),
  // `denied:true` comes always with `isError:true` (§3.2).
  'tool.end': (m) => (m.denied && !m.isError ? { path: 'tool.end.isError', reason: 'not true with denied' } : null),
};

export const SCREEN_TYPES = Object.freeze(Object.keys(SCREEN));
export const ROOM_TYPES = Object.freeze(Object.keys(ROOM));
export const ITEM_KINDS = Object.freeze(Object.keys(ITEMS));

// ---------------------------------------------------------------- the walk

/** The first failing field of `v` against `fields`, as {path, reason}, or null. */
function walk(v, fields, ctx, path) {
  for (const [name, spec] of Object.entries(fields)) {
    const { rule, null: nullable = false, optional = false, when: pred } = typeof spec === 'function' ? { rule: spec } : spec;
    const at = `${path}.${name}`;
    const has = Object.prototype.hasOwnProperty.call(v, name) && v[name] !== undefined;
    if (pred) {
      // "with X": required in that case and absent otherwise (§2.4).
      const needed = !!pred(v);
      if (!needed) {
        if (has) return { path: at, reason: 'not allowed here' };
        continue;
      }
    }
    if (!has) {
      if (optional) continue;
      return { path: at, reason: 'missing' };
    }
    if (v[name] === null) {
      if (nullable) continue;
      return { path: at, reason: 'null' };
    }
    const bad = rule(v[name], ctx, at);
    if (bad) return typeof bad === 'object' ? bad : { path: at, reason: bad };
  }
  return null;
}

function context(opts = {}) {
  return {
    maxPromptChars: Number.isInteger(opts.maxPromptChars) ? opts.maxPromptChars : MAX_PROMPT_CHARS,
    languages: Array.isArray(opts.languages) ? opts.languages : null,
  };
}

const ok = Object.freeze({ ok: true });
/** `found.path` starts with `prefix` (the message type, `item` or `turn`) and a dot. */
function bad(found, prefix) {
  const field = found.path === prefix ? null : found.path.slice(prefix.length + 1);
  return { ok: false, code: 'bad-message', field, message: `${found.path}: ${found.reason}` };
}

/**
 * Check one parsed message. `dir` 'in' is screen → room (what the room's link
 * handler receives), 'out' room → screen (what it sends, and the page reads).
 */
export function checkMessage(msg, dir, opts) {
  if (dir !== 'in' && dir !== 'out') throw new TypeError(`checkMessage: dir must be 'in' or 'out', not ${dir}`);
  if (!isObj(msg)) return { ok: false, code: 'bad-message', field: null, message: 'not a JSON object' };
  const { type } = msg;
  if (typeof type !== 'string' || !/^[a-z][a-z.]{0,31}$/.test(type)) {
    return { ok: false, code: 'bad-message', field: 'type', message: 'type: not a message type' };
  }
  const table = dir === 'in' ? SCREEN : ROOM;
  if (!Object.prototype.hasOwnProperty.call(table, type)) {
    return { ok: false, code: 'unknown-type', field: 'type', message: `type: ${type} is not a ${dir === 'in' ? 'screen' : 'room'} message` };
  }
  const ctx = context(opts);
  const found = walk(msg, table[type], ctx, type) ?? (dir === 'in' ? SCREEN_EXTRA : ROOM_EXTRA)[type]?.(msg, ctx);
  return found ? bad(found, type) : ok;
}

/** Check one turn item (`json item`, §2.4's items table). */
export function checkItem(item, opts) {
  const found = ITEM(item, context(opts), 'item');
  return found ? bad(typeof found === 'object' ? found : { path: 'item', reason: found }, 'item') : ok;
}

/** Check one turn of `snapshot.turns` or `history.turns`. */
export function checkTurn(turn, opts) {
  const found = TURN(turn, context(opts), 'turn');
  return found ? bad(typeof found === 'object' ? found : { path: 'turn', reason: found }, 'turn') : ok;
}
