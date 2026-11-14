# Network: the wire

Network (`#/network`, `g n`, NET in the nav) shows the machines foundry runs on,
drawn as **the wire**:

- the tailnet is one wire; every machine hangs on it with one tap, and so do you;
- boxes in boxes say what lives where: a host, the **foreman** in it, its
  **rooms**, and in each room the run with its loop spot (the same seven dots
  as on Runs, [run-loop.md](run-loop.md));
- an event is a **packet** on the wire: when a live run writes new events, a
  dot runs from its host to the foreman's, and on to you when it now waits for
  you. Nothing else moves. Not under `prefers-reduced-motion`;
- on a phone the wire turns vertical and the boxes stack.

| You see | It means | From |
| --- | --- | --- |
| you, `■ n runs wait for you`, questions | what needs you (Runs) and the product questions (Inbox) | the Runs read |
| a host box, `● up`, its role | a host the engine reports | `health.hosts[]` |
| a dashed box, `○ not reporting` | a host only a run names | `runs[].rooms[].host` |
| Foreman · up, beat, queue, runs on | the foreman and where it lives | `health`; the host is `health.host`, or the steady one when an older foundry sends none (the box says so) |
| a room slot | a live room: its name and purpose, the run (a link to its page), goal, loop glyph, what it waits for, cost | `runs[].rooms[]`, the run row and its `loop` |
| pips, `n ended today` | rooms of runs that ended in the last 24 h (● done, ○ stopped, □ errors) | `runs[].endedAt`, `stop` |
| the 24 h strip | when that host had rooms up | `runs[].startedAt`, `endedAt` |

**Not reported yet**: host load and how the machines are linked on the tailnet.
laneboard has no feed for either, so the page says so instead of drawing it.

**The tie-in, both ways.** A run page names its hosts (`on heavy`); each is a
link to `#/network?sel=node:heavy`, which marks that host. The foreman part of
the Runs status line links here too. A room slot links to its run's page.

One read, every 5 s: `GET /api/engines/runs` (the Runs view's own; no extra
call to the engine).

The constellation Map (`#/map`, [map.md](map.md)) is still there: it also draws
lanes and sessions, which the wire does not.

## Try it

`{ "engines": [{ "id": "main", "kind": "fake" }] }`, then `g n`.
