# Security

## laneboard has no login, by design

It can read every Claude Code session on the machine, type into their
terminals and start new ones. Anyone who can reach the port can do all of
that. There is no login, no session cookie and no password field. A password
field would only make it *look* safe.

So the server binds **`127.0.0.1` only** and everything else follows from
that:

- **Put something in front of it that authenticates.** A tailnet
  (`tailscale serve --https=8443`), a reverse proxy with client certificates,
  an SSO proxy: anything works, as long as it decides who gets through.
  `docs/install.md` has worked examples.
- **Never expose it on a port shared with people you would not hand a shell
  to.** A tailnet node that is shared with an outside collaborator is such a
  port.
- **Never bind it to `0.0.0.0`.** `bind` is a config key because a scratch
  instance sometimes needs a different loopback address. Binding wider is not
  a supported deployment. In fleet mode a non-loopback peer on the main
  listener is refused (403 `not-local`).
- **One person per instance.** Two people who should not be able to type into
  each other's agents need two machines, not two browser tabs.

The terminals carry whatever the sessions carry: SSH keys, cloud
credentials, source. Treat reaching laneboard as equivalent to reaching a
shell on the machine, because it is.

All of this still holds in fleet mode. Fleet mode adds identities and rules
on top. It does not add a login.

## Fleet mode: who may do what

Fleet mode is one hub and several builders. Each builder runs its own
laneboard next to its agents. The hub shows all of them and relays your
clicks. The operator contract (classification, scopes, signatures, the audit
log, key rotation) is in `docs/fleet/auth.md`. Setup is in `docs/install.md`.

### The threat model

**An agent on a builder has a shell there, as the same uid as laneboard.**
Everything follows from that one fact:

- **Builders are untrusted.** The hub treats everything a builder sends as
  data from a possibly hostile source. It recomputes routing keys itself,
  caps sizes and rates, and escapes every builder string before display. A
  builder holds no hub credentials, only the hub's *public* keys.
- **Inside one builder, laneboard's guards are cooperative.** They stop
  mistakes and well-behaved agents. They do not stop an agent that sets out to
  defeat them. Pause, budget, approvals, kill and the builder's own audit log
  all live in files and tmux sessions that the agent's uid can write. Such an
  agent can drive tmux directly, delete pause sentinels, edit the hook
  settings, fake the status-line cost file, edit its lane record or the
  config, run `claude` itself, and rewrite and re-chain the local audit log.
- **The boundary that must hold is cross-machine.** An agent on `builder-a`
  must not reach `builder-b`, the hub, or your own devices. That is what the
  signatures, scopes, the ingress rules and the tailnet policy protect.
- **The hub is the crown jewel.** It holds the signing key that builders
  accept. It must run a commit that a human reviewed and pinned (a tag or a
  SHA in a detached checkout, installed with `npm ci --ignore-scripts`), never
  whatever a builder agent last pushed. Builder agents write laneboard's own
  code, so "deploy `main` on the hub" would let any of them write the code
  that holds the fleet key.

### Remote-only actions

Some actions are **remote-only**. They are refused (403 `remote-only`) for
the `local` kind: any process on the builder itself (CLI, hooks, scripts,
agents). They are allowed for a `direct` user who came through
`tailscale serve`, and for a signed hub request whose key has the `control`
scope:

- `approve`, `deny` and `release` of a permission request;
- `set-budget`;
- `kill *` (every session on the builder);
- `resume` with `override`, and `resume` of a session held by a `budget` or
  `quota` pause.

This closes one path: an agent approving its own permission request, or
lifting its own budget pause, by calling the local API. It does **not** make
the on-builder guards a security boundary (see above).

**Remote-only needs a `fleet` block.** Without one there is no ingress
listener, every request is `local` by definition, and nothing can tell your
click from an agent's `curl`. The server logs a warning at boot in that case.

On the hub, every action and every terminal needs a `direct` user. A process
on the hub box cannot drive builders through the hub's loopback listener.

### What is protected

| Against | Protection |
| --- | --- |
| Another tailnet web page opening a terminal or posting an action (CSRF, cross-site WebSocket) | Exact Origin check (never same-site), `Sec-Fetch-Site`, Host allowlist with port, `X-Laneboard: 1` on every mutation, JSON content type on v1 actions, no CORS headers ever |
| DNS rebinding to the loopback port | Host allowlist |
| A tagged tailnet node let in by an ACL mistake | `fleet.enforce` (on with a `fleet` block): unidentified ingress gets 403 |
| A forged `Tailscale-User-Login` from a local process on the main port | Every `Tailscale-*` header is deleted on the local listener before any handler sees it |
| A request on the ingress port that did not come through serve | 403 `not-from-serve` without serve's `X-Forwarded-For` and `X-Forwarded-Proto: https`; with `fleet.ingressPeerUid`, also when the socket is not owned by tailscaled's uid |
| A captured hub request replayed | Signed timestamp (±60 s), UUID nonce, nonce cache pre-loaded from the audit log at boot, builder id bound into what is signed |
| A request meant for one builder replayed against another | The builder id is part of every signature and every envelope |
| A read-only hub key used to act or open a terminal | Per-key scopes (`read`, `control`, `term`) and the `fleet.hubControl` master switch on each builder |
| A destructive click by mistake | Server-side confirm tiers (the typed target, or the builder id for `*`), rate limits |
| A launch in `bypassPermissions` | `fleet.allowedPermissionModes` (the default leaves out `bypassPermissions` and `dontAsk`) |
| Escape sequences from a builder in your terminal | The CLI strips control characters from every server string it prints |

### What is not protected

These are the accepted risks, stated plainly:

1. **Total control of an agent's own builder.** Without separate uids for the
   agents and laneboard, nothing laneboard does can stop an agent on a builder
   from killing, approving, unpausing, faking cost files or rewriting its
   local audit log *on that builder*. Remote-only rules close the local-API
   path only. A separate uid for laneboard is phase 2.
2. **No Bash sandbox for `default`-mode lanes and no root-owned managed hook
   settings yet.** The setting names are not verified on the installed Claude
   Code version, and a wrong setting could block every lane silently.
3. **The ingress peer-uid check is opt-in on builders.** Until
   `fleet.ingressPeerUid` is set, a local process can connect to the ingress
   port, send serve-like headers and become any `direct` user, which passes
   remote-only. That is inside the cooperative model of item 1. The server
   warns once per boot while it is unset. **On the hub it is required**: there
   a forged `direct` user would mean a terminal on every builder.
4. **No separate signer process on the hub.** The hub's web process holds the
   key. Mitigations: pinned deploy, `--ignore-scripts`, systemd sandboxing, a
   separate user for map feeds, remote-only hub control, and the builder-side
   scopes and master switch.
5. **No Trusted Types on the hub.** The rest of the CSP is enforced, and a
   lint forbids `innerHTML` with data in the frontend.
6. **No per-action restrictions per key.** Three scopes cover the rollout.
7. **A hub compromise reaches every builder's secrets.** It is bounded by
   branch protection and least-privilege push credentials on the forge side,
   and by manual key rotation (`docs/fleet/auth.md`).
8. **A compromised builder can lie about its own state.** Kill does not
   contain it. Transcript and diff content passes through the hub's memory.
   Budget pauses are advisory against an adversarial agent. The answer is the
   out-of-band runbook below, and fleet-wide kills that list the builders they
   skipped by name.

The builder audit log is authoritative only up to the hub's last
`audit.anchor` of it. A rewrite after an anchor raises an `audit-fork` alarm
at the hub. For relayed actions the hub's own log is the authority.

### Out of band

When a builder does not obey the board, do not rely on the board:

- `laneboard pause --all` on the builder writes the pause sentinel directly.
  It needs no server and works offline. The hook gate then blocks every tool
  call. It is cooperative like every other on-builder guard.
- `ssh` to the builder and use `tmux` itself: `tmux kill-session -t <name>`,
  or `tmux kill-server` for everything.
- Past that, stop the VM or pull its network.

## What it writes

Its own `data/` directory, `~/.cache/laneboard/status/`, and `~/lanes/<lane>/`.
Inside `launch` and `retire` only: worktrees under `codeDir`, and slots through
the configured slot provider. In fleet mode also: the audit log
(`~/.local/state/laneboard/audit.jsonl` by default, mode 0600, never
deleted when it rotates), pause and budget sentinels under the state dir, and
on the hub its key file (`~/.config/laneboard/hub.key`, 0600).
`deploy/install-claude.sh` changes `~/.claude/` additively (the hooks, the
pause gate, the status line) and backs the settings file up first.

Collectors never write anything and never `git fetch`.

## Reporting a vulnerability

Open a GitHub issue for anything that is already public, and use GitHub's
private vulnerability reporting for anything that is not.
