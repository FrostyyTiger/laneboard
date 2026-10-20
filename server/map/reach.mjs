// Reach (docs/map.md "Reach"): who can reach what, from a Tailscale policy
// file the owner exports and names in `map.policyFile`. laneboard only reads
// that file; it never fetches a policy (that would need an API key).
//
// A policy is a list of allow rules, `grants` and legacy `acls`. Access is
// deny by default and rules only add, so the result is a union of edges and
// no rule order matters. A selector is resolved against what the Map knows
// of each node: its tags and its tailnet addresses, from the feeds. What
// needs data the Map does not have (who owns a node, user roles) is counted
// as unresolved with a reason, never guessed.
import fs from 'node:fs';
import { parseHujson } from './hujson.mjs';

export const MAX_RULES = 1000;
export const MAX_LINKS = 2000;
const MAX_LABEL = 60;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : typeof v === 'string' && v ? [v] : []);

// ------------------------------------------------------------------ addresses

function ipv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts.reduce((a, p) => (a << 8n) | BigInt(p), 0n);
}

function ipv6(s) {
  if (!/^[0-9a-f:]+$/i.test(s) || !s.includes(':')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const words = (h) => (h === '' ? [] : h.split(':'));
  const head = words(halves[0]);
  const tail = halves.length === 2 ? words(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (all.some((w) => w === '' || w.length > 4)) return null;
  return all.reduce((a, w) => (a << 16n) | BigInt(parseInt(w, 16)), 0n);
}

/** `192.0.2.1`, `2001:db8::1`, or a CIDR -> {bits, n, len}; else null. */
export function parseAddr(text) {
  const [addr, len, extra] = String(text).split('/');
  if (extra !== undefined) return null;
  const v4 = ipv4(addr);
  const n = v4 ?? ipv6(addr);
  if (n == null) return null;
  const bits = v4 != null ? 32 : 128;
  const l = len === undefined ? bits : /^\d{1,3}$/.test(len) ? Number(len) : NaN;
  if (!(l >= 0 && l <= bits)) return null;
  return { bits, n, len: l };
}

/** Is address `ip` inside `range` (both parsed)? */
export function contains(range, ip) {
  if (!range || !ip || range.bits !== ip.bits) return false;
  const shift = BigInt(range.bits - range.len);
  return (range.n >> shift) === (ip.n >> shift);
}

// ------------------------------------------------------------------ the file

/**
 * A policy document -> `{rules, groups, hosts, ipsets}`. Each rule is
 * `{src: [selector], dst: [{sel, ports: [label]}], via?}`. A grant's ports
 * are its `ip` list (an `app`-only grant gives no network access: skipped);
 * an acl's `dst` is `host:ports`, split on the last colon. `ssh`, `tests`,
 * `sshTests`, `nodeAttrs`, `postures`, `autoApprovers` are not reachability.
 */
export function parsePolicy(doc) {
  if (!isObj(doc)) throw new TypeError('a policy file is a JSON object');
  const rules = [];
  let skipped = 0;
  for (const g of Array.isArray(doc.grants) ? doc.grants : []) {
    const ip = strings(g?.ip);
    if (!isObj(g) || !ip.length) { skipped++; continue; }
    const rule = { src: strings(g.src), dst: strings(g.dst).map((sel) => ({ sel, ports: ip })) };
    const via = strings(g.via);
    if (via.length) rule.via = via;
    rules.push(rule);
  }
  for (const a of Array.isArray(doc.acls) ? doc.acls : []) {
    if (!isObj(a) || (a.action ?? 'accept') !== 'accept') { skipped++; continue; }
    const proto = typeof a.proto === 'string' && a.proto ? a.proto : typeof a.proto === 'number' ? String(a.proto) : null;
    const dst = [];
    // `users` and `ports` are the deprecated names of `src` and `dst`.
    for (const d of strings(a.dst ?? a.ports)) {
      const cut = d.lastIndexOf(':');
      if (cut <= 0) { dst.push({ sel: d, ports: ['*'], bad: true }); continue; }
      const ports = d.slice(cut + 1).split(',').map((p) => p.trim()).filter(Boolean);
      dst.push({ sel: d.slice(0, cut), ports: ports.map((p) => (proto ? `${proto}:${p}` : p)) });
    }
    rules.push({ src: strings(a.src ?? a.users), dst });
  }
  if (rules.length > MAX_RULES) { skipped += rules.length - MAX_RULES; rules.length = MAX_RULES; }
  const table = (v) => (isObj(v) ? v : {});
  return { rules, skipped, groups: table(doc.groups), hosts: table(doc.hosts), ipsets: table(doc.ipsets) };
}

let cache = { file: null, mtimeMs: -1, value: null, error: null };

/**
 * The policy file, re-read when it changes. No file named = `{value: null}`
 * (Reach is off). A file that does not parse keeps the last good policy and
 * says why, like the topology file.
 */
export function loadPolicy(file) {
  if (!file) return { file: null, value: null, error: null };
  let st;
  try { st = fs.statSync(file); } catch {
    cache = { file, mtimeMs: -1, value: null, error: 'policy file not found' };
    return cache;
  }
  if (cache.file === file && cache.mtimeMs === st.mtimeMs) return cache;
  try {
    const value = parsePolicy(parseHujson(fs.readFileSync(file, 'utf8')));
    cache = { file, mtimeMs: st.mtimeMs, value, error: null };
  } catch (err) {
    cache = { ...cache, value: cache.file === file ? cache.value : null, file, mtimeMs: st.mtimeMs, error: `policy file rejected: ${String(err?.message || err).slice(0, 200)}` };
  }
  return cache;
}

// ------------------------------------------------------------------ selectors

const NEEDS_USERS = 'needs who owns each node, which no feed says';

/**
 * One selector -> `{ids}` (a Set of node ids) or `{why}`. `nodes` is a Map
 * id -> `{tags: Set, ips: [parsed]}`, the tailnet nodes only.
 */
export function resolveSelector(sel, policy, nodes, depth = 0) {
  const all = [...nodes.keys()];
  const where = (pred) => ({ ids: new Set(all.filter((id) => pred(nodes.get(id)))) });
  if (sel === '*') return { ids: new Set(all) };
  if (sel.startsWith('tag:')) return where((n) => n.tags.has(sel));
  if (sel === 'autogroup:tagged') return where((n) => n.tags.size > 0);
  // Every untagged tailnet node belongs to a user, and members are users.
  if (sel === 'autogroup:member') return where((n) => n.tags.size === 0);
  if (sel === 'autogroup:internet') return { why: 'the internet through an exit node, not a node' };
  if (sel.startsWith('autogroup:') || sel.startsWith('group:') || sel.includes('@')) return { why: NEEDS_USERS };
  if (sel.startsWith('svc:')) return { why: 'a Tailscale Service, not a node' };
  if (sel.startsWith('ipset:')) {
    const members = policy.ipsets[sel] ?? policy.ipsets[sel.slice(6)];
    if (!Array.isArray(members) || depth > 0) return { why: 'ipset not readable from the file' };
    const ids = new Set();
    for (const m of strings(members)) {
      const r = resolveSelector(m, policy, nodes, depth + 1);
      if (r.why) return { why: `ipset member ${m}: ${r.why}` };
      for (const id of r.ids) ids.add(id);
    }
    return { ids };
  }
  const alias = Object.hasOwn(policy.hosts, sel) ? policy.hosts[sel] : null;
  const range = parseAddr(typeof alias === 'string' ? alias : sel);
  if (range) return where((n) => n.ips.some((ip) => contains(range, ip)));
  return { why: alias != null ? 'host alias is not an address' : 'unknown selector' };
}

/**
 * The policy -> `{links, rules, unresolved, truncated}`. A link is
 * `{id: 'reach:<from>><to>', kind: 'reach', from, to, ports, label}`, one per
 * ordered pair, its ports the union of every rule that allows it. A selector
 * that resolves to no node is listed with why (`no node matches` when it is
 * valid but names nothing on this Map).
 */
export function reachLinks(policy, identities) {
  const nodes = new Map();
  for (const [id, n] of identities ?? []) {
    if (!n.tags.size && !n.ips.length) continue; // not on the tailnet
    nodes.set(id, n);
  }
  const memo = new Map();
  const unresolved = new Map(); // selector -> why
  const resolve = (sel) => {
    if (!memo.has(sel)) {
      const r = resolveSelector(sel, policy, nodes);
      if (r.why) unresolved.set(sel, r.why);
      else if (!r.ids.size) unresolved.set(sel, 'no node matches');
      memo.set(sel, r.ids ?? new Set());
    }
    return memo.get(sel);
  };
  const pairs = new Map(); // "from\0to" -> Set of ports
  let truncated = 0;
  for (const rule of policy?.rules ?? []) {
    const src = new Set();
    for (const s of rule.src) for (const id of resolve(s)) src.add(id);
    for (const d of rule.dst) {
      if (d.bad) { unresolved.set(d.sel, 'acl dst needs host:ports'); continue; }
      for (const to of resolve(d.sel)) {
        for (const from of src) {
          if (from === to) continue;
          const key = `${from}\0${to}`;
          if (!pairs.has(key)) {
            if (pairs.size >= MAX_LINKS) { truncated++; continue; }
            pairs.set(key, new Set());
          }
          for (const p of d.ports) pairs.get(key).add(p);
        }
      }
    }
  }
  const links = [...pairs].map(([key, set]) => {
    const [from, to] = key.split('\0');
    const ports = set.has('*') ? ['*'] : [...set].sort();
    const label = ports[0] === '*' ? 'all ports' : ports.join(', ');
    return { id: `reach:${from}>${to}`, kind: 'reach', from, to, ports, label: label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label };
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    links,
    rules: policy?.rules?.length ?? 0,
    unresolved: [...unresolved].map(([selector, why]) => ({ selector, why })).sort((a, b) => (a.selector < b.selector ? -1 : 1)),
    truncated: truncated || undefined,
  };
}
