// Statusline sidecar: install the snippet into ~/.claude/statusline-command.sh
// and read the per-session JSON it drops into ~/.cache/laneboard/status/.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { log } from '../log.mjs';

const MARKER = '--- laneboard sidecar';
const END_MARKER = '--- end laneboard sidecar ---';

export function isInstalled(script) {
  return script.includes(MARKER);
}

/**
 * Insert the sidecar before the LAST printf in the script, so the status line's
 * own output is emitted unchanged and last. Idempotent.
 */
export function withSidecar(script, snippet) {
  if (isInstalled(script)) return script;
  const lines = script.split('\n');
  let insertAt = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*printf\b/.test(lines[i])) { insertAt = i; break; }
  }
  const block = snippet.replace(/\n+$/, '').split('\n');
  return [...lines.slice(0, insertAt), ...block, '', ...lines.slice(insertAt)].join('\n');
}

export function withoutSidecar(script) {
  const lines = script.split('\n');
  const start = lines.findIndex((l) => l.includes(MARKER));
  if (start < 0) return script;
  let end = lines.findIndex((l, i) => i >= start && l.includes(END_MARKER));
  if (end < 0) end = start;
  const after = lines.slice(end + 1);
  while (after.length && after[0].trim() === '') after.shift();
  return [...lines.slice(0, start), ...after].join('\n');
}

/**
 * v3: a fresh ~/.claude has no status line at all, and there is nothing to
 * append the sidecar to. Then install the laneboard's own script, which already
 * carries the sidecar, instead of failing. An existing script is only ever
 * appended to, after a backup.
 */
export async function ensureStatusline() {
  try {
    await fsp.access(config.statuslinePath);
  } catch {
    const src = path.join(config.repoRoot, 'deploy', 'statusline-command.sh');
    await fsp.mkdir(path.dirname(config.statuslinePath), { recursive: true });
    const tmp = `${config.statuslinePath}.laneboard-tmp`;
    await fsp.copyFile(src, tmp);
    await fsp.chmod(tmp, 0o755);
    await fsp.rename(tmp, config.statuslinePath);
    log.info(`statusline installed from ${src}`);
    return { installed: true, fresh: true };
  }
  return installSidecar();
}

/** Install the sidecar after backing the script up (hard rule 4). */
export async function installSidecar() {
  const script = await fsp.readFile(config.statuslinePath, 'utf8');
  if (isInstalled(script)) return { installed: false, reason: 'already present' };
  const snippet = await fsp.readFile(path.join(config.repoRoot, 'deploy', 'statusline-sidecar.sh'), 'utf8');
  await fsp.mkdir(config.backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(config.backupsDir, `statusline-command.sh.${stamp}`);
  await fsp.copyFile(config.statuslinePath, backup);
  const next = withSidecar(script, snippet);
  const tmp = `${config.statuslinePath}.laneboard-tmp`;
  await fsp.writeFile(tmp, next, { mode: 0o755 });
  await fsp.rename(tmp, config.statuslinePath);
  log.info(`statusline sidecar installed (backup: ${backup})`);
  return { installed: true, backup };
}

const cache = new Map(); // sessionId -> { data, mtimeMs, readAt }

async function loadFile(file) {
  const abs = path.join(config.statusCacheDir, file);
  const sessionId = path.basename(file, '.json');
  try {
    const st = await fsp.stat(abs);
    const prev = cache.get(sessionId);
    if (prev && prev.mtimeMs === st.mtimeMs) return;
    const data = JSON.parse(await fsp.readFile(abs, 'utf8'));
    cache.set(sessionId, { data, mtimeMs: st.mtimeMs, readAt: Date.now() });
  } catch { /* half-written or vanished — try again next poll */ }
}

export async function refresh() {
  let files;
  try {
    files = await fsp.readdir(config.statusCacheDir);
  } catch { return cache; }
  await Promise.all(files.filter((f) => f.endsWith('.json') && !f.startsWith('.')).map(loadFile));
  return cache;
}

let watcher = null;
export function start() {
  fs.mkdirSync(config.statusCacheDir, { recursive: true });
  refresh();
  try {
    watcher = fs.watch(config.statusCacheDir, { persistent: false }, (_evt, name) => {
      if (name && name.endsWith('.json') && !name.startsWith('.')) loadFile(name);
    });
  } catch (err) {
    log.warn('statusline fs.watch unavailable, polling only', String(err));
  }
  // 5 s poll fallback — fs.watch misses events under some filesystems.
  const timer = setInterval(refresh, 5000);
  timer.unref();
  return () => { watcher?.close(); clearInterval(timer); };
}

/** Statusline payload for a sessionId, or null. */
export function get(sessionId) {
  return sessionId ? (cache.get(sessionId)?.data ?? null) : null;
}
export function getAll() { return cache; }
