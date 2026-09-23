// Configuration for laneboard. Every host-specific value comes from the
// environment; the defaults in this file are generic and run on any host.
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const env = process.env;
const list = (v, fallback) => (v ? v.split(',').map((a) => a.trim()).filter(Boolean) : fallback);

export const config = {
  // LANEBOARD_PORT / LANEBOARD_BIND exist so a second copy can be started on a
  // scratch port to verify a fresh clone without disturbing the live one.
  port: Number(env.LANEBOARD_PORT) || 7777,
  // Loopback only, by design: laneboard has no login and can type into
  // terminals. Remote access belongs to a reverse proxy in front of it that
  // does the authentication — never a public bind, never 0.0.0.0.
  bindAddresses: list(env.LANEBOARD_BIND, ['127.0.0.1']),
  // Where a browser reaches laneboard; used for the VAPID subject and the
  // "needs HTTPS" hint. Web Push needs an https origin, so a real install
  // points this at whatever reverse proxy terminates TLS in front of us.
  publicUrl: env.LANEBOARD_PUBLIC_URL || 'http://127.0.0.1:7777',

  // Shown next to the brand in the header; a plain label, not a route.
  hostname: env.LANEBOARD_HOSTNAME || os.hostname(),
  // The name a kickoff prompt uses for the person it reports to.
  human: env.LANEBOARD_HUMAN || 'the human',

  home: HOME,
  repoRoot: path.resolve(import.meta.dirname, '..'),
  dataDir: path.join(path.resolve(import.meta.dirname, '..'), 'data'),
  // LANEBOARD_DB overrides the database location. `node --test` runs each test
  // file in its own process, and they raced to create the real file; the suite
  // sets ':memory:' so tests never touch production data.
  dbPath: process.env.LANEBOARD_DB || path.join(path.resolve(import.meta.dirname, '..'), 'data', 'laneboard.db'),
  logPath: path.join(path.resolve(import.meta.dirname, '..'), 'data', 'laneboard.log'),

  claudeDir: path.join(HOME, '.claude'),
  sessionsDir: path.join(HOME, '.claude', 'sessions'),
  projectsDir: path.join(HOME, '.claude', 'projects'),
  settingsPath: path.join(HOME, '.claude', 'settings.json'),
  statuslinePath: path.join(HOME, '.claude', 'statusline-command.sh'),
  backupsDir: path.join(HOME, '.claude', 'backups'),
  // Written by the statusline sidecar, read by collector/statusline.mjs.
  statusCacheDir: path.join(HOME, '.cache', 'laneboard', 'status'),

  nodeBin: env.LANEBOARD_NODE_BIN || '/usr/bin',
  claudeBin: env.LANEBOARD_CLAUDE_BIN || path.join(HOME, '.local/bin/claude'),

  // The agent stack: a private Postgres/Redis/MinIO per slot, one external
  // script. laneboard calls it and never copies or edits it.
  agentStackBin: env.LANEBOARD_AGENT_STACK || path.join(HOME, 'code/agent-stack/agent-stack'),
  // Slot 1 is left to the human's own manual work; lanes take 2, 3, 4.
  laneSlots: list(env.LANEBOARD_LANE_SLOTS, ['2', '3', '4']).map(Number),
  // Slots a lane must never take, shown on the Box as reserved.
  reservedSlots: list(env.LANEBOARD_RESERVED_SLOTS, ['1']).map(Number),
  maxActiveLanes: 3,
  lanesDir: env.LANEBOARD_LANES_DIR || path.join(HOME, 'lanes'),
  // Main checkouts live here; a lane's worktree is <codeDir>/<repo>-<lane>.
  codeDir: env.LANEBOARD_CODE_DIR || path.join(HOME, 'code'),
  // The repo a `launch` with no --repo uses. Empty means --repo is required.
  defaultRepo: env.LANEBOARD_DEFAULT_REPO || '',
  // The repo whose checkouts must never run without an agent-stack
  // DATABASE_* (their tests would fall back to a shared database). Empty
  // means the preventive environment check has nothing to guard.
  platformRepo: env.LANEBOARD_PLATFORM_REPO || '',
  // The checkout whose `gh run list` is the CI queue on the Box.
  ciRepo: env.LANEBOARD_CI_REPO || env.LANEBOARD_PLATFORM_REPO || '',

  // A live stack next to us: health over HTTP only, never a connection.
  // `containerFilter` is a `docker ps --filter name=` prefix; empty means no
  // container list is collected at all.
  devStack: {
    apiPort: Number(env.LANEBOARD_STACK_API_PORT) || 8000,
    apiPath: env.LANEBOARD_STACK_API_PATH || '/api/health',
    webPort: Number(env.LANEBOARD_STACK_WEB_PORT) || 3000,
    webPath: env.LANEBOARD_STACK_WEB_PATH || '/',
    containerFilter: env.LANEBOARD_STACK_CONTAINERS || '',
  },
  devStackPollMs: 15000,
  slotsPollMs: 30000,
  // Ports an established connection from one of our processes must never
  // reach. Empty by default: a host with no live stack next to it has
  // nothing to guard. LANEBOARD_GUARD_PORTS sets the list.
  guardPorts: list(env.LANEBOARD_GUARD_PORTS, []).map(Number),

  // Sessions laneboard is allowed to create and touch.
  ownSessionPrefixes: ['_laneboard-test', '_laneboard'],

  // Repo roots for GET /api/dirs (depth 2).
  dirRoots: list(env.LANEBOARD_DIR_ROOTS, [path.join(HOME, 'code')]),
  /**
   * Repo prefixes stripped from a worktree basename to get the lane id
   * (`~/code/example-repo-bauplan` is `bauplan`). A main checkout keeps its
   * own name. To add a repo: append its prefix, longest first.
   */
  repoPrefixes: list(env.LANEBOARD_REPO_PREFIXES, []),

  tickMs: 2000,
  gitPollMs: 15000,
  // Everything lane-shaped runs at 60 s and sequentially (v2 hard rule 4):
  // worktree lists, merged-into-main, plan/status stages, marker scans.
  lanePollMs: 60000,
  vitalsGpuMs: 10000,
  // Hard rule 8: capture-pane budget.
  paneCaptureVisibleMs: 1000,
  paneCaptureHiddenMs: 5000,
  // Nobody is looking at a preview when no browser has any card on screen, so
  // back right off — this is the "CPU idle" figure in the budget.
  paneCaptureIdleMs: 15000,
  eventRetentionDays: 30,

  /**
   * What a lane shouting for help looks like. Measured from the real prompts
   * the lanes on this box are given (v2 plan §0).
   *
   * `anchored` patterns must start the line, after an optional bullet or quote
   * prefix — that is what stops a lane's OWN prompt text, which quotes the
   * markers inside backticks, from registering as a marker. The rate-limit
   * phrases are prose in the middle of a sentence, so they cannot anchor and
   * are matched case-insensitively instead.
   *
   * To add one: append a row. Nothing else changes.
   */
  markerPatterns: [
    { kind: 'need', source: 'NEED-HUMAN|NEED-OWNER', anchored: true },
    { kind: 'blocked', source: 'BLOCKED', anchored: true },
    { kind: 'done', source: 'STAGE-DONE|LANE-DONE', anchored: true },
    { kind: 'progress', source: 'PROGRESS', anchored: true },
    { kind: 'limit', source: "hit your limit|usage limit|rate limit|approaching your .{0,20}limit", anchored: false },
  ],
  timezone: env.LANEBOARD_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

export default config;
