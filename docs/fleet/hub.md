# The hub (`mode: "hub"`)

A hub is a laneboard process that runs no tmux, no sessions and no collectors.
It keeps one signed connection to every builder it is configured for, merges
their state, and serves the fleet UI. Builders never depend on it: when the hub
is down, each builder's own UI keeps working.

## Setting one up

1. Create the hub key on the hub box (PEM PKCS8 Ed25519, mode 0600):

   ```sh
   laneboard fleet keygen
   ```

   It is written to `fleet.hubKeyFile` (default
   `$XDG_CONFIG_HOME/laneboard/hub.key`, else `~/.config/laneboard/hub.key`).
   The hub **refuses to boot** if the file is missing, is readable by group or
   other, is owned by another user, or sits in a directory others can write.

2. Pin its public key on every builder (`fleet.hubKeys`, with the `control`
   scope for actions and `term` for terminals, and `fleet.hubControl: true`
   if the hub may act). See the fleet auth docs.

3. Configure the hub:

   ```json
   {
     "mode": "hub",
     "publicUrl": "https://hub.example.invalid:8443",
     "fleet": {
       "ingressPort": 7778,
       "ingressPeerUid": 0,
       "builders": [
         { "id": "builder-a", "url": "https://builder-a.example.invalid:8443" },
         { "id": "builder-b", "url": "https://builder-b.example.invalid:8443", "account": "acme" }
       ]
     }
   }
   ```

   `tailscale serve` targets the ingress port. `ingressPeerUid` is the uid of
   the process allowed to connect to it (the serve daemon); it is required on
   Linux in hub mode. The hub installs with `npm ci --ignore-scripts` and never
   loads `node-pty`.

## Config keys (`fleet` block, hub only)

| Key | Default | Meaning |
| --- | --- | --- |
| `builders` | `[]` | `[{id, url, code?, directUrl?, account?, repos?}]`; at least one. `url` is `https` (plain `http` only on loopback), no path. `directUrl` is what a browser uses for that builder's own UI (default `url`). `account` groups builders on one subscription for the rate-limit gauge. `repos` is a placement allowlist. |
| `hubKeyFile` | `$XDG_CONFIG_HOME/laneboard/hub.key` | the hub's signing key |
| `staleMs` / `downMs` | `15000` / `60000` | no frame for this long: the builder shows `stale`, then `down` |
| `batchMs` | `250` | hub to browser delta batching |
| `pingMs` | `5000` | upstream ping (latency, liveness) |
| `actionTimeoutMs` | `15000` | a relayed action's timeout (then "sent, outcome unknown") |
| `maxTermsPerBuilder` | `8` | proxied terminals per builder |
| `placement` | `{minFreeMemMb: 4096, maxSwapFrac: 0.5}` | placement gates |

Env: `LANEBOARD_MODE=hub`, `LANEBOARD_FLEET_BUILDERS=id=url,id=url` (a
scratch hub).

## Who may do what

Every request is classified like on a builder:

- through `tailscale serve` on the ingress port with `Tailscale-User-Login`:
  **direct**, the user's own login;
- on the local (loopback) listener, e.g. `bin/laneboard` on the hub box:
  **local**;
- a request signed with a hub key: refused on a hub (403).

`local` may read everything. **Control is remote-only on the hub**: actions
(`POST /api/fleet/actions`, including broadcast, fleet kill, fan-out pause and
resume, ack-alarm), audit rebase, terminals, push subscribe/unsubscribe,
`/api/push/quiet` and `/api/notify/prefs` writes need a `direct` user with a
real Tailscale login (not read-only); `local` gets 403 `remote-only`. So a
process on the hub box cannot drive the fleet, open a terminal or mute alarms
through the loopback listener. A read-only user cannot send `touch` on `/ws`
either. A hub refuses `fleet.enforce: false` and `fleet.insecureNoEnforce` at
startup: it never accepts unidentified ingress.

The web baseline is the builders' own: Host must match (with its port),
Origin must be same-origin or in `fleet.allowedOrigins`, every mutating request
carries `X-Laneboard: 1`, `OPTIONS` is 405, and pages carry the full CSP.

## Endpoints

| Method + path | What |
| --- | --- |
| `GET /healthz` | `{ok, ..., mode: 'hub', builders: {up, stale, down}}` |
| `GET /api/fleet` | `{hub, builders: [BuilderRow], aggregates}` |
| `GET /api/fleet/:builder/snapshot` | the cached snapshot with `state`, `stale`, `ageMs` (still served when the builder is down) |
| `GET /api/state?b=<id>` | the same in the builder's `/api/state` shape, for `bin/laneboard` pointed at a hub (default: the first builder) |
| `GET /api/map` | the fleet Map |
| `POST /api/fleet/actions` | `{builder | '*' | null, action, target, args}`: relayed, signed and audited (direct only) |
| `POST /api/fleet/placement` | `{repo?, need?}`: a dry-run ranking of builders |
| `GET /api/fleet/audit?since=&builder=&limit=` | the hub's audit entries with their reconciliation state |
| `POST /api/fleet/audit/rebase` | `{builder, confirm, onto?}`: accept a builder's rewritten audit chain after an `audit-fork` (direct only). `confirm` must be the builder id typed out; `onto` is `genesis` (default) or `head` (re-anchor on the builder's current verified head) |
| `GET /api/fleet/:builder/v1/<path>` | signed read proxy, fixed allowlist |
| `GET /api/push/key`, `POST`/`DELETE /api/push/subscribe`, `POST /api/push/test` | web push on the hub (VAPID keys and subscriptions in the hub's own database). An endpoint must be `https` on port 443 at a known push service: `push.allowedEndpointHosts` (host names, `*.domain` for subdomains), default `fcm.googleapis.com`, `android.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `*.push.apple.com`. At most 5 subscriptions per user (50 in all); only the owner removes one |
| `POST /api/push/quiet` | `{session: <fleet key>, quiet}`: mute one session's notifications (per-kind and quiet hours: `/api/notify/prefs`) |
| `WS /ws` | the fleet stream (`fleet`, `snapshot`, `delta`, `map`, `alarms`, `packages`, ...) |
| `WS /ws/term/:builder/:name` | a proxied terminal (direct only) |

Further hub routes come from modules in `server/hub/routes/` (alarms,
notifications, review waits, packages, credit, morning, archive, broadcast,
fleet kill). Builder routes (`/api/hook`, `/api/sessions/*`, `/api/lanes`, ...)
do not exist on a hub: the UI acts through the relay.

## Degraded modes

A builder that stops sending is `stale` after `staleMs` and `down` after
`downMs`; a socket close alone does not jump to `down`. Its last snapshot stays
visible, greyed with its age. Actions and terminals to it are refused (503):
nothing is queued. A builder whose hello names another id is `misconfigured`,
one with another API version `incompatible`; both are read-only.

## For developers

`server/boot/hub.mjs` wires the parts in this order: hub key, audit, fleet
store, upstreams, relay, read proxy, terminal proxy, audit reconciler, client
socket, map loop, push, services hook; then the module ctx (on ctx and
provided: `store`, `relay`, `readProxy`, `services`, `broadcast`,
`onClientMessage`, `audit`, `db`, `push`, `pushSender`, `auditForks`,
`upstreams`, `clientWs`), `loadModules('hub/routes', ctx)`, the
services, and the listeners. The hub key goes only to the upstreams, relay,
read proxy and terminal proxy constructors: modules get `upstreams` as a
facade (`status(id)`, `setVisible(id, keys)`), never the upstream objects or
the terminal proxy. `registerHubAction(..., {override: true})` is honoured
only for names in the core allowlist boot/hub.mjs passes to the relay (empty
today). Shutdown runs module stops first, then map loop,
services, reconciler, upstreams, terminals, client sockets, audit, database.

`server/hub/services.mjs` is the hook for fleet-derived services: a hub module
calls `ctx.services.register({name, start(ctx) -> stop})` from its `register`;
`start` gets `{store, push, audit, broadcast, relay, readProxy,
onClientMessage, config, now, view, log}`. A start that throws is logged and
skipped. `broadcast(msg)` reaches every hub client.

The Map is rebuilt with `tickFleet` 1 s after any store change and every 5 s,
from the store view plus the latest packages merge (`repos`, `edges`).

`test/hub-boot.test.mjs` boots a real hub against two fake builders and checks
the route table, auth, the web baseline, liveness and that the hub never loads
`server/state.mjs`, `server/terminals.mjs` or `node-pty`; its canary checks
that only the hub transport modules use the signers and that nothing disables
TLS verification.
