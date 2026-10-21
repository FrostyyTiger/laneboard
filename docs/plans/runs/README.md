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

## 8. Decisions (2026-10-20)
- **Q1 Look:** polish the current control-room style (§5). No new direction.
- **Q2 Order:** Runs (Part A) on night 1, Map 2 (Part B) on night 2.
- **Q3 Feeders:** `tailscale` + `proxmox` first, then `docker`.
- **Q4 Reach overlay:** yes, opt-in by config only (§4 B2).
- **Q5 Demo:** publish on GitHub Pages once it is ready.
