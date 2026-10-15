// Route module: what this builder can launch (fleet plan §8 2.7, C12). Builder only.
//
// - adds `launch` to hello.capabilities;
// - hello field `repos`: the names in config.repos, nothing else (no paths, no
//   discovered checkouts). The hub's placement (§3 H8) gates on it, and also on
//   its own fleet.builders[].repos allowlist, because this claim is untrusted;
// - hello field `permissionModes`: fleet.allowedPermissionModes, narrowed to the
//   modes `claude --help` lists (read once at start, launch.loadPermissionModes).
// No HTTP route of its own: `launch` (with `dryRun`) is reached through
// POST /api/v1/actions (server/fleet/builtin-actions.mjs).
import { addCapability, addHelloField } from '../fleet/api-v1.mjs';
import * as launcher from '../lanes/launch.mjs';

/** hello.repos: unique, string names from config.repos, in config order. */
export function repoNames(cfg) {
  const repos = Array.isArray(cfg?.repos) ? cfg.repos : [];
  const out = [];
  for (const r of repos) {
    const name = r?.name;
    if (typeof name === 'string' && name && !out.includes(name)) out.push(name);
  }
  return out;
}

function addField(name, fn) {
  try {
    addHelloField(name, fn);
  } catch (err) {
    // A second load of this module (tests) is a no-op; any other refusal is a bug.
    if (!/already registered/.test(String(err?.message))) throw err;
  }
}

export default {
  name: 'launch-caps',
  modes: ['builder'],
  register(ctx) {
    const cfg = () => ctx.config;
    addCapability('launch');
    addField('repos', () => repoNames(cfg()));
    addField('permissionModes', () => launcher.offeredPermissionModes(cfg()));
  },
  start(ctx) {
    launcher.loadPermissionModes().then((modes) => {
      if (!modes.length) ctx.log?.warn?.('launch-caps: claude --help listed no --permission-mode choices; offering the allowlist as is');
    });
  },
};
