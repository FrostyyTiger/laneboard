# Q14 IDEAS: a dead or stale feed, unmistakable from 3 m, quieter than live trouble

## Answer in brief

- Every system I could confirm treats "old data" as a **separate state from "bad data"**, and shows it by
  **taking something away or freezing it**, not by adding an alarm: OPC UA has `Uncertain_LastUsable` (value
  kept, flagged) apart from `Bad` (value untrustworthy); Garmin primary displays replace a lost value with a
  red X; Barco multiviewers give a lost input a red border and a frozen one a cyan border.
- The best-supported idea for the galaxy is therefore **freeze the life**: when frames stop, everything that
  moves for liveness (drift, twinkle, swell, pulse) stops and the frame goes still. A dead feed is then
  recognised by its stillness, which a plain grey sun cannot do on its own.
- The plan's grey sun and `STALE <age>` tag are a good base (README §7 B). Their one weakness: the crit
  nebulae stay red and brightest (T6's done-when). A frozen, red crit looks exactly like live trouble.
  The proposals below say how to mark it as *last known* without hiding it.

## What the sources say (what the builder can lean on)

- OPC UA / OPC DA quality splits into Good, Uncertain, Bad. `Bad_LastKnown` maps to
  `Uncertain_NoCommunicationLastUsable`: communication failed, the value is the last good one, whether it is
  still current is unknown. A separate "last usable value" case is a source that stops updating within the
  acceptable period (MathWorks wording). Inductive Automation's tag system has `Uncertain_LastKnownValue`
  (257) and `Bad_Stale` (516, "out of date based on the requested refresh interval"). Age is judged by
  timestamp. Takeaway: *stale* is "last usable, age unknown", a state of its own, never shown as live.
- Ignition's Perspective overlays: stale (Bad 516) gets the **Error** overlay, uncertain gets **Unknown**, and
  a large overlay carries its diagnostics in an icon at the upper right. The page gives no colours or
  opacity in text; I could not confirm how they look.
- Garmin G1000 service notices: a data field that loses its source shows a **red X** over the field (attitude,
  heading, slip/skid, airspeed, altitude, vertical speed); brief interruptions can show it for up to 2 s.
  Takeaway: the flag is a *shape* in the place the value was, so it works without colour, and the value does
  not stay on screen looking right.
- Barco FSN multiviewer (reseller text of the product sheet): a lost input's window border goes red, a
  **frozen** input's border cyan; tally sits in the label area, the loss warning on the border. Zandar
  Predator also changes border colour on an alarm. I found no industry standard for the colour; vendors
  differ.
- IADS operations console thread (2009, informal): a parameter that reads zero or null turns grey and enters
  an "ignore" state. One vendor's behaviour only.
- Hollifield et al., *High Performance HMI Handbook*, and ISA-101: the general rule is grey for normal,
  colour for abnormal. I could **not** find their text on quality/stale display (the one source, control.com
  "Going Gray", answered 403). Do not cite them for stale.

## Proposals for this Wall

### 1. `freeze` — the galaxy stops breathing (best; small to a round)

- **See:** at `STALE`, all liveness motion ends: the slow drift/orbit of planets, star twinkle, the sun's
  swell, the crit nebula's pulse. The picture does not go dark; it goes **still**, like a paused video. The
  tour camera may keep moving (it is the viewer's, not the data's). When frames return, one soft swell and
  the motion eases back in over about 1 s.
- **Means:** motion in the galaxy is fed by data (README: nothing moves without meaning). If the data stops,
  motion stops. A viewer who has watched the wall for a minute notices the absence even without reading the
  tag. This is the plan's "its absence is the alarm", made literal across the whole scene, not just the sun.
- **Cost:** small. A single `liveness` factor from `fresh.js` (1 live, 0 stale) multiplied into the time
  step of the scene's animated terms; reduced-motion mode is already still, so it needs the grey sun and tag
  to carry it (they do).
- **Inspired by:** Barco's "frozen input" being a state with its own cue; OPC "last usable value".
- **Check:** a film at `--quiet-after 5` should show two frames 10 s apart, after the state flips, with the
  same pixels outside the camera move (a test can compare the scene's animated uniforms to equal values).

### 2. `lastknown` — trouble stays, but is marked old (a round)

- **See:** at stale, crit and warn nebulae and glyphs keep their **hue and place** (they must stay visible:
  the feed's last word may be the only warning) but lose the pulse and get a **hatch or slow dashed outline**
  and the grey `<age>` next to the sun. Brightness drops one step below the live crit level, so a live crit
  that arrives after recovery is still the brightest thing. After a longer `dead` stage (say 10 min, a
  number to set) trouble desaturates toward `--text-3` and the caption says "last report 10 min ago".
- **Means:** the OPC distinction made visible: *last usable value*, not *current value*. The hatch is a shape,
  so protanopia/deuteranopia viewers get it too, and a one-line caption names the age.
- **Cost:** a round (a hatch or dash on the nebula's edge in `scene.js`, a stage in `fresh.js`, tests for the
  colour/brightness mapping). It changes T6's "crit cluster stays red and brightest" wording: keep
  red, but not brighter than live crit; the owner should read this under *For the owner*.
- **Inspired by:** OPC `Uncertain_LastUsable` vs `Bad`; Ignition's *Unknown* overlay as a separate look from
  *Error*.

### 3. `flag` — a failure flag in the sun's place (small)

- **See:** the grey sun gets a thin **ring with a diagonal slash** (a "no signal" glyph, 2 px, `--text-3`,
  never red) at its centre, sized to read at 3 m (about the sun's diameter, not a pip), with `STALE 2M` set
  beside it. It sits where the eye already rests when the corona swells.
- **Means:** the red-X idea without the red: a shape in the position where the live signal used to be, readable
  without colour. Red stays reserved for live trouble, as the brief asks.
- **Cost:** small (one sprite or SVG overlay in `hud`, a test that it shows only when `state !== 'live'`).
- **Inspired by:** Garmin red-X failure flags; Barco's border cue (the position matters: on the thing).

## Which to take

Order: **1** (cheapest and the one that makes the dead state felt, not read), then **3** (a shape that
survives colour-blindness and a grey-on-grey sun), then **2** only after the owner decides how a stale
crit should look. Together: still scene, slashed ring, grey sun, `STALE 2M`, trouble still visible but
hatched and one step dimmer.

## Not confirmed

- ISA-101's own text on bad-quality display (the standard is paywalled; the open sources I found were silent).
- How Ignition's overlays look (colour, opacity): the doc gives names and triggers only.
- Aviation standard text (AC 25-11B): the PDF returned 403; the red-X facts above come from Garmin notices.
- Any film-interface designer's talk on "signal lost" treatment: searches found only general Territory Studio
  pages. Film rationale for freeze/glitch is **not** sourced; proposals 1-3 rest on the control-room and
  avionics sources above.
- Barco colours are from reseller pages repeating the product sheet, not read on Barco's own site (403).

## Sources (read 2026-10-26)

- Inductive Automation, Quality Codes and Overlays: https://docs.inductiveautomation.com/docs/8.3/platform/tags/quality-codes-and-overlays
- OPC Foundation, Data Access Part 8, quality: https://reference.opcfoundation.org/Core/Part8/v104/6.3.2
- MathWorks, OPC HDA quality values: https://www.mathworks.com/help/icomm/ug/understanding-opc-hda-quality-values.html
- OPC Router, OPC UA status codes: https://docs.opc-router.com/plug_in/shopfloor/opc_client/opc_ua/opc_ua_statuscodes
- Garmin G1000 service notices (red-X): https://atlaske-content.garmin.com/filestorage//email/outbound/attachments/1129_Time1636987752952.pdf and https://avweb.com/?p=102211
- Barco FSN multiviewer (via search summary; page 403): https://www.barco.com/nl/product/fsn-multiviewer-card-mvr
- IADS operators console thread: https://groups.google.com/g/iads/c/aD3__gCe6L0
- Going Gray (not read, 403): https://control.com/technical-articles/going-gray/
- FAA AC 25-11B (not read, 403): https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_25-11B.pdf
- Territory Studio overview: https://en.wikipedia.org/wiki/Territory_Studio
