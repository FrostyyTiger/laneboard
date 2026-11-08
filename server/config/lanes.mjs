// Config fragment: lanes (docs/lanes-flag.md; runs-first phase 6).
//
//   lanes.enabled  bool, default false. Off: the Board, Packages, Diff, the
//                  archive, launch and retire are not registered: their routes
//                  answer 404, the page does not show them. The code stays.
//
// Env: LANEBOARD_LANES=1|0. This file must not import server/config.mjs (see
// the fragment notes there).

export function defaults() {
  return { lanes: { enabled: false } };
}

export function fromEnv(env = process.env) {
  const v = env.LANEBOARD_LANES;
  if (v === '1') return { lanes: { enabled: true } };
  if (v === '0') return { lanes: { enabled: false } };
  return {};
}

export function validate(c, bad) {
  if (typeof c.lanes?.enabled !== 'boolean') bad('lanes.enabled must be true or false');
}

/** A config that says nothing (a test's stub) keeps lanes; only an explicit false turns them off. */
export const lanesOn = (cfg) => cfg?.lanes?.enabled !== false;
