// The room's entry point (spec README "The room process", D128).
// startRoom(ctx) is what server/boot/builder.mjs calls when `cockpit.agent`
// is set, and what the room under test's wrapper imports unchanged
// (test/cockpit/stand-ins/room-under-test.mjs, stand-ins.md §1.1).
//
// First version (B1): called without a ctx, as the wrapper does, it boots the
// process the way server/index.mjs does (the board, `mode: builder`); the
// room's own wiring (routes, link, bridge, the `mode: cockpit` process) comes
// with the room process task (T6).
import fs from 'node:fs';
import { config } from '../config.mjs';
import { log } from '../log.mjs';

export async function startRoom(ctx = null) {
  if (ctx) return null; // the room's routes on the board's ctx: T6
  if (config.mode !== 'builder') throw new Error(`startRoom: mode ${JSON.stringify(config.mode)} is not served yet`);
  process.on('unhandledRejection', (err) => log.error('unhandledRejection', err?.stack || String(err)));
  process.on('uncaughtException', (err) => log.error('uncaughtException', err?.stack || String(err)));
  fs.mkdirSync(config.dataDir, { recursive: true });
  await import('./builder.mjs');
  return null;
}
