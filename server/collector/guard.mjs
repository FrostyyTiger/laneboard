// The guard's loop: ask the provider every 15 s, turn what comes back into
// `danger` markers, and keep the snapshot the Box renders.
//
// The provider does the looking; this file does the remembering. It never
// acts on a finding — no session is killed, no container is stopped, nothing
// is written anywhere but the marker table.
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { guard as provider } from '../providers/index.mjs';
import * as markers from './markers.mjs';

let deps = { state: null, onDanger: () => {} };
export function init(d) { deps = { ...deps, ...d }; }

let snap = {
  health: [], containers: [], dockerOk: true,
  guard: { ok: true, preventive: [], detective: [], ssOk: true, ports: [], checkedAt: 0 },
  at: 0,
};

export function snapshot() { return { ...snap, provider: provider.name }; }

/** Danger per session name, for the attention score. */
export function dangerFor(name) {
  const g = snap.guard;
  return g.preventive.find((d) => d.session === name) || g.detective.find((d) => d.session === name) || null;
}

function raise(d, check) {
  const who = d.session ? d.session : `pid ${d.pid}`;
  const text = `DANGER: ${check} guard: ${d.reason}${d.session ? '' : ` (${who}, no tmux session)`}`;
  const ts = Date.now();
  // The marker key includes the text, and the text includes the pid, so a new
  // offender is a new marker and the same one is not re-pushed every 15 s.
  const row = { lane: d.lane ?? null, sessionName: d.session ?? null, kind: 'danger', text: `${text} [pid ${d.pid}]`, source: 'guard', ts };
  const id = markers.record(row);
  if (id) {
    log.warn(row.text);
    deps.onDanger({ id, ...row });
  }
}

export async function refresh() {
  const [health, ps] = await Promise.all([provider.health(), provider.containers()]);
  const prev = await provider.preventive(deps.state?.all?.() ?? []);
  const det = await provider.detective((session) => deps.state?.get?.(session)?.lane ?? null);
  for (const d of prev) raise(d, 'preventive');
  for (const d of det ?? []) raise(d, 'detective');
  snap = {
    health,
    containers: ps.list ?? snap.containers,
    dockerOk: ps.ok,
    guard: {
      ok: prev.length === 0 && (det?.length ?? 0) === 0,
      preventive: prev,
      detective: det ?? [],
      ssOk: det != null,
      ports: provider.forbiddenPorts(),
      checkedAt: Date.now(),
    },
    at: Date.now(),
  };
  return snap;
}

export function start() {
  if (!provider.active) return;
  const tick = () => refresh().catch((err) => log.error('guard refresh failed', String(err)));
  const first = setTimeout(tick, 3000);
  first.unref();
  const timer = setInterval(tick, config.guardPollMs);
  timer.unref();
}
