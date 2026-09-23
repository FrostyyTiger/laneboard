// Per-directory git status, polled every 15 s and cached.
import { run } from '../util.mjs';
import { config } from '../config.mjs';

const cache = new Map(); // dir -> { info, at }
const wanted = new Set();

export function want(dir) {
  if (dir && typeof dir === 'string') wanted.add(dir);
}

export function get(dir) {
  return dir ? (cache.get(dir)?.info ?? null) : null;
}

/** Parse `git status --porcelain=v2 --branch` output. */
export function parseStatus(stdout) {
  const info = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, dirty: 0, isRepo: true };
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) info.branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.oid ')) info.oid = line.slice('# branch.oid '.length).trim().slice(0, 8);
    else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice('# branch.upstream '.length).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) { info.ahead = Number(m[1]); info.behind = Number(m[2]); }
    } else if (/^[12u?] /.test(line)) info.dirty++;
  }
  if (info.branch === '(detached)') info.branch = info.oid ? `detached@${info.oid}` : 'detached';
  return info;
}

async function poll(dir) {
  const r = await run('git', ['-C', dir, 'status', '--porcelain=v2', '--branch'], { timeout: 4000 });
  if (!r.ok) {
    cache.set(dir, { info: { isRepo: false, branch: null, dirty: 0, ahead: 0, behind: 0 }, at: Date.now() });
    return;
  }
  cache.set(dir, { info: parseStatus(r.stdout), at: Date.now() });
}

export async function refresh() {
  const dirs = [...wanted];
  // Sequential: 15 repos x git status at once would spike the i5-8400 (hard rule 8).
  for (const d of dirs) await poll(d);
}

export function start() {
  refresh();
  const timer = setInterval(refresh, config.gitPollMs);
  timer.unref();
  return () => clearInterval(timer);
}
