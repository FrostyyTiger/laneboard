// The room's start check (spec security.md §3, D209, D210) and the walk of the
// agent's way to its files (single-machine.md §3.3).
//
// REVIEW-REQUIRED (fenced.txt's last block: "the start check of security.md §3").
//
//   secretPaths({config, auditFile})  the paths D210 names, in its order:
//                    cockpit.stt.tokenFile, cockpit.infra.key, {stateDir}/cockpit/
//                    and everything in it, the audit file, its directory.
//   fileProblems(paths, {uid, fs})    one problem per wrong path, in that
//                    order: {key, path, dir, line}. The room stops on the first
//                    (exit 1, the line on stderr); `laneboard cockpit doctor`'s
//                    `files` check prints them all (single-machine.md §5, D248).
//   agentWalk(targets, {agent, fs, readAcl})  the §3.3 lines: every directory
//                    from / to each target the agent's user cannot enter. Not
//                    fatal: the room starts and the agent answers `tools-down`.
//   lookupAgent(name)  {name, uid, gids} of the agent's user (`id`, argv only).
//
// Everything here is pure apart from the injected `fs` ({statSync, lstatSync,
// readdirSync}), `readAcl` and `lookupAgent`, so S-SEC-01 drives it with an
// injected stat, as D111 injects uids (test/cockpit-security.test.mjs).
import nodeFs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OTHERS = 0o077;

const octal = (mode) => (mode & 0o7777).toString(8).padStart(4, '0');

/**
 * D210's list, in its order. `config` is the loaded config; `auditFile` the
 * board's audit log path (server/fleet/paths.mjs auditFile()). Keys a config
 * does not set (no tokenFile, no infra key before the coworker slice) are left
 * out. `tree: true` is a directory checked with everything in it.
 */
export function secretPaths({ config, auditFile }) {
  const out = [];
  const tokenFile = config?.cockpit?.stt?.tokenFile;
  if (typeof tokenFile === 'string' && tokenFile !== '') out.push({ key: 'cockpit.stt.tokenFile', path: tokenFile });
  const infraKey = config?.cockpit?.infra?.key;
  if (typeof infraKey === 'string' && infraKey !== '') out.push({ key: 'cockpit.infra.key', path: infraKey });
  out.push({ key: null, path: path.join(config.stateDir, 'cockpit'), tree: true });
  if (auditFile) {
    out.push({ key: null, path: auditFile });
    out.push({ key: null, path: path.dirname(auditFile) });
  }
  return out;
}

/** The D210 line for one path (D248: a path that is no config key starts the line). */
export function modeLine({ key, path: p, dir }) {
  return `${key ? `${key}: ` : ''}${p} can be read by others; make it ${dir ? '0700' : '0600'} and owned by the room's user`;
}

/** D248's owner line: the same check, the owner wrong. */
export function ownerLine({ key, path: p, owner }) {
  return `${key ? `${key}: ` : ''}${p} is owned by uid ${owner}, not you`;
}

/**
 * One problem per wrong path, in secretPaths' order; an empty list when all
 * hold. A path that does not exist is no problem (the room makes the state dir
 * itself, a missing token file is the speech check's: c2-voice.md §10).
 */
export function fileProblems(paths, { uid, fs = nodeFs } = {}) {
  const out = [];
  for (const entry of paths) {
    if (entry.tree) walkTree(entry, { uid, fs, out });
    else checkOne(entry, { uid, fs, out, follow: true });
  }
  return out;
}

/** stat (or lstat), else null for a path that is not there, else the error's code. */
function statOf(fs, p, follow) {
  try {
    return follow ? fs.statSync(p) : fs.lstatSync(p);
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return null;
    return { error: err?.code ?? 'error' };
  }
}

/** Checks one path; returns its stat (or null) so a tree can recurse. */
function checkOne({ key = null, path: p }, { uid, fs, out, follow, st: given }) {
  const st = given ?? statOf(fs, p, follow);
  if (!st) return null;
  if (st.error) {
    // D210, strict: a path the room cannot look at is not known to be closed.
    out.push({ key, path: p, dir: false, line: `${key ? `${key}: ` : ''}${p} cannot be checked (${st.error})` });
    return null;
  }
  const dir = st.isDirectory();
  // D210: owned by the room's user...
  if (st.uid !== uid) {
    out.push({ key, path: p, dir, owner: st.uid, line: ownerLine({ key, path: p, owner: st.uid }) });
    return st;
  }
  // D210: ...and no group or other bit, on a file or a directory alike.
  if (st.mode & OTHERS) out.push({ key, path: p, dir, mode: st.mode & 0o7777, line: modeLine({ key, path: p, dir }) });
  return st;
}

/**
 * D209, D210: `{stateDir}/cockpit/` and every file in it, depth first, names
 * sorted. A symbolic link is checked as what it points at and never entered.
 */
function walkTree(entry, ctx) {
  const st = checkOne(entry, { ...ctx, follow: false });
  if (!st || !st.isDirectory()) return;
  let names;
  try {
    names = ctx.fs.readdirSync(entry.path).map(String).sort();
  } catch (err) {
    ctx.out.push({ key: null, path: entry.path, dir: true, line: `${entry.path} cannot be checked (${err?.code ?? 'error'})` });
    return;
  }
  for (const name of names) {
    const p = path.join(entry.path, name);
    const lst = statOf(ctx.fs, p, false);
    if (lst && !lst.error && lst.isSymbolicLink?.()) {
      checkOne({ path: p }, { ...ctx, follow: true });
    } else if (lst && !lst.error && lst.isDirectory()) {
      walkTree({ path: p }, ctx);
    } else {
      checkOne({ path: p }, { ...ctx, st: lst });
    }
  }
}

// --- single-machine.md §3.3: the agent's way to its files ---------------------------

/** Every directory from / to `target`, inclusive. */
export function ancestors(target) {
  const parts = path.resolve(target).split(path.sep).filter(Boolean);
  const out = ['/'];
  for (let i = 1; i <= parts.length; i++) out.push(`/${parts.slice(0, i).join('/')}`);
  return out;
}

/**
 * Can `agent` ({uid, gids}) pass through a directory with stat `st`? The mode
 * bits as the kernel applies them (owner, else group, else other), then the
 * directory's access ACL when the bits say no (a `setfacl -m u:{user}:x` is
 * the fix the line prints, and it must silence the line).
 */
export function canEnter(st, agent, acl) {
  if (agent.uid === 0) return true;
  let byMode;
  if (st.uid === agent.uid) byMode = (st.mode & 0o100) !== 0;
  else if (agent.gids.includes(st.gid)) byMode = (st.mode & 0o010) !== 0;
  else byMode = (st.mode & 0o001) !== 0;
  if (byMode || !acl || st.uid === agent.uid) return byMode;
  const mask = acl.find((e) => e.tag === 'mask');
  const masked = (e) => e.perms.includes('x') && (!mask || mask.perms.includes('x'));
  const named = acl.find((e) => e.tag === 'user' && e.id === agent.uid);
  if (named) return masked(named);
  const groups = acl.filter((e) => e.tag === 'group' && (e.id === null ? agent.gids.includes(st.gid) : agent.gids.includes(e.id)));
  if (groups.length) return groups.some(masked);
  return byMode;
}

/** `getfacl -n` of a directory as [{tag, id, perms}], or null (no getfacl, no ACL support). */
export function readAcl(dir) {
  const r = spawnSync('getfacl', ['--omit-header', '--absolute-names', '--numeric', '--', dir], { encoding: 'utf8', timeout: 2000 });
  if (r.error || r.status !== 0) return null;
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^(user|group|mask|other):(\d*):([rwx-]{3})/.exec(line.trim());
    if (m) out.push({ tag: m[1], id: m[2] === '' ? null : Number(m[2]), perms: m[3] });
  }
  return out;
}

/**
 * §3.3's lines, one per directory on the way to any target the agent's user
 * cannot enter, each directory once, in walk order. A directory that is not
 * there yet is skipped (the room makes `cockpit-agent/` itself).
 */
export function agentWalk(targets, { agent, fs = nodeFs, readAcl: acl = readAcl } = {}) {
  const seen = new Set();
  const out = [];
  for (const target of targets) {
    for (const dir of ancestors(target)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      const st = statOf(fs, dir, true);
      if (!st || st.error) continue;
      const ok = canEnter(st, agent, null) || canEnter(st, agent, acl(dir));
      if (!ok) {
        out.push(`cockpit: ${agent.name} cannot enter ${dir} (mode ${octal(st.mode)}); its tools will not start. Run: setfacl -m u:${agent.name}:x ${dir}`);
      }
    }
  }
  return out;
}

/**
 * The agent's user as {name, uid, gids}, or null. `id` (NSS, so directory
 * users too), argv only; the name already passed config/cockpit.mjs's USER_RX.
 */
export function lookupAgent(name) {
  const u = spawnSync('id', ['-u', '--', name], { encoding: 'utf8', timeout: 2000 });
  const g = spawnSync('id', ['-G', '--', name], { encoding: 'utf8', timeout: 2000 });
  if (u.error || g.error || u.status !== 0 || g.status !== 0) return null;
  const uid = Number(u.stdout.trim());
  const gids = g.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
  if (!Number.isInteger(uid) || gids.some((n) => !Number.isInteger(n))) return null;
  return { name, uid, gids };
}
