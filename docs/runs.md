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

**Where to look:** the Runs view, `#/runs` (keys `g r`), lists every run
laneboard knows: goal, state, round n / max, the latest scores and their
trend, the 5 h / 7 d burn, time left and open needs. A row opens the run page,
`#/runs?run=<id>`: the timeline of rounds, one small score chart per metric
over the rounds, the stop reason, the open needs and the artifacts.

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
{"v":1,"t":"needs.ack","run":"readiness","ref":0,"by":"owner"}
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
| `run.start` | `goal` (text), `plan`, `branch`, `cwd` (the absolute dir the run works in), `host` (64 chars: the machine the run works on, when it is not the one reading the file; the Map hangs the run there), `deadline` (ISO or epoch), `budget` `{rounds, windowPct, pause5h, stop7d}` (the four may also sit at top level) | starts the run, or restarts it: a second `run.start` updates the goal and budget and reopens a stopped run |
| `round.start` | **`n`** (integer ≥ 0), `role`, `task`, `session` | round `n` begins; starting the same `n` again is a retry, counted in the round's `starts` |
| `round.end` | **`n`**, `outcome`, `commit`, `open`, `usd`, `session` | round `n` ended; `outcome` is free text (`kept`, `no-task-done`, `reviewed`, …); `usd` adds to the round's cost only, not to the run's `cost` (that is the sum of `cost` events); `session` (on either round event) names a Claude Code session of the round (see "Sessions of a round") |
| `score` | **`name`** (64 chars), **`value`** (number), `better` (`higher` or `lower`, default `higher`), `n`, `max` (a positive number: the value that means done, such as the task count; the Map's progress ring) | one measurement of a metric; without `n` it belongs to the latest round (the highest `n` of a `round.start` or `round.end` so far in the file, even if that round has ended; 0 before any) |
| `needs` | `kind` (default `decision`), `text`, `link`, `n` | the run needs a human; kind `wait` means the loop itself is waiting (a usage limit) and closes when the next round starts or the run stops; other kinds stay open until a `needs.ack` closes them; without `n` it belongs to the latest round, like `score` (even if that round has ended) |
| `needs.ack` | **`ref`**, `by` (64 chars) | someone saw a need and closed it: `ref` is the need's place in the run's needs (`0` = the first `needs` line of the run, an integer below 10⁹) or its `ts` (epoch s or ms, or ISO; the first open need with that `ts`, else the first one). The first ack of a need counts (it records `ackedAt` and `by`); a second one changes nothing. A `ref` that names no need is kept raw. A `fence` need (the loop reverted a round that touched a fenced file) closes only on an ack by a person: `by` is `inbox` (the Inbox's `a`), `run page` (its Ack button) or `owner` (`laneboard run ack … --by owner`); an ack with any other `by` or none (the reference loop writes `by: "loop"`) leaves it open and is kept raw, and a new round or `run.stop` never closes it. |
| `artifact` | **`url`**, `kind` (default `link`; `pr` for pull requests, `report` for the run's report), `title` | something the run produced; the same URL twice is kept once |
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
- **`cwd`** is an absolute path of at most 1024 characters, a trailing `/`
  dropped; anything else is ignored (never cut: a cut path names another dir).
- **`session`** is a session id (a UUID, or letters, digits, `.`, `_`, `:`,
  `-`, 128 at most); anything else is ignored.
- **Booleans** may be `true`/`false`, `"true"`/`"false"` or `1`/`0`.
- **Lines** longer than 16 KiB, empty lines, lines that are not a JSON object,
  and lines failing a check above are **skipped and counted** by reason; the
  run shows how many. Nothing a writer sends makes laneboard throw.

## What laneboard makes of it

A run's events, in file order, are folded into one picture
(`foldRun` in `server/runs/protocol.mjs`): goal, plan, branch, deadline,
budget, the rounds sorted by `n` (role, task, starts, start and end time,
outcome, commit, cost, usage), the scores per metric over rounds and which way
is better, the needs (each with `i`, its place, and `open`, `acked`, `ackedAt`,
`by`), the artifacts, the stop, the run's `cost`, the last usage,
the raw events, and how many lines were skipped. The run's `cost` (`usd`,
and `rounds`, how many `cost` events) is the sum of the `cost` events only:
a `round.end` `usd` (the CLI's `round --end --usd`) fills that round's
`usd` but leaves the run's `cost` at 0. A loop that wants a run total sends
`cost` events.

### Sessions of a round

The run page lists, per round, the Claude Code sessions that ran in it, with
what each cost. laneboard knows a session from its hook events (id, cwd, first
and last time seen) and its cost snapshots, and ties it to a round
(`server/runs/bind.mjs`):

- **by name**: a round that carries `session` (for example a loop that
  starts `claude --session-id <uuid>` and writes the same uuid on its
  `round.start`) has that session, exactly, wherever it ran;
- **by dir and time**: otherwise a session belongs to the round it was first
  seen in, when its cwd is one of the run's dirs or below one. A round's window
  runs from its start to its end, else to the next round's start, else to the
  stop, else to now. The run's dirs are its `run.start` `cwd` and the `<dir>`
  of every `<dir>/.laneboard/run.jsonl` it was read from.

A run read from somewhere else (a `runs.files` glob outside the run dir, or
posted to the API) and without `cwd` is tied only by name. Two runs working in
the same dir at the same time cannot be told apart: a session that fits both is
listed in both as a guess (`?` before it), never given to one by chance. A
session open before the first round started belongs to no round.

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

### Stuck

A run that has not stopped can look stuck. laneboard works it out again from
the events every time it folds the run, so a later good round clears it and
nothing has to be acknowledged. The first rule that matches wins; a rule with
nothing to judge (no deadline, no task names, no score history, rounds without
times) stays silent. The numbers are `runs.stuck` in [config.md](config.md)
(`runs.stuck: false` turns every rule off).

| Rule | Fires when |
| --- | --- |
| `deadline` | the deadline has passed and the run has no `run.stop` (before the deadline a run is never stuck by this rule, and a `report` artifact does not change that) |
| `same-task` | the latest round failed and its task failed in 2 rounds in a row of that task; a failed round has `outcome` `fail`, `failed`, `failure`, `error`, `errored`, `no-task-done`, `still-red`, `reverted`, `blocked`, `timeout` or `timed-out` |
| `no-progress` | no score got better in its `better` direction over the last 3 ended rounds (a score without a value before those rounds is not judged) |
| `shorter-rounds` | the last 3 ended rounds were each shorter than the one before: a hint at a usage limit, or the run finishing its backlog; not while the run is `waiting` |

## The helper CLI

So loops do not hand-write JSON, `laneboard run` writes one line per call:

```sh
laneboard run start  --run readiness --goal "Make acme-api ready for review" \
                     --deadline 2026-10-21T05:00:00Z --rounds 15
eval "$(laneboard run round --run readiness --n 3 --role builder --task A2.4)"
laneboard run score  --run readiness --name tests --value 0.93 --better higher
laneboard run round  --run readiness --n 3 --end --outcome kept --commit abc1234
laneboard run needs  --run readiness --kind decision --text "Drop the v1 export?"
laneboard run ack    readiness 0 --by owner
laneboard run artifact --run readiness --kind pr --url https://example.invalid/acme/acme-api/pull/7
laneboard run stop   --run readiness --reason done
```

| Subcommand | Flags |
| --- | --- |
| `start` | `--goal`, `--plan`, `--branch`, `--host`, `--deadline`, `--rounds N`, `--window-pct P` (the last two go into `budget`) |
| `round` | **`--n N`**, `--role`, `--task`; with `--end`: `--outcome`, `--commit`, `--open N`, `--usd x` |
| `score` | **`--name`**, **`--value x`**, `--better higher\|lower`, `--n N`, `--max x` |
| `needs` | `--kind`, `--text`, `--link`, `--n N` |
| `ack` | **`<ref>`** (or `--ref`), `--by`; `ack <run> <ref>` names the run too |
| `artifact` | **`--url`**, `--kind`, `--title` |
| `stop` | `--reason`, `--rounds N`, `--usd x` |

Every subcommand also takes `--run <id>`, `--file <path>` and `--post`, after
the subcommand or before it (`laneboard run --post score …`); every other
flag goes after the subcommand.

`score` and `needs` without `--n` attach to the latest round in the file, even
if it has ended: a question asked between rounds 3 and 4 shows under round 3.
Pass `--n` to put it elsewhere.

**laneboard only sees the file if it reads that place.** The default file,
`./.laneboard/run.jsonl`, is seen when the current directory is the root of
a lane (a git worktree laneboard shows on the board). Anywhere else, a
subdirectory included, name the file in
`runs.files` or send the events with `--post`; otherwise `#/runs` stays empty
and nothing warns.

- It writes to `--file`, else `$LANEBOARD_RUN_FILE`, else
  `./.laneboard/run.jsonl` (a relative path against the current directory,
  the directory made if missing), and works with laneboard down.
- `--post` sends the event to `POST /api/runs/events` instead of the file;
  a refused event prints the server's reason and exits 1.
- Each line gets `"v":1` and `ts` (now, epoch ms).
- `round` (without `--end`) prints `export LANEBOARD_RUN=<run>/<n>`, so after
  `eval` the sessions the round starts carry the run and round in their
  environment. `--run` defaults to the run part of `$LANEBOARD_RUN`, so a
  session inside a round can send `laneboard run score --name … --value …`.
- Bad arguments (an unknown flag, a missing value, a number that is not one,
  a line `parseLine` would skip) exit 2, print one line saying what is wrong
  and write nothing. `laneboard run --help` prints the flags.

The exact flags are in the header of `bin/laneboard`.

## The API

On the builder, on the loopback port, behind the same local guards as the rest
of the UI (the CLI sends the `x-laneboard` header):

| Route | Does |
| --- | --- |
| `GET /api/runs` | a summary of every run laneboard knows |
| `GET /api/runs/<run>` | one run, folded; 404 if unknown |
| `POST /api/runs/events` | one event as JSON; checked like a file line (400 with the reason if skipped) and appended to `<stateDir>/runs/<run>.jsonl` |

`GET /api/runs` answers `{"runs": [...]}`, one row per run: `run`, `goal`,
`plan`, `branch`, `state`, `round` (the latest round's `n`), `rounds` (how
many), `maxRounds` (`budget.rounds`), `scores` (per name: the latest `n` and
`value`, the `prev` value and `better`), `usage`, `cost` (the sum of
`cost` events, see above), `deadline`,
`deadlineAt`, the open `needs`, `artifacts` (a count), `prs` (the `pr`
artifacts as `url`, `title`, `ts`; the Inbox lists them), `stop` (the reason or
null), `stuck` (`{rule, reason}` from the rules above, or null), `startedAt`,
`updatedAt`. `GET /api/runs/<run>` answers `{"run": …}`
with the whole fold (rounds, every score, needs, artifacts, raw events); each
round has `sessions`, the sessions tied to it (`sessionId`, `name`, `cwd`,
`firstAt`, `lastAt`, `usd`, `how` = `id` or `cwd`, `maybe`), and `sessionsUsd`,
their summed cost (null when none is known).

`GET /api/morning` (and `laneboard morning`, one line per run) carries `runs`:
every run with an event in the window, as `run`, `goal`, `state`, `rounds`
(started or ended in the window), `scores` (per name: `start` = the first value
in the window, `end` = the last, `better`), `stop` (the reason or null), `prs`
(URLs of the `pr` artifacts given in the window), `usd` (the run's `cost` when
the whole run is in the window, else the window's rounds' `usd`; null when
nothing says), `usage`, `startedAt`, `updatedAt`. No runs means `runs: []`.

A posted event is written as sent, on one line, with `ts` set to the server's
time if it had none; the answer is `201 {"ok": true, "run", "t"}`, and the run
is in the list at once. A body over 64 KiB is 413.

Without the CLI, `curl` does the same. The server wants the header
`X-Laneboard` with the value `1` exactly (any other value counts as missing):

```sh
curl -sS -X POST http://127.0.0.1:7777/api/runs/events \
  -H 'content-type: application/json' -H 'x-laneboard: 1' \
  -d '{"v":1,"t":"score","run":"acme-night","n":3,"name":"tests","value":412}'
```

Without that header the answer is 403 `{"error": "forbidden", "reason":
"no-csrf-header"}` and nothing is written.

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

Run it at the root of a lane (the worktree its agent sessions work in) and the
run shows up in `#/runs`. Run elsewhere, it needs a `runs.files` glob that matches
`<dir>/.laneboard/run.jsonl` (see "Where runs write").

Tips that make the Runs view worth reading:

- send a `score` after every round (tests passing, tasks done, a benchmark), so
  "is it getting better" has an answer;
- send `cost` and `usage` if the agent reports them, so the run shows its burn;
- say why you stopped: a `run.stop` with a reason beats a run that just goes
  quiet;
- put a question in `needs` instead of in a log nobody reads.

## Watching the runs loop

The loop that builds laneboard's own plans (`docs/plans/runs/loop/run.sh`)
speaks this protocol with its own small `ev()` writer, not the CLI. It keeps
everything for a run in `~/runs/<name>/`, outside any lane's cwd, so laneboard
only sees it when the config names the files:

```json
{
  "runs": { "files": ["~/runs/*/run.jsonl"] }
}
```

Restart laneboard after changing the file; new runs under `~/runs/` are found
on the next pass, without another restart. What it writes, and what laneboard
makes of it:

| The loop writes | Shown as |
| --- | --- |
| `run.start` with `rounds`, `pause5h`, `stop7d`, `branch` at the top level | the budget: round n / `rounds`; the burn bars warn at 90 % (5 h) and 85 % (7 d), the loop's default levels |
| `round.start` per session, again for a retry after a usage limit | one timeline row, `×2` for a retry; the cost of every try adds up |
| `usage` per round (`fiveHourPct`, `sevenDayPct` from the session's rate-limit events, `-1` when unknown, `fiveHourResetsAt` in seconds) | the 5 h / 7 d burn of the last round; `-1` is shown as unknown |
| `cost` per round (`usd`, and `total` since the loop's last start) | the round's cost; the run's cost is the sum of every `usd`, so it does not drop when the loop restarts (`total` and `run.stop.usd` do) |
| `score` `tests` (share of tests passing) after each check, `tasks` (tasks done) after each round | the two scores and their trend, higher is better; on the run page one line each over the rounds (two scores in one round: the last counts) |
| `round.end` with `outcome` `kept`, `no-task-done`, `researched` (`open` questions), `reviewed`, `triaged`, `fixed`, `still-red` | the round's outcome and commit; the planner, operator and final rounds have no `round.end` |
| `needs` `wait` (sleeping out a usage limit) | the run is `waiting`, not asking you anything |
| `needs` `fence` (a round touched a fenced file and was reverted) | an open need on the row: the owner decides; also a row in the Inbox's Runs group, where `a` acknowledges it (a `needs.ack` with `by: "inbox"` that names the need by its `ts`, since places shift when a later-read file holds older needs); only a person's ack closes it (`needs.ack` above), and the run page lists it under the open needs as `acked by <by> <time> ago` |
| `artifact` `pr` | the PR link on the run page; in the Inbox while the run is live and for 24 h after its last event (the protocol has no "merged") |
| `run.stop` with `reason`, `rounds`, `usd` | the stop reason: `done`, `deadline`, `rounds`, `no-progress`, `7d-window`, `overage`, `error`, `human` |

Its file sits outside the dir the sessions work in and it writes neither
`cwd` nor `session`, so its rounds list no sessions yet; a `cwd` on its
`run.start` (or the uuid of `claude --session-id` on each `round.start`)
would tie them.

Two quirks of that writer are taken as they are: older copies wrote every
number as a float (`"n": 3.0`, a commit made only of digits as a number,
whose leading zeros are given back), and its deadline has no zone
(`"2026-10-21 07:00"`), which laneboard reads in its own local time. A tasks
score that is not a number is skipped and counted, not fatal.
`test/fixtures/runs/loop-runs-n1.jsonl` is a night of that loop, folded by
`test/runs-loop.test.mjs`.
