// Merge every collector into the Session objects the UI and CLI consume (plan §2.1).
import { config } from './config.mjs';
import { log } from './log.mjs';
import { truncate, stripAnsi, isBlankLine } from './util.mjs';
import * as tmux from './collector/tmux.mjs';
import * as registry from './collector/registry.mjs';
import * as statusline from './collector/statusline.mjs';
import * as git from './collector/git.mjs';
import * as lanes from './collector/lanes.mjs';
import * as progress from './collector/progress.mjs';
import * as markers from './collector/markers.mjs';
import * as ratelimits from './collector/ratelimits.mjs';
import * as vitals from './collector/vitals.mjs';
import * as guard from './collector/guard.mjs';
import * as transcripts from './collector/transcripts.mjs';
import * as push from './push.mjs';
import * as db from './db.mjs';

export const STATES = [
  'waiting_permission', 'waiting_question', 'working', 'done', 'idle', 'shell', 'dead',
];

const ATTENTION_SCORE = {
  waiting_permission: 100,
  waiting_question: 90,
};

/**
 * Score per plan §2.2, with the amendment agreed during the Stage 4 review:
 * a finished session drops OUT of the queue after 24 h instead of sitting
 * there at 20 forever. On this box the original rule listed 13 of 17 sessions,
 * which made the queue useless. waiting_* is unchanged.
 */
const HOUR = 60 * 60 * 1000;
/** Added to a stuck session that is not already waiting (fleet §7). */
export const STUCK_BONUS = 40;
export function attentionScore(session, now = Date.now()) {
  // v3: the dev-stack guard outranks everything, a permission prompt included.
  if (session.danger) return 1000;
  // A held approval (decorated `awaitingApproval`, fleet §8) is a permission
  // prompt for the queue's purposes; the state word itself is not changed.
  const state = session.awaitingApproval ? 'waiting_permission' : session.state;
  const base = ATTENTION_SCORE[state];
  if (base) return base;
  let score = 0;
  if (state === 'done' && session.activity?.lastAssistant) {
    const age = now - (session.stateSince ?? now);
    if (age < 2 * HOUR) score = 50;
    else if (age < 24 * HOUR) score = 20;
  }
  // Decorated `stuck` (fleet §7): raised, but never above a waiting session.
  if (session.stuck) score += STUCK_BONUS;
  return score;
}

/** Card preview on the wire: the last 8 non-blank lines, raw ANSI. */
export const PREVIEW_LINES = 8;
export const PREVIEW_LINE_CHARS = 400;

/**
 * Raw pane lines -> `previewLines` (fleet F6): blanks dropped, the last
 * PREVIEW_LINES kept, each right-trimmed and sliced to PREVIEW_LINE_CHARS.
 * The client renders them with public/js/core/ansi.js; no HTML is built here.
 */
export function previewLinesOf(lines) {
  return (Array.isArray(lines) ? lines : [])
    .filter((l) => typeof l === 'string' && !isBlankLine(l))
    .slice(-PREVIEW_LINES)
    .map((l) => l.replace(/\s+$/, '').slice(0, PREVIEW_LINE_CHARS));
}

/**
 * Pane-content heuristic — the last resort when no hook and no registry status.
 * Looks at the last ~15 rendered lines of the pane.
 */
export function paneHeuristic(lines) {
  // Claude's TUI leaves blank rows below its prompt box, and `capture-pane -e`
  // colours each word separately — strip escapes, then look at the last 15
  // non-blank lines.
  const tail = lines.map(stripAnsi).filter((l) => l.trim()).slice(-15);
  const text = tail.join('\n');
  if (/Do you want|❯\s*1\.\s*Yes|\bAllow\b|Would you like to proceed|Enter to confirm/i.test(text)) return 'waiting_permission';
  // A spinner line looks like "✻ Composing… (31m 33s · ↓ 26.3k tokens)". A bare
  // "✻ Cooked for 40s" is the *finished* marker, so require the ellipsis + timer.
  if (/esc to interrupt|to run in background\)|[✻✽✶✳✢⠋⠙⠹*]\s*\S+…\s*\(\d/i.test(text)) return 'working';
  for (let i = tail.length - 1; i >= 0; i--) {
    if (/^\s*[❯>]\s*$/.test(tail[i]) || /^\s*[❯>]\s+\S/.test(tail[i])) return 'done';
  }
  return null;
}

/**
 * Is a freshly spawned session ready to be typed into?
 * A brand-new Claude in an untrusted directory sits on "Is this a project you
 * created or one you trust?" — typing a prompt there answers the DIALOG, not
 * Claude. `ADCS project` has been stuck on exactly that for 13 days.
 */
export function promptReadiness(lines) {
  const text = lines.map(stripAnsi).filter((l) => l.trim()).slice(-25).join('\n');
  if (!text) return 'unknown';
  if (/trust this folder|Is this a project you created|Yes, I trust/i.test(text)) return 'trust_dialog';
  if (/Do you want|Would you like to proceed/i.test(text)) return 'dialog';
  // The empty input box at the bottom of a settled TUI.
  if (/^\s*[❯>]\s*$/m.test(text)) return 'ready';
  // Claude 2.1.2xx paints a dim suggestion into the empty box
  // (`❯ Try "how do I log an error?"`), so the box is never bare. The dim SGR
  // straight after the prompt char is what says "placeholder, not typed text";
  // it only survives in the raw ANSI lines, not in `text`.
  if (lines.slice(-25).some((l) => /[❯>][\s\u00a0]*\x1b\[2m\S/.test(String(l)))) return 'ready';
  return 'not_ready';
}

const HOOK_STALE_MS = 10 * 60 * 1000;

/**
 * Priority: hooks > registry > pane heuristic (plan §2.2).
 * `hook` is { state, at, tool, lastAssistant } or null.
 */
export function deriveState({ hook, registryStatus, paneCmd, claudeAlive, paneLines, now = Date.now() }) {
  if (paneCmd && paneCmd !== 'claude' && !claudeAlive) return { state: 'shell', source: 'pane' };
  if (hook && now - hook.at < HOOK_STALE_MS && hook.state) return { state: hook.state, source: 'hook' };
  if (!claudeAlive && paneCmd === 'claude') return { state: 'dead', source: 'proc' };
  if (registryStatus === 'busy') return { state: 'working', source: 'registry' };
  if (registryStatus === 'idle') return { state: 'done', source: 'registry' };
  if (registryStatus === 'shell') return { state: 'shell', source: 'registry' };
  if (paneLines?.length) {
    const guess = paneHeuristic(paneLines);
    if (guess) return { state: guess, source: 'heuristic' };
  }
  return { state: claudeAlive ? 'idle' : 'dead', source: 'default' };
}

// --- live state -------------------------------------------------------------

/** name -> Session. Rebuilt every tick, but stateSince and extras are carried over. */
const sessions = new Map();
/**
 * Claude sessionId -> { state, at, tool, toolInput, lastAssistant, lastAssistantAt, lastUserPrompt }.
 * Keyed by sessionId, NOT by tmux name: SessionStart fires before the session
 * appears in ~/.claude/sessions, so a name lookup at ingest time misses.
 */
export const hookState = new Map();
/** name -> pinned flag etc. */
const flags = new Map();

let latestVitals = null;
let generatedAt = 0;

export function getFlags(name) {
  if (!flags.has(name)) flags.set(name, { pinned: false });
  return flags.get(name);
}

/** Hooks and cost engines look sessions up by Claude sessionId. */
export function sessionNameBySessionId(sessionId) {
  for (const s of sessions.values()) if (s.claude?.sessionId === sessionId) return s.name;
  return null;
}

export function get(name) { return sessions.get(name) ?? null; }
export function all() { return [...sessions.values()]; }

/**
 * v3: what the lane cards and the Box need beyond sessions and lanes — lane
 * records, PRs, slots, the dev stack, readiness, jobs. Provided by boot/builder.mjs,
 * which owns those collectors, so this module does not import them.
 */
let extras = () => null;
export function setExtras(fn) {
  extras = fn;
}

// --- hooks for feature modules (server/flags/*.mjs) ------------------------
//
// Flags such as `stuck`, `paused`, `awaitingApproval` (sessions) and
// `reviewReady` (lanes) are not computed here: a module registers a decorator
// and this file merges its patch in. With nothing registered, every path
// below is exactly what it was before the hooks existed.

/** name -> { session?(s, ctx) -> patch, lane?(lane, ctx) -> patch } */
const decorators = new Map();
/** name -> () -> value, a top-level snapshot key */
const snapshotKeys = new Map();
/** fn(ctx, now), at the end of every tick */
const tickHooks = [];

const CORE_SNAPSHOT_KEYS = new Set(['box', 'sessions', 'lanes', 'vitals', 'attention', 'generatedAt']);

/**
 * Decorate sessions and/or lanes. `session(s, {now})` and
 * `lane(lane, {now, sessions})` return a patch object (or null) that is merged
 * into the session/lane. Session decorators run before the attention score is
 * computed, so the score sees the flag. A patch should name every field it
 * owns on every call (`{stuck: null}` to clear), because a lane is rebuilt per
 * snapshot but a session object lives until the next tick.
 */
export function addDecorator(name, { session, lane } = {}) {
  if (!name || typeof name !== 'string') throw new TypeError('addDecorator needs a name');
  if (decorators.has(name)) throw new Error(`decorator '${name}' is already registered`);
  if (session !== undefined && typeof session !== 'function') throw new TypeError(`decorator '${name}': session must be a function`);
  if (lane !== undefined && typeof lane !== 'function') throw new TypeError(`decorator '${name}': lane must be a function`);
  if (!session && !lane) throw new TypeError(`decorator '${name}' needs a session or a lane function`);
  decorators.set(name, { session, lane });
}

/** Add `snapshot()[name] = fn()`. A core key or a second registration is refused. */
export function addSnapshotKey(name, fn) {
  if (!name || typeof name !== 'string') throw new TypeError('addSnapshotKey needs a name');
  if (typeof fn !== 'function') throw new TypeError(`snapshot key '${name}' needs a function`);
  if (CORE_SNAPSHOT_KEYS.has(name) || snapshotKeys.has(name)) throw new Error(`snapshot key '${name}' is already defined`);
  snapshotKeys.set(name, fn);
}

/** Run `fn(ctx, now)` at the end of every tick; ctx is `{ sessions, get }`. */
export function onTick(fn) {
  if (typeof fn !== 'function') throw new TypeError('onTick needs a function');
  tickHooks.push(fn);
}

/** Tests only: forget every registered hook. */
export function _resetHooks() {
  decorators.clear();
  snapshotKeys.clear();
  tickHooks.length = 0;
  hookFailures.clear();
}

/**
 * A hook that throws is logged and skipped; it never breaks a tick or a
 * snapshot. A hook failing on every session every tick is logged on its 1st,
 * 10th, 100th... failure, not 30 times every 2 s.
 */
const hookFailures = new Map();
function guarded(key, what, fn) {
  try {
    return fn();
  } catch (err) {
    const n = (hookFailures.get(key) ?? 0) + 1;
    hookFailures.set(key, n);
    if (Number.isInteger(Math.log10(n))) log.error(`${what} failed${n > 1 ? ` (${n} times)` : ''}`, err?.stack || String(err));
    return null;
  }
}

/**
 * Apply every session decorator to `list` (in place), then recompute the
 * attention score. Exported for tests; snapshot() calls it.
 */
export function decorateSessions(list, now = Date.now()) {
  if (!decorators.size) return list;
  for (const s of list) {
    for (const [name, d] of decorators) {
      if (!d.session) continue;
      const patch = guarded(`decorator:${name}`, `decorator ${name} (session ${s.name})`, () => d.session(s, { now }));
      if (patch && typeof patch === 'object') Object.assign(s, patch);
    }
    s.attentionScore = attentionScore(s, now);
  }
  return list;
}

/** Apply every lane decorator to `laneList` (in place). Exported for tests. */
export function decorateLanes(laneList, now = Date.now(), sessionList = []) {
  if (!decorators.size || !Array.isArray(laneList)) return laneList;
  for (const l of laneList) {
    for (const [name, d] of decorators) {
      if (!d.lane) continue;
      const patch = guarded(`decorator:${name}`, `decorator ${name} (lane ${l?.id ?? '?'})`, () => d.lane(l, { now, sessions: sessionList }));
      if (patch && typeof patch === 'object') Object.assign(l, patch);
    }
  }
  return laneList;
}

/** The registered snapshot keys, evaluated. Exported for tests. */
export function snapshotExtras() {
  const out = {};
  for (const [name, fn] of snapshotKeys) out[name] = guarded(`key:${name}`, `snapshot key ${name}`, fn) ?? null;
  return out;
}

/** Run the onTick hooks. Exported for tests; tick() calls it. */
export async function runTickHooks(now = Date.now()) {
  const ctx = { sessions: all(), get };
  for (const fn of tickHooks) {
    try {
      await fn(ctx, now);
    } catch (err) {
      log.error('tick hook failed', err?.stack || String(err));
    }
  }
}

export function snapshot() {
  const list = all();
  const now = generatedAt || Date.now();
  // A decorator's source (an approval, a pause) can change between ticks, so
  // the flags and the score are refreshed on every snapshot, not only per tick.
  decorateSessions(list, now);
  const snap = {
    box: extras(),
    sessions: list,
    // Idle lanes are NOT sessions (lanes plan hard rule 6): separate array,
    // no state, no attention score, never a card.
    lanes: decorateLanes(lanes.build(list, { progressFor: progress.get }), now, list),
    vitals: latestVitals,
    attention: list.filter((s) => s.attentionScore > 0)
      .sort((a, b) => b.attentionScore - a.attentionScore || (a.stateSince ?? 0) - (b.stateSince ?? 0))
      .map((s) => ({ name: s.name, state: s.state, score: s.attentionScore, since: s.stateSince, danger: s.danger ? s.danger.reason : null })),
    generatedAt,
  };
  if (snapshotKeys.size) Object.assign(snap, snapshotExtras());
  return snap;
}

// Pane captures are rate-limited per hard rule 8, and batched into ONE tmux
// process per tick — 19 separate execs cost 3.6% CPU, over the 3% budget.
const paneCache = new Map(); // name -> { lines, at }

function paneDue(name, wanted, now) {
  const entry = paneCache.get(name);
  const budget = wanted
    ? config.paneCaptureVisibleMs
    : visibleSessions.size
      ? config.paneCaptureHiddenMs
      : config.paneCaptureIdleMs;
  return !entry || now - entry.at >= budget;
}

async function captureDuePanes(inv, now) {
  const wanted = [];
  const byTarget = new Map();
  for (const [name, t] of inv) {
    const target = t.mainPane?.target;
    if (!target) continue;
    if (!paneDue(name, visibleSessions.has(name), now)) continue;
    wanted.push(target);
    byTarget.set(target, name);
  }
  if (!wanted.length) return;
  const captured = await tmux.captureMany(wanted, { ansi: true });
  for (const [target, lines] of captured) {
    const name = byTarget.get(target);
    if (name) paneCache.set(name, { lines, at: Date.now() });
  }
}

function paneLinesFor(name) {
  return paneCache.get(name)?.lines ?? [];
}

/**
 * Has this pane's content moved since the last marker scan?
 *
 * Cheap on purpose: the signature is the line count and the last line, which is
 * what changes whenever a terminal writes. A session redrawing a spinner is
 * "changed" and gets scanned; a session sitting on a finished prompt is not.
 */
const paneSignature = new Map();

export function paneChanged(name, lines) {
  const sig = lines.length ? `${lines.length}|${lines[lines.length - 1]}` : '0';
  if (paneSignature.get(name) === sig) return false;
  paneSignature.set(name, sig);
  return true;
}

/** Which sessions a browser currently has on screen — raises their capture rate. */
export const visibleSessions = new Set();

/** Hook for Stage 3: name -> cost object. */
export const costBySession = new Map();

/**
 * The newest undismissed marker per session, so a card can show one line of
 * "what this lane last shouted" without the client asking for the whole list.
 * Refreshed on the same 60 s beat as the watch-log scan, not per tick.
 */
let latestMarkers = new Map(); // session name -> marker row

export function markerFor(name) {
  return latestMarkers.get(name) ?? null;
}

function refreshLatestMarkers() {
  const next = new Map();
  // Newest first, so the first row seen for a session is the one to keep.
  for (const m of db.listMarkers({ limit: 500 })) {
    if (m.session_name && !next.has(m.session_name)) next.set(m.session_name, m);
  }
  latestMarkers = next;
}

/**
 * A freshly recorded marker. Two shapes reach here — the collector's
 * (sessionName) and a database row's (session_name) — so normalise once.
 */
function noteMarker(m) {
  const row = {
    id: m.id,
    ts: m.ts ?? Date.now(),
    lane: m.lane ?? null,
    session_name: m.session_name ?? m.sessionName ?? null,
    kind: m.kind,
    text: m.text,
    source: m.source,
    dismissed_at: null,
  };
  // Put it on the card now rather than at the next 60 s sweep: a NEED-HUMAN
  // that takes a minute to appear is a NEED-HUMAN you do not trust.
  if (row.session_name) latestMarkers.set(row.session_name, row);
  if (['need', 'blocked', 'limit'].includes(row.kind)) {
    push.onMarker(row).catch((err) => log.error('marker push failed', String(err)));
  }
}

/**
 * Watch logs and the latest-marker map, on the lane beat rather than the tick.
 * A watcher writes a line a minute at most, and tailing eleven logs every two
 * seconds would be the sort of thing hard rule 8 exists to prevent.
 */
/** The hook path records markers before the tick sees them. */
export function noteMarkerFromHook(m) {
  noteMarker(m);
}

export async function refreshMarkers() {
  const seenLanes = new Set();
  // Sequential: same reasoning as every other 60 s pass.
  for (const s of sessions.values()) {
    if (!s.lane || seenLanes.has(s.lane)) continue;
    seenLanes.add(s.lane);
    try {
      for (const m of await markers.scanWatchLog(s.lane, s.name)) noteMarker(m);
    } catch (err) {
      log.error(`watch log scan failed for ${s.lane}`, String(err));
    }
  }
  refreshLatestMarkers();
}

export async function tick() {
  const [inv, reg] = await Promise.all([tmux.inventory(), registry.registryBySession()]);
  await statusline.refresh();
  const now = Date.now();
  await captureDuePanes(inv, now);
  const seen = new Set();
  let claudeRssKb = 0;

  for (const [name, t] of inv) {
    seen.add(name);
    const entry = reg.bySession.get(name)
      || (t.mainPane && reg.byPaneId.get(t.mainPane.paneId))
      || null;
    const sl = statusline.get(entry?.sessionId);
    const dir = sl?.workspace?.current_dir || sl?.cwd || entry?.cwd || t.mainPane?.path || null;
    if (dir) { git.want(dir); lanes.wantRoot(dir); }
    const g = git.get(dir);
    if (entry?.rssKb) claudeRssKb += entry.rssKb;

    const paneCmd = t.mainPane?.cmd ?? null;
    const claudeAlive = Boolean(entry) || paneCmd === 'claude';
    const hook = entry?.sessionId ? (hookState.get(entry.sessionId) ?? null) : null;
    // Every session gets a preview: skipping capture for hook-fresh sessions
    // left exactly the busiest ones blank on their card and in `laneboard peek`.
    const paneLines = paneLinesFor(name);

    const derived = deriveState({
      hook,
      registryStatus: entry?.status ?? null,
      paneCmd,
      claudeAlive,
      paneLines,
      now,
    });

    const prev = sessions.get(name);
    const transitioned = prev && prev.state !== derived.state;
    let stateSince;
    if (prev && prev.state === derived.state) {
      stateSince = prev.stateSince;
    } else if (prev) {
      stateSince = now; // a transition we actually watched happen
    } else {
      // First sight. Using `now` would make a session that finished six hours
      // ago look freshly done and flood the attention queue, so fall back to
      // when the registry last changed its status.
      stateSince = entry?.statusUpdatedAt || entry?.updatedAt || t.activityAt || now;
    }

    let cost = null;
    if (entry?.sessionId) {
      cost = await transcripts.update({
        transcriptPath: sl?.transcript_path || null,
        sessionId: entry.sessionId,
        dir: entry.cwd || dir,
      });
      if (cost) costBySession.set(name, cost);
    }

    const session = {
      name,
      tmuxTarget: t.mainPane?.target ?? null,
      paneId: t.mainPane?.paneId ?? null,
      paneCmd,
      paneSize: t.mainPane ? { cols: t.mainPane.width, rows: t.mainPane.height } : null,
      attached: t.attached,
      createdAt: t.createdAt,
      activityAt: t.activityAt,
      dir,
      // The worktree this session is working in. A colour and a filter, never
      // a sort key (lanes plan hard rule 1). Null for a session with no repo.
      lane: lanes.laneOf(dir),
      branch: g?.branch ?? null,
      dirty: g?.dirty ?? 0,
      ahead: g?.ahead ?? 0,
      behind: g?.behind ?? 0,
      // 'claude' | 'shell' — which agent this session runs.
      kind: entry || paneCmd === 'claude' ? 'claude' : 'shell',
      claude: entry
        ? {
            pid: entry.pid,
            sessionId: entry.sessionId,
            version: entry.version,
            model: sl?.model?.display_name || sl?.model?.id || null,
            modelId: sl?.model?.id || null,
            startedAt: entry.startedAt,
            rssMb: entry.rssKb ? Math.round(entry.rssKb / 1024) : null,
            // Pushed to disk. Moved here from the Machine view in v3.
            swapMb: entry.swapKb != null ? Math.round(entry.swapKb / 1024) : null,
            registryStatus: entry.status,
            registryName: entry.name,
            transcriptPath: sl?.transcript_path || null,
            title: sl?.session_name || null,
          }
        : null,
      state: derived.state,
      stateSource: derived.source,
      stateSince,
      activity: {
        tool: hook?.tool ?? null,
        toolInput: hook?.toolInput ?? null,
        // Hooks are freshest, then the transcript, then whatever we had before.
        lastUserPrompt: truncate(hook?.lastUserPrompt || cost?.lastUserPrompt || prev?.activity?.lastUserPrompt || '', 200),
        lastAssistant: truncate(hook?.lastAssistant || cost?.lastAssistant || prev?.activity?.lastAssistant || '', 300),
        lastAssistantAt: hook?.lastAssistantAt ?? cost?.lastAssistantAt ?? prev?.activity?.lastAssistantAt ?? null,
      },
      context: sl?.context_window
        ? {
            usedPct: sl.context_window.used_percentage ?? null,
            size: sl.context_window.context_window_size ?? null,
            currentUsage: sl.context_window.current_usage ?? null,
          }
        : null,
      cost: cost ?? costBySession.get(name) ?? null,
      statuslineCostUsd: sl?.cost?.total_cost_usd ?? null,
      linesAdded: sl?.cost?.total_lines_added ?? null,
      linesRemoved: sl?.cost?.total_lines_removed ?? null,
      rateLimits: sl?.rate_limits
        ? {
            fiveHour: sl.rate_limits.five_hour
              ? { usedPct: sl.rate_limits.five_hour.used_percentage, resetsAt: sl.rate_limits.five_hour.resets_at * 1000 }
              : null,
            sevenDay: sl.rate_limits.seven_day
              ? { usedPct: sl.rate_limits.seven_day.used_percentage, resetsAt: sl.rate_limits.seven_day.resets_at * 1000 }
              : null,
          }
        : null,
      preview: (paneCache.get(name)?.lines ?? []).slice(-40),
      // 8 raw ANSI lines for the card, rendered on the client by
      // public/js/core/ansi.js (fleet F6): no HTML goes on the wire. Blank lines
      // are dropped first so the card shows 8 lines of content; each line is
      // right-trimmed and capped at PREVIEW_LINE_CHARS.
      previewLines: previewLinesOf(paneCache.get(name)?.lines),
      pinned: getFlags(name).pinned,
      // The guard's finding for this session, or null (collector/guard.mjs).
      danger: null,
      attentionScore: 0,
    };
    session.danger = guard.dangerFor(name);
    // Flags from modules first: the score must see them.
    if (decorators.size) decorateSessions([session], now);
    session.attentionScore = attentionScore(session, now);
    // The pane preview is already in hand, so scanning it for markers costs no
    // new tmux call — but it is NOT free. Joining and regex-scanning 40 lines
    // for every session on every 2 s tick was the largest new allocation v2 put
    // on the hot path, and a 20-minute soak walked RSS from 125 MB to 181 MB
    // with the JS heap flat: transient garbage the allocator does not hand back.
    //
    // A terminal appends at the bottom, so the line count plus the last line is
    // a reliable "did anything change?" and it is a string compare rather than
    // forty. Idle panes — most of them, most of the time — now cost nothing.
    if (paneChanged(name, paneLines)) {
      for (const m of markers.ingest({
        lane: session.lane,
        sessionName: name,
        source: 'pane',
        text: paneLines.map(stripAnsi).join('\n'),
      })) {
        noteMarker(m);
      }
    }
    session.lastMarker = markerFor(name);
    sessions.set(name, session);

    if (transitioned) {
      // Never let a push failure break the tick.
      push.onTransition({
        name,
        from: prev.state,
        to: derived.state,
        stateSince: prev.stateSince,
        activity: session.activity,
      }).catch((err) => log.error('push failed', String(err)));
    }
  }

  for (const name of [...sessions.keys()]) if (!seen.has(name)) sessions.delete(name);
  for (const name of [...paneSignature.keys()]) if (!seen.has(name)) paneSignature.delete(name);

  // Drop hook state for sessions that are gone, so the map stays bounded.
  const liveIds = new Set(reg.entries.map((e) => e.sessionId).filter(Boolean));
  for (const id of [...hookState.keys()]) if (!liveIds.has(id)) hookState.delete(id);

  // One row a minute, from the tick rather than a timer of its own: the tick
  // already holds the sessions, and a sampler firing mid-rebuild would read a
  // half-finished snapshot.
  ratelimits.maybeSample([...sessions.values()], now);
  latestVitals = await vitals.sample({ claudeRssKb, sessionCount: seen.size });
  generatedAt = now;
  if (tickHooks.length) await runTickHooks(now);
  return snapshot();
}

let timer = null;
export function start(onTick) {
  statusline.start();
  git.start();
  lanes.start();
  progress.start();
  // Offset again from the lanes (5 s) and progress (20 s) passes.
  const markerFirst = setTimeout(() => refreshMarkers().catch(() => {}), 35000);
  markerFirst.unref();
  const markerTimer = setInterval(() => refreshMarkers().catch(() => {}), config.lanePollMs);
  markerTimer.unref();
  const loop = async () => {
    try {
      const snap = await tick();
      if (onTick) onTick(snap);
    } catch (err) {
      log.error('tick failed', err?.stack || String(err));
    }
    timer = setTimeout(loop, config.tickMs);
    timer.unref();
  };
  loop();
  return () => clearTimeout(timer);
}
