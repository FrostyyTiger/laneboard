# Section 2: Builder API v1, authentication, signing, audit log

**Integration notes (integrator):**
- Mutating-request header is `X-Laneboard: 1` (§1), replacing `X-Laneboard-Request: 1` everywhere.
- `fleet.hubKeys` accepts **both** PEM SPKI (`openssl pkey -pubout`) and `ed25519:<base64 raw 32 bytes>`; `keyId` is computed over the raw 32 bytes, so both spellings of one key have the same id.
- New config key `fleet.hubControl` (default `false`): a valid signed `hub` request may read, but every action and every `/api/v1/term` upgrade from `hub` is refused 403 `control-disabled` (actions are audited as refused).
- `fleet.ingressPort` defaults to `7778` when the config has a `fleet` block (same rule as `fleet.enforce`), else `null`; it is required in hub mode. `tailscale serve` targets it on builders and on the hub.
- Host/Origin/CSRF primitives live in `server/security.mjs` (§1 F5); `auth.mjs` imports them and adds the kind-specific rules (`guardRequest`, `guardUpgrade`). `auth.mjs` also exports the hub-side signers `signEnvelope`, `signedReadString`, `signRead` (headers) used by §3.
- Tier set is `read | click | ask | confirm` (`ask` = UI verb+Cancel dialog, no extra server check). `kill` now accepts target `*` (builder kill switch, §8 C9 via `dispatch.registerAllHandler`). New actions in the allowlist: `release` (§8), `send-review`, `run-script` (§10); `send-text` gains `guardPrompt` (merges §8's `guard:"not-prompting"`).
- Files: config keys are the fragment `server/config/fleet-auth.mjs`; built-in action registrations are `server/fleet/builtin-actions.mjs`; HTTP routes are `server/routes/v1.mjs` (X1 module) over handlers in `server/fleet/api-v1.mjs` (created by §1 F9). `/api/v1/jobs/:id` added. `paths.stateDir()` added (used by §8 `config.stateDir`).
- Tests split per module (`test/nonces.test.mjs`, `test/ratelimit.test.mjs`, `test/stream.test.mjs`, `test/api-v1-auth.test.mjs`) so parallel tasks never share a test file.
- Hub mode: requests on the hub are classified with the same `classify`; hub routes accept `direct` and `local` only and refuse `hub` kind.
- Task ids A1-A10 match the global DAG (README.md); A1 runs in wave 0. Private details moved to `private/02-private.md`.
- Adopted from the late security review and the verified tailnet facts (see INTEGRATION-REPORT.md): ingress requests without `X-Forwarded-For`/`X-Forwarded-Proto` are refused (`not-from-serve`); Host comparison includes the port; the `lb_*` query-param signatures are deleted; verification order is parse → key → verify → ts → nonce insert, over the raw `req.url`; `canonicalJson` rejects `__proto__`/`constructor`/`prototype` keys; terminal upgrades from the hub carry a signed `term` **envelope** (`X-Laneboard-Envelope`), not a read signature; `approve`/`deny`/`release`/`set-budget`/`resume{override}` are `remoteOnly` (refused for `local`); target `*` on a builder needs `args.confirm === fleet.id` (the hub converts `fleet`); the CLI strips terminal control characters from server strings; SECURITY.md states that on-builder guards are cooperative.
- **Security fixes pass (see `SECURITY-FIXES.md`):** `fleet.hubKeys` entries carry per-key **scopes** (`{key, id, scopes:["read"|"control"|"term"]}`, a bare string = `read` only); a hub action needs `control`, a hub terminal needs `term` (never a read signature), and `fleet.hubControl:false` stays as a master switch that additionally refuses `control` and `term`. `fleet.ingressPort` is mandatory whenever a `fleet` block exists and the header heuristic is deleted; `Tailscale-User-*` headers on the local listener are stripped, not just ignored; optional `fleet.ingressPeerUid` (peer-uid check through `/proc/net/tcp`, new task A11), `fleet.hubAddrs` (expected `X-Forwarded-For` of hub requests) and `fleet.allowedUsers`. `remoteOnly` now also covers `resume` of a budget/quota pause (with or without `override`). Files of this section marked REVIEW-REQUIRED in README 4.5 (`canonical.mjs`, `keys-ed25519.mjs`, `nonces.mjs`, `auth.mjs`, `dispatch.mjs`, `builtin-actions.mjs`, `audit.mjs`, `api-v1.mjs`, `routes/v1.mjs`, `peercred.mjs`, the A8 parts of `http.mjs`/`boot/common.mjs`) each get an independent review task (SR*) by an agent that is not the author.

## 1. Goal and scope

**In:** the `/api/v1/*` surface every builder serves (hello, snapshot, stream, actions, audit, term); request classification
(local / direct / hub) and Ed25519 verification in `server/fleet/auth.mjs`; one action dispatcher with server-side
confirmation tiers, strict per-action argument allowlists and rate limits; hash-chained audit log `server/fleet/audit.mjs`;
Origin/Host/CSRF checks on every upgrade and every mutating route (old and new); CLI `laneboard fleet keygen|pubkey`,
`laneboard audit [verify]`; threat model.

**Out:** the hub's side (upstream WS client, relay, its audit mismatch view: §3, §4 D12); the handlers for
`pause`, `resume`, `approve`, `deny`, `release`, `set-budget` (§8), `ack-alarm` (§7), `send-review`, `run-script` (§10) (their sections register them into the dispatcher
defined here); the new frontend (§1/§4 frontends). Builder-side signing of anything (the builder is least trusted; its
signature would prove nothing the hash chain does not).

Today's facts this builds on:
- No auth at all: `http.mjs:100` copies `tailscale-user-login` into `req.tsUser`; `index.mjs:221` `who = req.tsUser || 'local'`
  is attribution only. `SECURITY.md` says "no authentication, by design".
- **No Origin check anywhere.** `index.mjs:432-442` upgrades `/ws` (`ws.mjs:91`) and `/ws/term/:name` (`terminals.mjs:293`)
  for any caller, so any web page the user opens can open a cross-site WebSocket to the builder through `tailscale serve`
  and get a live terminal (browsers do not apply CORS to WebSockets; serve stamps the user's identity on it). This is
  fixed for both modes, fleet or not.
- Mutations: `actions.sendKeys` (`actions.mjs:58`), `sendText` (`:77`), `spawn` (`:107`), `kill` (`:205`), `restart` (`:222`),
  `launcher.launch` (`lanes/launch.mjs:227`, validation `:146`), `retirer.retire` (`lanes/retire.mjs:148`, its own confirm
  check `:163`). Each already validates names (`isSafeSessionName`) and records an `action` event (`actions.mjs:43`).

## 2. Design

### 2.1 New files

| File | Owns |
|---|---|
| `server/fleet/canonical.mjs` | `canonicalJson(value)`, `sha256Hex(str)` (pure) |
| `server/fleet/keys-ed25519.mjs` | `generateHubKey()`, `loadPrivateKey(file)`, `publicKeyString(keyObj)`, `publicKeyPem(keyObj)`, `parsePublicKey("ed25519:<b64>" \| "-----BEGIN PUBLIC KEY-----…")`, `keyId(pubStrOrKeyObj)`, `sign(data, priv)`, `verify(data, sigB64, pub)` (pure apart from file reads) |
| `server/fleet/paths.mjs` | XDG defaults without importing `config.mjs`: `stateDir()` = `$XDG_STATE_HOME/laneboard` (fallback `~/.local/state/laneboard`), `hubKeyFile()` = `$XDG_CONFIG_HOME/laneboard/hub.key` (fallback `~/.config/laneboard/hub.key`), `auditFile()` = `$LANEBOARD_AUDIT_FILE` or `$XDG_STATE_HOME/laneboard/audit.jsonl` (fallback `~/.local/state/laneboard/audit.jsonl`) |
| `server/fleet/nonces.mjs` | `createNonceCache({max:10000, ttlMs:300000, now})` → `{seen(id), add(id, ts), size}` |
| `server/fleet/auth.mjs` | verify side: `classify(req, cfg)`, `verifySignedRead(req, cfg)`, `verifyEnvelope(env, headers, cfg)`, `guardRequest(req, url, cfg)` (Host + kind-aware Origin/CSRF; uses `server/security.mjs`), `guardUpgrade(req, url, cfg)`, `AuthError`; sign side (hub, pure): `signedReadString({method, builderId, pathWithQuery, ts, nonce})`, `signRead({method, url, builderId, key, keyId, now, uuid}) -> headers {X-Laneboard-Ts, -Nonce, -Key, -Sig}`, `signEnvelope(env, key) -> 'ed25519 <b64>'` |
| `server/fleet/ratelimit.mjs` | `createLimiter(rules, now)` → `take(user, action, target)` → `{ok, retryAfterMs}` |
| `server/fleet/dispatch.mjs` | module-singleton `ACTIONS` registry (feature modules import it directly; `_reset()` for tests), `registerAction(name, def)`, `registerAllHandler(name, run)` (the `*` handler for an action owned by another section), `tiers() -> {name: tier}`, `dispatch(envelope, ctx)`, `TIERS = ['read','click','ask','confirm']`, `ActionRefused` |
| `server/fleet/builtin-actions.mjs` | `registerBuiltins({actions, launcher, retirer, state, config})`: the rows with a "calls" entry in 2.6 |
| `server/fleet/audit.mjs` | `openAudit({file, maxBytes, now})` → `{append(entry), head(), read({since, after, limit}), verifyAll()}`; `verifyFile(lines, prevHash)` (pure) |
| `server/fleet/peercred.mjs` (A11) | `parseProcNetTcp(text) -> [{local:{addr,port}, remote:{addr,port}, state, uid}]` (pure, IPv4 and IPv6 rows, hex little-endian addresses), `peerUid({remotePort, localPort, read = fs.readFileSync}) -> uid|null` (reads `/proc/net/tcp` and `/proc/net/tcp6`, returns the uid of the row whose local end is `127.0.0.1:<remotePort>` / `::1` / `::ffff:127.0.0.1` and whose remote end is the ingress port) |
| `server/fleet/stream.mjs` | v1 stream clients, `seq`/`epoch`, ring buffer, `publish(msg)`, `attachStream(req, socket, head, auth)` |
| `server/fleet/api-v1.mjs` (created by §1 F9) + `server/routes/v1.mjs` (X1 route module) | handlers for hello/snapshot/actions/audit/jobs, the hello registry (`addCapability`, `addHelloField`), `upgradeV1(req, socket, head, url, auth)` registered through the module's `upgrade()` hook |
| `test/auth.test.mjs`, `test/audit.test.mjs`, `test/api-v1.test.mjs` (F9's, extended), `test/api-v1-auth.test.mjs`, `test/dispatch.test.mjs`, `test/canonical.test.mjs`, `test/keys-ed25519.test.mjs`, `test/nonces.test.mjs`, `test/ratelimit.test.mjs`, `test/stream.test.mjs`, `test/cli-fleet.test.mjs` | tests |

Changed: `server/http.mjs` (classification hook), `server/boot/common.mjs` (ingress listener, guarded upgrades), `server/boot/builder.mjs` (legacy routes through
dispatch), `server/ws.mjs` (tap for v1 stream, `resync`), `server/terminals.mjs` (`attachNamed`), new fragment `server/config/fleet-auth.mjs`
(fleet auth keys), `bin/laneboard` (new commands), `SECURITY.md`, `docs/install.md`, `docs/fleet/auth.md`.

### 2.2 Config keys (`config.fleet.*`, fragment `server/config/fleet-auth.mjs`)

| Key | Default | Meaning |
|---|---|---|
| `fleet.hubKeys` | `[]` | each entry is either a **bare string** (PEM SPKI `-----BEGIN PUBLIC KEY-----…` as printed by `openssl pkey -pubout` / `laneboard fleet pubkey --pem`, **or** `"ed25519:<base64 raw 32-byte pubkey>"`), which means scopes `["read"]` (fail-safe), **or** an object `{key: "<PEM or ed25519:…>", id: "<label [a-z0-9-]{1,32}>", scopes: ["read", "control"?, "term"?]}`. `scopes` must contain `read` (a key that cannot read cannot connect) and only the three known values; `id` labels must be unique and are written into audit entries as `key`. More than one entry allows rotation. Parsed once at config load into `{keyId, label, scopes:Set, pub}` |
| `fleet.ingressPort` | `7778` if a `fleet` block exists, else `null` | **mandatory whenever a `fleet` block exists** (an explicit `null` there is a `ConfigError`) and in hub mode; second loopback listener that `tailscale serve` targets; every request on it is *ingress* (see 2.3). Must differ from `port` |
| `fleet.hubControl` | `false` | master switch on top of the per-key scopes. `false`: signed hub requests may read (hello, snapshot, stream, audit, other v1 reads) but every action and every `/api/v1/term` upgrade answers 403 `control-disabled` (actions audited with `result.ok=false`), whatever the key's scopes. `true`: a hub action additionally needs `control` in the signing key's scopes and a hub terminal needs `term`; otherwise 403 `scope-missing` |
| `fleet.hubAddrs` | `[]` | optional defence in depth: when non-empty, a request classified `hub` whose `X-Forwarded-For` is not in this list → 403 `hub-addr` (serve always sets it to the caller's tailnet address and overwrites client copies; a tagged caller carries no user headers, so this is the only network-level hub identity) |
| `fleet.ingressPeerUid` | `null` (off) | optional: when a number, every ingress connection's peer socket must belong to this uid (the uid `tailscaled` runs as, usually `0`), looked up through `/proc/net/tcp`/`tcp6` (A11). Lookup failure or mismatch → 403 `not-from-serve` (fail closed, never downgraded to `local`). Linux only; set on a non-Linux host → `ConfigError` |
| `fleet.allowedUsers` | `[]` (any login serve stamps) | optional: when non-empty, a `direct` request whose `Tailscale-User-Login` is not listed → 403 `user-not-allowed` (builders and hub) |
| `fleet.legacyBrowserRoutes` | `true` | see 2.6 (stays `true` tonight; flipping it is a HUMAN decision after the new UI is verified) |
| `fleet.publicHosts` | `[new URL(publicUrl).host]` when `publicUrl` is not loopback | allowed `Host` values on ingress |
| `fleet.allowedOrigins` | `[]` | (defined by §1 F4's fragment) extra Origins allowed (same origin is always allowed) |
| `fleet.enforce` | `true` if a `fleet` block exists, else `false` | refuse unidentified ingress requests (403) |
| `fleet.clockSkewMs` | `60000` | ts window |
| `fleet.allowedPermissionModes` | `["default","acceptEdits","plan","auto"]` | v1 `launch`/`spawn` refuse anything else (notably `bypassPermissions`) unless listed |
| `fleet.rateLimits` | see 2.7 | override per action |
| `fleet.audit.maxBytes` | `10485760` | rotate size |

`bind` stays `127.0.0.1` only; `ingressPort` is bound on the same `bindAddresses` (`index.mjs:424`).

### 2.3 Request classification (`auth.classify`)

`tailscale serve` is a reverse proxy on the same box, so every request, local or remote, arrives from `127.0.0.1`. The
builder must not rely on peer IP. Rule, in order:

1. **ingress?** `req.socket.localPort === cfg.ingressPort`. That is the only test: the header heuristic is **deleted** (a local process can add any header). With a `fleet` block `ingressPort` is mandatory (2.2). Without a `fleet` block (today's standalone install) there is no ingress listener, every request is `local`, and the `Tailscale-User-Login` header is used for attribution only, exactly as today; `remoteOnly` (2.6) is then not enforceable and the server logs one warning per boot that remote-only protection needs a `fleet` block. Deploy docs: `tailscale serve --bg --https=8443 http://127.0.0.1:7778`. On the ingress port, a request **without** `X-Forwarded-For` and `X-Forwarded-Proto: https` did not come through serve (verified: serve always adds `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto` and overwrites client copies) → 403 `not-from-serve`. When `fleet.ingressPeerUid` is set, the connection's peer uid (A11, recorded on the socket at `connection` time by `listenAll`, `socket.lbPeerUid`) must equal it, else 403 `not-from-serve`.
2. **not ingress → `{kind:'local', user:'local'}`**: CLI, hooks, statusline sidecar, scripts. Today's behaviour. Every
   `Tailscale-User-*` and `Tailscale-App-Capabilities` header on the non-ingress listener is **deleted from `req.headers`** before any handler runs, and `req.tsUser` is set from `req.auth.user` only, so no later code (`http.mjs:100`, `who()`) can pick up a forged identity.
3. **ingress + `Tailscale-User-Login`** → `{kind:'direct', user:<login>, name:<Tailscale-User-Name, RFC 2047-decoded>}`.
   Serve sets these for traffic from user-owned (untagged) nodes and removes client-supplied copies (verified). When `fleet.allowedUsers` is non-empty and the login is not in it → 403 `user-not-allowed`.
4. **ingress + no user header + `X-Laneboard-Sig`** → verify (2.4); success → `{kind:'hub', keyId, keyLabel, scopes}` (scopes of the pinned entry that verified). When `fleet.hubAddrs` is non-empty, `X-Forwarded-For` must be in it, else 403 `hub-addr`. The acting user for an
   action comes from `envelope.user` (attribution only; the hub is trusted for it).
5. **ingress + both a user header and a signature** → 400 `ambiguous identity` (a hub is a tagged node and gets no user headers).
6. otherwise: `fleet.enforce` → 403 `unidentified`; not enforcing → `{kind:'direct', user:'local'}` (exactly today).
7. **hub mode**: the same rules run on the hub process; hub routes accept `local` and `direct` only, and a request that classifies as `hub` is refused 403 (a hub never takes signed requests).

Tagged-source traffic (the hub, any other tagged node): serve sets **no** `Tailscale-User-*` headers, so it lands in 4 or 6.
That is why the hub must sign, and why `enforce` matters: otherwise any tagged node the ACL lets in would act as `local`.

`Tailscale-App-Capabilities` (only present when serve runs with `--accept-app-caps=laneboard.dev/cap`): if present and
parseable, `{"laneboard.dev/cap":[{"role":"read"}]}` downgrades `direct` to read-only (actions → 403 `read-only role`).
Absent → no effect. Nothing depends on it. Verified: the `--accept-app-caps` flag exists on the installed versions and serve strips a client-sent `Tailscale-App-Capabilities`; the JSON shape is unverified, so the feature stays inert in v1 (optional defence in depth only).

`http.mjs:95` `handleRequest` (after §1 F5's `checkHost`) gains `req.auth = auth.classify(req, cfg)` right after `req.tsUser` (`:100`), then `auth.guardRequest` for mutating routes; a thrown
`AuthError` is answered `json(res, {error}, status)` before routing. `/healthz` is exempt (always 200, no data beyond today).
`POST /api/hook` (now in `server/boot/builder.mjs`) and §8's `POST /api/hook/permission` are accepted only from `local` when enforcing (hooks never come through serve).

### 2.4 Signatures (`keys-ed25519.mjs`, `auth.mjs`)

- Keygen: `crypto.generateKeyPairSync('ed25519')`; private key written as PKCS8 PEM to `paths.hubKeyFile()` with
  `fs.writeFileSync(f, pem, {mode:0o600, flag:'wx'})`, dir `0700`. Load refuses a key file whose mode has group/other bits.
- Public key string: `"ed25519:" + Buffer.from(pub.export({format:'jwk'}).x, 'base64url').toString('base64')`; `publicKeyPem(k)` = `pub.export({type:'spki', format:'pem'})`.
  Parse: a string starting `-----BEGIN PUBLIC KEY-----` → `crypto.createPublicKey(pem)` and require `asymmetricKeyType === 'ed25519'`; `ed25519:<b64>` → `crypto.createPublicKey({key:{kty:'OKP', crv:'Ed25519', x:<base64url>}, format:'jwk'})`; reject a raw length ≠ 32 and anything else. Validation in the config fragment uses this parser.
- `keyId(pub)` = first 16 hex of `sha256(raw 32-byte pubkey)` (same id for the PEM and the `ed25519:` spelling). Header `X-Laneboard-Key: <keyId>` selects among `hubKeys` on signed reads **and** on `POST /api/v1/actions`
  (unknown → 403). The entry found carries the **scopes** used below: signed reads and the stream need `read`; actions need `control`; terminal upgrades need `term` (2.6, 2.9). A bare-string entry has `read` only.
- Sign/verify: `crypto.sign(null, Buffer.from(data,'utf8'), priv)` / `crypto.verify(null, data, pub, sig)`; header
  `X-Laneboard-Sig: ed25519 <base64 64-byte sig>`; anything else → 401.
- **Canonical JSON** (`canonicalJson`): objects with keys sorted by UTF-16 code unit order (`Object.keys().sort()`),
  recursively; arrays in order; no whitespace; strings/numbers/booleans/null via `JSON.stringify`; throws on keys `__proto__`, `constructor`, `prototype`, on `undefined`,
  functions, `NaN`/`±Infinity`, `BigInt`, and on non-plain objects. The builder parses the body and verifies the signature over
  `canonicalJson(parsed)`, never over raw bytes, so key order/whitespace in transit do not matter. Body limit 64 KiB for
  `/api/v1/actions` (`readBody(req, 65536)`, `http.mjs:56`).
- **Actions:** signature over `canonicalJson(envelope)` (envelope has no signature field). Checks: `v === 1`; `id` is a UUID;
  `builder === config.fleet.id` (binds the action to this builder, so one builder cannot replay an action meant for
  another); `|now - ts| <= clockSkewMs`; nonce `id` unseen; `via === 'hub'`; `user` matches `^[^\s]{1,128}$`.
- **Signed reads and upgrades:** headers `X-Laneboard-Ts`, `X-Laneboard-Nonce` (UUID), `X-Laneboard-Key`, `X-Laneboard-Sig`
  over the string `` `v1 ${METHOD} ${builderId} ${pathWithQuery} ${ts} ${nonce}` `` (the conventions' `METHOD path ts nonce`,
  with a version tag and the builder id bound in; §3 produces it only through `auth.signRead`/`signedReadString`).
  `pathWithQuery` is the **raw** `req.url` (not decoded). WebSocket upgrades accept the same four headers (the hub uses `ws`'s `headers` option); there are no query-param signatures (they would leak into logs). Signed reads authorize only `GET`s and the `/api/v1/stream` upgrade.
- **Terminal upgrades from the hub** (`/api/v1/term/:name`) carry an action envelope `{v:1, id, ts, builder, action:'term', target:name, args:{cols, rows, window?}, user, via:'hub'}` as base64url canonical JSON in `X-Laneboard-Envelope`, with `X-Laneboard-Sig`/`-Key` over it; verified by `verifyEnvelope` (same checks as actions, nonce recorded via the `term` audit entry) and refused unless `fleet.hubControl` is true **and** the signing key has the `term` scope (403 `control-disabled` / `scope-missing`). A read signature on any upgrade path other than `/api/v1/stream` → 403 `read-signature-not-allowed`; the `term` envelope's `target` must equal the `:name` in the path and its `args` must equal the clamped query values.
- **Verification order** (reads, envelopes): parse headers → key lookup by `X-Laneboard-Key` → **signature verify** → ts window → nonce check-and-insert. Nothing unauthenticated ever enters the nonce cache.
- **Nonce cache** (`nonces.mjs`): insertion-ordered `Map` id→ts; entries older than 5 min dropped on each `add`; when 10 000
  *unexpired* entries are held, new signed requests get 503 `nonce cache full` (never evict a live nonce: eviction re-opens
  replay). On boot the cache is pre-loaded with every audit entry `id` from the last 5 min (`audit.read({since: now-300000})`),
  so a restart does not re-open the replay window for actions.

### 2.5 Origin, Host, CSRF (`checkOrigin`, `checkHost`)

Applied to every WebSocket upgrade (`/ws`, `/ws/term/*`, `/api/v1/stream`, `/api/v1/term/*`) and every non-GET/HEAD route,
legacy and v1, in both modes. `checkHost`/`checkOrigin`/`checkCsrf` are §1 F5's functions in `server/security.mjs`; this section adds the kind-aware rules below in `auth.guardRequest`/`guardUpgrade`:
- `Host` (compared **with** its port, verified: serve preserves `host:8443`) must be `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` on the local listener (and on any port when
  `ingressPort` is unset), or one of `fleet.publicHosts` on ingress. Stops DNS rebinding. Unset `publicHosts` on ingress →
  allowed with one `log.warn` per boot.
- `direct`/`local` with an `Origin` header: its `host` must equal `Host`, or the Origin is in `allowedOrigins`; else 403.
  `Origin` missing on an upgrade from `direct` → 403 (browsers always send it). If `Sec-Fetch-Site` is present it must be
  `same-origin` or `none`.
- `hub`: any `Origin` → 403 (a browser cannot sign; a signed request with an Origin is a confused deputy).
- every mutating request needs `X-Laneboard: 1` (§1 F5; the hub relay sends it too); v1 `POST /api/v1/actions` from `direct` additionally needs `content-type: application/json`
  (non-simple request → a cross-origin page cannot send it without a CORS preflight, which is never answered with allow headers).
- No CORS headers are ever emitted.
- The Origin check is exact (scheme + host + port), never "same-site": every node of one tailnet shares the same registrable domain, so a same-site rule would admit any other tailnet web app.

`guardUpgrade(req, url, cfg)` is called first thing in `index.mjs:432`'s upgrade handler; on failure it writes
`HTTP/1.1 403 Forbidden` and destroys the socket. `hub` kind is accepted on `/api/v1/*` upgrades only (and on `/api/v1/term/*` only with a `term` envelope, `fleet.hubControl` true and the `term` scope; else 403); legacy `/ws` and
`/ws/term/*` take `local` or `direct`. `guardUpgrade` replaces F5's plain `checkHost`/`checkOrigin` call in `server/boot/common.mjs`.

### 2.6 Dispatcher, tiers, allowlist (`dispatch.mjs`)

```js
registerAction(name, {
  tier: 'read' | 'click' | 'ask' | 'confirm',
  target: 'session' | 'lane' | 'builder' | 'session-or-all',
  args: { field: {type, required?, max?, re?, enum?} },  // strict: unknown keys -> 400
  hubOnly?: false, localOnly?: false,   // localOnly: refused (403) when auth.kind === 'hub'
  run: async ({target, args, user, via, deps}) => result,
});
dispatch(envelope, {auth, deps, audit, limiter, now}) -> {ok, result|error, status, auditId}
```

Order inside `dispatch`: shape check → registry lookup (unknown → 400 `unknown action`, `hubOnly` → 400) → **hub control** (`auth.kind === 'hub' && !config.fleet.hubControl` → 403 `control-disabled`; `auth.kind === 'hub'` and `control` ∉ `auth.scopes` → 403 `scope-missing`; `localOnly` from hub → 403 `local-only`) → **remote-only** (below) → target check
→ args schema → **tier** → rate limit → `run` (target `*` with a registered all-handler → that handler) → audit append (in `finally`, also for refusals after authentication).

**Tiers, enforced here so a UI cannot skip them:**
- `read`: nothing.
- `click`: nothing beyond a valid envelope (the UI shows one button).
- `ask`: same as `click` on the server; the UI shows a verb + Cancel dialog (§4 `confirmAction`).
- `remoteOnly` (a def flag, independent of tier; `true` or a predicate `(envelope, deps) => bool` evaluated after target validation): refused 403 `remote-only` when `auth.kind === 'local'`, i.e. only a `direct` user through serve or a signed `hub` request with `control` scope may run it. Set for `approve`, `deny`, `release`, `set-budget`, `kill` with target `*`, and `resume` when `args.override` is true **or** any targeted session (all paused sessions for `*`) is held by a pause of `kind:'budget'` or `kind:'quota'` (§8 C6/C7 supply the predicate). This closes the "agent approves its own request / lifts its own budget pause through the local API" path; it does **not** make on-builder guards a security boundary (an agent with a shell can still drive tmux, delete sentinels, edit hooks and settings, or fake the statusline cost file). SECURITY.md (A10) says so plainly. Without a `fleet` block there is no ingress listener and remote-only cannot be enforced (2.3).
- `confirm`: `args.confirm === target` (string equality, after target validation).
- **target `*`** (all sessions on this builder, only for `session-or-all` actions): `args.confirm` must equal this builder's id (`config.fleet.id`); a builder never accepts the constant `"fleet"` — for a fleet-wide fan-out the hub checks the typed `fleet` confirm itself and rewrites `args.confirm` to each builder's id. `kill *` is additionally refused for `local` (CLI uses `laneboard pause --all` + the runbook). Allowed for `interrupt`, `pause`, `resume`, `kill` (builder kill switch, §8 C9, which registers the `*` handler with `registerAllHandler('kill', fn)`; without it `*` → 501), `set-budget` (lane-or-all) and `ack-alarm` (exempt from the confirm rule, it is not destructive). Never allowed for `restart`, `retire`, `spawn`, `launch`, `send-text`, `send-keys`, `send-review`, `run-script`, `approve`, `deny`, `release`.

| v1 action | tier | target | args (strict) | calls | legacy route |
|---|---|---|---|---|---|
| `send-text` | click | session | `text` str 1..8000, `enter` bool=true, `fanout?` `{parent: uuid}`, `guardPrompt?` bool | `actions.sendText(name, text, enter, who)` `actions.mjs:77`; with `guardPrompt`, first refuse 409 `prompting` (result `{ok:false, skipped:'prompting'}`) when the session state is `waiting_permission`/`waiting_question`, `awaitingApproval` is set, or `state.promptReadiness(pane)` is not `ready` (numbered permission menu, trust dialog; `actions.mjs:183-187`) | `POST /api/sessions/:name/text` `index.mjs:228` |
| `send-keys` | click | session | `keys` str[] 1..20, each `^[A-Za-z0-9_.^-]{1,16}$` | `actions.sendKeys` `:58` | `POST /api/sessions/:name/keys` `index.mjs:223` |
| `interrupt` | click | session-or-all | `confirm?` | `sendKeys(name, ['Escape'])` per session | (none; UI sends keys today) |
| `kill` | confirm | session-or-all | `confirm`; for `*` also `graceMs?`, `include?` str[], `cancel?` job id | `actions.kill` `:205`; `*` → §8 C9's all-handler | `DELETE /api/sessions/:name` `index.mjs:240` |
| `restart` | confirm | session | `confirm` | `actions.restart` `:222` | `POST /api/sessions/:name/restart` `index.mjs:242` |
| `spawn` | ask | session (new name) | `dir`, `prompt?` ≤8000, `model?`, `permissionMode?`, `resume?`, `slot?` | `actions.spawn({name: target, ...})` `:107` | `POST /api/sessions` `index.mjs:235` |
| `launch` | ask | lane | `repo` ∈ `config.repoNames`, `plan`, `branch?`, `model?`, `permissionMode?`, `priority?` (§8), `budgetUsd?` (§8), `dryRun?` (§8), `restoredFrom?` (§10) | `launcher.launch` `launch.mjs:227` | `POST /api/lanes` `index.mjs:156` |
| `retire` | confirm | lane | `confirm`, `force?` bool | `retirer.retire(id, {force, confirm})` `retire.mjs:148` | `DELETE /api/lanes/:id` `index.mjs:159` |
| `term` | click | session | `cols?`, `rows?`, `window?` (§10, `^run-[a-z0-9-]{1,24}$`) | audit-only entry written by `upgradeV1` on attach | `/ws/term/:name` |
| `pause` | click | session-or-all | `confirm?`, `interrupt?` bool, `reason?` str ≤200 | registered by §8 C6 | — |
| `resume` | click | session-or-all | `confirm?`, `nudge?` bool=true, `override?` bool | registered by §8 C6 | — |
| `approve` | click | session | `approvalId` | registered by §8 C6 | — |
| `deny` | click | session | `approvalId`, `note?` ≤500, `interrupt?` bool | registered by §8 C6 | — |
| `release` | click | session | `approvalId` (show the dialog at the terminal now) | registered by §8 C6 | — |
| `set-budget` | ask | lane-or-all | `usd` number\|null, `window?`, `confirm?` | registered by §8 C7 | — |
| `ack-alarm` | click | alarm id or `*` | `tile?`, `builder?` (scope for `*`) | registered by §7 O8, `localOnly` (a hub acks its own alarms, never relays) | — |
| `send-review` | ask | lane | `review: {base, mergeBase, headSha, comments[≤100], note?}` | registered by §10 R7 | — |
| `run-script` | ask | lane | `script` name, `stop?` bool | registered by §10 R8 | — |
| `broadcast` | confirm | `*` | (hub) `targets` fkey[] ≤30, `text` ≤2000, `enter`, `confirmCount` | `hubOnly`: builders refuse (400); the hub (§8 C8) fans out into `send-text` with `args.fanout.parent` and `guardPrompt:true`; its confirm is `confirmCount === plan.send.length` | — |

Allowlist rules beyond the table: no action takes a shell string or a free path except `spawn.dir`, which v1 resolves with
`fs.realpathSync` and requires to be inside one of `config.dirRoots` (`config.mjs:354`; today `spawn` accepts any
directory, `actions.mjs:113`). `launch` rejects the test-only fields `fakeTakenSlots`, `localBranch`, `promptOverride`
(`launch.mjs:198-209`) on v1; repo must be in `config.repoNames` (today `validate` only regex-checks it, `launch.mjs:153`).
`permissionMode` must be in `fleet.allowedPermissionModes`. Session targets reuse `isSafeSessionName` + inventory
(`requireSession`, `actions.mjs:35`); lane targets reuse `store.isLaneId`. Errors: `ActionError`/`LaneError` map to their
`status`; `ActionRefused(status, code)` for tier/limit/schema (`code`: `confirm_required`, `rate_limited`, `bad_args`, ...).

**Legacy routes and the local UI. Recommendation: the new UI uses v1 only; legacy routes stay for the CLI and scripts.**
Each legacy mutating route in `index.mjs:156-242` becomes a thin adapter that builds an envelope
(`via:'legacy'`, `id: crypto.randomUUID()`, `user: who(req)`) and calls `dispatch`, so audit and rate limits cover it too.
Because the legacy HTTP verb is itself the explicit request (the CLI asks y/N, `bin/laneboard:242-256`), the adapter fills
`args.confirm = target` for `kill`/`restart`, **only for `local` kind**. For `direct` (a browser) on a legacy confirm-tier
route: no auto-confirm, so `DELETE /api/sessions/:name` needs body `{confirm:name}`; and when `fleet.enforce` is on, legacy
mutating routes from `direct` answer 410 `use /api/v1/actions` once the new frontend lands (flag `fleet.legacyBrowserRoutes`,
default `true`; it stays `true` tonight, flipping it is a HUMAN decision after the §4 UI is verified). Retire keeps its own `force && confirm` check (`retire.mjs:163`);
the adapter maps the body unchanged. The local UI calls v1 with `via:'direct'`, unsigned, `id`/`ts` filled by the client and
`builder` = the hello id; the server ignores client `user` for `direct` and uses `req.auth.user`. One code path, one audit.

### 2.7 Rate limits (`ratelimit.mjs`)

Token buckets in memory, keyed `(user, rule)`; `local` CLI is exempt from all but the global cap. Defaults:

| Rule | Limit |
|---|---|
| `send-text` / `send-keys` / `interrupt` | 30 per minute per (user, target) |
| `send-text` with `fanout.parent` | the parent counts once: 1 parent per 10 s per user (broadcast ≤ 1 / 10 s / user, also enforced at the hub) |
| `kill`, `restart`, `retire`, `run-script`, `send-review` | 5 per minute per user |
| `spawn`, `launch` | 3 per minute per user |
| any target `*` | 1 per 10 s per user |
| global | 120 actions per minute per user; 300 per minute across all `hub` traffic |

Over limit → 429 `{error:'rate_limited', retryAfterMs}`, audited with `result.ok=false`.

### 2.8 Audit log (`audit.mjs`)

- File `paths.auditFile()`, mode 0600, dir 0700. One JSON line per entry:
  `{ts, id, user, via, builder, action, target, argsHash, result, prevHash, hash}`, where
  `argsHash = sha256Hex(canonicalJson(args))` (args are not stored: they may hold prompts; the existing `events` table already
  keeps a 300-char preview, `actions.mjs:87`), `result = {ok, status, error?, job?}` (error truncated to 300 chars).
- `hash = sha256Hex(prevHash + "\n" + canonicalJson(entryWithoutHash))`. Genesis `prevHash = "0".repeat(64)`.
- `append` is synchronous: `fs.appendFileSync` + `fs.fsyncSync` (actions are rare; durability beats latency). One process
  owns the file; `head` is cached in memory, recomputed from the last line at open.
- Rotation: before an append that would exceed `maxBytes`, rename to `audit-<UTC yyyymmddThhmmss>.jsonl` in the same dir and
  start a new file whose first entry is `{action:'audit.rotate', target:<old file name>, prevHash:<old head>}`; the chain
  continues across files. Rotated files are never deleted by laneboard.
- Unauthenticated failures (bad signature, replay) are **not** chained (an attacker could flood the chain); they go to
  `log.warn`, at most one line per 10 s with a counter.
- `GET /api/v1/audit?since=<ms>&after=<hash>&limit=<n≤1000>` → `{builder, head:{hash, count}, entries, more}`. `after` (hash)
  wins over `since`; the hub replays with `after=<last hash it holds>`. Reads across rotated files.
- `verifyAll()` / `verifyFile(lines, prevHash)` → `{ok, count, head, firstBad?: {file, line, reason}}`, reasons
  `bad_json`, `prev_mismatch`, `hash_mismatch`, `ts_regressed`.

### 2.9 v1 endpoints (`server/fleet/api-v1.mjs` + `server/routes/v1.mjs`)

- `GET /api/v1/hello` → `{id, code, version, apiVersion:1, mode, capabilities, actions:{<name>: <tier>}, time, auth:{kind}, ...helloFields}`.
  `capabilities` is a string array built from `addCapability` calls (`snapshot`, `stream`, `actions`, `audit`, `term` here; `launch` §8, `approvals`, `pause`, `budget` §8, `health` §7, `morning`, `credit` §7/§10, `conflicts:textual`, `ci:jobs` §6, `review`, `scripts` §10, `ci` when the gh provider is configured, `guard`). Non-string data goes in hello fields registered with `addHelloField(name, fn)`: `repos` and `permissionModes` (§8 C12), `scripts: {<repo>: [names]}` (§10 R8). `version` from `server/version.mjs`.
- `GET /api/v1/snapshot` → `{...state.snapshot(), sessions: snap.sessions.map(ws.forWire), builder:{id, code}, seq, epoch}`
  (`forWire`, `ws.mjs:10`, strips `preview`, keeps `previewLines`). Snapshot keys added by modules via `state.addSnapshotKey` (`repos` §6, `approvals` §8, `budget` §8) are included.
- `WS /api/v1/stream` → on connect a `snapshot` (as above), then every message `ws.send` emits today (`ws.mjs:77`:
  `delta`, `event`, `map` if any) plus `health` (§7), `approval` (§8), `stuck` (§7), `repos` (§6), `alarms` (§7, builder-mode alarms; the hub ignores them) from their sections, each as the original object with
  `builder`, `seq`, `epoch` added at top level (`{type:'delta', ..., builder:'builder-a', seq:4812, epoch:'k3f9…'}`).
  `seq` is one per-process counter shared by all v1 clients; `epoch` = random id per process start. Implementation:
  `ws.mjs` gets `export function addTap(fn)`, called inside `send()` and `broadcastEvent()`; `stream.publish` stamps and
  stores the last 500 messages in a ring. Client messages: `{type:'resync', fromSeq}` → if same epoch and `fromSeq` still in
  the ring, replay `fromSeq+1..now`; else send a fresh `snapshot`. `{type:'visible', keys}` (fkeys; legacy `names` accepted for one release, §1 F7) and `{type:'ping'}` behave as
  `ws.mjs:100-109`. Receiver rule (documented for the hub): on `epoch` change or `seq !== last+1`, send `resync`. Heartbeat
  as `ws.mjs:122` (30 s ping). Note the diff baseline in `ws.mjs:29` is global, so v1 clients must be counted in
  `clientCount()`-based shortcuts (`ws.mjs:38`): the tap makes `broadcastFrom` treat "has v1 clients" as "has clients".
- `POST /api/v1/actions` → `dispatch`; 200 `{ok:true, result, auditId}` or `{ok:false, error, code?, auditId?}` with the
  error status; launch keeps 202.
- `GET /api/v1/audit` → 2.8.
- `GET /api/v1/jobs/:id` → `{job, steps}` from `db.jobSteps(id)` (the v1 twin of `/api/jobs/:job`, so the hub can follow a launch through the read proxy).
- `WS /api/v1/term/:name[?window=run-<script>]` → `terminals.attachNamed(req, socket, head, name, url)` (extracted from `terminals.mjs:293-317`,
  `attach` becomes a wrapper; §10 R8 adds the `window` param). Tier `click`, rate-limited, audited as action `term` with `args {cols, rows, window?}`; from `hub` kind it needs a valid `term` envelope (2.4), `fleet.hubControl` true (else 403 `control-disabled`) and the `term` scope (else 403 `scope-missing`); a signed read never opens a terminal.

All v1 reads require `local`, `direct` or signed `hub`; all mutations go through `dispatch`.

### 2.10 CLI (`bin/laneboard`)

Offline commands that import `../server/fleet/*.mjs` directly (no server, no `config.mjs` import):
- `laneboard fleet keygen [--out <file>] [--force]`: writes the hub key (refuses to overwrite without `--force`), prints the
  public key string and `keyId`.
- `laneboard fleet pubkey [--key <file>] [--pem]`: prints `ed25519:<base64>` (or the PEM SPKI with `--pem`), for pasting into builders' `fleet.hubKeys`; also accepts a key made by `openssl genpkey -algorithm ed25519`.
- `laneboard audit [-n 50] [--since 1h] [--file f] [--json]`: tail as a table `TS USER VIA ACTION TARGET OK`.
- `laneboard audit verify [--file f]`: exit 0 and `ok N entries, head <hash8>`; exit 1 naming file, line, reason.
Add to `usage()` (`bin/laneboard:425`) and `COMMANDS` (`:451`).

### 2.11 Threat model

| Threat | Effect without this section | Mitigation here | Residual |
|---|---|---|---|
| Agent with a shell on this builder | Everything on this builder | `remoteOnly` closes the local-API path for approve/deny/release/set-budget/budget-resume/`kill *`; Tailscale identity headers stripped on the local listener | **Accepted:** pause, budget, approvals, kill and the local audit log are cooperative against it (tmux, sentinel files, hook settings, the statusline cost file are all writable by that uid). Uid separation is phase 2. The boundary is cross-machine |
| Compromised builder | — | Holds no hub credentials (only hub *public* keys); ACL lets it start nothing; its data is untrusted at the hub (frontend/§3s); `builder` field in envelopes and in the signed read string stops it replaying a hub request elsewhere | It can lie about its own state and rewrite its own audit log; its log is authoritative only up to the hub's last `audit.anchor`, and a rewrite after an anchor raises `audit-fork` at the hub (§3 H13) |
| Compromised hub key | Full control of every builder | Key 0600 on the hub only, never on builders; per-key scopes (a `read`-only key cannot act or open terminals) and the builder-side `hubControl` master switch; optional `hubAddrs`; `keyId` + multiple `hubKeys` for rotation; tiers + rate limits + `allowedPermissionModes` still bind a signed caller; every builder audits locally | An attacker with a `control`/`term` key can do anything a user can at the rate limits; rotate by editing `hubKeys` on each builder (HUMAN runbook) |
| Stolen browser session (unlocked laptop, malicious extension) | Same as the user | Tailscale identity, not cookies; confirm tier for destructive ops; rate limits; audit names the user | Equal to the user at the keyboard |
| Replay of a captured action/read | Repeat a kill or a send | ±60 s ts, UUID nonce LRU, cache pre-loaded from audit on boot, builder id bound into what is signed | Reads within 60 s across a restart (no state change) |
| CSRF / cross-site WebSocket from another tailnet page | Any page could open `/ws/term/x` today | Origin + `Sec-Fetch-Site` + Host checks on every upgrade and mutation, JSON + custom header on v1 actions, no CORS | None known |
| DNS rebinding to `127.0.0.1:7777` | Local API reachable from a web page | Host allowlist | — |
| Forged `Tailscale-User-Login` | Wrong attribution; passes remote-only rules | Stripped on the local listener; serve overwrites client copies (verified); the ingress listener refuses requests without serve's `X-Forwarded-*` | A local process can still connect to the ingress port and send serve-like headers unless `fleet.ingressPeerUid` is set (A11, opt-in); documented as the remaining gap of the cooperative on-builder model |
| Tagged node allowed in by ACL mistake | Acts as `local` | `fleet.enforce` → 403 unless hub-signed | — |

## 3. Implementation tasks (dependency order)

Ids match the global DAG in README.md.

1. **A1 canonical + keys** (wave 0; deps none) — files: `server/fleet/canonical.mjs`, `server/fleet/keys-ed25519.mjs`, `server/fleet/paths.mjs`,
   `test/canonical.test.mjs`, `test/keys-ed25519.test.mjs`. Done when: `npm test` green; sign→verify round-trip, `parsePublicKey(publicKeyString(k))` and `parsePublicKey(publicKeyPem(k))` both equal `k` and give the same `keyId`; a PEM produced by `openssl pkey -pubout` fixture parses. REVIEW-REQUIRED (SR1).
2. **A2 nonces + ratelimit** (deps none) — `server/fleet/nonces.mjs`, `server/fleet/ratelimit.mjs`, `test/nonces.test.mjs`, `test/ratelimit.test.mjs`. Injected `now`, no timers.
3. **A3 audit** (deps A1) — `server/fleet/audit.mjs`, `test/audit.test.mjs`. Done when chain/rotation/tamper tests pass using a tmp dir. REVIEW-REQUIRED (SR2).
4. **A4 auth** (deps A1, A2, §1 F5) — `server/fleet/auth.mjs`, `test/auth.test.mjs`. Pure over a fake `req` `{headers, method, url, socket:{localPort, lbPeerUid}}`; imports `server/security.mjs`. Done when the `test/auth.test.mjs` list in §4 passes, including scopes, stripped local identity headers, `hubAddrs`, `allowedUsers` and the peer-uid branch. REVIEW-REQUIRED (SR3).
5. **A5 config keys** (deps F4, A1) — `server/config/fleet-auth.mjs`, `test/config-fleet-auth.test.mjs` (validation: bad `hubKeys`
   string, PEM and `ed25519:` both accepted, a bare string parses to scopes `{read}`, an object entry `{key, id, scopes}` parses, scopes without `read` / with an unknown scope / duplicate `id` → `ConfigError`, `ingressPort` == `port`, `ingressPort: null` with a `fleet` block or in hub mode → `ConfigError`, unknown permission mode, `hubControl` boolean, `hubAddrs` entries are IP literals, `ingressPeerUid` integer ≥ 0 or null (and refused off Linux), `allowedUsers` strings). Only the keys in 2.2; `fleet.id/code/allowedOrigins` are F4's fragment. REVIEW-REQUIRED (SR4).
6. **A6 dispatch** (deps A2, A3) — `server/fleet/dispatch.mjs`, `server/fleet/builtin-actions.mjs`, `test/dispatch.test.mjs`. Built-in registrations for the rows with calls in
   2.6, deps injected (`{actions, launcher, retirer, state, config}`) so tests use stubs. Implements the `remoteOnly` flag as boolean or predicate and the `scope-missing` check. REVIEW-REQUIRED (SR5).
7. **A7 stream + term hook** (deps §1 F7, F9) — `server/fleet/stream.mjs`, `server/ws.mjs` (`addTap`, client accounting), `server/terminals.mjs`
   (`attachNamed`), `test/stream.test.mjs` (tap receives every sent message; resync), `test/terminals.test.mjs` unchanged-green.
8. **A8 api-v1 + wiring** (deps A4, A5, A6, A7, A11, F9, F5, F7, SR7) — `server/fleet/api-v1.mjs`, `server/routes/v1.mjs` (actions, audit, jobs, stream/term upgrades, nonce preload from audit, `registerBuiltins` at module register), `server/http.mjs` (classification, `guardRequest`, `AuthError` answer),
   `server/boot/common.mjs` (second listener for `ingressPort` in `listenAll`; `guardUpgrade` first in the upgrade path),
   `server/boot/builder.mjs` (legacy adapters through `dispatch`; `/api/hook` local-only when enforcing),
   `test/api-v1.test.mjs`, `test/api-v1-auth.test.mjs` (hubControl false → 403 `control-disabled` and an audit row; true + `control` scope → 200; true + bare-string (read-only) key → 403 `scope-missing`; term upgrade with a read signature → 403, with a `term` envelope from a key without `term` → 403, with `term` scope → 101; `fleet` block with `ingressPort` → requests on the ingress port without `X-Forwarded-For`/`-Proto` → 403; `Tailscale-User-Login` sent to the local listener → audit entry `user:'local'`; with `ingressPeerUid` set and a stubbed `peerUid` returning another uid → 403 `not-from-serve`). `listenAll` records `socket.lbPeerUid` on ingress connections only when `fleet.ingressPeerUid` is set (deps A11). REVIEW-REQUIRED (SR6).
9. **A9 CLI** (deps A1, A3, F5) — `bin/laneboard`, `test/cli-fleet.test.mjs` (spawn `node bin/laneboard fleet keygen --out <tmp>`, `fleet pubkey [--pem]`, and `audit verify --file`). Every server-supplied string the CLI prints passes `cleanTerm(s)` (strip C0 except `\t`, DEL, C1, ESC); test: a session name containing `\x1b]52;c;…\x07` prints without ESC.
10. **A10 docs** (deps A8) — `SECURITY.md` (new section "Fleet mode: who may do what", keep the loopback rule, and state plainly that pause, budget, approvals, kill and the audit log on a builder are cooperative controls against an agent that has a shell there; the boundary is cross-machine; list what is remote-only and that it needs a `fleet` block; list the accepted residual risks from `SECURITY-FIXES.md`), `docs/install.md`
    (ingress port mandatory, `tailscale serve --bg --https=8443 http://127.0.0.1:7778`, hubKeys in either format and with scopes, start with a bare-string (read-only) key, `hubControl`, optional `hubAddrs`/`ingressPeerUid`/`allowedUsers`, `jq` as a requirement of the statusline script), `docs/fleet/auth.md`. `CHANGELOG.md` is X4's (use a `Changelog:` trailer). Done when hygiene test green.
11. **A11 ingress peer-uid lookup** (deps none) — `server/fleet/peercred.mjs`, `test/peercred.test.mjs`, `test/fixtures/proc-net/**` (captured `/proc/net/tcp` and `tcp6` samples). Pure parser plus a lookup with injected `read`. Done when: the fixture rows for an established `127.0.0.1:<eph> → 127.0.0.1:7778` connection return the expected uid; IPv6 and v4-mapped rows parse; a missing row returns `null`; a malformed line is skipped, never thrown. Wired by A8. REVIEW-REQUIRED (covered by SR6).

## 4. Tests

- `test/canonical.test.mjs`: key order irrelevant; nested arrays keep order; throws on `__proto__`/`constructor` keys, `undefined`, `NaN`, `Infinity`, `BigInt`, `Date`.
- `test/auth.test.mjs`: valid signed action accepted; **expired** (ts −61 s and +61 s) → 401 `stale`; **replayed** (same id
  twice) → 401 `replay`; **forged** (one byte flipped in sig, envelope field changed after signing, signed by another key) → 401;
  wrong `builder` → 401; unknown `X-Laneboard-Key` → 403; **missing header** on ingress with `enforce` → 403, without enforce
  → `direct/local`; user header + sig → 400; user header on local listener ignored; heuristic ingress via `x-forwarded-for`;
  signed read string mismatch (path or query changed) → 401; a request signed over the raw `req.url` with a percent-encoded path verifies, the decoded spelling of the same path does not; query-param signature → 401; garbage signatures never enter the nonce cache; ingress request without `X-Forwarded-For` → 403 `not-from-serve`; with a `fleet` block an `X-Forwarded-For` on the **local** listener does not make the request ingress (heuristic deleted); `Tailscale-User-Login` on the local listener is removed from `req.headers`; a term upgrade with a read signature → 403, with a valid `term` envelope and `hubControl:true` from a key without `term` → 403 `scope-missing`, with `term` → ok; a term envelope whose `target` differs from the path → 403; a bare-string key verifies reads and gets scopes `{read}`; `hubAddrs` set and `X-Forwarded-For` not listed → 403 `hub-addr`; `allowedUsers` set and the login not listed → 403; `ingressPeerUid` set and `socket.lbPeerUid` different or `null` → 403 `not-from-serve`; **origin**: cross-origin
  upgrade 403, missing Origin on direct upgrade 403, `allowedOrigins` honoured, `Sec-Fetch-Site: cross-site` 403, Origin on a
  hub request 403; Host not allowed → 403; nonce cache full → 503 and does not evict; `App-Capabilities` role read blocks actions, absent changes nothing.
- `test/audit.test.mjs`: three appends chain (`entries[i].prevHash === entries[i-1].hash`); verify ok; **tamper**: edit a
  field, delete a line, reorder two lines, truncate mid-line → `firstBad` with the right line and reason; rotation at a tiny
  `maxBytes` keeps the chain across files and `verifyAll` passes; `read({after})` returns only later entries across files;
  file mode 0600.
- `test/dispatch.test.mjs`: every built-in action's schema rejects unknown keys; `kill` without/with wrong `confirm` → 400
  `confirm_required` and stub not called; `*` target refused for restart/retire/spawn/launch/send-text; `kill *` without a registered all-handler → 501, with one and `confirm:<builderId>` → handler called; hub kind with `hubControl:false` → 403 `control-disabled`, audited; hub kind with `hubControl:true` and scopes `{read}` → 403 `scope-missing`, with `{read, control}` → runs; `resume` from `local` of a session held by a `kind:'budget'` pause → 403 `remote-only` even without `override`, of a plain operator pause → runs; `guardPrompt` refuses with 409 `prompting` when the stub state is `waiting_permission`; `*` with `confirm:<builderId>` accepted for interrupt and with `confirm:"fleet"` refused (400); `kill *` from `local` → 403; `approve` from `local` → 403 `remote-only`;
  `broadcast` refused on builder; `launch` with repo not in `repoNames` → 400, with `fakeTakenSlots` → 400;
  `spawn.dir` outside `dirRoots` (and via a symlink) → 400; `bypassPermissions` refused by default; rate limit 429 after the
  configured count with `retryAfterMs`; every authenticated outcome (ok, refused, thrown) lands one audit entry.
- `test/api-v1.test.mjs`: starts `http.createServer(handleRequest)` on port 0 with `registerV1` and stub deps; `hello` shape
  (`apiVersion: 1`, `actions` is an object of tiers); `snapshot` has `builder`, `seq` and no `preview`; signed `POST /actions` → 200 with `auditId` present in
  `GET /audit?after=`; legacy `DELETE /api/sessions/x` from local auto-confirms and is audited `via:'legacy'`; from direct
  without body confirm → 400; stream: connect with a signed upgrade, receive `snapshot`, publish two messages, seq contiguous;
  `resync` with an old `fromSeq` replays, with a seq outside the ring returns a `snapshot`; unsigned ingress upgrade → 403.
- `test/cli-fleet.test.mjs`: keygen writes 0600 PEM, refuses overwrite, `pubkey` prints `ed25519:` + 44 base64 chars, `pubkey --pem` prints a PEM that `parsePublicKey` accepts; `audit verify` exit codes.

## 5. Risks, open questions, HUMAN checks

- Verified on the installed tailscale (no longer HUMAN): serve sends `Tailscale-User-Login`, `Tailscale-User-Name`, `X-Forwarded-For`/`-Host`/`-Proto`, preserves `Host` **with** the `:8443` port, and overwrites client-supplied copies of all of them; a tagged caller gets **no** `Tailscale-User-*` headers (spoofed ones are stripped); `--accept-app-caps` exists; funnel is off. Re-check after a Tailscale upgrade.
- HUMAN (only if enabling `fleet.ingressPeerUid`): confirm `ps -o uid= -C tailscaled` on each box and set that uid.
- Still open: the `Tailscale-App-Capabilities` JSON shape; the feature stays inert until checked.
- Risk: audit entry is written after `run`; a crash between them loses one entry. Accepted; the `events` row (`actions.mjs:43`) still exists.
- Risk: clock skew > 60 s between hub and builder → every signed request fails. `hello` returns `time`; §3 surfaces
  skew (Box view, §4 D11). NTP is assumed on all boxes.
- Risk: making `/ws/term` check Origin could break a non-browser client that connects without one from ingress; there is none today (CLI uses HTTP).
- Open: whether `restart` should be `confirm` tier (chosen: yes, it kills the process) — the frontend must show the confirm input.
- The signed-read string adds `v1` and the builder id to the conventions' `METHOD path ts nonce`; §3 uses `auth.signRead()`/`signedReadString()` exported from here rather than re-implementing it.

## 6. Dependencies

- Needs: §1 (F4 `config.fleet.id/code/allowedOrigins`, F5 `server/security.mjs`, F7 wire keys, F9 v1 skeleton) and §11 X1 (`mode`, module loader, config fragments, boot split).
- Provides to: §3 (envelope, signing helpers `signEnvelope(env, key)`, `signedReadString`, `signRead`, stream `seq`/`resync`
  contract, audit `after=` replay, term path); §1/§4 frontend (v1 actions, `X-Laneboard: 1` header, confirm fields,
  error codes, `hello.actions` tiers); §7, §8, §10 (`registerAction`, `registerAllHandler`, `addCapability`/`addHelloField`; their messages go through `ws.send`, which the A7 tap forwards to `stream.publish`).

## 7. PRIVATE (homelab repo)

Private details: homelab repo.
