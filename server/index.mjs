// Laneboard entrypoint: one process, two modes. `mode` (server/config/mode.mjs)
// picks the wiring; everything shared lives in server/boot/common.mjs.
//   builder  today's board: collectors, sessions, terminals (server/boot/builder.mjs)
//   hub      the fleet view over many builders (server/boot/hub.mjs)
//   cockpit  the cockpit's room alone (server/boot/cockpit.mjs, D128)
// Kept as the entrypoint because package.json `main`, deploy/laneboard.service
// and bin/laneboardctl all point here. Frozen after wave 0: add modules instead.
import fs from 'node:fs';
import { config } from './config.mjs';
import { log } from './log.mjs';

process.on('unhandledRejection', (err) => log.error('unhandledRejection', err?.stack || String(err)));
process.on('uncaughtException', (err) => log.error('uncaughtException', err?.stack || String(err)));

fs.mkdirSync(config.dataDir, { recursive: true });

await (config.mode === 'cockpit' ? import('./boot/cockpit.mjs').then((m) => m.startRoom()) : import(config.mode === 'hub' ? './boot/hub.mjs' : './boot/builder.mjs'));
