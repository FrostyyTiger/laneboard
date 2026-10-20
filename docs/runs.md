# Runs: the run protocol, v1

A **run** is one goal worked on by a loop of many short agent sessions (plan,
build, check, review, repeat) for hours or days. Without help, laneboard sees
such a run only as short sessions coming and going. The run protocol lets the
loop say what it is doing, so laneboard can show the run as one thing: its
goal, its rounds, whether it is getting better, what it cost, why it stopped
and what it needs from you.

Any loop can speak it: a bash script, an Agent SDK program, another vendor's
agent. laneboard does not care what runs the loop.

**The `none` default:** with no config and no run files, there are no runs and
nothing changes. laneboard never starts, stops or steers a run; it only reads
what the run writes.

> Status: the parser and the fold (`server/runs/protocol.mjs`) are in. The
> config keys, the collector, the API, the CLI and the Runs view below are
> being built in this order (`docs/plans/runs/PROGRESS.md`); this page is the
> contract they follow.

## Where runs write

A run appends one JSON object per line to

```
<run dir>/.laneboard/run.jsonl
```

where `<run dir>` is the directory the loop works in (usually the repo or the
worktree). Append only; never rewrite a line. One file may hold several runs
(each line names its run), and a run may restart and append to the same file.

laneboard reads, as configured in `docs/config.md`:

- the files matched by `runs.files` (globs, `~` expanded; default `[]`, none);
- `<lane cwd>/.laneboard/run.jsonl` for every lane, when `runs.lanes` is on
  (the default);
- `<stateDir>/runs/<run>.jsonl`, where events posted to the API land.

Files are tailed: a new line shows up within a collector tick, a half-written
last line waits for its newline, and a file that shrinks or is replaced is read
again from the start.
A file that disappears keeps its runs until `runs.keepDays` forgets them, a
run over `runs.maxEvents` drops its oldest events first (its `run.start` lines
stay), and one run written to several files is merged by `ts`.

## A line

```jsonl
{"v":1,"t":"run.start","run":"readiness","ts":1792483200000,"goal":"Make acme-api ready for review","deadline":"2026-10-21T05:00:00Z","budget":{"rounds":15,"windowPct":90}}
{"v":1,"t":"round.start","run":"readiness","n":3,"role":"builder","task":"A2.4"}
{"v":1,"t":"score","run":"readiness","name":"tests","value":0.93,"better":"higher"}
{"v":1,"t":"round.end","run":"readiness","n":3,"outcome":"kept","commit":"abc1234"}
{"v":1,"t":"needs","run":"readiness","kind":"decision","text":"Drop the v1 export?","link":"https://example.invalid/acme/acme-api/pull/7"}
{"v":1,"t":"artifact","run":"readiness","kind":"pr","url":"https://example.invalid/acme/acme-api/pull/7"}
{"v":1,"t":"run.stop","run":"readiness","reason":"no-progress","rounds":3,"usd":3.75}
```

Every line has these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `v` | no | protocol version; `1`, and `1` when missing. Any other version is skipped. |
| `t` | yes | the event type (table below), at most 64 characters |
| `run` | yes | the run id: a letter or digit, then letters, digits, `.`, `_`, `-`; 64 at most. It ends up in a file name, so nothing else is accepted. |
| `ts` | no | when it happened: epoch ms, epoch seconds or an ISO 8601 string. Without it the event still counts but carries no time. |

## Events

| Type | Fields | What it does |
| --- | --- | --- |
| `run.start` | `goal` (text), `plan`, `branch`, `deadline` (ISO or epoch), `budget` `{rounds, windowPct, pause5h, stop7d}` (the four may also sit at top level) | starts the run, or restarts it: a second `run.start` updates the goal and budget and reopens a stopped run |
| `round.start` | **`n`** (integer ≥ 0), `role`, `task` | round `n` begins; starting the same `n` again is a retry, counted in the round's `starts` |
| `round.end` | **`n`**, `outcome`, `commit`, `open`, `usd` | round `n` ended; `outcome` is free text (`kept`, `no-task-done`, `reviewed`, …); `usd` adds to the round's cost |
| `score` | **`name`** (64 chars), **`value`** (number), `better` (`higher` or `lower`, default `higher`), `n` | one measurement of a metric; without `n` it belongs to the latest round started (0 before any) |
| `needs` | `kind` (default `decision`), `text`, `link`, `n` | the run needs a human; kind `wait` means the loop itself is waiting (a usage limit) and closes when the next round starts or the run stops; other kinds stay open |
| `artifact` | **`url`**, `kind` (default `link`; `pr` for pull requests), `title` | something the run produced; the same URL twice is kept once |
| `run.stop` | `reason` (default `unknown`), `rounds`, `usd` | the run stopped (reasons below) |
| `usage` | `n`, `fiveHourPct`, `sevenDayPct`, `fiveHourResetsAt` (epoch s or ms), `overage` (boolean) | the account's usage windows after a round; a negative percentage means "not known" |
| `cost` | **`usd`** (≥ 0), `n`, `total` | what a round cost; the run's cost is the sum of `usd` (the writer's own `total` restarts when the loop does) |

Bold fields are required: a line without them is skipped. Any other type is
**kept raw** (its first 40 keys, strings clamped) and shown as written, so a
loop can send its own events (`review.note`, `deploy`, …) and still see them.

### Values

- **Strings** are clamped: `goal` and `needs.text` at 2000 characters, every
  other string at 300. A number where a string is expected is taken as its text.
- **Numbers** may be JSON numbers or plain numeric strings (`"3"`, `"0.93"`).
  Integer fields take integral floats (`3.0` is `3`); `3.5` is not an integer
  and the line is skipped where the integer is required.
- **`commit`** is a hex sha of 4 to 64 characters. A short sha made only of
  digits that a writer turned into a number gets its leading zeros back
  (padded to 7).
- **Booleans** may be `true`/`false`, `"true"`/`"false"` or `1`/`0`.
- **Lines** longer than 16 KiB, empty lines, lines that are not a JSON object,
  and lines failing a check above are **skipped and counted** by reason; the
  run shows how many. Nothing a writer sends makes laneboard throw.

## What laneboard makes of it

A run's events, in file order, are folded into one picture
(`foldRun` in `server/runs/protocol.mjs`): goal, plan, branch, deadline,
budget, the rounds sorted by `n` (role, task, starts, start and end time,
outcome, commit, cost, usage), the scores per metric over rounds and which way
is better, the needs, the artifacts, the stop, the summed cost, the last usage,
the raw events, and how many lines were skipped.

### States

| State | When |
| --- | --- |
| `running` | started and not stopped |
| `waiting` | the last event is a `needs` of kind `wait`: the loop is sleeping until a limit resets |
| `stopped` | a `run.stop` came after the last `run.start` |

### Stop reasons

Any reason is kept as written; these are the ones laneboard knows:

| Reason | Means |
| --- | --- |
| `done` | every task is done |
| `deadline` | the time ran out |
| `rounds` | the round cap was reached |
| `budget` | a budget other than rounds ran out |
| `no-progress` | rounds stopped moving anything (for example two in a row with no task done) |
| `7d-window` | the 7-day usage window reached its stop level |
| `overage` | the account went into paid extra usage |
| `error` | the loop could not go on (a session would not start, a tool failed) |
| `human` | someone stopped it |

## The helper CLI

So loops do not hand-write JSON, `laneboard run` writes one line per call:

```sh
laneboard run start  --run readiness --goal "Make acme-api ready for review" \
                     --deadline 2026-10-21T05:00:00Z --rounds 15
eval "$(laneboard run round --run readiness --n 3 --role builder --task A2.4)"
laneboard run score  --run readiness --name tests --value 0.93 --better higher
laneboard run round  --run readiness --n 3 --end --outcome kept --commit abc1234
laneboard run needs  --run readiness --kind decision --text "Drop the v1 export?"
laneboard run artifact --run readiness --kind pr --url https://example.invalid/acme/acme-api/pull/7
laneboard run stop   --run readiness --reason done
```

- It writes to `--file`, else `$LANEBOARD_RUN_FILE`, else
  `./.laneboard/run.jsonl`, and works with laneboard down.
- `--post` sends the event to the API instead of the file.
- `round` prints `LANEBOARD_RUN=<run>/<n>`, so after `eval` the sessions the
  round starts carry the run and round in their environment.
- Bad arguments exit 2 and write nothing.

The exact flags are in the header of `bin/laneboard`.

## The API

On the builder, on the loopback port, behind the same local guards as the rest
of the UI (the CLI sends the `x-laneboard` header):

| Route | Does |
| --- | --- |
| `GET /api/runs` | a summary of every run laneboard knows |
| `GET /api/runs/<run>` | one run, folded; 404 if unknown |
| `POST /api/runs/events` | one event as JSON; checked like a file line (400 with the reason if skipped) and appended to `<stateDir>/runs/<run>.jsonl` |

A loop that cannot send the header writes the file instead; that is always the
simplest way.

## Writing a loop that reports itself

The smallest useful loop, in bash, with no CLI at all:

```sh
ev() { printf '%s\n' "$1" >> .laneboard/run.jsonl; }
mkdir -p .laneboard
ev '{"t":"run.start","run":"nightly","goal":"Make the tests green"}'
for n in 1 2 3; do
  ev "{\"t\":\"round.start\",\"run\":\"nightly\",\"n\":$n,\"role\":\"builder\"}"
  # … run one agent session here …
  ev "{\"t\":\"round.end\",\"run\":\"nightly\",\"n\":$n,\"outcome\":\"kept\"}"
done
ev '{"t":"run.stop","run":"nightly","reason":"rounds"}'
```

Tips that make the Runs view worth reading:

- send a `score` after every round (tests passing, tasks done, a benchmark), so
  "is it getting better" has an answer;
- send `cost` and `usage` if the agent reports them, so the run shows its burn;
- say why you stopped: a `run.stop` with a reason beats a run that just goes
  quiet;
- put a question in `needs` instead of in a log nobody reads.
