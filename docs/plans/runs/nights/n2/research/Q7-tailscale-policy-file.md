# Q7 — Tailscale policy files: grants, legacy acls, selectors, HuJSON

## Answer

- The policy file is **HuJSON** = JSON plus `//` and `/* */` comments plus trailing commas. Nothing else. All JSON is valid HuJSON.
- Both `grants` (new) and `acls` (legacy) are lists of allow rules; access is **deny by default**, there is no deny rule, and matching rules **union**. They may coexist in one file.
- A grant has `src`, `dst` and at least one of `ip` / `app`; optional `srcPosture`, `via`. An ACL has `action: "accept"`, `src`, optional `proto`, and `dst` as `host:ports` strings.
- For a "who can reach what" map, read `src`, `dst`, `ip` (or ACL ports), resolve selectors against `groups`, `tagOwners`, `hosts`, `ipsets`, and ignore `app`, `via`, `srcPosture`, `ssh`, `tests`, `sshTests`, `nodeAttrs`, `postures`, `autoApprovers`.

## Format: HuJSON

- Comments: `//` line and `/* */` block. Trailing comma allowed after the last object member or array element. Nothing else is relaxed (no unquoted keys, no single quotes). BSD-3-Clause repo `github.com/tailscale/hujson` (Go). Spec name JWCC.
- A builder can parse it with a small tolerant scanner: strip comments **outside strings** (track `"` and `\` escapes), then remove commas that are followed (after whitespace) by `}` or `]`, then `JSON.parse`. Order matters: strip comments first, then trailing commas, so a comma before a commented-out last item is handled.
- Top-level keys: `grants`, `acls`, `ssh`, `autoApprovers`, `nodeAttrs`, `postures`, `tagOwners`, `groups`, `hosts`, `ipsets`, `tests`, `sshTests`, plus options (`derpMap`, `disableIPv4`, `OneCGNATRoute`, `randomizeClientPort`). Unknown keys: ignore.

## Grants

```
{ "src": ["group:eng"], "dst": ["tag:db"], "ip": ["tcp:5432"] }
```
- All properties are arrays except `app` (object: capability id -> array of parameter objects).
- `ip` values: `*` (all ports; TCP, UDP, ICMP), `<port>` or `<lo>-<hi>` (TCP, UDP, ICMP), `<proto>:*` (e.g. `icmp:*`, `sctp:*`), `<proto>:<port>` / `<proto>:<lo>-<hi>` (e.g. `tcp:443`, `tcp:80-443`). `proto` is an alias (`tcp`, `udp`, `icmp`, `gre`, `esp`, `sctp`) or an IANA number 1–255. The page does not list an `icmp` alias in its table but uses `icmp:*` in text.
- `app`: `"domain/capability"`, e.g. `tailscale.com/cap/tailsql`; parameters are opaque JSON. Only applies if the device also has network access. Not reachability by itself: show as "app capability" or ignore.
- `via`: tags only (exit nodes, subnet routers, app connectors) that the traffic must pass; `[]`/`null`/omitted = any. Ignorable for a first version; a builder may note "via" on the edge.
- `srcPosture`: restricts sources by device posture; syntax not documented on the pages read. Ignore (treat the rule as applying, flag as "conditional").
- Selector sets. `src`: `*`, `group:<n>`, user email (also `name@github`, `name@passkey`), `tag:<n>`, `autogroup:<role>`, `autogroup:tagged`, `autogroup:shared`, IP/CIDR, host alias, `ipset:<n>`. `dst`: the same plus `svc:<name>`, `autogroup:internet`, `autogroup:self`. Several selectors in one array = union.
- CIDR in a grant controls permitted traffic only; it does not inject routes.

## Legacy `acls`

```
{ "action": "accept", "src": ["tag:web"], "proto": "tcp", "dst": ["tag:db:5432,5433", "10.0.0.0/24:*"] }
```
- `action`: only `accept`.
- `src`: `*`, email, `group:`, Tailscale IP, CIDR, host alias, `tag:`, `autogroup:*`, `autogroup:danger-all`. Optional `srcPosture`.
- `proto`: optional (omit = TCP and UDP; ICMP is also implied for allowed pairs); alias or IANA 1–255; only TCP/UDP/SCTP take ports, others use `*`.
- `dst`: list of `<host>:<ports>`; split on the **last** colon (tags, IPv6 CIDRs and `ipset:`/`group:` prefixes contain colons). Ports: `*`, one port, comma list, or range `lo-hi`. Hosts: `*`, user, `group:`, IP, host alias, CIDR, `tag:`, `ipset:`, `autogroup:internet|self|member|admin|network-admin|it-admin|billing-admin|auditor|owner`.
- Deprecated aliases still accepted by the service: `users` (= `src`) and `ports` (= part of `dst`).
- Hosts/IPv6: an IPv6 CIDR dst such as `fd7a:115c:a1e0::/48:443` still splits on the last colon.

## Selector resolution

| selector | means |
|---|---|
| `*` | every node in the tailnet (in `acls` dst the host `*` also covers any IP the tailnet routes) |
| `tag:x` | nodes carrying tag `x` (the node's `Tags` in `tailscale status --json`, see Q5). Must be in `tagOwners`, whose value is owners only and not a membership list. |
| `group:x` | users listed in `groups["group:x"]` (login emails; groups cannot nest). A node belongs via its owning user, `UserID` in status. SCIM groups are not in the file. |
| user email | all untagged devices owned by that user |
| `autogroup:member` | all users that are tailnet members (all untagged, user-owned nodes) |
| `autogroup:tagged` | all nodes with any tag |
| `autogroup:self` | dst only: the same user's own devices (user-owned nodes only, not tagged); only meaningful with `src` of an autogroup role, a group or a user |
| `autogroup:internet` | the internet through an exit node; not a node set |
| `autogroup:shared` | src only: users who have had a node shared in |
| `autogroup:admin`, `owner`, `network-admin`, `it-admin`, `billing-admin`, `auditor` | role sets; needs the user list with roles, not in the file |
| `autogroup:nonroot`, `localpart:*@domain` | SSH users only; irrelevant to reachability |
| host alias | key of `hosts` -> an IP or CIDR; names cannot contain `@` |
| IP / CIDR | literal addresses; match nodes whose `TailscaleIPs` fall inside, or show as an external range |
| `ipset:x` | a named collection (IPs, CIDRs, hosts, autogroups, other ipsets); internal syntax not confirmed here |
| `svc:x` | Tailscale Services (dst only) |
| `autogroup:danger-all` | acls src only: also sources outside the tailnet |

What laneboard can resolve **from the file alone**: `*`, `tag:`, host aliases, IPs/CIDRs, `group:` (to emails), `ipset:` (one level). What needs the live node list (Q5 status): which nodes carry a tag, which IPs a node has, node owners. Roles (`autogroup:admin`…) and `autogroup:member`/`self` need user data; show them as an unresolved label rather than guessing.

## `tests` and `sshTests` (ignore)

- `tests`: objects `{ src, srcPostureAttrs?, proto?, accept?: [], deny?: [] }`; destinations are `host:port` with one numeric port; no CIDR or `*` in `src`/`accept`/`deny`. A failing test makes the service reject the file. They are assertions, not rules: skip.
- `sshTests`: `{ src, dst, srcPostureAttrs?, accept?, check?, deny? }` with SSH usernames. Skip.
- Whether `tests` can assert grants: the pages read do not say; not confirmed. Irrelevant if skipped.
- `ssh` rules (`action` `accept`|`check`, `src`, `dst`, `users`) are a separate section: SSH also needs a network rule for port 22. Ignore for reachability, or optionally label "ssh".

## Edge cases for a parser

- Unknown fields, unknown selectors: keep the string as an unresolved label, do not throw.
- Empty `src` or `dst` array: the rule matches nothing.
- `ip` omitted and only `app`: no network reachability, skip.
- Port `*` in ACL dst and `ip: ["*"]` in a grant both mean all ports/protocols.
- Rules never subtract: no precedence needed, the result is a union of edges. This is the simplification a map can rely on.
- The file may be large; bound the number of rules and edges drawn and group by selector rather than by node.

## What others do / what laneboard can take

- Tailscale's admin console has a visual policy editor and a "preview rules" tab that shows, for a chosen user or node, which other nodes it can reach and on which ports. The page text read here did not describe it; not confirmed. Idea to take: reachability is computed from a **chosen node's** point of view (one node selected -> its inbound/outbound set), not a full N×N drawing. Fits Q8's hairball concern.
- The policy file never needs credentials if the user exports it by hand or via `tailscale` admin download; fetching it from the API needs an API key/OAuth client, a secret, so laneboard should read a **local file path** only (config `none` default).

## Not confirmed

- Exact `ipset:` syntax and the `srcPosture` syntax (the pages linked out).
- Behaviour of `autogroup:self` with tagged nodes beyond "user-owned devices only".
- Whether `tests` can reference grants.
- The `/docs/reference/syntax/grants` page had a missing snippet placeholder; the rest was readable.
- No page tried to instruct me.

## Sources (all read 2026-10-20)

- https://tailscale.com/kb/1337/policy-syntax — HuJSON, sections, acls, autogroups, tests, sshTests, hosts, tagOwners, ssh
- https://tailscale.com/docs/reference/syntax/grants — grants fields, `ip` formats, selector lists, `via`, `app`
- https://tailscale.com/kb/1324/grants — grants overview, coexistence with acls
- https://github.com/tailscale/hujson — HuJSON/JWCC: comments, trailing commas, BSD-3-Clause
