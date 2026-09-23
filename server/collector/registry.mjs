// ~/.claude/sessions/<pid>.json — undocumented internal format.
// Tolerate missing and extra fields; never write here (hard rule 6).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** VmRSS and VmSwap in kB, from one read of /proc/<pid>/status. */
export async function procMemKb(pid) {
  try {
    const status = await fs.readFile(`/proc/${pid}/status`, 'utf8');
    const grab = (key) => {
      const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm').exec(status);
      return m ? Number(m[1]) : null;
    };
    return { rssKb: grab('VmRSS'), swapKb: grab('VmSwap') };
  } catch {
    // The process died between the listing and this read. Not an error.
    return { rssKb: null, swapKb: null };
  }
}

export async function rssKb(pid) {
  return (await procMemKb(pid)).rssKb;
}

/**
 * The `tmux` field is "<session name>:@<window-id>.%<pane-id>".
 * Session names contain spaces, parens AND colons, so take everything before
 * the LAST ":@" — never split on whitespace or the first colon.
 */
export function parseTmuxField(value) {
  if (typeof value !== 'string' || !value) return { session: null, windowId: null, paneId: null };
  const idx = value.lastIndexOf(':@');
  if (idx < 0) return { session: value, windowId: null, paneId: null };
  const session = value.slice(0, idx);
  const rest = value.slice(idx + 1); // "@17.%17"
  const dot = rest.indexOf('.%');
  if (dot < 0) return { session, windowId: rest || null, paneId: null };
  return { session, windowId: rest.slice(0, dot), paneId: rest.slice(dot + 1) };
}

export function normaliseEntry(entry, fallbackPid) {
  if (!entry || typeof entry !== 'object') return null;
  const pid = Number(entry.pid ?? fallbackPid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const { session, windowId, paneId } = parseTmuxField(entry.tmux);
  return {
    pid,
    sessionId: entry.sessionId ?? null,
    cwd: entry.cwd ?? null,
    startedAt: entry.startedAt ?? null,
    version: entry.version ?? null,
    kind: entry.kind ?? null,
    tmuxRaw: entry.tmux ?? null,
    tmuxSession: session,
    tmuxWindowId: windowId,
    tmuxPaneId: paneId,
    status: entry.status ?? null,
    statusUpdatedAt: entry.statusUpdatedAt ?? null,
    updatedAt: entry.updatedAt ?? null,
    name: entry.name ?? null,
    messagingSocketPath: entry.messagingSocketPath ?? null,
    rssKb: null,
    swapKb: null,
  };
}

/** All registry entries whose process is still alive. */
export async function readRegistry() {
  let files;
  try {
    files = await fs.readdir(config.sessionsDir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let entry;
    try {
      entry = JSON.parse(await fs.readFile(path.join(config.sessionsDir, f), 'utf8'));
    } catch { continue; } // missing, half-written or malformed — skip silently
    const norm = normaliseEntry(entry, Number(path.basename(f, '.json')));
    if (!norm) continue;
    if (!pidAlive(norm.pid)) continue;
    out.push(norm);
  }
  return out;
}

/** Pick the newest entry per key. */
export function indexBy(entries, keyFn) {
  const map = new Map();
  for (const e of entries) {
    const key = keyFn(e);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || (e.startedAt ?? 0) > (prev.startedAt ?? 0)) map.set(key, e);
  }
  return map;
}

/** Registry entries with RSS filled in, keyed by tmux session name. */
export async function registryBySession() {
  const entries = await readRegistry();
  await Promise.all(entries.map(async (e) => { Object.assign(e, await procMemKb(e.pid)); }));
  return { bySession: indexBy(entries, (e) => e.tmuxSession), byPaneId: indexBy(entries, (e) => e.tmuxPaneId), entries };
}
