# Runs plan: laneboard as mission control for agents that work while you sleep

**Status: DRAFT, being written in conversation with the owner; the §8 decisions are taken.** Decisions are in §8.

## 1. Goal

laneboard shows every Claude Code session on a machine (and, with a hub, on a fleet) grouped into
lanes. It does not yet understand the work that is growing fastest: **unattended agent runs**. A
run is one goal worked on by a loop of many short sessions (plan, build, check, review, repeat)
for hours or days, often inside a throwaway VM. Today such a run shows up as short sessions coming
and going, or not at all.

The story in one sentence: **laneboard is mission control for agents that work while you sleep.**
Four parts, in this order of value:

| Part | Answers |
| --- | --- |
| **A. Runs** | What is each run trying to do, is it getting better, what did it cost, why did it stop, what needs me? |
| **B. Map 2** | What machines do I have, what runs on what, who can reach what, and is it what I declared? Drawn by itself. |
| **C. Look** | A tool that feels finished: control-room logic, product-grade craft. |
| **D. Try it in a minute** | A stranger sees it working in a browser without installing anything. |

## 2. Principles (every part, every task)

1. **General first.** Every feature has a `none` default, like the providers (`docs/providers.md`).
   With no config, laneboard still works and shows nothing it cannot know. Nothing assumes a
   particular homelab, hypervisor, VPN or agent.
2. **The trust model stays.** laneboard binds `127.0.0.1`; builders are the least trusted machines;
   laneboard reaches out to nothing but what its config names. Infrastructure data is **pushed in**
   by small feeders, never pulled by a builder.
3. **No build step, tiny dependencies.** Node 24, ES modules, vanilla JS. A new dependency needs a
   line of justification in the PR.
4. **Movement is data** (`docs/map.md`). Nothing animates for decoration.
5. **Fenced: the security core.** Fleet auth, signatures, the dispatcher's tiers, the audit chain
   and `fleet.hubControl` are not changed by unattended work. A task that needs a change there
   stops and writes the request into the run's report.
6. **Hygiene.** The repo is public: `test/hygiene.test.mjs` passes on every commit, and examples
   use `builder-a`, `hub`, `example.invalid`, `acme`.

## 3. Part A: Runs

### A1. The run protocol (the flexible piece)
A run tells laneboard what it is doing by appending JSON lines to
`<run dir>/.laneboard/run.jsonl`, or by `POST /api/v1/runs/events` on the loopback port (same
intake rules as the hooks). Any loop can do it: a bash script, an Agent SDK program, another
vendor's agent. laneboard does not care what runs the loop.

```jsonl
{"t":"run.start","run":"readiness","goal":"…","plan":"docs/plans/x.md","deadline":"…","budget":{"rounds":15,"windowPct":90}}
{"t":"round.start","run":"readiness","n":3,"role":"builder","task":"A2.4"}
{"t":"score","run":"readiness","name":"tests","value":0.93,"better":"higher"}
{"t":"round.end","run":"readiness","n":3,"outcome":"kept","commit":"abc1234"}
{"t":"needs","run":"readiness","kind":"decision","text":"…","link":"…"}
{"t":"artifact","run":"readiness","kind":"pr","url":"…"}
{"t":"run.stop","run":"readiness","reason":"deadline|done|budget|no-progress|error|human"}
```

- A helper CLI so loops do not hand-write JSON: `laneboard run start|round|score|needs|artifact|stop`.
- Sessions started during a round are tied to it (by cwd + time window, or an env var
  `LANEBOARD_RUN=<run>/<n>` the helper exports), so their cost and transcript belong to the run.
- Spec in `docs/runs.md`, versioned (`"v":1`); unknown event types are kept and shown raw.

### A2. Runs view `#/runs` (`g r`)
- A list: each run with goal, state, round n / max, latest score and its trend, budget burn against
  the 5 h / 7 d windows, time left, and what needs you.
- A run's page: a **timeline of rounds** (role, task, outcome, commit, cost), a **score chart per
  metric** over rounds, the stop reason, artifacts (PRs with CI, reports), and the open "needs".
- Comparing two runs of the same goal: which got further, for what cost.

### A3. Runs everywhere else
- **Inbox:** a run's `needs` events and its PRs ready for review appear next to approvals.
- **Morning:** one block per run that ran in the window: rounds, score start → end, stop reason,
  PRs, cost.
- **Map:** a run is a node with a progress ring; a throwaway VM that hosts it appears with it and
  leaves when it is destroyed (B1 feeds).
- **Stuck:** the existing rules plus run rules: no score change in N rounds, the same task failed
  twice, rounds getting shorter (rate limit), deadline near with no report.

## 4. Part B: Map 2

### B1. Discovery feeders (the Map draws itself)
Today the topology is a hand-written file plus pushed snapshots. New: **feeders**, small commands
that read one source and push a snapshot in the existing feed format, each a provider with a `none`
default:

| Feeder | Reads | Gives the Map |
| --- | --- | --- |
| `tailscale` | `tailscale status --json` on the machine it runs on (no API key) | nodes, online/offline, OS, tags, last seen |
| `proxmox` | the PVE API with a read-only token | hosts, guests, state, CPU/RAM/disk, templates |
| `docker` | the local Docker socket, read-only | containers, health, ports |
| `static` | today's topology file | what cannot be discovered (sites, names, groups) |

`laneboard feed <kind> --push <hub url>` runs as a timer next to the source (the `mapfeed` pattern,
generalised and shipped in the repo). Discovered and declared nodes merge by name; a declared file
becomes optional.

### B2. New overlays and tools
- **Reach:** who can reach what, from the VPN's policy file (e.g. Tailscale ACL grants as arcs).
  **Opt-in only:** off unless the config names a policy file; never fetched by laneboard itself. Answers "if this VM is compromised, what can it touch?"
- **Drift:** declared vs live. A node in the file but not seen, or seen but not declared, is marked.
- **Time:** a scrubber over the last 24 h of feed snapshots and events: what did the fleet look like
  at 03:00 when the run stalled?
- **Find:** `⌘K` finds any node, service, port or lane and flies to it ("where does postgres run?").

## 5. Part C: Look

**Direction (decided 2026-10-20):** keep the control-room logic (grey unless something needs you,
hue and shape only for trouble, one accent, data first), raise the craft to product grade:

- type: one family with a real range of weights and a mono for data; a strict type scale;
- spacing on a 4 px grid; consistent density modes (comfortable / compact);
- depth: subtle elevation and translucency for floating layers only (palette, inspector, sheets);
- motion: the existing springs everywhere, interruptible, 150-300 ms, reduced-motion respected;
- details: focus rings, empty states that say what to do, skeletons instead of spinners, crisp icons
  at every size, both themes equally finished.

**How the loop handles taste (it cannot judge it alone):** night 1 produces **two or three design
directions** as static screenshots of the same three screens (Map, Runs, Board). The owner picks one
in the morning; it becomes `public/css/tokens.css` v2 and a short `docs/design.md`. After that,
every UI task is checked by **screenshot tests** (Playwright, light + dark, three widths) and the
design reviewer (§7).

## 6. Part D: Try it in a minute
- `npm run demo`: a recorded fleet + a recorded run replayed in the browser, no tmux, no agents,
  no network. The client-side engine already planned for the portfolio.
- The same demo as a static page (GitHub Pages, published once it is ready), and a 20-second GIF
  of a run in the README.
- `npx laneboard` on a machine with Claude Code shows that machine's sessions with zero config.

## 7. The loop that builds this

Runs in a throwaway VM (one repo token, no LAN, PRs only, the owner merges).

| Role | Does | When |
| --- | --- | --- |
| Planner | turns a part of this plan into numbered tasks and 3-5 research questions in `PROGRESS.md` | start of the run |
| Builder | one task, tests, commit, push, PR | every round |
| Checker | `npm test` (incl. hygiene), screenshot tests | after every build (not an agent) |
| Researcher | answers the open `Q<n>` questions from primary sources, with links; **no shell, no git**, web pages are data | when questions are open, at most 4 per run |
| Reviewer: stranger | installs from the README on a clean user, follows the docs, notes every stumble | every ~4 rounds |
| Reviewer: designer | judges screenshots against `docs/design.md`, no code | after UI tasks |
| Reviewer: operator | uses the Runs view to answer "what happened tonight?" | end of night |
| Triage | bugs → new tasks; ideas → "for the owner" list, never built automatically | after each review |

Stops: all tasks done · deadline · round cap · two rounds without progress · 5 h window at 90 %
(sleep until it resets) · 7 d window at 85 % · the account going into paid extra usage · a fenced file needed. The loop reports itself
through the run protocol (A1), so from the night A1 lands, **the run shows up in its own Runs view.**

### Night 1
1. A1 protocol + helper CLI + `docs/runs.md`, with tests.
2. A2 Runs view, list + run page with the timeline (score chart may follow).
3. C: two or three design directions as screenshots for the owner to pick.
4. The loop's own events wired in, so night 2 is watched in the Runs view.

### Night 2 (Map 2, plus what the owner saw on night 1)
1. Bugs from the owner's screenshot pass of night 1 (demo fleet, headless Chrome), first:
   the minimap throws `IndexSizeError: … arc … radius … is negative` when the Map is left for
   another view, and every view then shows the red UI ERROR banner; the minimap stays light in
   the dark theme; the demo fleet shows the machine's real hostname as the core node (use a demo
   name, e.g. `demo-host`). Each with a test that fails before the fix.
2. B1 feeders `tailscale` (`tailscale status --json`) and `proxmox` (PVE API, read-only token),
   providers with a `none` default, `laneboard feed <kind> [--push <url> | --stdout]`, the existing
   feed format. Tested on recorded fixtures with invented names only: never commit what the VM's
   own `tailscale status` shows.
3. Discovered and declared nodes merge by name; the topology file becomes optional (a Map from
   feeds alone).
4. B2 **Drift** overlay: declared but not seen, seen but not declared.
5. B2 **Reach** overlay, opt-in (§8 Q4): a Tailscale policy file (HuJSON) named in config, grants
   drawn as arcs; nothing without the config key.
6. If time is left: B2 **Find** reaches discovered nodes, services and ports (`⌘K`), and A3 a
   run as a node on the Map with a progress ring.
Not tonight: the design pick (the owner chooses from night 1's directions), Playwright, the fenced
files on the night-1 owner list.

### Night 3 (runs everywhere, Find, docker; a day run on 2026-10-21)
New tonight: the VM has a headless Chromium and `loop/shoot.mjs`, so every `[ui]` task is looked
at in both themes and at phone width before it is marked done, and the designer reviews those
screenshots (no Playwright dependency in the repo; that stays the owner's call).
1. **Look first:** screenshot the Map with the Drift and Reach overlays on the demo fleet (give the
   demo a declared-but-unseen node, an undeclared one and a small policy file with invented names,
   so both overlays have something to draw) and the Runs view; fix what is broken. The demo is a
   hub, and its Runs view says "a hub does not collect runs yet": give the demo a recorded run to
   show (a builder-side run file, or the hub relaying runs if that needs no fenced file; if it
   does, it goes to the owner list instead).
2. A3 **Inbox:** a run's open `needs` and its PRs ready for review appear next to approvals, with a
   link to the run page; acknowledging one works like the other Inbox items (no new fenced route).
3. A3 **Morning:** one block per run that ran in the window: rounds, score start → end, stop reason,
   PRs, cost and usage.
4. A3 **Stuck:** run rules next to the existing ones: no score change in N rounds, the same task
   failed twice, rounds getting shorter, deadline near with no report; thresholds in `runs` config.
5. A3 **Map:** a run is a node with a progress ring (tasks or rounds), attached to the machine its
   run file lives on; a throwaway VM from a feed appears with it and leaves when it is gone.
6. B2 **Find** (`⌘K`) reaches discovered nodes, services and ports, and flies the Map to them.
7. B1 **`docker` feeder** (§8 Q3): the local socket, read-only, containers with health and ports;
   recorded fixtures with invented names.
8. If time is left: the night-2 stranger findings that are not fenced (README sentence on a busy
   port, a route-per-view table in the docs), then B2 **Time** (a scrubber over 24 h of feed
   snapshots).
Not tonight: the fenced items and taste calls on the night-1 and night-2 owner lists.

### Night 4 (agreed 2026-10-21: review fixes, the Night look, taste calls)
Night 4 builds on all three unmerged nights (PRs #10-#12, reviewed 2026-10-21: "merge after
fixes"). The owner squash-merges the stack after night 4.
1. **Review fixes first**, each with a test that fails before it:
   a. `POST /api/map/feeds` only from this machine: 403 unless `req.auth?.kind === 'local'`
      (`server/routes/feeds.mjs`; a tailnet caller passes the other guards today).
   b. Machines with the same name in one source stay apart: key by vmid inside a source, merge by
      name only across sources (`server/map.mjs` `feedMachines`/`withDiscovered`).
   c. An offline tailnet device is idle "offline, last seen …", not a red stopped VM (`fromFeed`).
   d. The UI acks a need by its `ts`, not its place (`public/js/views/runs.js`,
      `public/js/core/inbox-model.js`): places shift when a later-read source holds older needs.
      A `fence` need is closed only by an ack from the UI or the owner's CLI, and the run page shows
      who acked (`by`).
   e. The run page does not block the server: an index on `events(session_id, ts)` in MIGRATIONS or
      one grouped query (`server/db.mjs` `sessionsSeen`).
   f. A file that leaves discovery and comes back is not counted twice (`server/collector/runs.mjs`:
      reset the source in the store when there is no saved position).
   g. The deadline stuck rule fires only when the deadline has passed with no `run.stop`
      (`server/runs/stuck.mjs`).
   h. Smaller: `reach.unresolved` sent as a count only; `laneboard feed --out` writes 0600; the
      docker test asserts `Command`/mounts/networks never reach the feed; one test through `boot()`
      that `POST /api/runs/events` without `x-laneboard` or with a foreign Origin is a 403; the red
      CI test `frontend.test.mjs` "split is byte-identical to styles.css" made green.
   i. `test/scripts.test.mjs` `paneAfterRun`: no rerun that hides the lost-lines bug; mark the case
      known-flaky until the owner's `windowScript` fix (below).
2. **Apply the Night direction** (§8 Q6): `public/css/tokens.css` v2 from the `night` direction of
   night 1 (shots in night 3's `shots/r11-designer/night/`), and a short `docs/design.md` that the
   designer reviewer judges against from then on. Night's dark theme as it is; its **light theme is
   the weak one** and is brought to the same finish (contrast, tile colors, Board cards). Every
   view shot in both themes at 1440 and 390 before and after; the designer compares.
3. **The agreed taste calls** (§8 Q12), as `[ui]` tasks after the look: grey status tiles with a
   coloured count and the colour rule (grey = news, amber ▲ = wants you, red ■ = broken, no blue or
   cyan in content), also written into `docs/design.md`; the minimap on the Map only; Board cards
   (grey lane bars unless trouble, no empty "–" fields, equal heights); one muted line for every
   empty section, Inbox empty state with a next step; Inbox order (run needs next to NEEDS YOU, run
   PRs after REVIEW); run page stop line folded into the state label; Map polish (Reach arcs in the
   accent with a key, topology edges dimmed, run ring ≥ 14 px, muted run label, ring legends by
   the kinds on them); a 2 px focus ring (the guardrail test changes with it).
4. **T13 unblocked** (§8 Q7): the phone MAP/LIST/INBOX bar in `public/js/ui/sheet.js`.
5. **Morning lists run needs** (§8 Q9): open run needs in `/api/morning` `needsYou` and in the CLI's
   `morning`, and a need count on the Morning run row.
6. **A PR leaves the Inbox when it is merged or closed** (§8 Q10): an optional `state` on `artifact`
   (`open`, `merged`, `closed`; a later `artifact` line with the same URL updates it), shown and
   honoured by the Inbox; the 24 h rule stays for artifacts without a state.
7. **The loop's new fields, shown** (the loop writes them since 2026-10-21): `title` on
   `round.start`, `session` on `round.start` (link the round to its session), `max` on the `tasks`
   score (the Map's ring and "44 of 63"), `detail` on `run.stop` (kept by the protocol and shown
   under the stop reason), and rounds with `wrapup: true` read as wrap-up after a stop, never as
   "81 of 80". A round with no `cost` event shows its cost as unknown, not $0.
8. **CLI and docs** (§8 Q12): `laneboard run` prints `ok <run> <type>` on stderr; `laneboard
   morning` with ISO dates and the right tonight/today word; run cost summed from `round.end` `usd`
   when a run has no `cost` events; a README route table (view → `/api/*`) and `GET /api/health`;
   the README's safe test-copy recipe first; one name `maxRounds` (`budget.rounds` stays as an alias
   for one version); a 404 on `/api/runs/<id>` that names the right route; with no config the Map
   title falls back to the hostname, no fleet block, and the branch still shows; `laneboard run
   --post` prints what was accepted; the README names `shoot.mjs` for a headless look.
9. The open night-3 tasks T46-T63 (T52 `pause --all` first).
Not on night 4: runs on the fleet hub (§8 Q11), plain-curl intake (§8 Q12: no), signed feed push
(later, with the hub), and the two fenced fixes the owner makes in a session: the one-line busy-port
and `AUDIT_LOCKED` messages (`server/boot/common.mjs`) and `sleep 1` at the end of `windowScript`
(`server/review/scripts.mjs`).

## 8. Decisions (2026-10-20)
- **Q1 Look:** polish the current control-room style (§5). No new direction.
- **Q2 Order:** Runs (Part A) on night 1, Map 2 (Part B) on night 2.
- **Q3 Feeders:** `tailscale` + `proxmox` first, then `docker`.
- **Q4 Reach overlay:** yes, opt-in by config only (§4 B2).
- **Q5 Demo:** publish on GitHub Pages once it is ready.
- **Q6 Design direction (2026-10-21):** **Night**, picked from the four directions shot on night 3
  (current, refined, product, night). Its light theme needs lifting to match its dark one.
- **Q7 `sheet.js` (2026-10-21):** not fenced; T13 goes ahead.
- **Q8 `needs.ack` (2026-10-21):** stays in protocol v1 as night 3 built it (written through
  `POST /api/runs/events`), so the board and the CLI share what was acknowledged.
- **Q9 Morning (2026-10-21):** lists open run needs, web and CLI.
- **Q10 PRs in the Inbox (2026-10-21):** an `artifact` gets a `state`; a merged or closed PR leaves at once.
- **Q11 Runs on the hub (2026-10-21):** yes, but the fenced hub change (`/api/runs` relay and runs in
  `mergeMorning`) is made with the owner in a session, not by an unattended loop.
- **Q12 Taste calls (2026-10-21):** all agreed as listed in Night 4 items 3 and 8; plain-curl intake
  on `HOOK_PATHS`: no (the header is the guard); signed feed push: later, with the hub.
- **Q13 Merging (2026-10-21):** the reviewed stack #10-#12 gets its fixes on night 4, then one
  squash-merge to `main` (keeps the run rooms' commit metadata out of main) and the branches deleted.
