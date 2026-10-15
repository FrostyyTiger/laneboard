// Laneboard hub mode (config `mode: "hub"`). Wave-0 stub (fleet X1): it
// listens, serves /healthz and the shell, and nothing else. It has no tmux,
// no sessions and no collectors of its own, so it must never import
// server/state.mjs, server/terminals.mjs or anything under server/collector,
// server/routes or server/flags. §3 H11 fills this file in: the fleet store,
// upstreams, relay, the hub ctx services and then loadModules('hub/routes', ctx).
import { log } from '../log.mjs';
import { listenAll, registerHealthz, installSignalHandlers } from './common.mjs';

registerHealthz(() => ({
  mode: 'hub',
  builders: { up: 0, stale: 0, down: 0 },
}));

installSignalHandlers();

await listenAll();

log.info('hub mode: no builders configured');
log.info(`laneboard hub up, pid ${process.pid}`);
