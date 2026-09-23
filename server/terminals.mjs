// Live terminals: a node-pty running `tmux new-session -t <name>` (a GROUPED
// session) bridged to xterm.js over a WebSocket.
//
// ---------------------------------------------------------------------------
// Sizing — the thing the plan got wrong, and how this resolves it
// ---------------------------------------------------------------------------
// The plan's hard rule 1 permits grouped attach "because it doesn't resize the
// owner's client". Measured: it absolutely does. Session groups share their
// windows and tmux sizes a shared window to the latest attached client:
//
//   owner 90x24 + grouped client 200x50  ->  owner becomes 200x49, and stays
//   owner 90x24 + grouped client 90x24   ->  owner untouched
//
// The shrink also COMPOUNDS, because our client reserves a row for its own
// status bar (24 -> 23 -> 22 -> 21 over four attaches).
//
// But the dock and sheet terminals are explicitly wanted
// and sheet terminals to re-flow to the BROWSER's width. Both can hold:
//
//   * If the owner has a real client attached (someone is sitting in that
//     session in their own terminal) -> PINNED. We match their geometry and
//     ignore the browser. Never disturb a session someone is looking at.
//   * Otherwise (all 17 sessions here are detached) -> the BROWSER drives the
//     size, and when the last web client disconnects the owner's original
//     geometry is restored, so the net effect is nil.
//
// `resize-window` sets `window-size manual` as a side effect, which would stop
// a real terminal resizing the window later, so the option is unset again on
// restore. Verified end to end, twice in a row, in both modes.
//
// Our status bar is disabled IN THE SAME tmux command as the attach, so the
// option lands before the first size negotiation:
//
//   tmux new-session -t =owner -s group \; set-option -t group status off
//
// (`set-option` rejects the `=` exact-match prefix that `new-session -t`
// needs — "no such session: =name" — so the group name is passed bare there.)
//
// Protocol: pty output is sent as BINARY frames, control messages as TEXT JSON.
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { run, isSafeSessionName } from './util.mjs';
import { exactTarget } from './collector/tmux.mjs';
import { kvRead, kvWrite } from './db.mjs';
import * as state from './state.mjs';

const wss = new WebSocketServer({ noServer: true });

/** id -> entry */
const live = new Map();
/** owner session name -> { cols, rows, windowSize, clients } */
const owners = new Map();
let seq = 0;

export const WEB_SUFFIX = /-web-[0-9a-z]+$/;
const KV_GEOMETRY = 'terminals.ownerGeometry';

/**
 * Kill grouped sessions left behind by a crash.
 * The name suffix alone is NOT a safe test — a user session called
 * "my-web-app" matches it — so a session is swept only when it ALSO belongs to
 * a session group and has no client attached. Real sessions are not grouped.
 */
export async function sweepStale() {
  const r = await run('tmux', [
    'list-sessions', '-F', '#{session_name}\t#{session_group}\t#{session_attached}',
  ]);
  if (!r.ok) return 0;
  let killed = 0;
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [name, group, attached] = line.split('\t');
    if (!WEB_SUFFIX.test(name)) continue;
    if (!group) { log.warn(`not sweeping ${name}: not a grouped session`); continue; }
    if (attached !== '0') { log.warn(`not sweeping ${name}: a client is attached`); continue; }
    await run('tmux', ['kill-session', '-t', exactTarget(name)]);
    log.info(`swept stale web session ${name}`);
    killed++;
  }
  await restorePersistedGeometry();
  return killed;
}

/** After a crash we may have left owners resized; put them back. */
async function restorePersistedGeometry() {
  const saved = kvRead(KV_GEOMETRY, {}) || {};
  const names = Object.keys(saved);
  if (!names.length) return;
  for (const name of names) {
    const geom = saved[name];
    if (!geom?.cols || !geom?.rows) continue;
    await restoreOwner(name, geom);
    log.info(`restored ${name} to ${geom.cols}x${geom.rows} after an unclean shutdown`);
  }
  kvWrite(KV_GEOMETRY, {});
}

/** The owner's live pane geometry, or null if we cannot determine it. */
export function ownerSize(name) {
  const size = state.get(name)?.paneSize;
  if (!size || !size.cols || !size.rows) return null;
  return { cols: size.cols, rows: size.rows };
}

/** Pinned when a human is attached to the session in their own terminal. */
export function isPinned(name) {
  return Boolean(state.get(name)?.attached);
}

async function rememberOwner(name) {
  const existing = owners.get(name);
  if (existing) { existing.clients++; return existing; }
  const size = ownerSize(name);
  const opt = await run('tmux', ['show-options', '-t', name, '-w', 'window-size']);
  const rec = {
    cols: size?.cols ?? null,
    rows: size?.rows ?? null,
    // "" means the option was inherited and must be UNSET again, not set back.
    windowSize: opt.ok ? (opt.stdout.trim().split(/\s+/)[1] ?? '') : '',
    clients: 1,
  };
  owners.set(name, rec);
  persistGeometry();
  return rec;
}

function persistGeometry() {
  const out = {};
  for (const [name, rec] of owners) {
    if (rec.cols && rec.rows) out[name] = { cols: rec.cols, rows: rec.rows, windowSize: rec.windowSize };
  }
  kvWrite(KV_GEOMETRY, out);
}

async function restoreOwner(name, geom) {
  if (!geom?.cols || !geom?.rows) return;
  await run('tmux', ['resize-window', '-t', name, '-x', String(geom.cols), '-y', String(geom.rows)]);
  // resize-window sets window-size=manual; put the original setting back so a
  // real terminal still resizes the window when it attaches.
  if (geom.windowSize) await run('tmux', ['set-option', '-t', name, '-w', 'window-size', geom.windowSize]);
  else await run('tmux', ['set-option', '-t', name, '-w', '-u', 'window-size']);
}

async function releaseOwner(name) {
  const rec = owners.get(name);
  if (!rec) return;
  rec.clients--;
  if (rec.clients > 0) return;
  owners.delete(name);
  persistGeometry();
  await restoreOwner(name, rec);
  log.info(`restored ${name} to ${rec.cols}x${rec.rows}`);
}

export function clampDim(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

async function attachTerminal(ws, name, want) {
  const id = `${process.pid.toString(36)}${(seq++).toString(36)}`;
  const groupName = `${name}-web-${id}`;
  const pinned = isPinned(name);
  const owner = ownerSize(name);

  await rememberOwner(name);

  const size = pinned
    ? owner
    : { cols: clampDim(want.cols, 20, 500, owner.cols), rows: clampDim(want.rows, 5, 200, owner.rows) };

  const term = pty.spawn('tmux', [
    'new-session', '-t', exactTarget(name), '-s', groupName,
    ';', 'set-option', '-t', groupName, 'status', 'off',
    ';', 'set-option', '-t', groupName, 'destroy-unattached', 'on',
  ], {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd: config.home,
    env: { ...process.env, TERM: 'xterm-256color', PATH: `${config.nodeBin}:${process.env.PATH}` },
  });

  const entry = { id, name, groupName, term, ws, closed: false, pinned, cols: size.cols, rows: size.rows };
  live.set(id, entry);

  const control = (msg) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(msg)); } catch { /* going away */ }
    }
  };
  control({ type: 'size', cols: size.cols, rows: size.rows, session: name, pinned });

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(Buffer.from(data, 'utf8'), { binary: true }); } catch { /* going away */ }
    }
  });
  term.onExit(({ exitCode }) => {
    log.info(`term ${groupName} exited (${exitCode})`);
    cleanup(entry);
    if (ws.readyState === ws.OPEN) ws.close();
  });

  ws.on('message', (raw, isBinary) => {
    if (entry.closed) return;
    if (isBinary) { term.write(raw.toString('utf8')); return; }
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (msg.type === 'data' && typeof msg.data === 'string') {
      term.write(msg.data);
    } else if (msg.type === 'resize') {
      if (entry.pinned) {
        // A human is attached; their geometry wins. Tell the browser to scale.
        control({ type: 'size', cols: entry.cols, rows: entry.rows, session: name, pinned: true });
        return;
      }
      const cols = clampDim(msg.cols, 20, 500, entry.cols);
      const rows = clampDim(msg.rows, 5, 200, entry.rows);
      if (cols === entry.cols && rows === entry.rows) return;
      try {
        term.resize(cols, rows);
        entry.cols = cols;
        entry.rows = rows;
      } catch { /* raced with exit */ }
    }
  });

  const close = () => cleanup(entry);
  ws.on('close', close);
  ws.on('error', close);

  log.info(
    `term ${groupName} attached ${size.cols}x${size.rows} ` +
    `${pinned ? '(pinned to owner)' : '(browser-sized)'} (${live.size} live)`
  );
  return entry;
}

/**
 * If the owner gains a real client while we are connected, stop driving the
 * size immediately and follow theirs instead.
 */
function followOwners() {
  for (const entry of live.values()) {
    if (entry.closed) continue;
    const nowPinned = isPinned(entry.name);
    if (entry.pinned && !nowPinned) {
      entry.pinned = false;
      log.info(`term ${entry.groupName} unpinned: ${entry.name} has no client`);
      continue;
    }
    if (!nowPinned) continue;
    if (!entry.pinned) {
      entry.pinned = true;
      log.info(`term ${entry.groupName} pinned: a client attached to ${entry.name}`);
    }
    const size = ownerSize(entry.name);
    if (!size || (size.cols === entry.cols && size.rows === entry.rows)) continue;
    try {
      entry.term.resize(size.cols, size.rows);
      entry.cols = size.cols;
      entry.rows = size.rows;
      if (entry.ws.readyState === entry.ws.OPEN) {
        entry.ws.send(JSON.stringify({
          type: 'size', cols: size.cols, rows: size.rows, session: entry.name, pinned: true,
        }));
      }
    } catch { /* raced with exit */ }
  }
}

function cleanup(entry) {
  if (entry.closed) return;
  entry.closed = true;
  live.delete(entry.id);
  try { entry.term.kill(); } catch { /* already gone */ }
  // Kill OUR grouped session only — never the session it is grouped with.
  run('tmux', ['kill-session', '-t', exactTarget(entry.groupName)])
    .then((r) => {
      if (!r.ok && !/can't find session|no server running/i.test(r.stderr)) {
        log.warn(`failed to kill ${entry.groupName}: ${r.stderr.trim()}`);
      }
      return releaseOwner(entry.name);
    })
    .catch((err) => log.error('terminal cleanup failed', String(err)));
  log.info(`term ${entry.groupName} detached (${live.size} live)`);
}

/** Upgrade handler for /ws/term/<name>. Returns true if it handled the request. */
export function attach(req, socket, head, url) {
  const m = /^\/ws\/term\/(.+)$/.exec(url.pathname);
  if (!m) return false;
  const name = decodeURIComponent(m[1]);

  const reject = (why) => {
    log.warn(`term refused for ${JSON.stringify(name)}: ${why}`);
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  };

  if (!isSafeSessionName(name)) return reject('unsafe name');
  if (WEB_SUFFIX.test(name)) return reject('refusing to attach to a web session');
  if (!state.get(name)) return reject('not in inventory');
  if (!ownerSize(name)) return reject('owner pane size unknown');

  const want = { cols: Number(url.searchParams.get('cols')), rows: Number(url.searchParams.get('rows')) };
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachTerminal(ws, name, want).catch((err) => {
      log.error('term attach failed', err?.stack || String(err));
      try { ws.close(); } catch { /* already closed */ }
    });
  });
  return true;
}

export function liveCount() { return live.size; }

const follow = setInterval(followOwners, 2000);
follow.unref();

export async function shutdown() {
  for (const entry of [...live.values()]) cleanup(entry);
  for (const [name, rec] of [...owners]) {
    owners.delete(name);
    await restoreOwner(name, rec);
  }
  kvWrite(KV_GEOMETRY, {});
  await sweepStale();
}
