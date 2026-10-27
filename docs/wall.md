# The Wall

The Wall is the Map for a screen nobody sits at: a tablet on a shelf, a TV in
a hallway, half of a big monitor. It answers one question from three metres
away: **is anything wrong, and where?** Nobody has to touch it. It tours the
fleet by itself, trouble first, and says what it shows in big type. A finger
can take it over at any time; a minute later the tour takes it back.

It reads the same model as the app's Map (`GET /api/map`, then the `map`
frames of `/ws`) and needs no new route, config or dependency. It only
reads: nothing on the Wall changes anything in the fleet.

There are two pages:

| Page | What it is |
| --- | --- |
| `galaxy.html` | The Wall. The fleet as one spiral galaxy in WebGL: the hub is the sun, each site a star cluster, the machines and services in it its planets. Trouble is the only colour. |
| `wall.html` | The 2D Wall: the Map's own drawing in four layouts (`?variant=`), with the same caption, frame and tour. The galaxy sends a browser without WebGL here. |

The colour rules are the app's (`docs/design.md`): grey unless something
needs you, red for crit and down, amber for warn. A light's own colour
(`glow`, below) is the one exception, kept low so it never reads as status.

## What you see

- **The tour.** The camera rests on the whole galaxy, then flies to each
  site in turn, worst first, and holds there: 14 s on a site in trouble, 6 s
  on a calm one, the overview again for 10 s. After every two calm sites
  the camera goes back to the trouble it has already shown.
- **The caption** (the plate, top left) types what the camera holds: the
  site's name, its worst status as one word (`CRIT`, `DOWN`, `WARN`, or the
  calm line) and the named problems, worst first.
- **The fleet line** (bottom right) is the whole fleet's worst trouble
  while the camera is elsewhere; the clock is bottom left. The tag (top
  right) says `STALE 1m 20s` when no data came for 30 s, and `OFFLINE` when
  the socket closed; the sun then goes small and cold grey, and the next plate says the
  data is old.
- **Countdowns.** A node that carries a `countdown` (below) shows how long
  until its job runs under its name: whole minutes from afar (`in 12 min`),
  `m:ss` while the camera holds it, `+4 min` once it is late. Never in
  colour: a late job is news, not trouble.
- **Reduced motion** (the system setting `prefers-reduced-motion`): no
  flights, no turning, no drift. The page holds the overview with every
  cluster folded and the caption steps through the sites, trouble first.

## Touch

- **The first touch** anywhere stops the tour and eases out to the whole
  galaxy. Nothing under that first touch is activated.
- **One finger** turns the galaxy; **a pinch** (or the wheel) zooms between
  the overview and a close system. Both coast to rest.
- **Tap a site** to fly there and open its sheet: every problem, worst first.
  In an open system, tap a planet for its own sheet. Where several planets
  sit under one finger they fan out as rows; tap the one you want.
- **Tap the fleet line** to open what it names.
- **Back** (`‹ BACK`, top right) or a tap on empty sky goes one step back:
  planet, system, overview. The plate, the fleet line and the clock are not
  sky: a tap on them opens nothing and steps nothing back, except a sheet
  row naming a planet, which opens it.
- **`MANUAL · TOUR IN 0:40`** under the tag says a person is driving and when
  the tour comes back.

**To give the page back to the tour**: tap `▶ TOUR` (where the back control
is, at the overview), or wait. A minute after the last touch, the tour
takes the page back at its next leg, trouble first, flying there from
wherever the finger left the camera.

**To stop the tour**: touch the screen; it stays stopped for a minute after
the last touch. For a screen that never tours by itself, open it with
`?role=explore` (below).

The page itself never scrolls or zooms: every gesture moves the camera.

## A tablet in kiosk mode

Serve laneboard as usual (`docs/install.md`; HTTPS in front of it if the
tablet is not on the same machine) and open
`https://<your laneboard>/galaxy.html` on the tablet. Then make it a kiosk:

- **Windows** (a Surface, say): an assigned-access kiosk account with
  Microsoft Edge in full-screen kiosk mode on that address, or Edge started
  with `--kiosk https://<your laneboard>/galaxy.html --edge-kiosk-type=fullscreen`.
- **Android**: Chrome's *Add to Home screen*, then the system's screen
  pinning, or a kiosk launcher.
- **iPad**: Safari's *Add to Home Screen*, then *Guided Access*
  (Settings › Accessibility).

Set the tablet's screen timeout to never and keep it on power: the page
does not hold the screen awake itself. Landscape is the layout the Wall is
judged on; portrait and half a screen (684 px wide) keep the names, the
trouble and the touch targets readable too. If the tablet is not the size
the page guesses, tell it the screen's height in mm (`?mm=`).

To try it without a fleet: `node test/tools/demo-fleet.mjs --size large`
starts a demo hub with five sites and a moving crit, warn and attention on
`http://127.0.0.1:7795/`; open `/galaxy.html?demo=1` there.

## The URL switches

Switches combine: `galaxy.html?demo=1&fx=beacon,warp&perf=1`. None is on by
default; an unknown value is ignored.

| Switch | Page | What it does |
| --- | --- | --- |
| `?demo=1` | both | Video speed: about 4 s per site, overview included, for filming and trying things. `?demo=0` (or `false`, `no`, `off`) is off. |
| `?pace=wall` | galaxy | With `?demo`: the demo's data at the normal, readable tour speed. |
| `?fx=<names>` | galaxy | Turns on effects, comma-separated (see below). `<html data-fx>` lists those on. |
| `?perf=1` | galaxy | An overlay with the frame budget: script and frame ms, quality level, pixel ratio, three.js's draw counts. |
| `?quality=0\|1\|2` | galaxy | Pins the quality level (0 the best, 2 the cheapest) instead of letting the frame budget choose. |
| `?ratio=<n>` | galaxy | Pins the pixel ratio the canvas is drawn at (0.5 to 4, still capped by the screen's), for filming or comparing frames. |
| `?at=<site>` | galaxy | Parks the camera on one site (its id or its name), no tour, no touch steering: for stills. |
| `?open=0..1` | galaxy | With `?at`: how far the parked system is opened (1, the default, fully). |
| `?role=tour\|explore` | galaxy | What the screen is for. `tour` (the default) tours by itself and lends itself to a finger for a minute. `explore` is a person's screen: it starts at the overview with no tour until `▶ TOUR` asks for one, never hands itself back after a touch (the line reads `MANUAL`), and refuses show commands. `?at` ignores it. |
| `?show=demo` | galaxy | Plays a recorded conversation's show commands over the demo fleet, again and again, with the tour between: fly to the crit, pin a note, highlight what it breaks. |
| `?showOrigins=<origins>` | galaxy | Other origins allowed to send show commands by `postMessage` (comma-separated, exact origins such as `https://hub.example.invalid`). The page's own origin always may, also by `BroadcastChannel('laneboard.show')`. |
| `?mm=<n>` | both | The screen's height in mm, so the type is sized for reading at its distance on this screen rather than a guessed one. |
| `?variant=<id>` | wall | The 2D layout: `radial` (the default), `orbits`, `islands`, `mosaic`. An unknown name is radial. |

### Effects (`?fx=`)

Each effect is a switch, off unless asked for, so it can be kept or dropped
on its own. None of them runs in reduced motion, and none of them is louder
than live trouble.

| `fx` | What it shows | What it means |
| --- | --- | --- |
| `beacon` | A thin pillar of light above each cluster in crit, with a white core at its foot; taller and wider the longer the crit has lasted. A tap on the pillar opens its site. | How long it has been burning: two crits are no longer twins. |
| `warp` | During a flight to trouble, dust and far stars stretch into streaks towards the target, their ends in its status colour; gone before it lands. | Trouble ahead: you know the next target is red before the caption types it. Flights to a calm site or to the overview have none. |
| `afterglow` | A faint outline ring on the plane round a cluster whose trouble cleared, cooling red, amber, grey, gone after 30 minutes. | Something went wrong here recently, though it is calm now. Remembered by the page only; a reload forgets it. |
| `activity` | A planet with an agent or a job at work is brighter, larger and wears a slowly breathing ring; a quiet one dims. A landing job flashes its target; a failed one stops short and breaks up. | What is at work, and what just ran. Never a change of colour. |
| `sweep` | Once per tour round, at the overview, a faint grey line turns once round the plane; each cluster it crosses pings, but only if its site sent new data since the last sweep. | Freshness: a silent site stays dark and the gap shows. |

## Feed fields

A feed (`docs/map.md`, "Feeds") may hang three extras on a host, a guest or a
service for the screens that paint them. Each is kept whole or dropped when
invalid, and gone while the feed is stale. The app's Map draws none of them.

| Field | Shape | Painted by |
| --- | --- | --- |
| `glow` | `{ "rgb": [255, 200, 120], "level": 0.8 }`: a light's colour (three integers 0-255) and brightness (0-1, 1 when left out) | `wall.html`: a soft light round the node in its own colour |
| `ring` | `{ "progress": 0.42 }`: a job's progress, 0-1 | `wall.html`: a thin grey ring round the node |
| `countdown` | `{ "at": 1793000000000, "label": "backup" }`: when a scheduled job runs next (epoch ms or an ISO time) and a short name (up to 32 characters, may be left out) | `galaxy.html`: a line under the node's name and a line on its plate |

The demo fleet (`--size large`) carries all three: lights with `glow` and a
3D printer whose job's `ring` fills in ten minutes in the `home` site, and
scheduled jobs with `countdown` (database dumps, an offsite copy, and an
object-store lifecycle job that runs late).
