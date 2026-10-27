# Cockpit spec: protocols

Part 1 (T15): **screen ⇄ room**, the link every screen keeps to the room. Part 2 (T16, planned):
room ⇄ agent bridge and room ⇄ speech-to-text. Words (screen, room, turn, focus, …) are the
glossary's (`README.md`). Times in s or ms; sizes in bytes. Every JSON example below is a test
fixture (§9).

## 1. Transport: one origin, the room behind its own path

The screen talks to the room **directly, never through the hub**, on the page's own origin (D89,
D92). The page (app or Wall) is served by the laneboard that serves the board; everything under
`/api/cockpit/` is answered by the room:

| Setup | Who answers `/api/cockpit/*` | How it gets there |
| --- | --- | --- |
| one box (`single-machine.md`, T19) | the one laneboard process, which has a `cockpit` section | the same port as the board (`port`, default `7777`) |
| a board and a room on one box as two users (D91; the owner's case) | the room process (a laneboard with a `cockpit` section, its own `port`, e.g. `7778`, on `127.0.0.1`) | the front that serves the page (a reverse proxy, or `tailscale serve` with a path mount) forwards the prefix `/api/cockpit/` to the room's port, the path unchanged (research Q9 checks `tailscale serve`) |

- **Why not through the hub**: D89's overrule names it: a hop on every audio frame and a second
  place that sees the device token. The hub stays as it is (plan §2: "the hub stays narrow").
- **Hub down, room up** (two-process setup): the pane and the canvas keep working; the agent's read
  tools answer "board unreachable" (`c3-see.md` S-C3-07). On one box, board and room are one
  process and go down together.
- **How the page learns there is a cockpit** (D93): the board's first frame on `/ws`
  (`helloMessage()` in `server/ws.mjs`; on a hub, the `fleet` frame of `server/hub/client-ws.mjs`)
  gains `"cockpit":"/api/cockpit"` when the board's config has `cockpit.url`, else
  `"cockpit":null`. `cockpit.url` must be a path starting with `/` (another origin is fatal at
  start, naming the key: D89 forbids cross-origin). `null`: `data-cockpit="unconfigured"`, no
  button (D17).
- **Two channels**: plain HTTP for pairing (`screens.md` §6) and the C2b button API
  (`c2-voice.md` §14); one WebSocket, the **room link**, for everything else.

### 1.1 HTTP routes on the room

| Method, path | Who | Body and answer | Errors |
| --- | --- | --- | --- |
| `POST /api/cockpit/pair` | an unpaired screen | `201 {"code":"K7M4QX","expiresAt":"2026-10-27T07:05:00+01:00"}` (T56 adds `pairSecret`, pending Q-O10) | `429 {"error":"too-many-codes"}` with `Retry-After: 30` (D13) |
| `GET /api/cockpit/pair/{code}` | the same screen, every 2 s | `202 {"state":"pending"}`; `200 {"name":"desk"}` plus the `Set-Cookie` of the device token, once | `410 {"error":"expired"}` (or already collected); `404 {"error":"unknown"}` |
| `POST /api/cockpit/talk` | a physical button (C2b) | `c2-voice.md` §14 | `c2-voice.md` §14 |
| `GET /api/cockpit/ws` (upgrade) | a paired screen | §2 | §2.3 |

Every request passes `server/security.mjs` first: `checkRequest` (Host; and for `POST`, Origin and
the `X-Laneboard: 1` header of `docs/fleet/auth.md`), and `checkUpgrade` (Host, Origin) for the
WebSocket. Which credential the upgrade needs (the device token, or the trust the board already has)
is `security.md`'s (T17, pending Q-O21); this file writes it for the device token in an `HttpOnly`
cookie, as T56 specifies it.

## 2. The room link

One WebSocket per page, `wss://<page origin>/api/cockpit/ws` (`ws://` only on a loopback origin).
Two pages with one device token (two tabs, `c1-talk.md` S-C1-23) are two links of one screen.

### 2.1 Frames

- **Text frames** carry one JSON object each, UTF-8, with a `type` (`^[a-z][a-z.]{0,31}$`).
- **Binary frames** go screen → room only and carry audio (§6). A binary frame from the room is a
  protocol error.
- **The envelope.**
  - Room → screen messages that change the shared state (the conversation, pins, cards, the status)
    carry `seq`: one counter per room process, +1 per such message, shared by every screen, so
    every screen sees the same order. Messages for one screen only, or that nothing replays
    (heartbeat, speech, camera moves, answers to a request), carry no `seq`.
  - Screen → room messages carry `seq` too: the link's own counter, from 1 on each new link
    (`c3-see.md` §8.1 uses it in `focus`). A room answer to one of them names it in `re`.
  - Times are ISO 8601 with offset (D59), except `receivedAt` and `sentAt`, which are epoch ms for
    the speed marks (`README.md` §"Speed budget").
- **Unknown `type`** from the screen: `error` `unknown-type` (§2.3), the link stays. Unknown fields
  are ignored both ways, so a newer room can talk to an older page.

### 2.2 Open, hello, resume

```
screen                                  room
  │── upgrade /api/cockpit/ws ───────────▶│  Host, Origin, credential (§1.1)
  │── hello {page, lastSeq?, epoch?} ────▶│  within 5 s of open
  │◀── welcome {screen, epoch, seq, …} ───│
  │◀── snapshot …  or  the missed events ─│
  │◀── heartbeat (every 10 s) ────────────│
```

**`hello`** (screen → room), the first frame:

```json
{"type":"hello","seq":1,"page":"wall","protocol":1,"epoch":"r-5f2c9a","lastSeq":1287}
```

`epoch` and `lastSeq` only on a reconnect: the `epoch` of the last `welcome` and the highest room
`seq` the screen has applied. A fresh page (a load or a reload) sends neither.

**`welcome`** (room → screen):

```json
{"type":"welcome","re":1,"protocol":1,"screen":"desk","epoch":"r-5f2c9a","seq":1291,
 "conversation":"c-0007","resume":"replay",
 "config":{"stt":"on","languages":["de","en"],"maxPromptChars":8000},
 "status":null,"now":"2026-10-27T07:02:11.480+01:00"}
```

| Field | What |
| --- | --- |
| `screen` | the paired name (`screens.md` §6) |
| `epoch` | a random id made at each room start; another epoch means the room restarted |
| `seq` | the room's current `seq` |
| `resume` | `replay`: the events `lastSeq + 1 … seq` follow, in order; `snapshot`: one `snapshot` follows |
| `config.stt` | `on` or `none` (`c2-voice.md` §9: `none` draws no talk button) |
| `config.languages` | `cockpit.stt.language` as a list (`["auto"]` for `auto`), for the language button (D48) |
| `status` | the room's status line or `null` (§3.5) |
| `now` | the room's clock; the screen logs a skew over 2 s once and changes nothing |

**Replay or snapshot** (D94). The room keeps its last **2 000** `seq`'d messages in memory. It
replays when the `epoch` matches and `lastSeq + 1` is still kept; otherwise (fresh page, room
restart, too far behind) it sends a `snapshot`. A screen that applies a `seq` other than its last +1
asks again by closing the link with 4000 `gap` and reconnecting at once (no backoff); the room then
sends a snapshot. Nothing is ever applied twice: a `seq` at or below the last applied is dropped.

**`snapshot`** (room → screen): the current conversation, the last 50 turns (D27), the running turn
where it is, pins and cards. One or more frames of at most 512 KB each; the screen draws once the
frame with `part` equal to `parts` has arrived.

```json
{"type":"snapshot","seq":1291,"part":1,"parts":1,"conversation":"c-0007",
 "startedAt":"2026-10-27T06:12:00+01:00","olderTurns":12,
 "turns":[{"turnId":"t-0131","source":"spoken","lang":"de","about":null,
   "prompt":"wie lief die Nacht?","at":"2026-10-27T07:00:04+01:00","state":"done",
   "items":[
     {"kind":"tool","blockIndex":0,"toolUseId":"tu-01","tool":"mcp__laneboard__morning","input":{"window":"tonight"},
      "startedAt":"2026-10-27T07:00:05.100+01:00","endedAt":"2026-10-27T07:00:05.600+01:00","isError":false},
     {"kind":"text","blockIndex":1,"text":"■ One run is stuck: builder-a since 03:12."}],
   "end":{"state":"done","at":"2026-10-27T07:00:12+01:00"}}],
 "pins":[],"cards":[]}
```

- `olderTurns`: how many turns of this conversation are not in the snapshot; `SHOW EARLIER`
  (`c1-talk.md` §3) on a reloaded screen asks for them with `history` (§3.7).
- `items` hold the turn's parts in the order the agent produced them (`blockIndex`, §3.2): `text`,
  `tool` and `show` (§4); an error end is in `end` (§3.2's table). A running turn has `state` `thinking`, `working` or `answering` and
  no `end`; later events continue it (`c1-talk.md` §12: a screen "joins a running turn where it is").
- `pins` and `cards` are C4's (§4, §5); `[]` until then.

**`heartbeat`** (room → screen), every 10 s on every link, no `seq` (D10):

```json
{"type":"heartbeat","at":"2026-10-27T07:02:21.480+01:00"}
```

The screen counts the link as lost after **25 s** without any frame, shows it after the 5 s grace
(`screens.md` §7, D10), and reconnects with `nextBackoff` (500 ms × 1.8, cap 15 s; D11). The room
also sends a WebSocket ping every 30 s and drops a link that has not answered the previous one, as
`server/ws.mjs` does.

### 2.3 Errors and close codes

**`error`** (room → screen) answers one screen message that the room refused; the link stays:

```json
{"type":"error","re":17,"code":"bad-message","message":"focus.inSight: more than 60 ids"}
```

| `code` | When |
| --- | --- |
| `bad-message` | a field is missing, of the wrong type or out of range (each message's checks below); the message is dropped whole |
| `unknown-type` | a `type` the room does not know |
| `unknown-id` | a `turnId`, `showId`, `card` or `utterance` the room does not have |
| `too-many` | over the rate limit (§8); the message is dropped |
| `not-now` | valid but not possible in this state (`stop` with no running turn, a second `audio.start`) |

`message` is for the log and tests; the screen never draws it, except where a message's own error
case below says what the screen shows.

**Close codes** (room → screen, or the screen itself):

| Code | Reason text | Who | The screen then |
| --- | --- | --- | --- |
| 1000 | `bye` | either | — (page unload) |
| 1001 | `room stopping` | room, at shutdown | reconnects with backoff; `room-down` after the grace |
| 4000 | `gap` | screen | reconnects at once, asks for a snapshot (§2.2) |
| 4001 | `no hello` | room: no `hello` 5 s after open | reconnects with backoff |
| 4002 | `protocol {n}` | room: `hello.protocol` it does not speak | no retry; `data-cockpit="room-down"`, status line `The cockpit room speaks another version ({n}). Reload this page.` |
| 4401 | `unpaired` | room: no or unknown device token | no retry; `data-cockpit="unpaired"`, the pairing card (`screens.md` §6) |
| 4401 | `revoked 2026-10-27T06:58:00+01:00` | room: the token was unpaired (also sent to open links at `unpair`) | no retry; the "pair again" card with that time (`screens.md` §6) |
| (HTTP 403) | `bad-origin` or `bad-host` | room, before the upgrade: refused as HTTP 403 with that reason as the body, no WebSocket opens | no retry; the reason in the console; `data-cockpit="room-down"` |
| 4408 | `too slow` | room: the link's unsent data passed 4 MB (§8) | reconnects with backoff; gets a snapshot |
| 4413 | `too big` | room: a text frame over 64 KB or a binary frame over 6 400 bytes | reconnects with backoff |
| 4429 | `too many` | room: rate limits passed 3 times in 60 s (§8) | reconnects after 30 s |
| 1011 | `internal` | room: an exception in its handler | reconnects with backoff |

## 3. The conversation (C1)

### 3.1 Sending a prompt

**`prompt`** (screen → room), on `SEND`, `Enter` or the talk release (`c1-talk.md` §7, `c2-voice.md` §2):

```json
{"type":"prompt","seq":17,"clientId":"p-3c1e0b2a","text":"how did the night go?","source":"typed",
 "lang":null,"about":null,"sentAt":1793080924120,
 "focus":{"page":"wall","route":{"view":"wall"},"wallState":"tour","layout":"split","pane":"open","inSight":[]}}
```

| Field | Rule |
| --- | --- |
| `clientId` | made by the screen, `p-` and 8 hex characters from `crypto.getRandomValues`; kept by the screen with the drawn block |
| `text` | trimmed, 1 to `config.maxPromptChars` (8 000, D30) characters |
| `source` | `typed` or `spoken` (`YOU · SPOKEN`, `c1-talk.md` §3) |
| `lang` | the language of a spoken prompt (`c2-voice.md` §8), else `null` |
| `about` | the context chip's node id or `null` (`c3-see.md` §9, D65; the room writes D66's line) |
| `focus` | the screen's focus at the send (`c3-see.md` §8.1, without `type`, `seq`, `at`) |
| `sentAt` | epoch ms of the tap, for the marks |

**The echo is the confirmation.** The room appends the prompt to the conversation and sends
**`turn.prompt`** to every link, the sender's included:

```json
{"type":"turn.prompt","seq":1292,"turnId":"t-0132","clientId":"p-3c1e0b2a","screen":"desk",
 "text":"how did the night go?","source":"typed","lang":null,"about":null,
 "at":"2026-10-27T07:02:04.130+01:00","receivedAt":1793080924131,"delivery":"new"}
```

- The sender finds its block by `clientId`: `· SENDING` goes (`c1-talk.md` §7). The other screens
  draw a new prompt block ≤ 0.5 s after the room has it (`c1-talk.md` §12).
- `screen` is for the room's log and later slices; C1 draws no screen name (D37).
- `delivery` (pending Q-O1): `new` starts a turn. During a running turn, under Q-O1's recommendation
  d), it is `queued`: the prompt goes into the running turn (`turnId` is that turn's) and the screen
  draws `· QUEUED` until `prompt.taken` (§3.4). Under a), the room stops the running turn first and
  sends `delivery:"new"` (`c1-talk.md` §8 as written today; T85 rewrites it for d)).
- **Once only** (D95). The room remembers each `clientId` for 10 min. A `prompt` with a known
  `clientId` starts nothing: the room answers with the same `turn.prompt` again, to that link only,
  without `seq`. So `RETRY` after E1 `not-sent` (`c1-talk.md` §10) sends the same `clientId`, and a
  prompt that did arrive late never runs twice.

**Errors.**

| Case | Room answers | The screen shows |
| --- | --- | --- |
| no `turn.prompt` 5 s after the send, link up | nothing | E1 `not-sent` (D31) |
| `text` empty or too long, a bad `focus` | `error` `bad-message` | E1 `not-sent` at once (a correct screen never sends these) |
| the agent cannot take prompts (E3, E4; status §3.6) | **`prompt.refused`** `{"type":"prompt.refused","re":17,"clientId":"p-3c1e0b2a","code":"agent-down"}` | the block's label `YOU · 07:02 · NOT SENT` and the status line's text; `RETRY` and `EDIT` as E1 |
| over 10 prompts per minute from one device token (T59) | `prompt.refused` with `"code":"too-many"` | `NOT SENT` with T59's line |
| link down at the send | — | `SEND` is disabled while `room-down` (`screens.md` §7); a send in the 5 s grace waits for the link and goes when it is back, else E1 |

### 3.2 The turn as it runs

All room → screen, all with `seq`, all to every link. The bridge's own events and how they map
onto these are part 2 (T16); this is what the screen consumes (T29's list).

| `type` | Example | The screen |
| --- | --- | --- |
| `turn.state` | `{"type":"turn.state","seq":1293,"turnId":"t-0132","state":"thinking"}` | sets `data-turn` (`thinking`, `working`, `answering`, `stopping`; D56) |
| `text.delta` | `{"type":"text.delta","seq":1301,"turnId":"t-0132","blockIndex":1,"text":"■ One run is","sentAt":1793080931020}` | appends to block 1 (`c1-talk.md` §3, B4 from `sentAt`) |
| `text.block` | `{"type":"text.block","seq":1309,"turnId":"t-0132","blockIndex":1,"text":"■ One run is stuck: builder-a since 03:12."}` | replaces block 1 with this text (a lost delta cannot leave wrong text) |
| `tool.start` | `{"type":"tool.start","seq":1295,"turnId":"t-0132","blockIndex":0,"toolUseId":"tu-07","tool":"mcp__laneboard__morning","input":{"window":"tonight"},"startedAt":"2026-10-27T07:02:05.100+01:00"}` | a call in a tool line, folded by D24 |
| `tool.end` | `{"type":"tool.end","seq":1296,"turnId":"t-0132","toolUseId":"tu-07","endedAt":"2026-10-27T07:02:05.600+01:00","isError":false}` | the call ends; `ok` or `failed` and its ms in the opened row |
| `turn.retrying` | `{"type":"turn.retrying","seq":1297,"turnId":"t-0132","attempt":2,"of":10}` | E5's grey row (`c1-talk.md` §10) |
| `turn.end` | `{"type":"turn.end","seq":1310,"turnId":"t-0132","state":"done","at":"2026-10-27T07:02:12.400+01:00"}` | `READY`; ends the cursor |

- **Ordering**: within a turn, by `seq`. `blockIndex` counts the turn's items from 0 in the order
  the agent produced them (a text block and a tool call each take one index); the screen places
  items by it, so a replayed or snapshotted turn reads the same.
- **Parallel tool calls**: several `tool.start` before their `tool.end`s; calls of one tool fold
  into one line by D24 whatever the order of their ends.
- **Tool input** (D97): the room sends `input` with every string value cut to 200 characters and
  the whole object at most 2 000 characters of JSON (beyond: `{"…":"cut"}`), after the redaction
  rules of `security.md` (T17, T57). The screen takes `{target}` (D24) and the 120-character row
  from it. Tool output never goes to a screen in C1 (`c1-talk.md` §5).
- **Show commands** in a turn leave `show.line` items (§4).

**`turn.end` states and their error line** (`c1-talk.md` §10):

```json
{"type":"turn.end","seq":1311,"turnId":"t-0133","state":"error","code":"step-limit","steps":40,
 "at":"2026-10-27T07:05:40+01:00"}
```

| `state` | `code` | Extra fields | Line |
| --- | --- | --- | --- |
| `done` | — | — | none |
| `stopped` | — | `forced` (bool) | `STOPPED AT 07:03`, `(forced)` (D33) |
| `error` | `agent-exited` | — | E2; the room later sends `status` with `agent-back` |
| `error` | `agent-down` | `detail` | E3 |
| `error` | `not-logged-in` | — | E4 |
| `error` | `step-limit` | `steps` | E7 |
| `error` | `failed` | `detail` | E8 |

`detail` is at most 120 characters (`c1-talk.md` §10), drawn as text.

### 3.3 Stopping

**`stop`** (screen → room): `{"type":"stop","seq":22,"turnId":"t-0132"}`. The room sends
`turn.state` `stopping` to every link at once, asks the bridge to interrupt (T16), forces it after
5 s (D32) and ends with `turn.end` `stopped`. Errors: `unknown-id`; `not-now` when the turn already
ended (the screen changes nothing: its `turn.end` is on the way or applied). Under Q-O1 d) the room
also drops prompts still `queued` in that turn and sends `prompt.taken` with `"state":"cancelled"`
for each (pending Q-O1, T85).

### 3.4 A prompt taken into a running turn (pending Q-O1)

`{"type":"prompt.taken","seq":1305,"turnId":"t-0132","clientId":"p-77aa01c3","state":"taken"}`:
the agent read it (`· QUEUED` goes); `"state":"cancelled"`: it was dropped by `stop`, its block
gets `NOT SENT` with `RETRY`/`EDIT`. Only under Q-O1 d); T85 specifies the times.

### 3.5 Errors outside a turn and the status line

**`status`** (room → screen, `seq`): the one status slot of the pane (`c1-talk.md` §1, T68's
precedence), or `null` to clear it.

```json
{"type":"status","seq":1320,"status":{"code":"agent-down","since":"2026-10-27T07:04:00+01:00",
 "detail":"claude: command not found"}}
```

| `code` | Text on the screen |
| --- | --- |
| `agent-down` | `Agent not running since 07:04.` (E3) |
| `not-logged-in` | T68's line |
| `agent-back` | E2's second line, then `null` after 5 s |

`room-down` is not a message: the screen sets it itself from the link (`screens.md` §7).

### 3.6 A new conversation

**`new`** (screen → room): `{"type":"new","seq":30}`. The room stops a running turn (§3.3), starts a
new session (T16) and sends to every link:

```json
{"type":"conversation.new","seq":1330,"conversation":"c-0008","reason":"owner",
 "at":"2026-10-27T07:10:00+01:00"}
```

`reason` `owner`, or `forced` when the old session could not go on (`c1-talk.md` §11's two
dividers). Errors: `not-now` while one is starting (a second tap within the start).

### 3.7 Older turns

**`history`** (screen → room): `{"type":"history","seq":31,"before":"t-0120","count":50}`, `count`
1 to 50. Answer, to that link only, no `seq`:
`{"type":"history.turns","re":31,"turns":[],"olderTurns":0}` (here empty) with turns as in `snapshot`, of the
current conversation only (`c1-talk.md` §11: a reload shows only the current one). Errors:
`unknown-id`.

### 3.8 Focus and presence

- **`focus`** (screen → room): `c3-see.md` §8.1 has the message, its checks and D61's timing. A
  failing one gets `error` `bad-message` and changes nothing (S-C3-16). No answer when it is good.
- **`touched`** (screen → room), at most once per 10 s while the screen is touched, clicked or
  keyed: `{"type":"touched","seq":40,"at":"2026-10-27T07:12:30.002+01:00"}`. The room keeps the
  latest per screen for the C2b "screen touched last" target (`c2-voice.md` §14). No answer.

## 4. Show commands (C4)

The agent's show tool reaches the room over MCP (`c4-show-canvas.md` §1); the room sends:

**`show`** (room → each target link, no `seq`: a camera move is never replayed):

```json
{"type":"show","showId":"sh-0041","turnId":"t-0132","cmd":"fly_to",
 "args":{"node":"builder-a"},"receivedAt":1793080932210}
```

`cmd` and `args` are `c4-show-canvas.md` §3's, after the room's checks (node ids resolved). The
screen starts the camera (B5 from `receivedAt`) and answers:

```json
{"type":"show.result","seq":51,"showId":"sh-0041","state":"shown"}
```

`state`: `shown`, `waiting` (the finger rule, D70; a later `show.result` follows), `skipped` with
`"why":"in use"`, or `noCamera`. The room collects them for 1.0 s (D76) and sends one
**`show.line`** (`seq`, every link), and another each time the line's state changes:

```json
{"type":"show.line","seq":1302,"turnId":"t-0132","blockIndex":2,"showId":"sh-0041",
 "text":"flew to builder-a","state":"shown","skippedOn":[],"undoable":true}
```

The screen draws `c4-show-canvas.md` §4's suffix from `state` and `skippedOn` (its own name in
`skippedOn` gives ` · not on this screen: in use`).

**`undo`** (screen → room): `{"type":"undo","seq":52,"showId":"sh-0041"}`. The room sends **`show.undo`**
`{"type":"show.undo","showId":"sh-0041"}` (no `seq`) to every link with a camera, each restores its
saved state (`c4-show-canvas.md` §5), then a `show.line` with `"state":"undone"`. Errors:
`unknown-id`; `not-now` when the line is no longer undoable (the screen draws the line's current
state, which the next `show.line` brings).

**Pins** are shared state: `pin.put` and `pin.remove` (`seq`, every link) carry
`c4-show-canvas.md` §3.4's pin, and a `snapshot` lists them in `pins`.

## 5. Cards (C4)

The room's one card list (D79) travels as shared state; card data as refreshes (D81).

| `type` | Direction, `seq` | Example | Notes |
| --- | --- | --- | --- |
| `card.put` | room → all, `seq` | `{"type":"card.put","seq":1340,"card":{"id":"card-0004","block":"countdown","title":"shut off vm-c","size":"s","by":"agent","at":"2026-10-27T07:12:00+01:00","fields":{"job":"job-0002","until":"2026-10-27T10:12:00+01:00"}},"receivedAt":1793081520010}` | new or replaced (`replace`, same `id`); B6 from `receivedAt` |
| `card.remove` | room → all, `seq` | `{"type":"card.remove","seq":1341,"card":"card-0004","by":"desk"}` | `by` the screen whose `✕` it was, or `agent`, or `full` (D80) |
| `card.order` | room → all, `seq` | `{"type":"card.order","seq":1342,"ids":["card-0004","card-0003"]}` | after `TO FRONT` (D79) |
| `card.data` | room → all, no `seq` | `{"type":"card.data","card":"card-0003","asOf":"2026-10-27T07:12:10+01:00","data":{"state":"ok","label":"builder-a"}}` | every 10 s per card (D81); after a replay or snapshot the room sends one per card |
| `card.close` | screen → room | `{"type":"card.close","seq":60,"card":"card-0004"}` | `✕` (`c4-show-canvas.md` §9); while `room-down` the screen keeps it and sends it when the link is back |
| `card.restore` | screen → room | `{"type":"card.restore","seq":61,"card":"card-0004"}` | `UNDO` within 10 s (D84); after that `not-now` |
| `card.front` | screen → room | `{"type":"card.front","seq":62,"card":"card-0003"}` | `TO FRONT` |
| `card.tick` | screen → room | `{"type":"card.tick","seq":63,"card":"card-0005","row":2,"ticked":true}` | a checklist row (D87); a row with a `when` gets `not-now` |

Errors for all four screen messages: `unknown-id` (the card is gone; the screen removes it too).

## 6. Audio (C2)

The screen streams the microphone to the room; the room alone talks to the speech service
(`c2-voice.md` §10; part 2 has that side).

### 6.1 Messages

**`audio.start`** (screen → room), on `pointerdown` once the track is live (B1):

```json
{"type":"audio.start","seq":70,"utterance":"u-0012","lang":"de","format":"pcm-s16le-16000-1"}
```

`utterance`: `u-` and the screen's own counter for this page. `lang`: one of `config.languages`
(D48). `format`: the only v1 value (D96). At most one open utterance per link: a second
`audio.start` gets `not-now`.

**Binary frames** follow: raw PCM, signed 16-bit little-endian, 16 000 Hz, mono, **100 ms each
(3 200 bytes)**; the last one may be shorter, none longer than 6 400 bytes. The screen captures with
an `AudioWorklet` and resamples to 16 kHz there. Frames belong to the link's open utterance; frames
with none open are dropped and counted in the room's log. Frames captured before the link could
send (the link opening) are held on the screen and sent first, in order (D46).

**`audio.stop`** (screen → room): the release, second tap or a tap on the words:

```json
{"type":"audio.stop","seq":95,"utterance":"u-0012","reason":"send"}
```

`reason`: `send` (release or second tap), `fix` (tap on the words, D47), `limit` (120 s, D45). The
room asks the service for the final (part 2) and answers with `stt.final`. **`audio.cancel`**
`{"type":"audio.cancel","seq":96,"utterance":"u-0012"}`: `CANCEL`, slide off, 30 s with no word,
link lost; the room ends the service session and sends nothing more for it.

**Room → the speaking link only, no `seq`** (partial words never reach another screen, D37):

| `type` | Example | The screen |
| --- | --- | --- |
| `stt.update` | `{"type":"stt.update","utterance":"u-0012","firm":"wie lief","tail":"die Na","sentAt":1793080921610}` | replaces `[data-firm]` and `[data-tail]` (`c2-voice.md` §4) |
| `stt.final` | `{"type":"stt.final","utterance":"u-0012","text":"wie lief die Nacht?"}` | `text` replaces firm and tail; with `reason` `send` and words in it, the screen sends the `prompt` (§3.1, `source:"spoken"`, its typed draft in front, D44); with `fix` it goes into the textarea; empty: nothing sent, `MICROPHONE OFF` |
| `stt.error` | `{"type":"stt.error","utterance":"u-0012","error":"stt-down","detail":"no-answer"}` | `data-talk-error` and `data-talk-detail` (D50's tables) |

The room sends `stt.update` with firm = the service's committed lines joined by one space and
tail = its buffer (research Q4), so the screen never joins anything itself.

### 6.2 Timeouts and errors

| Case | Who sees it | Result |
| --- | --- | --- |
| no service answer 2.0 s after `audio.start` | room | `stt.error` `stt-down`/`no-answer`; the room drops the held audio (D50) |
| no final 3.0 s after `audio.stop` | room | `stt.error` `stt-failed` (or `stt-down` if no word was sent); the screen keeps the last words as a draft (D41) |
| no `stt.final` or `stt.error` 3.5 s after `audio.stop` | screen | the same as the line above, decided on the screen (covers a room that went quiet) |
| the link drops with the microphone open | screen | the microphone closes at once, the words stay as a draft (`screens.md` §7) |
| `config.stt` is `none` and a screen sends `audio.start` | room | `error` `not-now` (a correct screen draws no talk button) |
| audio frames faster than 20 per second | room | §8 |

## 7. The physical button (C2b)

`POST /api/cockpit/talk` (`c2-voice.md` §14) reaches the screen as **`talk`** (room → that screen's
links, no `seq`): `{"type":"talk","request":"k-0009","action":"press"}` (`release` for the second
call). The screen runs its press or release function (`c2-voice.md` §11) and answers
`{"type":"talk.state","seq":80,"request":"k-0009","talk":"listening"}` with its `data-talk`; the
room answers the HTTP call with it (D52: at most 1.0 s, else 504). With two links for one screen,
the link that sent `touched` last gets it.

## 8. Limits (D99)

| What | Limit | Over it |
| --- | --- | --- |
| text frame, screen → room | 64 KB (a prompt of 8 000 characters is at most 32 KB) | close 4413 |
| binary frame | 6 400 bytes | close 4413 |
| text messages, screen → room | 50 per second per link (as the hub's `inboundPerSec`) | `error` `too-many`, the message dropped; 3 times in 60 s: close 4429 |
| audio frames | 20 per second per link | dropped, counted in the room's log |
| prompts | 10 per minute per device token (T59) | `prompt.refused` `too-many` |
| frame, room → screen | 512 KB (as the hub's `frameBytes`); a bigger snapshot is split into parts | — |
| unsent data per link | 4 MB (as the hub's `bufferedBytes`) | close 4408 |
| links per room | 32 | the 33rd upgrade gets HTTP 503 `too-many-links` |
| replay buffer | the last 2 000 `seq`'d messages | snapshot instead (§2.2) |

## 9. How tests check this

- **Every JSON example here is a fixture** (D98). One module of message checks in the room
  (`server/cockpit/protocol.mjs`, D89's folder) validates each message both ways; a unit test in
  `npm test` pulls every fenced `json` block and every example cell from this file and asserts it
  validates, and that a copy with one required field removed fails with `bad-message` naming that
  field. A message added to the code but not here fails the reverse check (every `type` the module
  knows has an example here).
- **The stand-in room** (`stand-ins.md`, T18) speaks this protocol; the acceptance tests (D88) read
  the link from the page side with Playwright's `page.on('websocket')` and its `framesent` and
  `framereceived` events, so a scenario can assert "the screen sent `stop` with this `turnId`" or
  "the room sent `turn.end` `stopped`".
- Close codes and limits each get one unit test against the room's handler with a fake socket.

## 10. One spoken turn, message by message

07:00 at the desk, Wall in `split`, pane closed, the stand-ins of `stand-ins.md` (T18): fake speech
sends its first partial 0.6 s after the first audio frame and its final 0.15 s after the stop
(B2, B3). `t` is seconds from the `pointerdown`.

| t (s) | Direction | Message | The screen shows |
| --- | --- | --- | --- |
| 0.00 | — | `pointerdown` on the talk button | pane opens (B7) |
| ≤ 0.20 | screen → room | `audio.start` `u-0012`, `lang:"de"` | `data-talk="listening"` (B1) |
| 0.20-2.80 | screen → room | 26 binary frames of 3 200 bytes | — |
| 0.20 | room → speech | connect, then the frames (part 2) | — |
| 0.80 | room → screen | `stt.update` `firm:""`, `tail:"wie"` | `wie` in the tail (B2 ≤ 1.0 s) |
| 1.40 | room → screen | `stt.update` `firm:"wie lief"`, `tail:"die"` | firm and tail replaced |
| 2.60 | room → screen | `stt.update` `firm:"wie lief die"`, `tail:"Nacht"` | |
| 2.80 | — | `pointerup` (a hold: 2.8 s > 400 ms, D39) | `data-talk="final"` |
| 2.80 | screen → room | `audio.stop` `reason:"send"` | |
| 2.95 | room → screen | `stt.final` `text:"wie lief die Nacht?"` | |
| 2.96 | screen → room | `prompt` `clientId:"p-3c1e0b2a"`, `source:"spoken"`, `lang:"de"`, `focus` | prompt block `YOU · SPOKEN · 07:00 · SENDING` (B3 ≤ 0.3 s from 2.80) |
| 2.97 | room → all | `turn.prompt` `t-0131`, `delivery:"new"` | `· SENDING` goes; other screens draw the block |
| 2.98 | room → all | `turn.state` `thinking` | `● WORKING` |
| 4.10 | room → all | `tool.start` `tu-01` `mcp__laneboard__morning` | `● read the Morning for tonight…` |
| 4.60 | room → all | `tool.end` `tu-01`, `isError:false` | the line ends |
| 5.20 | room → all | `turn.state` `answering`, then `text.delta` × n, block 1 | text grows (B4 ≤ 0.5 s per delta) |
| 7.90 | room → all | `text.block` block 1 | text replaced, markup applied |
| 8.00 | room → all | `turn.end` `done` | `READY`; cursor gone |
| every 10 s | room → all | `heartbeat` | — |
