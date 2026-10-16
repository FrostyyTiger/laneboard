// The hook for fleet-derived services on the hub (fleet plan §3 2.9, H11).
//
//   const services = createServices({log});
//   services.register({name, start(ctx) -> stop?})   // from a hub module's register(ctx)
//   await services.startAll(ctx)                      // boot/hub.mjs, after every module registered
//   await services.stopAll()                          // shutdown, newest first
//   services.names() / services.running()
//
// `ctx` is what boot/hub.mjs hands every service: {store, push, audit,
// broadcast, relay, readProxy, onClientMessage, config, now} (plus `view`, a
// cached store view shared with the map loop and the core routes, and `log`).
// It is frozen: a service cannot swap another one's dependency.
//
// Rules:
//   - a name is registered once (a duplicate throws, like a duplicate module);
//   - startAll runs every start in registration order; a start that throws is
//     logged and skipped, so one broken service never keeps the hub (and its
//     read-only fleet view) from coming up;
//   - start may return a stop function (or a promise of one), or nothing;
//   - a service registered after startAll starts at once with the same ctx;
//   - stopAll calls the stops in reverse order, each at most once, and swallows
//     their errors (logged).
// Alarms (§7 O8), notifications (§7 O9), review-wait (§7 O10) and the packages
// merge (§6 P11) register here. Stuck detection and budget caps run on the
// builders and do not.

const NAME_RX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export class ServiceError extends Error {}

export function createServices({ log = null } = {}) {
  const registered = []; // {name, start}
  const names = new Set();
  const running = []; // {name, stop}
  let ctxStarted = null;
  let stopping = false;

  const say = (level, ...args) => {
    try { log?.[level]?.(...args); } catch { /* never fail on logging */ }
  };

  async function startOne(svc, ctx) {
    let stop;
    try {
      stop = await svc.start(ctx);
    } catch (err) {
      say('error', `hub service ${svc.name}: start failed`, err?.stack || String(err));
      return false;
    }
    running.push({ name: svc.name, stop: typeof stop === 'function' ? stop : null });
    return true;
  }

  function register(svc) {
    if (!svc || typeof svc !== 'object') throw new ServiceError('service must be an object {name, start}');
    const { name, start } = svc;
    if (typeof name !== 'string' || !NAME_RX.test(name)) throw new ServiceError('service name must be a short identifier');
    if (typeof start !== 'function') throw new ServiceError(`service ${name}: start(ctx) is required`);
    if (names.has(name)) throw new ServiceError(`service '${name}' is already registered`);
    if (stopping) throw new ServiceError(`service ${name}: the hub is shutting down`);
    names.add(name);
    const entry = { name, start };
    registered.push(entry);
    // Late registration: start it now with the ctx everyone else got.
    if (ctxStarted) return startOne(entry, ctxStarted).then(() => undefined);
    return undefined;
  }

  async function startAll(ctx = {}) {
    if (ctxStarted) throw new ServiceError('services already started');
    ctxStarted = Object.freeze({ ...ctx });
    const ok = [];
    for (const svc of [...registered]) {
      if (await startOne(svc, ctxStarted)) ok.push(svc.name);
    }
    if (ok.length) say('info', `hub services: ${ok.join(', ')}`);
    return ok;
  }

  async function stopAll() {
    stopping = true;
    while (running.length) {
      const { name, stop } = running.pop();
      if (!stop) continue;
      try {
        await stop();
      } catch (err) {
        say('error', `hub service ${name}: stop failed`, err?.stack || String(err));
      }
    }
  }

  return {
    register,
    startAll,
    stopAll,
    names: () => registered.map((s) => s.name),
    running: () => running.map((s) => s.name),
  };
}

export default createServices;
