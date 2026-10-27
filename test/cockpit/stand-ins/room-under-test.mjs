// The room under test (spec stand-ins.md §1): the real room, started by
// test/helpers/boot.mjs as `boot({entry: ROOM_UNDER_TEST})`. Three things,
// then the room's normal boot, unchanged:
//   1. the room's clock becomes a test clock (`real` until POST /clock says
//      `manual`): setClock() on server/cockpit/clock.mjs
//   2. the fault hooks: setFaults() on server/cockpit/faults.mjs
//   3. the control port on 127.0.0.1 (room-control.mjs), announced as one
//      stdout line `control 127.0.0.1:<port>`, which boot() reads as
//      `booted.control`
// Nothing here is reachable from the room's own port, and nothing in server/
// reads a test flag (D109).
//
// Started any other way (`node --test` runs every .mjs under test/, or by
// hand) it has no isolated state dir: it prints its usage and exits 0 rather
// than boot a room on the user's own files (B23).
if (!process.env.LANEBOARD_STATE_DIR) {
  process.stdout.write('usage: started by test/helpers/boot.mjs as boot({entry: ROOM_UNDER_TEST}), which sets LANEBOARD_STATE_DIR and the rest of the isolation (spec stand-ins.md §1.1)\n');
  process.exit(0);
}

const { config } = await import('../../../server/config.mjs');
const { createTestClock, setClock } = await import('../../../server/cockpit/clock.mjs');
const { setFaults } = await import('../../../server/cockpit/faults.mjs');
const { createRoomControl } = await import('./room-control.mjs');

const clock = createTestClock();
setClock(clock);
const control = createRoomControl({ clock, timeZone: config.timezone });
setFaults(control.hooks);
const address = await control.listen();
process.stdout.write(`control ${address}\n`);

const { startRoom } = await import('../../../server/boot/cockpit.mjs');
await startRoom();
