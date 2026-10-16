# Fleet mode

One laneboard watches one machine. **Fleet mode** puts several of them behind
one page: every machine that runs agents keeps its own laneboard (a
**builder**), and one more laneboard process in `mode: "hub"` (the **hub**)
shows and drives all of them.

This page is the operator's overview: what the parts are, how they connect,
who may do what, and the order to roll it out in. Each topic has its own page,
linked from [the index](#the-pages) at the end.

## Builders and the hub

| | Builder | Hub |
| --- | --- | --- |
| Runs | next to its agents: tmux, sessions, collectors, hooks, the audit log | on a box of its own: no tmux, no sessions, no collectors, never loads `node-pty` |
| Config | today's config plus a `fleet` block (`fleet.id`, `fleet.ingressPort`, `fleet.hubKeys`, ...) | `mode: "hub"`, `fleet.builders`, `fleet.ingressPort`, `fleet.ingressPeerUid` |
| Holds | its own state, its audit log | the hub key every builder trusts, the fleet's merged view, the hub's audit log, push subscriptions |
| Without the other | keeps working: its own UI, CLI and hooks do not depend on the hub | shows each builder's last snapshot, greyed with its age; refuses actions to it |

A builder with no `fleet` block and no `mode` is exactly the board it was
before fleet mode: nothing on this page changes it until you add the block.

## How they connect

The hub connects out to each builder; a builder never connects to the hub.

```
 browser ──https──▶ tailscale serve ──▶ hub :7778 (ingress) ──https, signed──▶ tailscale serve ──▶ builder :7778 (ingress)
                                                                                              builder :7777 (local: CLI, hooks)
```

- Every laneboard binds loopback only. A builder with a `fleet` block opens a
  second loopback listener, `fleet.ingressPort` (default `7778`), and
  `tailscale serve` targets that port, not `7777`. The main port stays for the
  CLI, the hooks and the status line on that box.
- The hub keeps one signed stream per builder (`/api/v1/stream`), plus
  signed reads (`/api/v1/hello`, snapshot, audit, diff, transcript, ...)
  through a fixed allowlist. It merges what arrives and serves the fleet UI on
  its own `/ws`.
- Actions from the hub UI are **relayed**: the hub signs an envelope and posts
  it to the builder's `POST /api/v1/actions`. Terminals are proxied the same
  way, with a signed `term` envelope.
- A builder that stops sending is `stale` after `fleet.staleMs` and `down`
  after `fleet.downMs`. Actions and terminals to it are refused (503), never
  queued.

## Who is asking

Every request is classified before any route runs, by the listener it
arrived on, never by a header alone:

| Kind | Who | Where |
| --- | --- | --- |
| `local` | anything on that box: CLI, hooks, scripts, agents | the main port, from loopback |
| `direct` | a person, through `tailscale serve` with a `Tailscale-User-Login` | the ingress port |
| `hub` | the hub, with a valid signature from a pinned key | the ingress port of a builder |

A hub accepts `local` and `direct` only; it never takes signed requests.
On top of the kind, every mutating request and upgrade is checked for its
`Host` (with port), an exact `Origin`, `Sec-Fetch-Site` and the header
`X-Laneboard: 1`. The whole contract is in [fleet/auth.md](fleet/auth.md).

## Signed actions and the audit log

Everything is Ed25519, and a signature only ever travels in headers.

- **Reads** sign `v1 <METHOD> <builder id> <path and query> <ts> <nonce>`,
  so a request signed for one builder fails on another.
- **Actions** are an envelope `{v, id, ts, builder, action, target, args,
  user, via: "hub"}`, signed over its canonical JSON. `id` is a UUID the
  builder has never seen, so a captured action cannot be replayed.
- **Every action** that got past authentication, refusals included, is
  appended to the builder's hash-chained audit log; every relayed action also
  to the hub's. The hub anchors each builder's chain head, reconciles relayed
  actions against the builder's entries, and raises `audit-fork` when a
  builder's log is rewritten behind an anchor. If the log cannot be written,
  nothing runs (503 `audit-unavailable`).

Every action, whoever sends it, goes through one dispatcher: server-side
confirmation tiers (a `*` target needs the builder id typed back; fleet-wide
actions need `fleet` typed on the hub), strict per-action argument checks,
`fleet.allowedPermissionModes` for `launch` and `spawn`, and rate limits.

## Scopes: what the hub may do

Each builder pins the hub's public key in `fleet.hubKeys`, and the entry
decides what that key may do:

| Entry | The hub may |
| --- | --- |
| a bare string `"ed25519:…"` | read only (fail-safe) |
| `{key, id, scopes: ["read", "control"]}` | read, and relay actions |
| `{key, id, scopes: ["read", "control", "term"]}` | read, relay actions and open terminals |

`fleet.hubControl` is a master switch on the builder, default `false`: while
it is off, the hub can only read, whatever the scopes (403
`control-disabled`). A key without the scope gets 403 `scope-missing`.

## Remote-only

Some actions must never come from the box they act on, so an agent cannot use
the local API to wave itself through. They answer 403 `remote-only` for
`local`:

- `approve`, `deny`, `release` (an agent must not answer its own permission
  request);
- `set-budget`;
- `kill *` (the builder kill switch) and its cancel;
- `resume` with `override`, or of a session held by a `budget` or `quota`
  pause.

They work for a `direct` user and for a hub key with `control` (and
`hubControl` on). On the hub itself **every** action, terminal, audit rebase
and notification setting needs a `direct` user: a process on the hub box
cannot drive the fleet through the loopback listener.

Every guard on a builder is cooperative against an agent that has a shell on
that builder. The boundary these rules hold is between machines; read
`SECURITY.md` for what they do not protect.

## The views

The Map is the home view. The same views run on a builder (one builder) and on
the hub (the fleet); the builder rail on the left and `[` `]` scope them to one
builder.

| View | Keys | What |
| --- | --- | --- |
| **Map** `#/map` | `g m` | Home. Every builder as a node under the room that hosts it, its lanes and sessions, the packages they touch, and touch, conflict, package and CI links; overlays for status, CI, cost, context and age (`o`). `\` splits it with a dense lane table. See [map.md](map.md). |
| **Board** `#/board` | `g b` | One data block per lane and session: builder code, state, lane, stage, PR and checks, context, 5 h spend, age. |
| **Inbox** `#/inbox` | `g i` | Pending approvals, lanes that need you, the review queue, paused and stuck lanes; `a` `d` `r` `p` approve, deny, release, pause. |
| **Packages** `#/packages` | `g p` | Every package of every repo: CI on main, untested commits, touching lanes, PRs, conflicts, plans. See [fleet/packages.md](fleet/packages.md). |
| **Morning** `#/morning` | `g o` | The night by builder: what needs you, what finished, review waits, stuck incidents, approvals answered, cost by package, held notifications. |
| **Credit** `#/credit` | `g c` | Per-builder cost and per-account rate-limit windows. |
| **Box** `#/box` | `g x` | Every builder's link state, version, clock skew, latency and health with sparklines. |
| **Audit** `#/audit` | `g a` | The hub's audit log with each relayed action's reconciliation state and fork alarms (on a builder: its local chain). |
| **Diff** `#/diff` | from a lane | A lane's changes; batch line comments into one review sent to the lane. |
| **Archive** `#/board?s=archive` | from the Board | Retired lanes, searchable, restorable through a confirmed launch. |

`⌘K` opens the command palette, `?` lists every key. The inspector on the
right holds the selected lane's details, peek, diff and actions; on a phone a
bottom sheet replaces it.

## Rollout

Roll out in this order. Each step is safe to stop at: the fleet keeps working
at every point, and every builder keeps its own UI throughout.

1. **Upgrade the builders, still in builder mode.** Deploy the new version
   with no `fleet` block and no `mode`. Nothing changes: check `/healthz`, that
   `/api/v1/hello` says `mode: "builder"`, and that your existing config still
   loads. Re-run `deploy/install-claude.sh` to register the new hook events.
2. **Add the fleet block and point `tailscale serve` at the ingress port,
   together.** Add `fleet.id` (and `fleet.code`) to each builder's config,
   restart, then move serve from `7777` to `fleet.ingressPort`:
   `tailscale serve --bg --https=8443 http://127.0.0.1:7778`. Do both in one
   go: once the block exists, requests serve still delivers to the main port
   lose their Tailscale identity and are refused with a log line telling you
   to move serve. Open the board through serve and look for `bad-host` 403s
   (fix `publicUrl`, `fleet.publicHosts` or `fleet.allowedOrigins`).
3. **Start the hub on a pinned commit.** On its own box, a detached checkout
   of a tag or SHA you reviewed (never a branch an agent can push), installed
   with `npm ci --ignore-scripts`. Create the key with `laneboard fleet
   keygen`, configure `mode: "hub"`, `fleet.builders`, `fleet.ingressPort` and
   `fleet.ingressPeerUid`, and serve its ingress port the same way.
4. **Pin the hub key on the builders, read-only.** Add the key from `laneboard
   fleet pubkey` to `fleet.hubKeys` as a bare string and leave
   `fleet.hubControl` off. Set `push.local: true` on each builder for now:
   pinning a hub key otherwise turns the builder's own push off before the
   hub's works. Check that the hub shows every builder `up`.
5. **Enable control.** When you want to act from the hub, change the entry to
   `{key, id: "hub", scopes: ["read", "control", "term"]}` (leave out what you
   do not need) and set `fleet.hubControl: true`. Approve one prompt from the
   hub and check that the audit entry exists on both sides
   (`laneboard audit verify` on the builder).
6. **Move the map feeds to the hub.** A builder with a hub key stops reading
   `map.feedsDir`; the hub reads its own. Point the feed pushers at the hub
   box ([map.md](map.md#on-a-hub)).
7. **Move push to the hub.** Subscribe from the hub's page on your phone, set
   notification kinds and quiet hours there, then remove `push.local: true`
   from the builders so they fall back to auto (off with a hub key).

Optional hardening at any point: `fleet.hubAddrs` and `fleet.ingressPeerUid`
on builders, `fleet.allowedUsers` on builders and hub. To rotate the hub key,
see [fleet/auth.md](fleet/auth.md#rotating-the-hub-key).

## When things go wrong

- **A builder is `stale` or `down`:** its last snapshot stays visible, greyed;
  nothing is queued for it. A builder whose hello names another id is
  `misconfigured`, one with another API version `incompatible`; both are
  read-only.
- **The board does not obey:** `laneboard pause --all` on the builder works
  with the server down; then `tmux kill-session`. The runbook is in
  [fleet/control.md](fleet/control.md#runbook-out-of-band-kill).
- **`audit-fork`:** a builder's log no longer contains the head the hub
  anchored. After checking the reset was yours, rebase from the hub with
  `POST /api/fleet/audit/rebase` and the builder id typed as `confirm`; see [fleet/control.md](fleet/control.md#audit-repair-a-corrupt-audit-line-blocks-actions).

## The pages

| Page | What |
| --- | --- |
| [install.md](install.md#fleet-mode) | setting up builders, the hub key, pinning, the hub |
| [fleet/auth.md](fleet/auth.md) | classification, scopes, signatures, remote-only, the audit log, key rotation, refusal codes |
| [fleet/identity.md](fleet/identity.md) | `fleet.id`, `fleet.code`, `fleet.allowedOrigins` |
| [fleet/hub.md](fleet/hub.md) | hub config, who may do what on the hub, its endpoints, degraded modes |
| [fleet/control.md](fleet/control.md) | approvals, pause, budgets and the quota guard, broadcast, kill switches, the hook installer, the out-of-band runbook |
| [fleet/packages.md](fleet/packages.md) | packages, CI per package, lanes touching packages, conflict prediction, plans |
| [fleet/review.md](fleet/review.md) | the review workflow: diff, send-review, scripts, and its residual risk |
| [fleet/map.md](fleet/map.md) | what fleet adds to the Map model: builder nodes, sessions, repos, new links |
| [map.md](map.md) | the Map itself: topology, feeds, overlays, keys |
| [config.md](config.md#fleet-keys) | every fleet config key, its default and its environment variable |
| `SECURITY.md` | the threat model and the accepted risks |
