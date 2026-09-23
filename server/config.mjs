// Configuration.
//
// Three layers, each winning over the one before it:
//
//   defaults   the generic values in this file. They are not one host's
//              settings: a laneboard with no config file at all runs a board
//              of sessions and terminals with every provider off.
//   file       ~/.config/laneboard/config.json, or $LANEBOARD_CONFIG. A
//              missing file is not an error; a malformed one is fatal, and
//              says which file and which line.
//   env        LANEBOARD_* — the same keys, for a scratch instance or a unit
//              override. Always wins.
//
// Anything derived (paths under $HOME, poll intervals, the compiled marker
// patterns) is computed after the merge and is not a config key. Every config
// key is documented in docs/config.md.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * The provider names each kind accepts. Not imported from
 * server/providers/index.mjs: that module reads `config` to choose, and a
 * cycle between the two would be a trap for whoever next moves an import.
 * server/providers/index.mjs asserts the two lists agree.
 */
export const PROVIDERS = {
  slots: ['none', 'agent-stack'],
  guard: ['none', 'ports'],
  ci: ['none', 'gh'],
};

const HOME = os.homedir();
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** A comma-separated env value as a list, or undefined when it is unset. */
const list = (v) => (v === undefined || v === null || v === '' ? undefined : String(v).split(',').map((a) => a.trim()).filter(Boolean));
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// --- the defaults ------------------------------------------------------------

/** Every key a config file may set, with the value used when it does not. */
export function defaults() {
  return {
    port: 7777,
    // Loopback only, by design: laneboard has no login and can type into
    // terminals. Remote access belongs to a reverse proxy in front of it that
    // does the authentication — never a public bind, never 0.0.0.0.
    bind: ['127.0.0.1'],
    // Where a browser reaches laneboard: the VAPID subject, and the "needs
    // HTTPS" hint on the push button. Web Push needs an https origin, so a
    // real install points this at whatever terminates TLS in front of us.
    publicUrl: 'http://127.0.0.1:7777',
    // Shown next to the brand in the header; a label, not a route.
    hostname: os.hostname(),
    // What a kickoff prompt calls the person it reports to.
    human: 'the human',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',

    nodeBin: '/usr/bin',
    claudeBin: path.join(HOME, '.local/bin/claude'),
    // Main checkouts live here, and a lane's worktree beside them as
    // <repo>-<lane>. It is also what GET /api/dirs offers.
    codeDir: path.join(HOME, 'code'),
    // One directory per launched lane: its record and its kickoff prompt.
    // Never inside a worktree — an untracked file would show the lane dirty.
    lanesDir: path.join(HOME, 'lanes'),
    // The kickoff template a launch renders. A repo may name its own.
    kickoff: path.join(REPO_ROOT, 'templates', 'kickoff.md'),

    /**
     * The repos lanes are launched from. The first is the default when
     * `launch` is given no --repo. Each entry:
     *   name      the directory name of the main checkout under codeDir
     *   kickoff   a template for this repo's lanes, instead of the global one
     *   markers   extra marker patterns this repo's lanes print
     * Empty is fine: the board still shows every session and every worktree.
     */
    repos: [],

    /**
     * Agent slots — a private database per lane. `provider` picks the adapter:
     *   none          no slots; launch and retire refuse
     *   agent-stack   an external `agent-stack up|env|down|status <slot>`
     */
    slots: {
      provider: 'none',
      bin: path.join(HOME, 'code/agent-stack/agent-stack'),
      laneSlots: [2, 3, 4],
      // Slots a lane must never take, shown on the Box as reserved.
      reservedSlots: [1],
    },

    /**
     * The guard that keeps agents off something live next to us.
     *   none    nothing is watched
     *   ports   forbiddenPorts must never be reached, healthProbes are shown
     *           on the Box, containerFilter lists matching containers
     * `platformRepo` is the checkout whose test suites fall back to a shared
     * database when no DATABASE_* is set: a session working there with none
     * is `danger` even when no port is forbidden.
     */
    guard: {
      provider: 'none',
      forbiddenPorts: [],
      healthProbes: [],
      containerFilter: '',
      platformRepo: '',
    },

    /**
     * Pull requests and the CI queue.
     *   none   no PR chips, no queue
     *   gh     the `gh` CLI, as the person running laneboard is logged in
     */
    ci: { provider: 'none', repo: '' },

    /**
     * What a lane shouting for help looks like, as `kind -> pattern`.
     *
     * Anchored kinds must start the line, after an optional bullet or quote
     * prefix — that is what stops a lane's OWN prompt, which quotes the
     * markers inside backticks, from registering as a marker. `limit` is
     * prose in the middle of a sentence, so it is matched unanchored and
     * case-insensitively instead.
     *
     * A host adds its own names to `need` (`NEED-HUMAN|NEED-ALEX`); a repo
     * adds them under its own entry in `repos`.
     */
    markers: {
      need: 'NEED-HUMAN|NEED-OWNER',
      blocked: 'BLOCKED',
      done: 'STAGE-DONE|LANE-DONE',
      progress: 'PROGRESS',
      limit: 'hit your limit|usage limit|rate limit|approaching your .{0,20}limit',
    },
  };
}

// --- the file ----------------------------------------------------------------

/** Where the config file is, whether or not it exists. */
export function configPath(env = process.env) {
  return env.LANEBOARD_CONFIG || path.join(HOME, '.config', 'laneboard', 'config.json');
}

/**
 * Where a JSON.parse error is, as { line, column }, so the message can point
 * at something. V8 gives a byte position for a long document and a quoted
 * snippet of the source for a short one; both are turned into an offset here,
 * and neither is guaranteed, so the caller must cope with null.
 */
export function whereInJson(text, err) {
  const msg = String(err?.message || '');
  let index = -1;
  const pos = /position\s+(\d+)/.exec(msg);
  if (pos) {
    index = Number(pos[1]);
  } else {
    const snippet = /"([\s\S]*)"(?:\.\.\.)? is not valid JSON$/.exec(msg);
    if (snippet) {
      const at = text.indexOf(snippet[1]);
      if (at >= 0) {
        const token = /Unexpected token '(.)'/.exec(msg);
        const within = token ? snippet[1].indexOf(token[1]) : -1;
        index = at + (within >= 0 ? within : 0);
      }
    }
  }
  if (index < 0 || index > text.length) return null;
  const upto = text.slice(0, index);
  return { line: upto.split('\n').length, column: upto.length - upto.lastIndexOf('\n') };
}

export class ConfigError extends Error {}

/**
 * Read the config file. A missing file is `{}` — running without one is the
 * normal way to start. Anything else is fatal: a config that cannot be read
 * is not a config that can be guessed at.
 */
export function loadFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return {};
    throw new ConfigError(`cannot read the config file ${file}: ${err?.message || err}`);
  }
  // An empty file is a config with no keys set, not a broken one.
  if (!text.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const at = whereInJson(text, err);
    throw new ConfigError(
      `${file}${at ? `:${at.line}:${at.column}` : ''}: not valid JSON — ${err?.message || err}`
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`${file}: the config must be a JSON object, not ${Array.isArray(parsed) ? 'an array' : typeof parsed}`);
  }
  return parsed;
}

// --- the environment ---------------------------------------------------------

/**
 * The env layer, in the shape of a config file. Only keys that are actually
 * set appear, so an unset variable never overrides the file with a default.
 */
export function fromEnv(env = process.env) {
  const out = defined({
    port: num(env.LANEBOARD_PORT),
    bind: list(env.LANEBOARD_BIND),
    publicUrl: env.LANEBOARD_PUBLIC_URL,
    hostname: env.LANEBOARD_HOSTNAME,
    human: env.LANEBOARD_HUMAN,
    timezone: env.LANEBOARD_TIMEZONE,
    nodeBin: env.LANEBOARD_NODE_BIN,
    claudeBin: env.LANEBOARD_CLAUDE_BIN,
    codeDir: env.LANEBOARD_CODE_DIR,
    lanesDir: env.LANEBOARD_LANES_DIR,
    kickoff: env.LANEBOARD_KICKOFF,
    repos: list(env.LANEBOARD_REPOS)?.map((name) => ({ name })),
  });
  const slots = defined({
    provider: env.LANEBOARD_SLOTS_PROVIDER,
    bin: env.LANEBOARD_AGENT_STACK,
    laneSlots: list(env.LANEBOARD_LANE_SLOTS)?.map(Number),
    reservedSlots: list(env.LANEBOARD_RESERVED_SLOTS)?.map(Number),
  });
  const guard = defined({
    provider: env.LANEBOARD_GUARD_PROVIDER,
    forbiddenPorts: list(env.LANEBOARD_GUARD_PORTS)?.map(Number),
    containerFilter: env.LANEBOARD_GUARD_CONTAINERS,
    platformRepo: env.LANEBOARD_PLATFORM_REPO,
  });
  const ci = defined({ provider: env.LANEBOARD_CI_PROVIDER, repo: env.LANEBOARD_CI_REPO });
  if (Object.keys(slots).length) out.slots = slots;
  if (Object.keys(guard).length) out.guard = guard;
  if (Object.keys(ci).length) out.ci = ci;
  return out;
}

// --- the merge ---------------------------------------------------------------

/** One level of object merge; a list or a scalar replaces, it never merges. */
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? merge(base[k], v)
      : v;
  }
  return out;
}

/** Enough of a check that a wrong value fails at start rather than at 03:00. */
function validate(c, file) {
  const bad = (msg) => { throw new ConfigError(`${file}: ${msg}`); };
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) bad(`port must be a port number, got ${JSON.stringify(c.port)}`);
  if (!Array.isArray(c.bind) || !c.bind.length) bad('bind must be a non-empty list of addresses');
  if (!Array.isArray(c.repos)) bad('repos must be a list');
  for (const r of c.repos) {
    if (!r || typeof r !== 'object' || !r.name) bad('every entry of repos needs a name');
  }
  // The names come from the provider table itself, so adding a provider is
  // one line there and nothing here.
  for (const [key, allowed] of Object.entries(PROVIDERS)) {
    const p = c[key]?.provider;
    if (!allowed.includes(p)) bad(`${key}.provider must be one of ${allowed.join(', ')}, got ${JSON.stringify(p)}`);
  }
  for (const [kind, source] of Object.entries(c.markers)) {
    try { new RegExp(source); } catch (err) { bad(`markers.${kind} is not a valid regular expression: ${err.message}`); }
  }
  return c;
}

// --- assembly ----------------------------------------------------------------

/** The marker patterns, as collector/markers.mjs compiles them. */
export function markerPatterns(markers, repos = []) {
  const extra = new Map();
  for (const r of repos) {
    for (const [kind, source] of Object.entries(r.markers ?? {})) {
      extra.set(kind, [...(extra.get(kind) ?? []), source]);
    }
  }
  const kinds = new Set([...Object.keys(markers), ...extra.keys()]);
  return [...kinds].map((kind) => ({
    kind,
    source: [markers[kind], ...(extra.get(kind) ?? [])].filter(Boolean).join('|'),
    // `limit` is prose inside a sentence; every other kind is a typed token
    // at the start of a line.
    anchored: kind !== 'limit',
  })).filter((p) => p.source);
}

/** Merge the three layers and add everything derived from them. */
export function build({ env = process.env, file = configPath(env) } = {}) {
  const merged = validate(merge(merge(defaults(), loadFile(file)), fromEnv(env)), file);
  const home = HOME;
  return {
    ...merged,
    configPath: file,
    // `bindAddresses` is what http.mjs listens on; `bind` is the config key.
    bindAddresses: merged.bind,
    home,
    repoRoot: REPO_ROOT,
    dataDir: path.join(REPO_ROOT, 'data'),
    // LANEBOARD_DB overrides the database location. `node --test` runs each
    // test file in its own process and they raced to create the real file, so
    // the suite sets ':memory:' and never touches production data.
    dbPath: env.LANEBOARD_DB || path.join(REPO_ROOT, 'data', 'laneboard.db'),
    logPath: path.join(REPO_ROOT, 'data', 'laneboard.log'),

    claudeDir: path.join(home, '.claude'),
    sessionsDir: path.join(home, '.claude', 'sessions'),
    projectsDir: path.join(home, '.claude', 'projects'),
    settingsPath: path.join(home, '.claude', 'settings.json'),
    statuslinePath: path.join(home, '.claude', 'statusline-command.sh'),
    backupsDir: path.join(home, '.claude', 'backups'),
    // Written by the statusline sidecar, read by collector/statusline.mjs.
    statusCacheDir: path.join(home, '.cache', 'laneboard', 'status'),

    // The repo a `launch` with no --repo uses.
    defaultRepo: merged.repos[0]?.name ?? '',
    repoNames: merged.repos.map((r) => r.name),
    maxActiveLanes: merged.slots.laneSlots.length,
    // Repo roots for GET /api/dirs (depth 2).
    dirRoots: list(env.LANEBOARD_DIR_ROOTS) ?? [merged.codeDir],
    // Sessions laneboard is allowed to create and touch.
    ownSessionPrefixes: ['_laneboard-test', '_laneboard'],

    markerPatterns: markerPatterns(merged.markers, merged.repos),

    tickMs: 2000,
    gitPollMs: 15000,
    // Everything lane-shaped runs at 60 s and sequentially: worktree lists,
    // merged-into-main, plan/status stages, marker scans.
    lanePollMs: 60000,
    guardPollMs: 15000,
    slotsPollMs: 30000,
    vitalsGpuMs: 10000,
    // The capture-pane budget.
    paneCaptureVisibleMs: 1000,
    paneCaptureHiddenMs: 5000,
    // Nobody is looking at a preview when no browser has any card on screen,
    // so back right off — this is the "CPU idle" figure in the budget.
    paneCaptureIdleMs: 15000,
    eventRetentionDays: 30,
  };
}

export const config = (() => {
  try {
    return build();
  } catch (err) {
    // One line an operator can act on, ahead of whatever the runtime adds.
    // A config that cannot be read is not a config that can be guessed at, so
    // the error still propagates and the process still refuses to start.
    if (err instanceof ConfigError) process.stderr.write(`laneboard: refusing to start — ${err.message}\n`);
    throw err;
  }
})();

export default config;
