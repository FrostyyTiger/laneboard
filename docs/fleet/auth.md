# Fleet auth

This is the contract between a builder, the hub and the people who use them,
written for the operator. Setup steps are in `docs/install.md` ("Fleet
mode"). The threat model, and what all of this does *not* protect, is in
`SECURITY.md`. Read that first: on a builder every guard below is cooperative
against an agent that has a shell there. The boundary these rules hold is
between machines.

## Who is asking: classification

Every HTTP request and WebSocket upgrade gets one of three kinds before any
route runs. The listener it arrived on decides, never a header:

| Kind | Who | How it is recognised |
| --- | --- | --- |
| `local` | anything on this box: the CLI, hooks, the status line, scripts, agents | arrived on the main port (`7777`) from a loopback address |
| `direct` | a person through `tailscale serve` | arrived on `fleet.ingressPort` with serve's `X-Forwarded-For`, `X-Forwarded-Proto: https` and a `Tailscale-User-Login` |
| `hub` | the hub | arrived on `fleet.ingressPort` through serve, no user header, and a valid signature from a pinned key |

The rules, in order:

1. **No `fleet` block, no ingress listener:** everything is `local`. The
   Tailscale login is kept for attribution only, as before fleet mode.
   Remote-only actions cannot be enforced; the server warns at boot.
2. **Main port:** `local`. Every `Tailscale-*` header is deleted before any
   handler sees it, so a local process cannot claim to be you. A peer that is
   not a loopback address is refused (`not-local`).
3. **Ingress port, not from serve** (no `X-Forwarded-For`, or
   `X-Forwarded-Proto` is not `https`): refused (`not-from-serve`). With
   `fleet.ingressPeerUid` set, a connection whose socket is not owned by that
   uid is refused the same way. The check fails closed.
4. **Ingress, a user header and a signature:** refused (`ambiguous-identity`).
   The hub is a tagged node and never gets user headers.
5. **Ingress, a user header:** `direct`. With `fleet.allowedUsers` set, other
   logins are refused (`user-not-allowed`).
6. **Ingress, a signature:** verified (below), then `hub` with the scopes of
   the key that verified. With `fleet.hubAddrs` set, the `X-Forwarded-For`
   must be listed (`hub-addr`).
7. **Ingress, nothing:** refused (`unidentified`). `fleet.enforce` is on
   whenever an ingress listener exists.

On the **hub** the same rules run, and the hub accepts `local` and `direct`
only. A request that would classify as `hub` is refused there
(`hub-kind-refused`): a hub never takes signed requests. Every action and
every terminal on the hub needs a `direct` user.

On top of the kind, every upgrade and every mutating request is checked for
`Host` (with its port; the listener's loopback names, or
`fleet.publicHosts` on ingress), an exact `Origin` (never same-site;
`fleet.allowedOrigins` adds more), `Sec-Fetch-Site`, and the header
`X-Laneboard: 1`. A browser upgrade without an `Origin` is refused. A signed
hub request that carries an `Origin` is refused (`origin-on-hub`): a browser
cannot sign, so such a request is a confused deputy. laneboard never sends
CORS headers.

## What the hub may do: scopes and `hubControl`

Each builder pins the hub's public key in `fleet.hubKeys`. The entry decides
what that key may do:

| Entry | Scopes |
| --- | --- |
| `"ed25519:…"` or a PEM string | `read` only |
| `{ "key": "…", "id": "hub", "scopes": ["read", "control", "term"] }` | exactly those |

| The hub wants to | Needs |
| --- | --- |
| read hello, snapshot, jobs, the audit log, the v1 stream | `read` |
| run an action (`POST /api/v1/actions`) | `control` **and** `fleet.hubControl: true` |
| open a terminal (`/api/v1/term/<name>`) | `term` **and** `fleet.hubControl: true` |

`fleet.hubControl` is a master switch on the builder, default `false`. While
it is off, actions and terminals from the hub are refused with
`control-disabled` whatever the scopes, and refused actions are audited. With
it on, a key without the scope is refused with `scope-missing`. Start with a
bare string and `hubControl` off; widen when you need to.

## Signatures

Everything is Ed25519. A signature travels **only in headers**. There are no
query-parameter signatures: a URL ends up in logs and history, and a request
with `lb_ts`, `lb_nonce`, `lb_key` or `lb_sig` in its query is refused
(`query-signature-not-allowed`).

**Signed reads** (GETs and the `/api/v1/stream` upgrade) carry four headers:

| Header | Value |
| --- | --- |
| `X-Laneboard-Ts` | milliseconds since the epoch |
| `X-Laneboard-Nonce` | a fresh UUID |
| `X-Laneboard-Key` | the key id: the first 16 hex characters of SHA-256 over the raw 32-byte public key (the same for the PEM and the `ed25519:` spelling) |
| `X-Laneboard-Sig` | `ed25519 <base64 signature>` |

The signature covers `v1 <METHOD> <builder id> <raw request path and query>
<ts> <nonce>`. The path is the raw one as sent, not decoded. The builder id is
bound in, so a request signed for one builder fails on another.

**Actions** are an envelope `{v, id, ts, builder, action, target, args,
user, via:"hub"}` in the JSON body, signed over its canonical JSON (sorted
keys, no whitespace), with `X-Laneboard-Key` and `X-Laneboard-Sig`. The
builder checks that `builder` is its own `fleet.id` and that `id` is a UUID it
has not seen. `user` is attribution only.

**Terminals** from the hub carry a signed `term` envelope in
`X-Laneboard-Envelope` (base64url canonical JSON). Its `target` must equal
the session in the path and its `args` the terminal size in the query. A
read signature never opens a terminal (`read-signature-not-allowed`).

Verification runs in a fixed order: parse the headers, look up the key
(unknown: 403 `unknown-key`), verify the signature (`bad-signature`), check
the timestamp (±`fleet.clockSkewMs`, default 60 s: `stale`), then record the
nonce (`replay` when seen). Nothing unauthenticated ever enters the nonce
cache. At boot the cache is pre-loaded with the ids of the last five minutes
of audit entries, and reads signed before the process started are refused,
so a restart does not reopen the replay window. A full nonce cache answers
503 `nonce-cache-full` and never evicts a live nonce.

## Remote-only actions

These are refused (403 `remote-only`) for `local`, so an agent cannot use the
local API to wave itself through:

- `approve`, `deny`, `release`;
- `set-budget`;
- `kill *`;
- `resume` with `override`, or of a session held by a `budget` or `quota`
  pause.

They work for a `direct` user through serve and for a hub key with `control`
(and `hubControl` on). The `laneboard` CLI on the builder is `local`: it can
pause, and resume an operator pause, but it cannot approve, lift a budget or
quota pause, or `kill *`.

Every action, from any kind, also goes through the server-side tiers (a
`confirm` action needs the typed target; a `*` target needs this builder's
`fleet.id`; the hub converts the fleet-wide `fleet` confirm itself), strict
per-action argument checks, `fleet.allowedPermissionModes` for `launch` and
`spawn`, and rate limits (`fleet.rateLimits`; 429 `rate_limited` with
`retryAfterMs`).

## The audit log

Every action that got past authentication is appended to the builder's audit
log, refusals included:

- **Where:** `$LANEBOARD_AUDIT_FILE`, else
  `$XDG_STATE_HOME/laneboard/audit.jsonl`, else
  `~/.local/state/laneboard/audit.jsonl`. Mode 0600, directory 0700.
- **What:** one JSON line per entry: `ts`, `id`, `user`, `via`, `builder`,
  `action`, `target`, `argsHash`, `result`, `prevHash`, `hash`. Arguments are
  not stored, only their SHA-256 (`argsHash`), because they can hold prompts.
  The hash is unsalted, so short arguments can be guessed from it; it is not
  a secret. For hub requests `result.key` names the key's `id`.
- **Chain:** each `hash` covers the previous entry's hash and this entry, so a
  changed, removed or reordered line breaks the chain. Requests that failed
  authentication (bad signature, replay) are not chained, so nobody can flood
  the chain from outside; they are counted in a rate-limited log line.
- **Rotation:** past `fleet.audit.maxBytes` (default 10 MiB) the file is
  renamed `audit-<UTC stamp>.jsonl` and the new file starts with an
  `audit.rotate` entry that continues the chain. laneboard never deletes
  rotated files.
- **Fails closed:** if the log cannot be opened or written, every mutation is
  refused with 503 `audit-unavailable`.

Read it and check it, offline, on the builder:

```bash
laneboard audit                    # the last 50 entries as a table
laneboard audit -n 200 --since 1h
laneboard audit --json
laneboard audit verify             # exit 0: "ok N entries, head <hash>"
laneboard audit verify --file <path>
```

`audit verify` exits 1 and names the file, the line and the reason
(`bad_json`, `prev_mismatch`, `hash_mismatch`, `ts_regressed`). A single line
cut short by a crash is reported as a `torn` warning on stderr, and
verification carries on past it.

**Authority.** An agent with a shell on the builder can rewrite and re-chain
that builder's log, and `audit verify` will then pass. So a builder's log is
authoritative only up to the hub's last `audit.anchor` of its head; a rewrite
behind an anchor raises an `audit-fork` alarm at the hub. For relayed actions
the hub's own log is the record. `GET /api/v1/audit` serves the log to the
hub (`read` scope).

## Rotating the hub key

Builders accept up to 16 pinned keys at once, which is what rotation uses.
Labels (`id`) and keys must be unique.

1. On the hub, make the new key next to the old one:
   `laneboard fleet keygen --out ~/.config/laneboard/hub-2.key`.
   It prints the public key and key id.
2. On every builder, add the new key as a second entry with the scopes it
   should have (`"id": "hub-2"`), and restart that builder.
3. On the hub, point `fleet.hubKeyFile` at the new file and restart the hub.
   Check that every builder still shows as connected.
4. On every builder, remove the old entry and restart. Requests signed with
   it now get 403 `unknown-key`.
5. Delete the old key file on the hub.

If the hub key may have leaked, skip the overlap: remove the old entry on
every builder first (or set `fleet.hubControl: false` there, which stops
actions and terminals at once), then pin the new key. Use the audit logs
(`result.key`) to see what the old key did.

## Refusal codes

Refusals answer JSON `{ "error": "<code>" }`; a refused upgrade gets the bare
status line with no body. The
codes worth knowing:

| Code | Status | Meaning |
| --- | --- | --- |
| `not-from-serve` | 403 | ingress request without serve's headers, or the peer uid is wrong |
| `not-local` | 403 | non-loopback peer on the main port |
| `unidentified` | 403 | ingress request with neither a user nor a signature |
| `user-not-allowed` | 403 | login not in `fleet.allowedUsers` |
| `hub-addr` | 403 | signed request from an address not in `fleet.hubAddrs` |
| `ambiguous-identity` | 400 | both a user header and a signature |
| `unknown-key` | 403 | `X-Laneboard-Key` matches no pinned key |
| `bad-signature`, `stale`, `replay`, `wrong-builder` | 401 | signature, timestamp, nonce or builder id check failed |
| `query-signature-not-allowed` | 401 | signature parameters in the query string |
| `read-signature-not-allowed` | 403 | a read signature used to act or open a terminal |
| `control-disabled` | 403 | `fleet.hubControl` is off |
| `scope-missing` | 403 | the key lacks `control` or `term` |
| `remote-only` | 403 | a remote-only action from `local` (or, on the hub, from anything but `direct`) |
| `hub-kind-refused` | 403 | a signed request sent to a hub |
| `origin-on-hub`, `no-origin`, `bad-host`, `sec-fetch-site` | 403 | Origin, Host or fetch-metadata check failed |
| `nonce-cache-full` | 503 | too many live nonces for this key; retry later |
| `audit-unavailable` | 503 | the audit log cannot be written; nothing ran |
