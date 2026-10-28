// Config fragment: which wiring this process runs (server/index.mjs).
//   builder  today's board, the default: with no `mode` and no fleet config,
//            behaviour is exactly as before
//   hub      the fleet view over many builders (server/boot/hub.mjs)
//   cockpit  the cockpit's room alone, beside a hub or a board: /healthz and
//            /api/cockpit/* only (server/boot/cockpit.mjs, D128)
// "both" is refused: server/state.mjs and server/ws.mjs are module
// singletons, so one process cannot be both. A host that wants both runs two.
export const MODES = ['builder', 'hub', 'cockpit'];

export function defaults() {
  return { mode: 'builder' };
}

export function fromEnv(env = process.env) {
  const v = env.LANEBOARD_MODE;
  return v === undefined || v === '' ? {} : { mode: String(v).trim() };
}

export function validate(c, bad) {
  if (c.mode === 'both') {
    bad('mode "both" is not supported: one process is either a builder or a hub; run two laneboard processes for both');
  }
  if (!MODES.includes(c.mode)) bad(`mode must be one of ${MODES.join(', ')}, got ${JSON.stringify(c.mode)}`);
}
