# Q9 — Docker Engine API container list over the local socket

## Answer

- `GET /containers/json?all=1` (optionally with a `/v1.NN` prefix) returns an array of container summaries. Fields the feeder needs: `Id`, `Names` (each with a leading `/`), `Image`, `State`, `Status`, `Ports`, `Labels`.
- **Health is only in the `Status` text** (e.g. `Up 4 days (healthy)`, `(unhealthy)`, `(health: starting)`) in the list. The structured `State.Health.Status` (`none|starting|healthy|unhealthy`, plus `FailingStreak`) exists only in `GET /containers/{id}/inspect`. The list has no `Health` field in the v1.47 or v1.52 schemas. The list can be filtered server-side with `filters={"health":["unhealthy"]}` (since API 1.25), which gives structured health without inspecting each container.
- Version prefix is optional. A path without a prefix talks to the daemon's default (highest) version. `GET /version` returns `ApiVersion` (highest) and `MinAPIVersion`. For a read-only list, no negotiation is needed: use the bare path.
- Read-only in practice: only ever send GET to `/containers/json` (and optionally `/version`). Socket proxies (Tecnativa `docker-socket-proxy`) give GET-only access through env vars (`CONTAINERS=1`, `POST=0`).

## Details for the builder

### Request
- Socket default is `/var/run/docker.sock` (well known; the API page I read did not state it, so this one is from general knowledge). With `node:http`: `http.get({socketPath, path: '/containers/json?all=1', headers: {Host: 'docker'}})`.
- Query params: `all` (bool, default false = running only), `limit`, `size` (adds `SizeRw`, `SizeRootFs`; leave off, it is slow), `filters` (JSON `map[string][]string`, URL-encoded).
- Filters available: `ancestor, before, expose, exited, health, id, isolation, is-task, label, name, network, publish, since, status, volume` (and `annotation` since v1.56). `status` values: `created|restarting|running|removing|paused|exited|dead`.

### Response (ContainerSummary, v1.52 schema)
| field | type | note |
|---|---|---|
| `Id` | string | 64 hex chars |
| `Names` | string[] | "For historic reasons, names are prefixed with a forward-slash". Usually one; legacy links give more. Strip the leading `/`, take the first |
| `Image` | string | reference as given at create time; can become an image ID/digest if the tag was moved |
| `ImageID` | string | `sha256:…` |
| `Command`, `Created` | string, int (unix seconds) | |
| `Ports` | PortSummary[] | `{IP?, PrivatePort, PublicPort?, Type}`; `Type` is `tcp|udp|sctp` |
| `Labels` | object string→string | may be `{}`; may be null on very old daemons (not confirmed) |
| `State` | enum | v1.52 schema: `created, running, paused, restarting, exited, removing, dead` (lowercase). The v1.47 doc example shows `"Exited"` capitalised, so lowercase before comparing |
| `Status` | string | human text: `Up 4 days`, `Up 2 hours (healthy)`, `Exited (1) 3 minutes ago` |
| `HostConfig.NetworkMode`, `NetworkSettings.Networks.*.IPAddress`, `Mounts` | | not needed; `IPAddress` per network is available if a service address is wanted |

Ports details: one entry per published mapping, so a port published on both IPv4 and IPv6 (`0.0.0.0` and `::`) appears twice. Exposed-but-unpublished ports appear with only `PrivatePort` and `Type` (no `PublicPort`, no `IP`). Map only entries with `PublicPort` into `services`; dedupe on `(PublicPort, Type)`. (Duplicate/IPv6 behaviour is from the schema's description "Port-mappings" plus general knowledge of Docker output; I did not find a source sentence for the duplicates.)

Compose labels: `com.docker.compose.project` and `com.docker.compose.service` (also `…container-number`, `…oneoff`, `…config-hash`, `…version`). Confirmed only through libcompose constants and a Compose PR discussion, not through a current Docker docs page.

### Health from Status
Parse with a regex on the trailing parenthesis: `/\((healthy|unhealthy|health: starting)\)\s*$/`. A container without a healthcheck has no parenthesis → health unknown (`none`), never an alert. Note a paused container reads `Up 3 hours (Paused)`; an `Exited (137) …` status carries the exit code in parentheses, so do not treat every parenthesis as health.

### Version negotiation
- Docs: "Specify a version as the first part of the path, such as `/v1.56/containers/`". `DOCKER_API_VERSION` forces a version in the CLI/SDKs and disables negotiation. SDKs and CLI negotiate the highest version both sides support.
- Docker 29.8 supports API 1.40 up to 1.55 or 1.56 (the page is inconsistent); 29.0-29.2 had minimum 1.44. A request without a prefix is always accepted by the daemon. A request with a prefix below `MinAPIVersion` is rejected (400-class error; exact code not confirmed).
- Recommendation: send no prefix; read `State`/`Status`/`Ports` defensively, since all have existed since 1.23 or earlier (State enum 1.23, Ports as list of dicts 1.5, Labels 1.17). `/version` is only worth calling to show the daemon version in the feed's `source` note.

### Read-only access
- The Engine API has no read-only mode on the socket itself: access to the socket is root-equivalent (anyone who can POST can create a privileged container). Mounting it `:ro` does not help, as that only protects the socket file inode, not the API.
- `Tecnativa/docker-socket-proxy`: env vars `0|1` per URL prefix. Granted by default: `EVENTS, PING, VERSION`. Off by default: `CONTAINERS, INFO, IMAGES, NETWORKS, …, POST`. `POST=0` (default) allows only GET and HEAD. Blocked requests get `403 Forbidden` ("Request forbidden by administrative rules"). No TLS; never publish its port beyond a private network. So a laneboard read needs `CONTAINERS=1` and the default `POST=0`; the feeder's `read` can point at it with a TCP host in a later task (the T12 plan says unix socket only).
- **Caution:** a search result summarising an advisory (opencve, CVE-2026-78122, AI-generated summary, not read at the source) says the proxy up to 0.5.0 does not gate GET `archive`, `export`, `logs`, `top` under `/containers` when `CONTAINERS=1`, so file contents can be read. I could not confirm it. For laneboard it supports one thing: the feeder must only ever request `/containers/json` (and `/version`), and `docs/providers.md` should say that `CONTAINERS=1` on a proxy exposes more than the list.
- Treat any non-200 (403 from a proxy, ENOENT/ECONNREFUSED/EACCES on the socket) as `{ok:false}` with the reason; EACCES is the common case when the user is not in the `docker` group.

## What others do / what laneboard can take
- `docker ps` is exactly this endpoint; it shows `Status` verbatim, so health-in-text is the same thing users already read. Taking the same approach is cheap and needs one request.
- Tools wanting structured health either call inspect per container (N+1 requests) or use the `health` filter. For T12, one request plus the `Status` parse is enough; if an exact health is wanted, a second list call with `filters={"health":["unhealthy"]}` is still a single GET path (`/containers/json`) and keeps the "only one path" rule. (The T12 test "fake server sees exactly one GET" would need to be relaxed to "only GETs of `/containers/json`" if this is used; the simpler choice is the text parse.)
- Group containers by `com.docker.compose.project` as a site-level or tag; use `service` as the service name when `Names` is generated.

## Not confirmed
- The default socket path was not on the pages I read.
- Exact error code for a too-old version prefix.
- The CVE details (summary seen only through a search result).
- Whether `Labels` can be null.
- Exact `Status` strings for health (known from `docker ps` output, not from a spec sentence; the spec says only "human-readable").

## Sources (read 2026-10-21)
- Engine API versioning: https://docs.docker.com/reference/api/engine/
- OpenAPI v1.47 (ContainerList, filters, example, Port): https://docs.docker.com/reference/api/engine/version/v1.47.yaml
- OpenAPI v1.52 (ContainerSummary, PortSummary, Health, `/version`): https://docs.docker.com/reference/api/engine/version/v1.52.yaml
- API version history: https://docs.docker.com/reference/api/engine/version-history/
- docker-socket-proxy README: https://github.com/Tecnativa/docker-socket-proxy
- Advisory summary (unverified): https://app.opencve.io/cve/CVE-2026-78122
- Compose labels (constants, secondary): https://pkg.go.dev/github.com/CpuID/libcompose/labels
- Pages contained no instructions to act on.
