# Q18 (IDEAS) — "at work" vs "idle" at a glance, without hue (for T17 `fx=activity`)

Read 2026-10-27. Mode `ideas`: three proposals for the galaxy, best first.

## Answer in brief

- The sources I could reach agree on one rule: **state is carried by brightness, form and motion, and hue stays
  for trouble.** High-performance HMI (ISA-101 practice) draws healthy equipment in grey and reserves colour for the
  alarm; Factorio's mod community asks for shape or "no light" in place of colour-only status.
- "Busy" is best read as **more light plus a slow, local motion**, and "idle" as **less light and no motion**. Idle must
  be the quiet default, because a moving thing nobody needs to watch is noise.
- A state that is only *scheduled or waiting* should look different from *working* (Ignition's docs: dark grey for
  "scheduled"). For laneboard: a session that is open but waiting is not "working".
- I found **no** developer write-ups (talks, diaries) for Homeworld, Stellaris, RimWorld or city builders on this
  question. The game material below is thin and mostly forum or mod material. Ideas that lean on those games are
  my own, marked as such.

## What the builder needs

No measured numbers were found in the sources. The values below are starting points to be tuned on the film
sheet and the 3 m shrunk overview, not facts from a source:

- Idle recedes one step (e.g. 60-70 % of base brightness), working sits at 100 % or slightly above, and size
  differs by 10-15 % at most, so the layout does not jump.
- A ring or breath should be slow (period 3-6 s) and below the "trouble" motion, which must stay the loudest thing.
- A landing flash is one event, about 400-700 ms; a failed job gets no flash at all, the absence being the sign.
- Never use the status hues (warn/crit) for activity; use white/the planet's own tone.

## Proposals for this Wall

### 1. Light follows work (best), `fx=activity` core. Cost: a round

- **See:** a planet with a working session is a step brighter, a little larger, and wears one thin ring that
  breathes slowly. Idle planets drop a step and hold still. At the overview you see the working ones as bright dots with a halo.
- **Means:** brightness = a session is working now (`workingPlanets`). Nothing else moves it.
- **Basis:** ISA-101 style grey-scale HMI: normal equipment is shown in low-contrast grey, with state as a contrast or
  fill change rather than saturated colour, and a "scheduled" state kept distinct in dark grey (Ignition docs).
  Factorio machines also stop their working animation when idle (forum thread on `idle_animation`; the engine keeps an
  idle sprite distinct from the working one).
- **Builder note:** distinguish "session open, waiting" (idle level) from "working" (bright). Add a text label when
  held (e.g. "working"), as Ignition advises text beside colour.

### 2. Landing flash and the quiet miss. Cost: small once 1 exists

- **See:** a job that lands makes its target planet flash once (a short bright ring, one expansion). A job that fails
  does not land: the comet or ring stops short and fades, no flash.
- **Means:** flash = job finished on that target; no flash = it did not. The gap *is* the information.
- **Basis:** my own proposal, in line with the HMI rule that fault is not decorated on equipment but shown by the
  separate alarm indicator (Ignition docs); a failure that also changes the planet's colour would fight crit.
  The Factorio thread states that "unpowered" is cheaper to read as *no light* than a coloured one.

### 3. Shape-coded state, for when hue and motion are both off. Cost: small

- **See:** a tiny mark beside the planet: a filled dot = working, a hollow ring = open and waiting, nothing = idle.
- **Means:** the three session states, readable in a screenshot, in a still frame, in grey-scale, and for colour-blind viewers.
- **Basis:** Factorio forum proposals for unique shapes per status (e.g. colour-blind players asking for distinct
  textures and shapes); Ignition's advice to pair state with descriptive text.
- **Caution:** at 3 m the mark must be at least the Q3 minimum size; if it cannot be, drop it and keep proposal 1.

## What I could not confirm

- Any developer-authored source on idle/busy indication for Homeworld, Stellaris, RimWorld or city builders. Searches
  returned player complaints (Stellaris: ship icons "really hard to see") and mods, not design talks.
- The ISA-101 normative wording. Statements about "dark grey running / light outline stopped" come from a secondary
  study-guide page and are not verified against the standard.
- Mini Metro's overcrowding ring: only general descriptions found, no maker write-up.

## Sources (all read 2026-10-27; no page tried to give instructions)

- Factorio staff on entity status to lamp colour (green working, yellow low power, red everything else):
  https://forums.factorio.com/viewtopic.php?p=530877
- Factorio forum thread on colour-independent machine status (shapes, "no light" for no power):
  https://forums.factorio.com/viewtopic.php?p=694483 (search summary; the thread itself I did not open)
- Factorio forum, idle vs working animation behaviour: https://forums.factorio.com/viewtopic.php?p=540420
- Ignition (Inductive Automation), High Performance HMI Techniques (grey-scale, "scheduled" dark grey, no fault
  colouring of equipment, simple shapes, text beside colour):
  https://docs.inductiveautomation.com/docs/8.1/ignition-modules/vision/common-tasks-in-vision/high-performance-hmitechniques
- Secondary, unverified: ISA-101 study guide summary
  https://open-exam-prep.com/study-guides/isa-cap/system-design-hmi-alarms-enterprise/hmi-design-isa101
- Stellaris dev diary 154 (no relevant specifics found):
  https://admin-forum.paradoxplaza.com/forum/developer-diary/stellaris-dev-diary-154-ux-design-in-stellaris.1244013/page-6
