# Changelog

## 0.1.0 — 2026-09-23

First public release. Extracted from a private cockpit built for one host,
with a clean history: nothing that named that host, its people or its repos
came along, and a test keeps it that way.

**The board.** One page over every Claude Code session on a machine, grouped
into lanes — a lane being a git worktree with one branch, one plan and one
piece of work. Four views: Board (lane cards, sorted by what most needs a
person), Morning (what needs you, what finished, what it cost, over a window),
Credit (the 5 h and 7 d rate-limit windows, and spend per lane), Box (the
machine, the guard, the CI queue, the agent slots). Keyboard throughout; a
rail and a terminal dock above 2000 px.

**Lanes.** `launch` turns a plan pushed on a branch into a worktree, a venv, a
private database slot and an agent session whose environment is verified from
`/proc` before the kickoff prompt is typed. `retire` shows readiness and never
acts on it: it refuses a live session always, and a dirty or unmerged lane
without `--force` plus the lane id typed back.

**Terminals.** Every session reachable over a WebSocket-attached pty, pinnable
into a dock.

**Markers, push and cost.** The lines a lane prints when it wants something are
collected from hooks, the pane and watch logs, pushed to a phone as Web Push,
and shown first on the card. Cost is labelled API-equivalent, next to the
rate-limit windows that are the real constraint.

**Configuration.** One JSON file, every key optional, every key also an
environment variable; with no file at all laneboard runs a board of sessions
and terminals on any machine. Everything site-specific sits behind three small
provider interfaces — slots, guard, CI — each with a `none` implementation.

Node 24, one process, six dependencies, no build step. 394 tests.

Measured with ten sessions on the board: 105 MB RSS, 0.5 % CPU, hook latency
under a millisecond.
