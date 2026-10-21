// Pure formatting helpers and state tables. Moved from public/app.js (fleet F1).

export const STATE_LABEL = {
  waiting_permission: 'permission',
  waiting_question: 'question',
  working: 'working',
  done: 'done',
  idle: 'idle',
  shell: 'shell',
  dead: 'dead',
};

// ---------------------------------------------------------------- helpers

export function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Dollars, one formatter everywhere: 2 decimals ($9.98, $0.00), whole dollars from $100 (T39). */
export function money(v) {
  if (v == null) return '—';
  if (v >= 100) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

/** 12345 -> "12.3k". */
export function compactCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

export function shortDir(dir) {
  if (!dir) return '';
  return dir.replace(/^\/home\/[^/]+/, '~');
}

/**
 * How loud a waiting session should look. Urgency is state x time, so the ring
 * fills on a log scale: 2 min ~ 15 %, 1 h ~ 57 %, 24 h and beyond = full.
 */
export function pressure(state, since) {
  if (state !== 'waiting_permission' && state !== 'waiting_question') return 0;
  const minutes = Math.max(0, (Date.now() - (since ?? Date.now())) / 60000);
  return Math.min(1, Math.log10(1 + minutes) / Math.log10(1 + 1440));
}

export function resetsIn(ts) {
  if (!ts) return '';
  const m = Math.round((ts - Date.now()) / 60000);
  if (m <= 0) return 'resetting';
  if (m < 60) return `resets in ${m}m`;
  return `resets in ${Math.round(m / 60)}h`;
}

export const STATE_RANK = { waiting_permission: 0, waiting_question: 1, working: 2, done: 3, idle: 4, shell: 5, dead: 6 };

/** Same string hash as the server (collector/lanes.mjs hueFor), for a lane with no worktree yet. */
export function hueFromId(id) {
  if (!id) return 0;
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h % 360;
}
