# Q9: path mounts and WebSocket through tailscale serve, nginx, Caddy

## Answer

- **tailscale serve `--set-path /api/cockpit <port>`: the prefix is STRIPPED.** The source wraps a proxy mount in `http.StripPrefix(<mount>, h)`. The backend sees `/…` not `/api/cockpit/…`. To keep the prefix, give a full target URL with the path (`http://127.0.0.1:PORT/api/cockpit`). A mount that is hit exactly gets the target's path. How `SetURL` joins a longer remainder to a target path is not shown in what I read: **test it** before relying on it.
- **WebSocket through serve:** no explicit upgrade code in `serve.go`. It uses Go's `httputil.ReverseProxy`, which I know forwards `Upgrade` (stdlib behaviour since Go 1.12, not re-read tonight). Treat as likely works, **not confirmed by Tailscale docs**.
- **Origin:** serve never reads or rewrites `Origin`; it arrives as the browser sent it. `Host` is passed as the incoming host (`r.Out.Host = r.In.Host`), so the backend sees the tailnet name, not `127.0.0.1`.
- **Caddy:** plain `reverse_proxy` keeps the path unchanged; `handle_path` strips. WebSocket works with no setting. `Host` passes through; `Origin` is not mentioned in the docs (no reason to think it is touched).
- **nginx:** needs explicit `Upgrade`/`Connection` headers. `proxy_read_timeout` defaults to 60 s, so an idle socket dies unless the backend pings. `proxy_pass http://b;` (no URI) keeps the path; `proxy_pass http://b/;` (with URI) replaces the matched prefix. The latter is from general nginx knowledge, not the page I read.

## What the spec needs

1. `protocols.md` §1: the server must not assume a path prefix. Either serve under the path the proxy sends (stripped, `/…`) or accept both. Recommendation: the cockpit server mounts its API at a fixed prefix `/api/cockpit` and the setup docs give the full-URL form `tailscale serve --set-path /api/cockpit http://127.0.0.1:PORT/api/cockpit`, so the backend always sees the prefix whatever the proxy. Plain nginx/Caddy examples must say "do not strip".
2. Origin check (D92/D93): compare `Origin` to the allowed list; since serve passes `Origin` through and `Host` as the tailnet name, an allow-list of the tailnet origin works. Compare against `Host` only if `Host` is the public name (it is, through serve). Do not trust `X-Forwarded-*` unless the peer is loopback.
3. Identity headers: serve sets `Tailscale-User-Login`, `-Name`, `-Profile-Pic` after deleting client-sent copies, only for tailnet (non-tagged, non-funnel) traffic. Usable as an optional extra check, valid **only** when the connection comes from loopback via serve; spoofable otherwise.
4. Keepalive: ping every ≤ 25 s on the room link so nginx's 60 s default never fires.
5. nginx snippet in docs must include `Upgrade`, `Connection`, and `proxy_read_timeout 3600s`.

## Not confirmed

- Tailscale's own docs say nothing about WebSocket or Origin. The WebSocket claim rests on the Go stdlib.
- Path join for sub-paths with a path-bearing target: not read. A builder test (S-level, against a real `tailscale serve` is not possible in CI) should be a manual checklist item.
- Caddy `Origin` handling not documented.
- A third-party project commit (OpenClaw) reports the same stripping and the same full-URL workaround; secondary only. Pages contained no instructions.

## Sources (read 2026-10-27)

- https://tailscale.com/kb/1242/tailscale-serve (`--set-path` appends a path; no WebSocket or header text)
- https://raw.githubusercontent.com/tailscale/tailscale/main/ipn/ipnlocal/serve.go (StripPrefix, Rewrite, headers; via summarising fetch, so quotes are paraphrase-level)
- https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- https://nginx.org/en/docs/http/websocket.html
- https://ayuriel.duckdns.org/Ayuriel/openclaw/commit/26ce65995f8f936e9f74d0e34b33f65bf9f22b50 (secondary, search snippet only)
