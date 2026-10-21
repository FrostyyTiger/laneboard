// One session card and its ⋯ menu, drawn as an ATC-style data block (fleet
// plan §4 2.7, task D9). Moved from public/app.js (fleet F1).
//
// Every card has the same anatomy, in fixed mono columns, so the eye scans
// columns instead of reading cards:
//   line 1  code  state(lamp + 4-char word)  lane  stage n/m  flags  age
//   line 2  PR  checks  ctx %  $ 5h  model  git
// A row (a session inside a lane card) is the same fields on one line.
// Icons come first; the words go to title/aria-label.
//
// The preview, the last prompt and the assistant line are L3 detail: they sit
// in `.card-detail`, which board.css shows only for the selected card (the
// keyboard/click cursor) until the §4 inspector mounts; D6 can import
// cardDetail() to fill the inspector with the very same nodes.
//
// Pure at import time. The model functions (dataBlock, checkGlyphs, prModel,
// ctxLevel, ageText) are tested in test/board.test.mjs. Builder text goes in
// through textContent/title only.
import { el } from '../core/dom.js';
import { previewToNodes } from '../core/ansi.js';
import { STATE_LABEL, money, shortDir } from '../core/format.js';
import { laneById, store } from '../core/store.js';
import { deriveCode } from '../core/keys.js';
import { act } from '../core/actions.js';
import { icon } from '../core/icons.js';
import { itemP, markP } from '../core/marks.js';
import { lamp, plate } from '../ui/components.js';
import { toast } from '../ui/shell.js';
import { togglePin } from '../ui/dock.js';
import { QUICK_KEYS, openSheet, sendQuick } from '../ui/sheet.js';
import { cardNodes, toggleLane } from './board.js';

/** What a missing field renders as. */
export const DASH = '—';

/** The 4-character state words (plan §4 2.7). */
export const STATE_WORD = Object.freeze({
  waiting_permission: 'PERM', waiting_question: 'QUES', working: 'WORK',
  done: 'DONE', idle: 'IDLE', shell: 'SHEL', dead: 'DEAD',
});

/** Session state -> lamp `data-p` (ISA-101: colour only for abnormal). */
export const STATE_P = Object.freeze(Object.fromEntries(
  ['waiting_permission', 'waiting_question', 'working', 'done', 'idle', 'shell', 'dead'].map((st) => [st, markP(st)]),
));

const STATE_ORDER = Object.freeze({ waiting_permission: 0, waiting_question: 1, working: 2, done: 3, idle: 4, shell: 5, dead: 6 });

/** At most this many check glyphs, then `+n`. */
export const CHECKS_MAX = 6;
const CHECK_GLYPH = Object.freeze({ fail: '✗', run: '◌', pass: '●', none: '○' });
const CHECK_ORDER = Object.freeze(['fail', 'run', 'pass', 'none']);
const CHECK_WORD = Object.freeze({ fail: 'failed', run: 'running', pass: 'passed', none: 'no result' });

/** Context use -> '1' at 85 % and above, '2' at 65 %, else null (same thresholds as the v2 gauge). */
export function ctxLevel(pct) {
  if (!Number.isFinite(pct)) return null;
  if (pct >= 85) return '1';
  if (pct >= 65) return '2';
  return null;
}

/** "12m" for a timestamp, `—` when there is none. Same steps as format.ago(). */
export function ageText(ts, now = Date.now()) {
  if (!Number.isFinite(ts) || ts <= 0) return DASH;
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function checkState(v) {
  const s = String(v ?? '').toLowerCase();
  if (/^(pass|passed|success|green|ok)$/.test(s)) return 'pass';
  if (/^(fail|failed|failure|red|error|cancelled|timed_out)$/.test(s)) return 'fail';
  if (/^(run|running|pending|queued|in_progress|waiting)$/.test(s)) return 'run';
  return 'none';
}

const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * One glyph per package or job, worst first, at most CHECKS_MAX, then `+n`.
 * `src`: an array of `{name, state}` (per package/job, §6) or the PR summary's
 * counts `{passed, failed, pending}`. -> [{s, g, name?}], the last one
 * `{s:'more', g:'+n', n}` on overflow.
 */
export function checkGlyphs(src) {
  const by = { fail: [], run: [], pass: [], none: [] };
  const n = { fail: 0, run: 0, pass: 0, none: 0 };
  if (Array.isArray(src)) {
    for (const c of src) {
      const s = checkState(c && typeof c === 'object' ? (c.state ?? c.conclusion ?? c.status) : c);
      n[s]++;
      if (by[s].length < CHECKS_MAX) by[s].push(typeof c?.name === 'string' ? c.name : null);
    }
  } else if (src && typeof src === 'object') {
    n.fail = count(src.failed);
    n.run = count(src.pending);
    n.pass = count(src.passed);
  }
  const out = [];
  for (const s of CHECK_ORDER) {
    for (let i = 0; i < n[s] && out.length < CHECKS_MAX; i++) {
      const item = { s, g: CHECK_GLYPH[s] };
      if (by[s][i]) item.name = by[s][i];
      out.push(item);
    }
  }
  const total = n.fail + n.run + n.pass + n.none;
  if (total > CHECKS_MAX) out.push({ s: 'more', g: `+${total - CHECKS_MAX}`, n: total - CHECKS_MAX });
  return out;
}

/** "8 passed, 1 failed" for the checks' accessible name. */
export function checksLabel(src) {
  const n = { fail: 0, run: 0, pass: 0, none: 0 };
  if (Array.isArray(src)) for (const c of src) n[checkState(c && typeof c === 'object' ? (c.state ?? c.conclusion ?? c.status) : c)]++;
  else if (src && typeof src === 'object') { n.fail = count(src.failed); n.run = count(src.pending); n.pass = count(src.passed); }
  const parts = CHECK_ORDER.filter((s) => n[s]).map((s) => `${n[s]} ${CHECK_WORD[s]}`);
  return parts.length ? `checks: ${parts.join(', ')}` : 'no checks';
}

/** A PR summary (collector/pr.mjs shape) -> {number, state, icon, text, title, url} or null. */
export function prModel(pr) {
  if (!pr || typeof pr !== 'object' || pr.none) return null;
  if (pr.error) return { number: null, state: 'unknown', icon: 'pr', text: 'PR ?', title: String(pr.error), url: null };
  const state = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open';
  const number = Number.isInteger(pr.number) ? pr.number : null;
  return {
    number,
    state,
    icon: state === 'merged' ? 'pr-merged' : state === 'draft' ? 'pr-draft' : 'pr',
    text: number != null ? `#${number}` : DASH,
    title: `${state} PR${number != null ? ` #${number}` : ''}`,
    url: typeof pr.url === 'string' ? pr.url : null,
  };
}

function mostUrgent(sessions) {
  let best = null;
  for (const s of sessions) {
    if (!best || (STATE_ORDER[s.state] ?? 9) < (STATE_ORDER[best.state] ?? 9)) best = s;
  }
  return best;
}

function reasonOf(v) {
  if (v && typeof v === 'object') return String(v.reason ?? v.rule ?? v.scope ?? '');
  return typeof v === 'string' ? v : '';
}

/** Flags, in plan order: stuck, paused, approval, review. Grey icons: the lamp is the one trouble mark (T23). */
function flagsOf(sessions, lane, extras) {
  const flags = [];
  const stuck = sessions.find((s) => s.stuck);
  if (stuck) {
    const why = reasonOf(stuck.stuck);
    flags.push({ id: 'stuck', icon: 'stuck', p: null, title: why ? `stuck: ${why}` : 'stuck' });
  }
  const paused = sessions.find((s) => s.paused);
  if (paused) {
    const scope = paused.paused && typeof paused.paused === 'object' && paused.paused.scope ? String(paused.paused.scope) : '';
    flags.push({ id: 'paused', icon: 'pause', p: null, title: scope ? `paused (${scope})` : 'paused' });
  }
  if (sessions.some((s) => s.awaitingApproval)) flags.push({ id: 'approval', icon: 'approval', p: null, title: 'awaiting approval' });
  const rr = lane?.reviewReady ?? extras.reviewReady ?? null;
  if (rr && rr.ready === true) {
    const reasons = Array.isArray(rr.reasons) ? rr.reasons.filter((r) => typeof r === 'string') : [];
    flags.push({ id: 'review', icon: 'review', p: null, title: reasons.length ? `ready for review: ${reasons.join(' · ')}` : 'ready for review' });
  }
  return flags;
}

/**
 * The data block of a lane or a session (plan §4 2.7). Pure.
 *   lane     the store's lane (id, progress, reviewReady) or null
 *   session  one session, or null for a lane card (then extras.sessions, the
 *            lane's live sessions, give the state: the most urgent one)
 *   extras   {code, pr, checks, usd5h, stale, sessions, reviewReady, now}
 * -> {code, lane, name, state, p, word, stage, pr, checks[], ctx, ctxP,
 *     usd5h, age, flags[], model, git}. Missing values are `—` (or null/[]
 *     for the structured ones).
 */
export function dataBlock(lane, session, extras = {}) {
  const x = extras ?? {};
  const sessions = session ? [session] : (Array.isArray(x.sessions) ? x.sessions.filter((s) => s && typeof s === 'object') : []);
  const lead = session ?? mostUrgent(sessions);
  const state = typeof lead?.state === 'string' ? lead.state : null;
  // One state, one mark (runs night 4 T23): danger anywhere on the lane is
  // the red ■, an approval or a stuck session the amber ▲, else the lead's state.
  let p = state ? markP(state) : 'off';
  for (const x of sessions) {
    const q = itemP(x);
    if (q === '1' || (q === '2' && p !== '1')) p = q;
  }
  if (x.stale) p = 'stale';
  const prog = lane?.progress;
  const pct = lead?.context?.usedPct;
  const usd = Number.isFinite(x.usd5h) ? x.usd5h : Number.isFinite(lead?.cost?.usd5h) ? lead.cost.usd5h : null;
  const code = typeof x.code === 'string' && x.code ? x.code : DASH;
  return {
    code,
    lane: (typeof lane?.id === 'string' && lane.id) || (typeof session?.name === 'string' && session.name) || DASH,
    name: typeof lead?.name === 'string' ? lead.name : null,
    state,
    p,
    word: state ? (STATE_WORD[state] ?? state.slice(0, 4).toUpperCase()) : DASH,
    stage: prog && prog.m != null ? `${prog.n ?? 0}/${prog.m}` : DASH,
    pr: prModel(x.pr),
    checks: checkGlyphs(x.checks ?? x.pr?.checks ?? null),
    ctx: Number.isFinite(pct) ? `${Math.round(pct)}%` : DASH,
    ctxP: ctxLevel(pct),
    usd5h: usd == null ? DASH : money(usd),
    age: ageText(lead?.stateSince, x.now ?? Date.now()),
    flags: flagsOf(sessions, lane, x),
    model: typeof lead?.claude?.model === 'string' && lead.claude.model ? lead.claude.model : (typeof x.model === 'string' && x.model ? x.model : DASH),
    git: { dirty: count(lead?.dirty), ahead: count(lead?.ahead), behind: count(lead?.behind) },
  };
}

// ---------------------------------------------------------------- builders

/** The builder behind a session, when the store knows it. */
export function builderOf(s) {
  return s?.builder ? store.builders.get(s.builder) ?? null : null;
}

/** A builder's short code plate: its own, else derived from its id. */
export function builderCode(b) {
  return (b && typeof b.code === 'string' && b.code) || deriveCode(b?.id ?? '');
}

/** True when the session's builder is not live (hub: stale, down). */
export function builderStale(s) {
  const b = builderOf(s);
  return Boolean(b) && store.source.kind === 'hub' && (b.status === 'stale' || b.status === 'down');
}

/** Show the code column only when there is more than one builder (one builder: no plate). */
export function showCodes() {
  return store.builders.size > 1;
}

// ---------------------------------------------------------------- the data block, as DOM

function field(cls, text, title) {
  const n = el('span', `db-f ${cls}`, text);
  if (title) n.title = title;
  return n;
}

/** The fields, by name. Each returns one node in its fixed column. */
export const FIELDS = Object.freeze({
  code: (db, o) => {
    const n = el('span', 'db-f db-code');
    if (o.showCode) n.append(plate(db.code, { title: o.builder ?? null }));
    return n;
  },
  state: (db) => {
    const n = el('span', 'db-f db-state');
    n.dataset.p = db.p;
    const long = db.state ? (STATE_LABEL[db.state] || db.state) : 'no live session';
    n.append(lamp(db.p, { label: long }), el('span', 'db-word', db.word));
    n.title = long;
    return n;
  },
  lane: (db, o) => field('db-lane', db.lane, o.laneTitle ?? db.lane),
  stage: (db, o) => field('db-stage', db.stage, o.stageTitle ?? (db.stage === DASH ? 'no plan stages' : `stage ${db.stage}`)),
  flags: (db) => {
    const n = el('span', 'db-f db-flags');
    for (const f of db.flags) {
      const i = el('span', `db-flag flag-${f.id}`);
      if (f.p) i.dataset.p = f.p;
      i.title = f.title;
      i.append(icon(f.icon, { size: 's', label: f.title }));
      n.append(i);
    }
    return n;
  },
  age: (db, o) => field('db-age', db.age, o.ageTitle ?? 'time in this state'),
  pr: (db) => {
    const n = el('span', 'db-f db-pr');
    if (db.pr) {
      n.dataset.state = db.pr.state;
      n.append(icon(db.pr.icon, { size: 's' }), el('span', 'db-pr-n', db.pr.text));
      n.title = db.pr.title;
    } else {
      n.append(el('span', 'db-pr-n', DASH));
      n.title = 'no PR';
    }
    return n;
  },
  checks: (db, o) => {
    const n = el('span', 'db-f db-checks');
    if (!db.checks.length) n.textContent = DASH;
    for (const c of db.checks) {
      const g = el('span', `ck ck-${c.s}`, c.g);
      if (c.name) g.title = `${c.name}: ${CHECK_WORD[c.s] ?? ''}`;
      n.append(g);
    }
    n.setAttribute('role', 'img');
    n.setAttribute('aria-label', o.checksLabel ?? (db.checks.length ? 'checks' : 'no checks'));
    n.title = o.checksLabel ?? '';
    return n;
  },
  ctx: (db, o) => {
    const n = field('db-ctx', `ctx ${db.ctx}`, o.ctxTitle ?? 'context used');
    if (db.ctxP) n.dataset.p = db.ctxP;
    return n;
  },
  usd: (db, o) => field('db-usd', db.usd5h, o.usdTitle ?? 'API-equivalent spend, last 5 hours'),
  model: (db) => field('db-model', db.model, 'model'),
  git: (db) => {
    const n = el('span', 'db-f db-git');
    const { dirty, ahead, behind } = db.git;
    if (ahead) n.append(el('span', 'ahead', `↑${ahead}`));
    if (behind) n.append(el('span', 'ahead', `↓${behind}`));
    if (dirty) n.append(el('span', 'dirty', `●${dirty}`));
    n.title = `${dirty} uncommitted, ${ahead} ahead, ${behind} behind`;
    return n;
  },
});

/** Field order per line (plan §4 2.7). */
export const LAYOUT = Object.freeze({
  line1: Object.freeze(['code', 'state', 'lane', 'stage', 'flags', 'age']),
  line2: Object.freeze(['pr', 'checks', 'ctx', 'usd', 'model', 'git']),
  row: Object.freeze(['code', 'state', 'lane', 'stage', 'pr', 'checks', 'ctx', 'usd', 'age', 'flags']),
});

/**
 * True when a field has nothing to show: it is left out of the line instead of
 * printing `—` (runs night 4 T15, r10 Board 2). The code plate hides by CSS
 * when empty; state, lane and flags are always drawn. Pure.
 */
export function emptyField(db, name) {
  switch (name) {
    case 'stage': return db.stage === DASH;
    case 'pr': return !db.pr;
    case 'checks': return !db.checks.length;
    case 'ctx': return db.ctx === DASH;
    case 'usd': return db.usd5h === DASH;
    case 'model': return db.model === DASH;
    case 'age': return db.age === DASH;
    case 'git': return !(db.git.dirty || db.git.ahead || db.git.behind);
    default: return false;
  }
}

/**
 * The card's trouble, for its lane bar: '1' (red, broken or a permission),
 * '2' (amber, a question or stuck), else null. A bar is grey unless there is
 * trouble (runs night 4 T15, r10 Board 1); a builder that is not live is grey.
 */
export function troubleOf(db) {
  if (!db || db.p === 'stale') return null;
  if (db.p === '1' || db.flags.some((f) => f.p === '1')) return '1';
  if (db.p === '2' || db.flags.some((f) => f.p === '2')) return '2';
  return null;
}

/** Put the trouble on a card node (`data-trouble`), or take it off. */
export function markTrouble(node, db) {
  const t = troubleOf(db);
  if (t) node.dataset.trouble = t;
  else delete node.dataset.trouble;
}

/** One `.db` line of the given fields, the empty ones left out. */
export function dbLine(db, names, cls, o = {}) {
  const line = el('div', `db ${cls}`);
  for (const name of names) if (!emptyField(db, name)) line.append(FIELDS[name](db, o));
  return line;
}

/** Titles for a session's fields: everything a field does not show is in its title. */
function sessionTitles(s) {
  const ctx = s.context;
  const cost = s.cost;
  return {
    builder: s.builder ?? null,
    laneTitle: [s.name, s.dir ? shortDir(s.dir) : '', s.branch ? `⌥${s.branch}` : ''].filter(Boolean).join(' · '),
    ageTitle: s.stateSince ? `${STATE_LABEL[s.state] || s.state} since ${new Date(s.stateSince).toLocaleString('en-GB')}` : 'time in this state',
    ctxTitle: ctx?.usedPct != null
      ? `context ${ctx.usedPct}%${ctx.size ? ` of ${Math.round(ctx.size / 1000)}k` : ''}`
      : 'no context reading',
    usdTitle: `API-equivalent spend, last 5 hours.${cost?.usd ? ` All time ${money(cost.usd)}, today ${money(cost.usdToday)}.` : ''}`,
  };
}

/**
 * The L3 detail of a session: where it runs, what it costs, the last prompt,
 * the assistant line and the preview. The card shows it only while selected;
 * the inspector (D6) can mount the same nodes.
 */
export function cardDetail(s) {
  const d = el('div', 'card-detail');
  const meta = el('div', 'card-meta detail-meta');
  if (s.dir) meta.append(el('span', 'dir', shortDir(s.dir)));
  if (s.branch) meta.append(el('span', 'branch', `⌥${s.branch}`));
  if (s.claude?.model) meta.append(el('span', 'model', s.claude.model));
  if (s.context?.usedPct != null) {
    meta.append(el('span', 'ctx-size', `ctx ${s.context.usedPct}%${s.context.size ? ` of ${Math.round(s.context.size / 1000)}k` : ''}`));
  }
  if (s.cost?.usd) {
    const c = el('span', 'cost', money(s.cost.usd));
    c.title = `API-equivalent, all time. Today ${money(s.cost.usdToday)}.` +
      (s.statuslineCostUsd ? ` Claude Code reports ${money(s.statuslineCostUsd)}.` : '');
    meta.append(c);
  }
  // RSS and swap moved here from the Machine view in v3.
  if (s.claude?.rssMb) {
    const mem = el('span', 'mem', `${s.claude.rssMb}MB`);
    mem.title = `resident memory${s.claude.swapMb ? `, ${s.claude.swapMb} MB swapped out` : ''}`;
    meta.append(mem);
    if (s.claude.swapMb) meta.append(el('span', 'dirty', `+${s.claude.swapMb}M swap`));
  }
  if (meta.childNodes.length) d.append(meta);

  if (s.activity?.lastUserPrompt && (s.state === 'working' || String(s.state).startsWith('waiting'))) {
    d.append(el('div', 'say say-user', `“${s.activity.lastUserPrompt}”`));
  }
  if (s.activity?.lastAssistant) d.append(el('div', 'say', s.activity.lastAssistant));

  // Raw ANSI lines on the wire (fleet F6; the old server-rendered previewHtml
  // is gone): built here as text nodes and spans, never parsed as markup.
  if (Array.isArray(s.previewLines) && s.previewLines.length) {
    const pre = el('div', 'preview');
    pre.append(...previewToNodes(s.previewLines, document));
    d.append(pre);
  }
  return d;
}

function iconButton(cls, name, label, { show = false, title = null } = {}) {
  const b = el('button', `btn ${cls}`.trim());
  b.append(icon(name, { size: 's' }), el('span', show ? 'btn-l' : 'btn-l btn-l--hide', label));
  b.setAttribute('aria-label', title ?? label);
  b.title = title ?? label;
  return b;
}

/** Card click / cursor: select this card (the brackets and the L3 detail follow `.cursor`). */
export function selectCard(k) {
  store.cursor = k;
  for (const [key, n] of cardNodes) n.classList.toggle('cursor', key === k);
}

export function renderCard(s, { row = false } = {}) {
  const k = s.key;
  const card = el('div', `card s-${s.state}${row ? ' card-row' : ''}${s.danger ? ' danger' : ''}`);
  card.dataset.key = k;
  card.dataset.row = row ? '1' : '0';
  if (store.cursor === k) card.classList.add('cursor');
  if (store.pinned.has(k)) card.classList.add('pinned');
  // One builder down in hub mode dims (and hatches) its cards; board.css
  // styles `.stale`. The global banner stays hidden.
  const stale = builderStale(s);
  if (stale) card.classList.add('stale');

  // The lane stripe: 3 px down the left edge, one stable colour per worktree.
  // A session with no repo gets NO stripe rather than a grey one. Inside a
  // lane card the card's own stripe and chip would repeat its header.
  const lane = row ? null : laneById(s.laneKey);
  if (lane) {
    card.classList.add('has-lane');
    card.style.setProperty('--lane-hue', String(lane.hue));
  }

  const b = builderOf(s);
  const db = dataBlock(null, s, { code: builderCode(b), stale });
  const o = { ...sessionTitles(s), showCode: showCodes() };
  markTrouble(card, db);
  if (row) {
    card.append(dbLine(db, LAYOUT.row, 'db-row', o));
  } else {
    const l1 = dbLine(db, LAYOUT.line1, 'db-1', o);
    // The chip names the lane the stripe stands for; a click filters by it.
    if (lane) {
      const chip = el('span', 'lane-chip', lane.id);
      chip.style.setProperty('--lane-hue', String(lane.hue));
      chip.title = `${lane.root}${lane.branch ? ` · ${lane.branch}` : ''}` +
        `${lane.sessions.length > 1 ? ` · ${lane.sessions.length} sessions` : ''}`;
      chip.onclick = (e) => { e.stopPropagation(); toggleLane(lane.key ?? lane.id); };
      l1.insertBefore(chip, l1.children?.[3] ?? null);
    }
    const l2 = dbLine(db, LAYOUT.line2, 'db-2', o);
    // A line with nothing to say is left out, not a row of gaps.
    card.append(l1, ...(l2.children.length ? [l2] : []));
  }

  // The guard's finding, above everything else on the card (v3).
  if (s.danger) {
    const dg = el('div', 'marker-line mk-danger');
    dg.append(el('span', 'mk-kind', 'danger'));
    dg.append(el('span', 'mk-text', s.danger.reason));
    card.append(dg);
  }

  // One activity line, never two. A running tool wins it — that is what the
  // session is doing *now*; when nothing runs the last marker takes the slot,
  // so a NEED-HUMAN is never invisible on an idle card.
  if (s.activity?.tool) {
    const t = el('div', 'tool-line');
    t.append(el('span', 'tname', s.activity.tool));
    if (s.activity.toolInput) t.append(el('span', 'targ', s.activity.toolInput));
    if (s.lastMarker) t.title = `last marker — ${s.lastMarker.kind}: ${s.lastMarker.text}`;
    card.append(t);
  } else if (s.lastMarker) {
    const mk = el('div', `marker-line mk-${s.lastMarker.kind}`);
    mk.append(el('span', 'mk-kind', s.lastMarker.kind));
    mk.append(el('span', 'mk-text', s.lastMarker.text));
    mk.title = `${s.lastMarker.source} · ${new Date(s.lastMarker.ts).toLocaleString('en-GB')}`;
    card.append(mk);
  }

  card.append(cardDetail(s));

  const actions = el('div', 'card-actions');
  if (s.state === 'waiting_permission' || s.state === 'waiting_question') {
    const yes = iconButton('ok', 'approve', 'Yes', { show: true, title: 'Answer yes' });
    yes.onclick = () => sendQuick(k, QUICK_KEYS.yes, 'Yes');
    const no = iconButton('no', 'deny', 'No', { show: true, title: 'Answer no' });
    no.onclick = () => sendQuick(k, QUICK_KEYS.no, 'No');
    actions.append(yes, no);
  }
  const open = iconButton('btn-open', 'terminal', 'open', { title: 'Open the terminal' });
  open.onclick = () => openSheet(k);
  const pinned = store.pinned.has(k);
  const pin = iconButton(pinned ? 'on' : '', 'pin', pinned ? 'pinned' : 'pin', { title: pinned ? 'Unpin from the dock' : 'Pin to the dock' });
  pin.onclick = () => togglePin(k);
  const more = iconButton('btn-more', 'more', 'more', { title: 'Send text, restart, kill' });
  more.setAttribute('aria-label', 'More actions');
  more.onclick = (e) => { e.stopPropagation(); toggleMenu(card, s); };
  actions.append(open, pin, more);
  card.append(actions);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    selectCard(k);
  });

  return card;
}

/** The ⋯ menu: the actions that are too destructive for a one-tap button. */
export function toggleMenu(card, s) {
  const existing = card.querySelector('.menu');
  closeMenus();
  if (existing) return;

  const menu = el('div', 'menu');
  const item = (label, cls, fn) => {
    const b = el('button', cls || null, label);
    b.onclick = (e) => { e.stopPropagation(); closeMenus(); fn(); };
    menu.append(b);
  };

  const k = s.key;
  item('Send text…', null, async () => {
    const text = globalThis.prompt(`Send to ${s.name}:`);
    if (text?.trim()) {
      const r = await act(k, 'send-text', { text: text.trim(), enter: true });
      if (actOk(r)) toast(`Sent → ${s.name}`);
    }
  });
  item('Open terminal', null, () => openSheet(k));
  item(store.pinned.has(k) ? 'Unpin' : 'Pin to dock', null, () => togglePin(k));
  item('Restart (resume)', null, async () => {
    if (!globalThis.confirm(`Restart ${s.name}? It resumes the same conversation.`)) return;
    const r = await act(k, 'restart');
    if (actOk(r)) toast(`Restarting ${s.name}…`);
  });
  item('Kill session', 'danger', async () => {
    if (!globalThis.confirm(`Kill ${s.name}? This cannot be undone.`)) return;
    const r = await act(k, 'kill');
    if (actOk(r)) toast(`Killed ${s.name}`);
  });

  card.append(menu);
}

/** An act() result: true on success; a failure or an unknown outcome is said in a toast. */
export function actOk(r) {
  if (r?.ok === true) return true;
  if (r?.ok === 'unknown') toast('Sent, outcome unknown');
  else toast(`Failed: ${r?.error ?? 'no answer'}`);
  return false;
}

export function closeMenus() {
  for (const m of document.querySelectorAll('.menu')) m.remove();
}
