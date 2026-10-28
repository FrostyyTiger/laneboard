// The cockpit's named constants (cockpit spec D150, D287, D291; c1-talk.md §16
// "Times at a glance"): every tunable in one file, pure, no imports, so the
// tests and the room import the same names. The room link's backoff keeps
// net.js's names (BACKOFF_START_MS, BACKOFF_FACTOR, BACKOFF_MAX_MS, D263).

// D150
export const EXPLORE_IDLE_S = 60;
export const PANE_IDLE_S = 300;
export const SPLIT_MIN_W = 1280;
export const PANE_W = 608;
export const TYPE_TALK = 28;
export const LINE_TALK = 1.4;
export const HOLD_MS = 400;
export const COCKPIT_PREFIX = '/api/cockpit';
export const DEMO_WAIT_MS = 3000;

// D287, c1-talk.md §16
export const PANE_SLIDE_MS = 120;
export const CONFIRM_WAIT_MS = 5000;
export const AGE_FROM_MS = 3000;
export const TICK_MS = 1000;
export const STOP_GUARD_MS = 1000;
export const QUEUED_RESEND_MS = 10_000;
export const STOP_FORCE_MS = 5000;
export const STOP_TERM_MS = 8000;
export const STOP_KILL_MS = 10_000;
export const HEARTBEAT_MS = 10_000;
export const LINK_SILENCE_MS = 25_000;
export const LINK_GRACE_MS = 5000;
export const SNAPSHOT_WAIT_MS = 5000;
export const RATE_MAX = 10;
export const RATE_WINDOW_MS = 60_000;
export const RETRY_WAIT_MS = 60_000;
export const RESTART_STEPS_S = Object.freeze([0, 2, 4, 8, 16, 30]);
export const READY_WAIT_MS = 30_000;
export const LOGIN_CHECK_S = 900;
export const LOGIN_RECHECK_S = 60;
export const NEWS_MS = 5000;
export const NEWBAR_MS = 10_000;

// D291 (C2), named here so the one file stays whole
export const HINT_MS = 5000;

// c1-talk.md §1.2 (D249, D250): the pane's widths and the floor.
export const FULL_PANE_BELOW_W = 900;
export const FLOOR_W = 700;
export const FLOOR_H = 560;

// protocols.md §2.2: the link's protocol version and the room's 4503 retry.
export const PROTOCOL = 1;
export const TOO_MANY_LINKS_RETRY_MS = 30_000;
// protocols.md §2.3 4429: reconnects after 30 s.
export const TOO_MANY_RETRY_MS = 30_000;
// protocols.md §8: a prompt is at most 8 000 characters (c1-talk.md §7).
export const MAX_PROMPT_CHARS = 8000;
