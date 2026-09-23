import { execFile } from 'node:child_process';

/** Run a command, never throw. Returns { ok, stdout, stderr, code }. */
export function run(cmd, args, { timeout = 5000, maxBuffer = 8 * 1024 * 1024, env, cwd } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer, env: env || process.env, cwd }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err?.code ?? 0, signal: err?.signal ?? null });
    });
  });
}

export const nowMs = () => Date.now();

// CSI sequences, OSC strings (incl. the OSC 8 hyperlinks tmux emits), and other
// escapes. tmux's `capture-pane -e` colours each word separately, so any text
// matching MUST run on the stripped string or phrases come out fragmented.
const ANSI_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b[@-Z\\-_]/g;

export function stripAnsi(s) {
  return typeof s === 'string' ? s.replace(ANSI_RE, '') : '';
}

export function isBlankLine(line) {
  return !line || !stripAnsi(line).trim();
}

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/** One-line, trimmed, truncated with an ellipsis. */
export function oneLine(s, max = 200) {
  if (!s) return '';
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

export function truncate(s, max) {
  if (!s) return '';
  const str = String(s);
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Encode a cwd the way Claude Code names its ~/.claude/projects sub-dirs:
 * both "/" and "_" become "-" (verified against the real directory listing —
 * /home/user/my_dir -> -home-user-my-dir).
 * Only a fallback: prefer the statusline's `transcript_path`, which is exact,
 * because a session's transcript stays in the dir it STARTED in even after /cd.
 */
export function encodeProjectDir(cwd) {
  return String(cwd).replace(/[/_]/g, '-');
}

/** Local-midnight timestamp for a timezone, as ms since epoch. */
export function startOfLocalDay(tz, at = Date.now()) {
  const d = new Date(at);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const localAsUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  const offset = localAsUtc - Math.floor(at / 1000) * 1000;
  const midnightLocalAsUtc = Date.UTC(g('year'), g('month') - 1, g('day'));
  return midnightLocalAsUtc - offset;
}

/**
 * The windows the Morning and Credit views offer.
 *
 * "Tonight" is the interesting one: it means since 18:00 local of the previous
 * calendar day, OR the last 12 hours, whichever reaches further back. At 07:00
 * that is 13 hours and covers the whole overnight run; at 02:00 the 18:00
 * boundary is only 8 hours back, so the 12-hour floor keeps the evening's work
 * in view instead of cutting the night in half.
 */
export const WINDOWS = ['12h', 'tonight', '24h', '7d'];

export function windowStart(name, tz = 'Europe/Zurich', now = Date.now()) {
  const HOURS = 3600 * 1000;
  switch (name) {
    case '12h': return now - 12 * HOURS;
    case '24h': return now - 24 * HOURS;
    case '7d': return now - 7 * 24 * HOURS;
    case 'tonight':
    default: {
      // 18:00 of the evening that has already begun: today's if it is past
      // 18:00 local, otherwise yesterday's.
      //
      // The plan says "18:00 of the previous calendar day", which is the same
      // thing whenever this view is read in the morning — the case it is for.
      // Read at 22:00 it is not: the previous day's 18:00 is 28 hours back, and
      // a block labelled "tonight" covering yesterday afternoon is a lie. The
      // 12 h floor then keeps a reading just after midnight from cutting the
      // evening's work in half.
      const midnight = startOfLocalDay(tz, now);
      const eveningToday = midnight + 18 * HOURS;
      const evening = now >= eveningToday ? eveningToday : eveningToday - 24 * HOURS;
      return Math.min(evening, now - 12 * HOURS);
    }
  }
}

export function windowLabel(name) {
  return { '12h': 'last 12 h', tonight: 'tonight', '24h': 'last 24 h', '7d': 'last 7 days' }[name] || name;
}

/** Session names may contain spaces and parens — never split on whitespace. */
export const SESSION_NAME_RE = /^[A-Za-z0-9 _.()-]{1,64}$/;
export function isSafeSessionName(name) {
  return typeof name === 'string' && SESSION_NAME_RE.test(name);
}
