// tmux inventory: sessions + panes. Read-only; never touches a session (hard rule 1).
import { run, isBlankLine } from '../util.mjs';

const TMUX_BIN = 'tmux';

/**
 * tmux sanitises a literal TAB inside a -F format to "_" unless it is running
 * under a UTF-8 locale (verified on tmux 3.4: LANG unset gives
 * "laneboard_1787751839_0", LANG=en_US.UTF-8 gives a real tab). That turns every
 * parsed field into garbage — session names swallow their own numbers and
 * pane paths come back null.
 *
 * The service only escapes this because systemd hands it LANG=en_US.UTF-8.
 * The same code run from cron, a plain ssh shell, or `npm test` mis-parses
 * everything in silence. Pin the locale here instead of depending on how we
 * were started; it also stops send-keys mangling non-ASCII prompt text.
 */
const TMUX_ENV = { ...process.env, LC_ALL: process.env.LC_ALL || 'C.UTF-8' };

/** Every tmux invocation in the laneboard goes through this. */
export function runTmux(args, opts = {}) {
  return run(TMUX_BIN, args, { ...opts, env: TMUX_ENV });
}

// Session names contain spaces, parens and colons, so fields are joined by a
// tab, which a session name cannot contain. TMUX_ENV above is what makes tmux
// emit that tab at all.
const SEP = '\t';

const S_FMT = [
  '#{session_name}', '#{session_created}', '#{session_activity}',
  '#{session_attached}', '#{session_windows}', '#{session_group}',
].join(SEP);
const P_FMT = [
  '#{session_name}', '#{window_index}', '#{pane_index}', '#{pane_id}',
  '#{pane_current_command}', '#{pane_current_path}', '#{pane_pid}',
  '#{pane_width}', '#{pane_height}', '#{pane_active}',
].join(SEP);

export async function listSessions() {
  const r = await runTmux(['list-sessions', '-F', S_FMT]);
  if (!r.ok) return []; // "no server running on ..." is normal
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, created, activity, attached, windows, group] = line.split(SEP);
    return {
      name,
      createdAt: Number(created) * 1000 || null,
      activityAt: Number(activity) * 1000 || null,
      attached: Number(attached) > 0,
      windows: Number(windows) || 0,
      group: group || null,
    };
  });
}

export async function listPanes() {
  const r = await runTmux(['list-panes', '-a', '-F', P_FMT]);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [session, windowIndex, paneIndex, paneId, cmd, cwdPath, pid, w, h, active] = line.split(SEP);
    return {
      session,
      windowIndex: Number(windowIndex),
      paneIndex: Number(paneIndex),
      paneId,
      cmd,
      path: cwdPath,
      pid: Number(pid),
      width: Number(w),
      height: Number(h),
      active: active === '1',
      target: paneId, // pane ids ("%17") are unambiguous targets, unlike names with spaces
    };
  });
}

/**
 * A session the laneboard itself created to render a terminal. These are grouped
 * with a real session and SHARE ITS PANE, so leaving them in the inventory
 * shows a phantom card and double-counts that session's cost.
 */
export function isOwnWebSession(session) {
  return Boolean(session?.group) && /-web-[0-9a-z]+$/.test(session?.name ?? '');
}

/** Sessions with their panes attached, keyed by session name. */
export async function inventory() {
  const [sessions, panes] = await Promise.all([listSessions(), listPanes()]);
  const byName = new Map();
  for (const s of sessions) {
    if (isOwnWebSession(s)) continue;
    byName.set(s.name, { ...s, panes: [] });
  }
  for (const p of panes) {
    const s = byName.get(p.session);
    if (s) s.panes.push(p);
  }
  for (const s of byName.values()) {
    // The pane a session's work happens in: the active pane of the first window.
    s.mainPane = s.panes.find((p) => p.active) || s.panes[0] || null;
  }
  return byName;
}

/**
 * tmux resolves a -t target by PREFIX unless it is written "=name".
 * Without this, `kill-session -t _laneboard` also kills `_laneboard-test`, and an
 * action aimed at "kubic" could land in "kubic plan a" (hard rule 1).
 * ALWAYS route session-name targets through this.
 */
export function exactTarget(name) {
  return `=${name}`;
}

/**
 * Read a pane. Read-only, safe on foreign sessions.
 * `scrollback: 0` (the default) captures only the visible screen — which for
 * Claude's full-screen TUI is the current render. Reading further back would
 * surface stale prompts and make the state heuristic lie.
 */
export async function capturePane(target, { ansi = false, scrollback = 0 } = {}) {
  if (!target) return [];
  const args = ['capture-pane', '-p', '-t', target];
  if (scrollback > 0) args.push('-S', `-${scrollback}`);
  if (ansi) args.push('-e');
  const r = await runTmux(args, { timeout: 3000 });
  if (!r.ok) return [];
  return trimBlank(r.stdout.split('\n'));
}

// One tmux process per pane per tick cost 3.6% CPU with 19 sessions, over the
// 3% budget (hard rule 8). tmux accepts several commands in one invocation, so
// every pane is captured in a SINGLE exec, with a marker line between them.
const MARK = '@@laneboard-pane@@';

/**
 * Capture many panes at once. Returns Map<target, lines>.
 * Falls back to per-pane capture only if the batch call fails outright.
 */
export async function captureMany(targets, { ansi = true } = {}) {
  const out = new Map();
  const list = [...new Set(targets.filter(Boolean))];
  if (!list.length) return out;

  const args = [];
  for (const t of list) {
    if (args.length) args.push(';');
    args.push('display-message', '-p', `${MARK}${t}`, ';', 'capture-pane', '-p', '-t', t);
    if (ansi) args.push('-e');
  }
  const r = await runTmux(args, { timeout: 8000, maxBuffer: 16 * 1024 * 1024 });
  if (!r.ok) return out;

  let current = null;
  let buf = [];
  const flush = () => { if (current) out.set(current, trimBlank(buf)); buf = []; };
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith(MARK)) {
      flush();
      current = line.slice(MARK.length).trim();
    } else if (current) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Drop leading and trailing blank lines; a detached TUI pane is mostly blank. */
export function trimBlank(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlankLine(lines[start])) start++;
  while (end > start && isBlankLine(lines[end - 1])) end--;
  return lines.slice(start, end);
}
