// The `tailscale` feeder: the tailnet as this machine sees it, from
// `tailscale status --json`. No API key and no network: the local CLI only.
// The cost is that it sees what this node may see (a policy can hide peers).
//
// The JSON is Go's `ipnstate.Status`, with no stability promise, so every
// field is read defensively: missing is unknown, never an error. What never
// leaves this module: login names (`User`), keys (`PublicKey`,
// `sshHostKeys`) and `AuthURL`.
import { run } from '../util.mjs';

export const name = 'tailscale';

const DEFAULT_EVERY = 60; // seconds; a timer next to the CLI pushes this often

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

/** What `ssh <name>` resolves: the MagicDNS label, else the HostName. */
export function nodeName(p) {
  const label = typeof p?.DNSName === 'string' ? p.DNSName.split('.')[0] : '';
  const raw = label || (typeof p?.HostName === 'string' ? p.HostName : '');
  return raw.trim().toLowerCase();
}

/** `LastSeen` in ms, or null. Online peers carry Go's zero time (year 1). */
export function lastSeenMs(v) {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms >= Date.UTC(1971, 0, 1) ? ms : null;
}

function describe(p) {
  const tags = strings(p.Tags);
  const ips = strings(p.TailscaleIPs);
  const os = typeof p.OS === 'string' && p.OS ? p.OS : null;
  const detail = {};
  if (os) detail.OS = os;
  if (ips.length) detail.IPs = ips.join(', ');
  if (tags.length) detail.Tags = tags.join(', ');
  const routes = strings(p.PrimaryRoutes);
  if (routes.length) detail.Routes = routes.join(', ');
  if (p.ExitNode) detail['Exit node'] = 'in use';
  else if (p.ExitNodeOption) detail['Exit node'] = 'offered';
  const out = { tags, ips, detail };
  if (os) out.os = os;
  return out;
}

/**
 * `tailscale status --json` -> one feed. Pure: `now` is the feed's `at`.
 * Peers are `guests` of type `tailnet`, `running` while connected to the
 * control plane (`Online`), `stopped` otherwise (the Map draws a stopped
 * tailnet peer at rest, "offline, last seen …"). Nodes shared into this
 * tailnet (`ShareeNode`) are left out, as the CLI's own listing does.
 */
export function toFeed(status, { source = 'tailscale', now = Date.now(), every = DEFAULT_EVERY } = {}) {
  const self = status?.Self && typeof status.Self === 'object' ? status.Self : null;
  const peers = status?.Peer && typeof status.Peer === 'object' ? Object.values(status.Peer) : [];
  const guests = [];
  for (const p of peers) {
    if (!p || typeof p !== 'object' || p.ShareeNode) continue;
    const name = nodeName(p);
    if (!name) continue;
    const { tags, ips, os, detail } = describe(p);
    const online = p.Online === true;
    const g = { name, type: 'tailnet', status: online ? 'running' : 'stopped', tags, ips };
    if (os) g.os = os;
    const seen = online ? null : lastSeenMs(p.LastSeen);
    if (seen != null) {
      g.lastSeen = seen;
      detail['Last seen'] = new Date(seen).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    if (Object.keys(detail).length) g.detail = detail;
    // An expired key drops the node off the tailnet at its next reconnect.
    g.alerts = p.Expired === true ? [{ level: 'warn', text: 'node key expired' }] : [];
    guests.push(g);
  }
  guests.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const online = guests.filter((g) => g.status === 'running').length;
  const host = { sub: `tailnet · ${online}/${guests.length} peers online`, alerts: [] };
  if (self) {
    const { tags, ips, os, detail } = describe(self);
    const name = nodeName(self);
    if (name) host.name = name;
    if (os) host.os = os;
    host.tags = tags;
    host.ips = ips;
    if (Object.keys(detail).length) host.detail = detail;
  }
  for (const h of strings(status?.Health)) host.alerts.push({ level: 'warn', text: h });
  return { source, at: now, every, host, guests, events: [] };
}

/**
 * Run `tailscale status --json` once. `{ok:true, input}` only when the daemon
 * is up and logged in: a stopped or logged-out tailscale has no peers to
 * report, and an empty feed would draw every node as gone.
 */
export async function read({ bin = 'tailscale', timeoutMs = 10000, runImpl = run } = {}) {
  const r = await runImpl(bin, ['status', '--json'], { timeout: timeoutMs });
  if (r.code === 'ENOENT') return { ok: false, error: `${bin} not found` };
  if (r.signal) return { ok: false, error: `${bin} status timed out after ${Math.round(timeoutMs / 1000)}s` };
  if (!r.ok) {
    const why = String(r.stderr || '').trim().split('\n')[0];
    return { ok: false, error: `${bin} status failed${why ? `: ${why.slice(0, 200)}` : ''}` };
  }
  let input;
  try { input = JSON.parse(r.stdout); } catch { return { ok: false, error: `${bin} status did not print JSON` }; }
  if (!input || typeof input !== 'object') return { ok: false, error: `${bin} status did not print JSON` };
  if (input.BackendState !== 'Running' || !input.Self) {
    return { ok: false, error: `tailscale is ${input.BackendState || 'not running'}` };
  }
  return { ok: true, input };
}
