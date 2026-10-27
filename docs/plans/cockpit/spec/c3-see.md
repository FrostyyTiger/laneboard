# C3 See: the agent reads what the board knows

Part 1 (T8): the laneboard MCP server and its seven read tools. Part 2 (T9, planned): `focus` and
"Ask about this". Plan C3: "A laneboard MCP server in the room gives the agent read access to what
the board knows." Words (room, agent, board, focus, tool line) are defined in `README.md`
§Glossary.

C3 reads; it never changes the fleet or the screen. Show commands are C4 (`c4-show-canvas.md`).

## 1. The server

- **One MCP server, key `laneboard`** (D58). The agent sees its tools as `mcp__laneboard__<tool>`;
  `c1-talk.md` §5 matches tool lines on that prefix. The C4 show commands join the same server later.
- **Served by the room process** (Q-O15 a) as Streamable HTTP at `POST /mcp` on `127.0.0.1` only,
  port `cockpit.mcp.port` (default `7790`) (D58). It never listens on another address. Every request
  needs `Authorization: Bearer <token>`; the room writes a fresh 32-byte random token (hex) to
  `<stateDir>/cockpit/mcp.token` (mode `0600`) at each start. A request with an `Origin` header is
  refused with 403 (`research/Q5`: a browser must never reach it). `focus` (T9) lives in the same
  process as the screens' connections, so it needs no second channel.
- **The agent's launch** adds (with Claude Code; the full line is Q-O23's):
  `--mcp-config <stateDir>/cockpit/mcp.json --strict-mcp-config --allowedTools "mcp__laneboard__*,…"`.
  The room writes `mcp.json` at start:

  ```json
  {"mcpServers":{"laneboard":{"type":"http","url":"http://127.0.0.1:7790/mcp",
    "headers":{"Authorization":"Bearer ${LANEBOARD_MCP_TOKEN}"},"timeout":15000}}}
  ```

  and starts the agent with `LANEBOARD_MCP_TOKEN` in its environment.
- **Startup check.** If the agent's `system/init` lists `laneboard` with a status other than
  `connected`, or names it in `mcp_server_errors` (`research/Q5`), the room logs it and the pane shows
  the grey line `The agent cannot read the board: its laneboard tools did not start.` before the
  first turn; turns still run (the agent answers without fleet data). `protocols.md` (T16) carries it.
- **Every argument is checked** against the tool's schema below. A bad argument is a JSON-RPC error
  `-32602` naming the field (`run: must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`). Anything the agent
  can recover from (an unknown id, the board down) is a normal result with `isError: true` and one
  plain sentence (§3).
- **At most 4 tool calls run at once** per agent session, the 5th waits; at most 60 calls per
  minute, the 61st returns `isError` `Too many board reads this minute; wait and ask again.` (D60).

## 2. Where the data comes from

The MCP server reads one **board** over HTTP, the same JSON the browser gets: config
`cockpit.board.url` (default `http://127.0.0.1:7777`). The board is a hub (fleet mode) or a single
laneboard (one machine, `single-machine.md`). The server asks the board's `/healthz` once at start
and every 60 s; `"mode": "hub"` picks the hub column below.

How the room is allowed to read a hub is not settled (pending Q-O26). The spec is written for the
recommendation: the room runs on the hub's box as its own unix user and reads the hub's loopback
port, where it is a `local` caller (`docs/fleet/auth.md`): on a hub `local` gets every read and no
action, control, terminal or push change.

| Tool | On a hub | On a single board |
| --- | --- | --- |
| `fleet` | `GET /api/map` (nodes, links), `GET /api/fleet` (builder rows) | `GET /api/map` |
| `runs` | gap: no route today (§6) | `GET /api/runs`, `GET /api/runs/:run` (`server/routes/runs.mjs`) |
| `lanes` | `GET /api/fleet/:builder/snapshot` (`server/hub/routes/core.mjs`) | `GET /api/lanes` |
| `ci` | `GET /api/packages` (`server/hub/packages.mjs` merge) | `GET /api/ci` (`server/collector/pr.mjs` snapshot) |
| `alerts` | `GET /api/alarms` (`server/hub/routes/alarms.mjs`) | `GET /api/alarms` (`server/routes/alarms.mjs`) |
| `morning` | `GET /api/fleet/morning?window=` (`server/hub/morning.mjs` merge) | `GET /api/morning?window=` (`server/morning.mjs`) |
| `history` | `GET /api/map` `events` (last 80) and `GET /api/fleet/audit` | `GET /api/map` `events` and `GET /api/events` |

- **Each board read times out after 5 s.** A tool waits for all of its reads, at most 8 s in all, and
  answers with what came back; a missing source is named in `missing` (§3).
- **Reads are cached 5 s** per URL in the room, so three tool calls in one turn cost one request each.
- The MCP server copies only the fields listed under each tool into fresh objects. It never passes a
  board response through whole: builder data is untrusted (`server/hub/morning.mjs` header) and the
  agent's context is small. Strings keep the board's own sanitising; the server additionally cuts
  each string to the length in §3.

## 3. Rules every result follows

- **Content.** One `text` item holding the result as compact JSON, and the same object as
  `structuredContent` (`research/Q5`). No images, no files, no resource links in C3.
- **Times** are ISO 8601 in the board's `config.timezone` with the offset
  (`2026-10-27T02:10:00+01:00`), never epoch numbers (D59). Durations are whole seconds or minutes, with
  the unit in the field name (`ageS`, `waitMin`).
- **`asOf`.** Every result starts with `asOf`: one entry per source it read, the time that source's
  data is from (a feed's `at`, a builder snapshot's `generatedAt`, the hub's `now`), and its `ageS`.
  A source older than 600 s carries `"stale": true` (review 44 finding 2; T63 adds what the agent says
  about it).

  ```json
  "asOf": [{"source":"hub","at":"2026-10-27T07:12:04+01:00","ageS":1},
           {"source":"feed:hv1","at":"2026-10-27T02:10:00+01:00","ageS":18124,"stale":true}]
  ```

- **`missing`**: the sources that did not answer, with why
  (`[{"source":"builder-c","why":"down since 2026-10-27T06:41:00+01:00"}]`), else absent.
- **Size.** Each result is at most 24 000 characters of JSON (about 6 000 tokens, a quarter of
  Claude Code's 25 000-token cap, `research/Q5`) (D60). Each list has a cap (per tool below); a capped
  list keeps the most important items first (the tool's order) and the result says
  `"truncated": {"<list>": <how many left out>}`. If the result is still over 24 000 characters, the
  server drops `detail` fields, then cuts lists in half, until it fits, and adds `"cut": true`.
- **Strings** are cut to 200 characters (`text`, `why`, `goal`) or 64 (`id`, `label`, names), ending
  in `…`.
- **Errors** the agent can act on are `isError: true` with one sentence, no JSON:

  | Case | Text |
  | --- | --- |
  | unknown id | `No run "acme-x". Known runs: acme-search, acme-docs, acme-billing.` (at most 10 names, then `, … (14 more)`) |
  | board not answering | `The board at http://127.0.0.1:7777 did not answer in 5 s; nothing to read.` |
  | board says 4xx/5xx | `The board answered 503 for /api/fleet/morning; try again in a minute.` |
  | not available on this board | `Runs are not available on this hub yet.` (§6) |
  | rate limit | `Too many board reads this minute; wait and ask again.` |

## 4. The tools

Each tool has a `description` the agent reads (given below in quotes, word for word), an
`inputSchema` (all parameters optional unless bold), its result, and its tool-line `{target}`
(`c1-talk.md` §5 table). Examples are from the demo fleet (`test/helpers/demo-hub.mjs`: site `lab`
on hypervisor `hv1`, rooms `vm-a`, `vm-b`, `vm-c`, `ci`, `backup`, builders `builder-a`..`c`, runs
`acme-search`, `acme-docs`, `acme-billing`); numbers in the examples are illustrative, field names and
ids are exact.

### 4.1 `fleet`

"What the fleet looks like now: sites, hosts, rooms, services, builders, each with its status and why.
Give `site` or `node` to see one part with its children. Call this first for 'is everything up?'."

| Param | Type | Rule |
| --- | --- | --- |
| `site` | string | a node id of `kind: site` (`lab`) or its label (`hv1`); only that subtree |
| `node` | string | any node id; that node, its parent and its children |
| `status` | string | `problems` keeps nodes whose status is `warn`, `attention`, `crit`, `down` or `unknown`, plus their parents |

`site` and `node` together is a `-32602` error. Tool line target: `site`, else `node`.

```json
{"asOf":[{"source":"hub","at":"2026-10-27T07:12:04+01:00","ageS":1},
         {"source":"feed:hv1","at":"2026-10-27T07:11:40+01:00","ageS":25}],
 "counts":{"nodes":14,"ok":9,"working":2,"warn":1,"crit":0,"down":1,"unknown":1},
 "builders":[{"id":"builder-a","state":"up","ageS":2,"version":"0.42.0"},
             {"id":"builder-c","state":"down","ageS":1960}],
 "nodes":[{"id":"lab","kind":"site","label":"hv1","status":"ok","sub":"hypervisor","cpu":0.27,"mem":0.58,"disk":0.44},
          {"id":"room-b","kind":"room","label":"vm-b","parent":"lab","status":"warn","why":"run acme-billing stuck: same task failed twice","builder":"builder-b"},
          {"id":"backup","kind":"room","label":"backup","parent":"lab","status":"unknown","drift":"missing","sub":"nightly backups"},
          {"id":"feed:hv1/scratch","kind":"room","label":"scratch","parent":"lab","status":"ok","drift":"undeclared"}]}
```

- Node fields copied from `/api/map` nodes: `id`, `kind`, `label`, `parent`, `status`, `sub`, `why`,
  `drift`, `builder`, `cpu`, `mem`, `disk` (fractions 0-1, 2 decimals), `detail` (at most 6 keys).
  Lanes, sessions and PR nodes are left out (they are `lanes`'s and `ci`'s).
- Order: worst status first (`crit`, `down`, `attention`, `warn`, `unknown`, `working`, `idle`, `ok`),
  then by label. Cap 200 nodes.
- `builders` from `/api/fleet` rows (`id`, `state`, `ageS`, `version`); on a single board, one row for
  itself.

### 4.2 `runs`

"Agent loops (runs): state, round, scores, what they need from the owner, cost, and whether they are
stuck. Give `run` for one run with its rounds."

| Param | Type | Rule |
| --- | --- | --- |
| `run` | string | a run id, `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` |
| `state` | string | `running`, `waiting`, `stopped`, `stuck` (stuck is any state with a stuck verdict) |
| `since` | string | ISO time or `12h`, `tonight`, `24h`, `7d`: runs updated in that window (default: all the board lists) |

Tool line target: `run`.

```json
{"asOf":[{"source":"builder-b","at":"2026-10-27T07:11:58+01:00","ageS":6}],
 "runs":[{"run":"acme-billing","host":"builder-b","goal":"Move acme-api billing to the new invoice table, tests green",
          "state":"running","round":4,"rounds":4,"maxRounds":10,
          "stuck":{"rule":"same-task","reason":"T3 failed in rounds 3 and 4"},
          "scores":{"tasks":{"value":2,"max":6,"prev":2}},
          "needs":[{"kind":"decision","text":"Drop the v1 export?","at":"2026-10-27T05:02:00+01:00"}],
          "costUsd":4.4,"prs":[],"deadline":"2026-10-27T09:00:00+01:00",
          "startedAt":"2026-10-26T22:06:40+01:00","updatedAt":"2026-10-27T06:58:10+01:00"}]}
```

- Row fields from `server/runs/summary.mjs` `summarize`: `run`, `goal`, `branch`, `state`, `round`,
  `rounds`, `maxRounds`, `scores` (value, max, prev), `needs` (open only), `cost.usd` as `costUsd`
  (review 44 finding 7), `prs` (url, title, state), `stop`, `stuck`, `deadline`, `startedAt`,
  `updatedAt`; `host` from the run's `run.start`, else the builder it came from.
- With `run`: the same row plus `rounds`, the last 10 rounds `{n, role, task, title, outcome, usd,
  startedAt, endedAt}`, newest first, with `"truncated"` when there are more.
- Order: stuck first, then `needs` open, then `updatedAt` newest. Cap 50 runs.

### 4.3 `lanes`

"Lanes on the builders: which agent sessions work on what branch, their state and their spend. Give
`builder` for one builder."

| Param | Type | Rule |
| --- | --- | --- |
| `builder` | string | a builder id (`builder-a`) |
| `state` | string | a lane state word as the Board uses it (`working`, `waiting`, `idle`, `done`, …) |

Tool line target: `builder`.

```json
{"asOf":[{"source":"builder-a","at":"2026-10-27T07:12:01+01:00","ageS":3}],
 "lanes":[{"id":"builder-a:search-api","builder":"builder-a","branch":"run/search","state":"waiting",
           "attention":"needs-input","since":"2026-10-27T06:55:00+01:00","usd5h":1.92,"pr":{"number":41,"verdict":"green"}}]}
```

- Fields: `id` (the fleet key, `docs/fleet/identity.md`), `builder`, `branch`, `state`, `attention`
  (the attention queue's state for it, else absent), `since`, `usd5h`, `pr` (`number`, `verdict`).
- Order: attention first (by the queue's score), then working, then the rest by label. Cap 100.

### 4.4 `ci`

"CI checks and pull requests: red, green or running, per branch and repo, and the CI queue. Give
`branch` (and `repo` if branch names repeat)."

| Param | Type | Rule |
| --- | --- | --- |
| `branch` | string | a branch name, 1-128 characters, no spaces |
| `repo` | string | a repo name or `owner/name` |
| `verdict` | string | `red`, `green`, `pending` |

Tool line target: `branch`.

```json
{"asOf":[{"source":"hub","at":"2026-10-27T07:12:04+01:00","ageS":1}],
 "queue":{"queued":2,"running":1},
 "branches":[{"repo":"acme/acme-api","branch":"main","verdict":"red","failed":["test (node 22)"],
              "headSha":"3f9c2a1","at":"2026-10-27T06:40:12+01:00"},
             {"repo":"acme/acme-api","branch":"run/search","verdict":"green","pr":41,"lane":"builder-a:search-api"}]}
```

- Order: `main`/default branches first, then red, pending, green. Cap 50 branches, `failed` at most 5
  names each.

### 4.5 `alerts`

"Open alarms across the fleet, worst first: what, where, since when, and whether someone acknowledged
it. Includes stuck runs and builders that are down."

| Param | Type | Rule |
| --- | --- | --- |
| `priority` | string | `P1`..`P4`: that priority and worse (`P2` gives P1 and P2) |
| `builder` | string | a builder id |

Tool line target: none (`read the alerts`).

```json
{"asOf":[{"source":"hub","at":"2026-10-27T07:12:04+01:00","ageS":1}],
 "alerts":[{"id":"builder-down:builder-c:builder-c","kind":"builder-down","priority":"P1","builder":"builder-c",
            "target":"builder-c","text":"builder-c not reachable","since":"2026-10-27T06:41:00+01:00","acked":false},
           {"id":"stuck:builder-b:acme-billing","kind":"stuck","priority":"P2","builder":"builder-b",
            "target":"acme-billing","text":"same task failed twice","since":"2026-10-27T06:12:00+01:00","acked":false}]}
```

- Fields from `server/fleet/alarms.mjs` `Alarm`: `id`, `kind`, `priority`, `builder`, `target`,
  `text`, `since`, `acked`, `ackedBy`. Order: priority, then `since` oldest first. Cap 100.

### 4.6 `morning`

"What happened in a window: what needs the owner, what finished, what got stuck, review waits,
approvals and cost. For a broad question ('how did the night go?') call this once first."

| Param | Type | Rule |
| --- | --- | --- |
| `window` | string | `12h`, `tonight`, `24h`, `7d` (`server/util.mjs` `WINDOWS`); default `tonight` (since 18:00 the evening before, or 12 h, whichever is longer) |

Tool line target: `window`. `c1-talk.md` §5's row changes from `since` to `window`, words
`read the Morning for {target}` (`read the Morning for tonight`).

```json
{"asOf":[{"source":"hub","at":"2026-10-27T07:12:04+01:00","ageS":1},
         {"source":"builder-c","at":"2026-10-27T06:40:51+01:00","ageS":1873,"stale":true}],
 "window":"tonight","label":"last night","since":"2026-10-26T18:00:00+01:00",
 "needsYou":[{"fkey":"builder-a:search-api","kind":"needs-input","text":"Which page size, 20 or 50?","since":"2026-10-27T06:55:00+01:00"}],
 "finished":[{"fkey":"builder-a:docs","outcome":"done","pr":{"number":39,"verdict":"green"},"at":"2026-10-27T03:20:00+01:00"}],
 "stuck":[{"fkey":"builder-b:acme-billing","reason":"same task failed twice","since":"2026-10-27T06:12:00+01:00","resolvedAt":null}],
 "review":{"waiting":2,"medianWaitMin":95},
 "approvals":{"answered":3,"approved":3,"denied":0},
 "costUsd":18.62,"costByPackage":[{"package":"acme-api","usd":12.4}],
 "missing":[{"source":"builder-c","why":"down since 2026-10-27T06:41:00+01:00"}]}
```

- Fields from the hub's `mergeMorning` (or a single board's `morning.build`): `window`, `label`,
  `since`, `needsYou`, `finished`, `stuck`, `review` (`waiting`, median wait in min), `approvals`,
  `totalUsd` as `costUsd`, `costByPackage`, `missing`. Each list capped at 20, in the board's order.
- A run's own state is `runs`'s; `morning` does not repeat it.

### 4.7 `history`

"What changed over time on one node or for one run: status changes, feed events, alarms raised and
cleared, actions taken. Give `node` (a node id or label) or `run`."

| Param | Type | Rule |
| --- | --- | --- |
| **`node`** or **`run`** | string | exactly one of the two |
| `since` | string | ISO time or `12h`, `tonight`, `24h`, `7d`; default `24h` |
| `limit` | integer | 1-100, default 30 |

Tool line target: `node`, else `run`.

```json
{"asOf":[{"source":"hub","at":"2026-10-27T07:12:04+01:00","ageS":1}],
 "node":"room-b","since":"2026-10-26T07:12:04+01:00",
 "events":[{"at":"2026-10-27T06:12:00+01:00","kind":"status","text":"vm-b is degraded"},
           {"at":"2026-10-27T03:01:10+01:00","kind":"feed","text":"nightly backup finished"},
           {"at":"2026-10-26T23:40:00+01:00","kind":"audit","text":"stop-session builder-b:old-lane by owner, ok"}],
 "covers":"2026-10-27T05:40:00+01:00"}
```

- Sources: the Map's event list (status changes and feed events, `server/map.mjs` `diffEvents`, the
  last 80 kept in memory), the audit log (`/api/fleet/audit?since=&builder=`, action, target, user,
  outcome, never arguments), and for `run` the run's own rounds and needs.
- `covers` is the oldest moment the in-memory events reach back to; when `since` is older, the
  result says so, so the agent does not read "no event" as "nothing happened" (§6).
- Order: newest first, `limit` items.

## 5. What the agent is told

The bridge's standing instructions (`protocols.md`, T16) include these four sentences about the
tools, word for word:

1. `The laneboard tools show the fleet as the board sees it; each result says how old its data is.`
2. `For a broad question, call morning once first, then only what it does not answer.`
3. `Name the node or run you are talking about by its label, as the board shows it.`
4. `If a tool says a source is missing or stale, say so in your answer.`

## 6. Gaps in the board today

What C3's build night adds to the board, outside the room (each is a code change in a reviewed
module; the night's done-when lists them):

- **Runs on a hub.** `server/routes/runs.mjs` is builder only and a hub has no `/api/runs` (the demo's
  forwarder fakes one, `test/helpers/demo-hub.mjs`). C3 adds `runs` and `runs/<id>` to the read
  proxy's `ALLOWLIST` (`server/hub/read-proxy.mjs`) and a hub route `GET /api/fleet/runs` that fans
  out to every builder and tags each row with its builder. Until then `runs` on a hub returns the
  error `Runs are not available on this hub yet.`
- **History beyond 80 events.** The Map keeps its last 80 events in memory only. C3 v1 reads them as
  they are and reports `covers`; a stored event history is part of `scrub` (C4, T10).

## 7. Scenarios

The harness for every `S-C3-` scenario: the demo hub with its fake builders, as
`test/tools/demo-fleet.mjs` boots it (`test/helpers/demo-hub.mjs`); the room process with
`cockpit.board.url` pointing at it; the fake agent (`stand-ins.md`, T18) running a script of tool
calls. "Calls the tool" means a JSON-RPC `tools/call` on `http://127.0.0.1:<port>/mcp` with the
token from `mcp.token`.

### S-C3-01 `fleet` reports problems first, with their age

Given the demo fleet with `builder-c` down and the hv1 feed 25 s old,
When the agent calls `fleet` with `{"status":"problems"}`,
Then the result (within 1.0 s) has `asOf` with `hub` and `feed:hv1`, neither stale; `nodes` starts
with the `down` and `warn` nodes (`vm-c` before `vm-b`), contains `backup` with `drift: "missing"`,
and holds no node whose status is `ok` unless it is a parent of a listed node; `builders` has
`builder-c` with `state: "down"`.
Test: node:test calls the MCP endpoint, parses `structuredContent`, asserts the order of
`nodes[].status`, the `backup` drift, the absence of other `ok` nodes, and that `content[0].text`
parses to the same object.

### S-C3-02 A stale feed is marked, not hidden

Given the hv1 feed's `at` moved to 02:10 while the room's clock reads 07:12,
When the agent calls `fleet` with no arguments,
Then `asOf` has `{"source":"feed:hv1","at":"…T02:10:00+01:00","ageS":18124,"stale":true}`; the
nodes fed by hv1 still appear with the status the board gives them (`unknown`, "no data"), never
`ok`.
Test: node:test writes the demo feed with an old `at` (`writeDemoFeed(dir, now - 5h02m)`), calls
`fleet`, asserts the `asOf` entry and that no hv1 guest node has `status: "ok"`.

### S-C3-03 One stuck run, one question, two tool lines

Given the demo runs (`acme-billing` stuck on `same-task`),
When the fake agent's script calls `morning` `{"window":"tonight"}`, then `runs`
`{"run":"acme-billing"}`, then answers `acme-billing is stuck: T3 failed twice.`,
Then the pane shows two tool lines, `read the Morning for tonight` and `looked at run acme-billing`,
then the reply; the `runs` result has `stuck.rule: "same-task"`, `costUsd` a number, and at most 10
`rounds`.
Test: Playwright at 1368x912 against the stand-ins: asserts the two `[data-tool-line]` texts in
order and the reply text; the room's received-results log (T32) holds the `runs` result with those
fields.

### S-C3-04 An unknown run is an answer the agent can use

Given the demo runs,
When the agent calls `runs` with `{"run":"acme-x"}`,
Then the result is `isError: true` with the text
`No run "acme-x". Known runs: acme-search, acme-docs, acme-billing.`, and the tool line reads
`looked at run acme-x · 1 failed` in grey.
Test: node:test asserts `isError` and the exact text; Playwright asserts the tool line's text and
that its colour is `--text-2` (no status hue).

### S-C3-05 A bad argument never reaches the board

Given the room's board-read log is empty,
When the agent calls `history` with `{"node":"room-b","run":"acme-billing"}`, then `runs` with
`{"run":"../etc"}`,
Then both calls fail with JSON-RPC error `-32602` naming the field (`node and run: give one`,
`run: must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`), and the board-read log stays empty.
Test: node:test asserts the two error objects and that the demo hub's request log has no new line.

### S-C3-06 A big fleet fits in one answer

Given a demo feed with 400 guests,
When the agent calls `fleet`,
Then `nodes` has 200 entries, `truncated.nodes` is the number left out (at least 200), the problem
nodes are all among the 200, and the JSON text is at most 24 000 characters.
Test: node:test writes a 400-guest feed with 3 `crit` guests, calls `fleet`, asserts the count, the
three `crit` ids present, `truncated.nodes`, and `content[0].text.length <= 24000`.

### S-C3-07 The board down: one sentence, at once

Given the room's `cockpit.board.url` points at a port nothing listens on,
When the agent calls `alerts`,
Then within 5.5 s the result is `isError: true`,
`The board at http://127.0.0.1:<port> did not answer in 5 s; nothing to read.` (connection refused
answers at once, a silent port after 5 s).
Test: node:test, two cases: a closed port (result within 0.5 s) and a listener that never answers
(result between 5.0 and 5.5 s); both texts asserted.

### S-C3-08 Only loopback, only with the token, never from a browser

Given the room is running,
When a request reaches `/mcp` without `Authorization`, with a wrong token, or with
`Origin: https://evil.example.invalid` and the right token,
Then the answers are 401, 401 and 403, and none of them reads the board; the server is not
reachable on any address other than `127.0.0.1`.
Test: node:test sends the three requests and asserts the codes and the empty board-read log; it
reads the room's listening sockets (`server.address()`) and asserts `127.0.0.1`.
