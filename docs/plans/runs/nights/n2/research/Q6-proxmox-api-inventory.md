# Q6: Proxmox VE API, read-only inventory

**Answer.** One call is enough: `GET https://<host>:8006/api2/json/cluster/resources` (optionally
`?type=vm` or `?type=node`) returns a flat array in `data`, one object per node, guest (`qemu`, `lxc`),
storage, pool, sdn. Auth header: `Authorization: PVEAPIToken=USER@REALM!TOKENID=SECRET`. Least privilege: a
user with the built-in **`PVEAuditor`** role on `/`, and a token on that user (with privilege separation
you must give the *token* the ACL too). The default certificate is self-signed: the client must take a CA/pinned
fingerprint, with an explicit "insecure" opt-out as the last resort.

## Request

- URL: `https://<host>:8006/api2/json/cluster/resources`. Response: `{"data":[ … ]}`.
- Query `type` enum: `vm`, `storage`, `node`, `sdn` (no filter = everything). `?type=vm` gives qemu + lxc only.
  Nodes come with `type=node`; for host stats the feeder needs `node` rows too, so call without a filter and pick rows by `type`.
- Header (exact): `Authorization: PVEAPIToken=root@pam!monitoring=aaaaaaaaa-bbb-cccc-dddd-ef0123456789`
  (shape: `PVEAPIToken=<user>@<realm>!<tokenid>=<uuid>`). No CSRF token is needed for tokens. The secret is
  shown once at creation.
- Tokens can have an expiry (epoch seconds); after it, requests fail with 401.
- Clustered: any node's API answers for the whole cluster. Standalone: same URL works (the cluster endpoint exists
  on single nodes too; not verified against a standalone install this round, though the docs list `cluster` at the API root).
- Fallback if `/cluster/resources` is refused: `/nodes` (list, `node`, `status`, `cpu`, `mem`, `maxmem`, `uptime`),
  `/nodes/<n>/qemu`, `/nodes/<n>/lxc` (per-guest `vmid`, `name`, `status`, `cpu`, `mem`, `maxmem`, `disk`, `uptime`, `template`).
  Field names there are as I remember them: **not verified** this round.

## Fields of `/cluster/resources` (from `PVE/API2/Cluster.pm` returns schema)

- Always: `id` (e.g. `qemu/101`, `lxc/102`, `node/hv1`, `storage/hv1/local`), `type` (`node|storage|pool|qemu|lxc|openvz|sdn|network`).
- Identity: `name` (guests; **absent on `node` rows**), `node` (host name), `vmid` (int; guests), `storage`, `pool`.
- Metrics (optional, bytes unless noted): `cpu` (fraction 0..1 of `maxcpu`), `maxcpu` (cores), `mem`, `maxmem`, `memhost`, `disk`, `maxdisk`, `netin`, `netout`, `diskread`, `diskwrite`, `uptime` (seconds).
- State: `status` ("Resource type dependent": guests `running` / `stopped` (also `paused`, `suspended` are PVE
  qemu states, not in the schema text I read); nodes `online` / `offline`; storage `available`), `lock` (config lock e.g. `backup`), `hastate`, `level` (node support level), `cgroup-mode`, `host-arch`.
- Guests only: `tags` (a single string, `;`-separated: from the guest config; I believe `;` but the schema text does not say), `template` (boolean, default 0 => `1` for templates; absent when 0 is likely).
- Storage: `content`, `shared`, `plugintype`.
- A **stopped** guest still has `maxmem`, `maxcpu`, `maxdisk` but `cpu`/`mem`/`uptime` are 0 (typical; not stated in the schema).
- `mem` for qemu guests: the value PVE reports is host-side usage that can include page cache for LXC (cgroup) and the balloon/agent figure for qemu; it is **not** "used by processes". T5's `memCache: true` flag is a reasonable way to say so. Not confirmed from a primary source.
- Integers vs floats: `cpu` is a float; `mem` etc. are integers (JS numbers are safe: < 2^53).

## Permissions (what the token sees)

- The method is `user => 'all'`; filtering is per object inside:
  - guest rows only if the caller has **`VM.Audit` on `/vms/<vmid>`**; `pool` on a guest is stripped without `Pool.Audit`;
  - node rows are always listed; `Sys.Audit` on `/nodes/<n>` decides how much detail (cpu/mem) comes back;
  - storage rows need `Datastore.Audit` on `/storage/<id>`;
  - sdn rows need `SDN.Audit`.
- **`PVEAuditor`** = `VM.Audit, VM.GuestAgent.Audit, Sys.Audit, Datastore.Audit, SDN.Audit, Pool.Audit, Mapping.Audit` (from `PVE/AccessControl.pm`: read-only privileges only).
- Recipe (for `docs/map.md`; to be run by the owner on the PVE host, not by laneboard):
  `pveum user add laneboard@pve`, `pveum user token add laneboard@pve map` (privilege separation stays **on**, the default),
  `pveum acl modify / --roles PVEAuditor --users laneboard@pve --tokens 'laneboard@pve!map'`. The `acl modify` flags are from
  my memory of `pveum`; the wiki only shows `pveum acl modify / -user joe@pve -role PVEAuditor`. Tell the builder to check `pveum acl modify --help` wording or point the docs at the wiki.
- Separated-privilege token permissions = intersection of the user's and the token's ACLs: so the ACL is needed for **both** (user and token) or the token sees nothing.
- Tokens cannot open consoles; irrelevant here.

## Self-signed certificate

PVE installs a cluster CA and a certificate for each node by default (the wiki's examples just use `curl -k`). Options for `node:https`:

1. `ca: fs.readFileSync(file)`: the PVE CA (`/etc/pve/pve-root-ca.pem` on the host; path from memory, not verified) or the node's own cert; verifies normally. Hostname check still applies: use the name in the cert, or `servername`.
2. Pin the SHA-256 fingerprint: `rejectUnauthorized: false` plus a `checkServerIdentity` callback that compares `cert.fingerprint256` with the configured value. Stronger than "insecure" and needs no file. (Node API; standard.)
3. Explicit `insecure` flag: warn once on stderr. Never default.

Recommendation: options 1 and 2 as `--ca <file>` / `--fingerprint <sha256>`; no TLS-off flag, or one that is loudly named.

## What others do (not fetched this round; from general knowledge, unconfirmed)

Monitoring integrations (Prometheus `pve_exporter`, Homepage, Telegraf) use the same token header, `PVEAuditor`, and a `verify_ssl` option defaulting on. Take: token id + secret from a file, `verify` on by default.

## Could not confirm

- Exact `status` values on `node` rows and whether `template` appears at all on non-template rows.
- The api-viewer's `apidata.js` returned 404, so the schema came from `Cluster.pm` source.
- The `/nodes/<n>/…` fallback field names; the `pveum acl` flag spelling; the CA path.

## Sources

- https://pve.proxmox.com/wiki/Proxmox_VE_API (read 2026-10-20): header format, `curl -k` examples, cluster/nodes root.
- https://pve.proxmox.com/wiki/User_Management (read 2026-10-20): token header, separated-privilege default and intersection rule, `pveum acl modify / -user joe@pve -role PVEAuditor`, expiry.
- https://raw.githubusercontent.com/proxmox/pve-manager/master/PVE/API2/Cluster.pm (read 2026-10-20): `resources` returns schema, `type` enum, per-object permission checks.
- https://raw.githubusercontent.com/proxmox/pve-access-control/master/src/PVE/AccessControl.pm (read 2026-10-20): PVEAuditor privilege list.
- Licence note: Proxmox sources are AGPL-3.0; I copied only field names.
