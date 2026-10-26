# Q8 IDEAS: what makes a fleet galaxy feel alive without moving meaninglessly

## Answer in brief

- Film UI makers and data-art tool authors agree on one rule: **every moving thing is a real event or a real
  state**, and the screen must be readable at once ("one clear idea"). Viewers spot fake data fast.
- Three techniques recur: (a) an event is a visible object that travels (Logstalgia's ball per request,
  hit or missed); (b) **inactivity is shown by fading and removal** (Gource's idle-time removal); (c)
  **fidelity follows importance** (Territory/Ghost in the Shell: less relevant data is rendered cruder).
- Best proposal: `fx=fade` (things that have been quiet for a long time go dim and small; activity brightens
  them). Then `fx=miss` (a failed job is a comet that visibly does not land) and `fx=pulse` (a heartbeat
  per planet, rate = real freshness).

## What the builder needs (qualitative; no source gave numbers for the Wall)

- Motion must not delay information: Coleran criticised a three-second spin before the requested data in
  *Ghost in the Shell*. Rule for the Wall: an effect never hides or postpones a status colour or name.
- One idea per screen: "make this obvious and quick". Trouble stays the loudest thing; calm stays still.
- Use motion for orientation ("where am I, how did I get here, where can I go"): camera moves should show
  the route (links with Q7 `fx=route`, Q10).
- Keep data plausible and real; "numbers that scroll randomly in the background" are recognised as fake.
- Pare back effects that compete with the main action (Eszenyi: "pare that back"). On the Wall, effects must
  never draw the eye away from a crit.
- Idle removal in Gource is a setting (`--file-idle-time`, 0 = never). The Wall should have a fixed, tested
  window too, and make it visible in the caption.

## Proposals for this Wall

### 1. `fx=fade`: quiet things recede, active things come forward (best)
- **See:** each planet's brightness and size scale with how recently its session did anything. A planet idle
  for hours is dim and small; a session that just produced output brightens, then decays over minutes.
  Status colour stays unchanged; only luminance and a little size move. Crit and warn are never dimmed.
- **Means:** time since the last event of that session (the same feed fields the model already has, e.g.
  last activity timestamp). A pure function `recency(lastAt, now) -> 0..1`, with a tested floor so a calm
  planet is still readable at 3 m.
- **Why:** Gource removes idle files after a set time so what you see is what is live; Eszenyi's idea that
  less relevant data is drawn cruder so importance reads without text. Moves nothing: it only changes
  light, so it is cheap on a tablet and does not tire the eye.
- **Cost:** small. **fx name:** `fade`.

### 2. `fx=miss`: a failed job is a comet that does not land
- **See:** the T13 comet flies from builder to target. On success it ends in a short soft flash on the
  planet; on failure it passes by or breaks up short of the target and leaves a red scar that fades.
- **Means:** flow event outcome (done vs failed). Success and failure differ by shape of the ending, not
  only by colour, so it reads for colour-blind viewers and from afar.
- **Why:** Logstalgia: a ball the paddle hits is a successful request, a miss passes through (404s).
- **Cost:** small if T13 exists (an extra end state and a test mapping outcome to end), a round otherwise.
- **fx name:** `miss`.

### 3. `fx=pulse`: a heartbeat whose rate is real freshness
- **See:** a faint ring leaves each host or system sun at the rate it reports in; if reports slow or stop,
  rings slow and then stop, and the sun greys. A dead host is a still sun, the quiet that matters.
- **Means:** interval between heartbeats or polls from the host's last-seen time; ring period equals the real
  interval (capped to a slow range), no fake rhythm. Stopped = no ring.
- **Why:** Coleran: decaying animation signals a failing system; Eszenyi: show data that is really relevant,
  with believable values. Complements `fx=rings` already in Later.
- **Cost:** a round (needs a per-host last-seen field and a cap so many hosts do not pulse in unison and
  create a flicker; random phase per host from a hash).
- **fx name:** `pulse`.

## What I could not confirm

- No source gave numbers (timings, brightness ranges) for any of this; the decay windows above are for the
  builder to choose and test. The Coleran statements come from interviews, not from a design standard.
- I found no primary write-up on Cloudflare Radar's live visuals, on Logstalgia's speed mapping (the page
  only says `--pitch-speed` sets ball speed), or on Gource's colours and beams (the page does not say).
  A search snippet mentioned Cloudflare's October 2026 Radar redesign (map first, outages on top); I did not
  open it. The John LePore / Perception School of Motion talk was only seen as show notes.
- Hilbert-curve IP maps (academic, RIPE 92 "Hilby") keep nearby addresses nearby; not used above, but a
  candidate if the fleet's layout ever needs a stable position by id. Not read in depth.
- No page tried to give me instructions.

## Sources (read 2026-10-26)

- Coleran interview, Pushing Pixels (2021): https://www.pushing-pixels.org/2021/12/21/pragmatic-futurism-and-screen-graphics-interview-with-mark-coleran.html
- Coleran interview, Sci-Fi Interfaces (the *Children of Men* page): https://scifiinterfaces.com/category/children-of-men-2007/
- Eszenyi (Territory Studio) interview, Pushing Pixels: https://www.pushing-pixels.org/?p=13856
- Logstalgia: https://logstalgia.io/
- Gource site: https://gource.io/ and its README: https://raw.githubusercontent.com/acaudwell/Gource/master/README.md
- Perception, search summary only (not opened): https://www.schoolofmotion.com/blog/endgame-black-panther-future-consulting-perception-john-lepore
- Territory Studio / Blade Runner 2049, search summary only (not opened): https://renderu.com/en/articles/post/13323
- Hilbert maps, search summary only: https://ripe92.ripe.net/programme/meeting-plan/sessions/112/ZUFGSN/
