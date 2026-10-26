# Q2 Calm technology and ambient displays: glanceable until something is wrong

## Answer in brief

- A screen in a room all day should live in the periphery: steady, low-contrast-of-change, nothing
  moving that carries no meaning. Weiser and Brown's test is the engine noise: you ignore it until it
  changes, and then you notice at once. The Wall's healthy state must be that steady hum.
- Trouble moves the screen from periphery to centre by a change in the thing already attended to
  (a node's colour, a new element appearing), not by a banner or a screen-wide effect. An abrupt onset
  of a new object is the strongest involuntary attention cue known in vision research, so keep it for
  trouble only.
- Escalate in steps (see table). The person, not the screen, decides when to look closer
  (Weiser and Brown: the individual must be in charge of moving things between centre and periphery);
  for the Wall this means the screen never takes over the view by itself for something minor.
- Motion budget: the healthy Wall may move slowly and continuously (it must look alive), but at most a
  few things should change per second, nothing should flash, and nothing meaningful should be shown
  by motion alone.
- **Not confirmed:** there is no source with a number for "how much ambient motion is too much" for
  a room screen. The numbers below are WCAG limits (a hard ceiling) plus proposals, marked as such.

## What the builder needs

### Principles (from the sources)

1. Centre and periphery. "Calm technology engages both the center and the periphery of our
   attention"; periphery is "what we are attuned to without attending to explicitly"; a calm
   technology "will move easily from the periphery of our attention, to the center, and back."
   The Wall serves both: from 3 m the periphery reading (one colour, one shape that is wrong), from
   1 m the centre reading (names, numbers).
2. Change is the signal. In the engine-noise example the cue is that the usual thing is different.
   So a steady background (no ambient flicker, no looping effects on healthy nodes) is what makes a
   change legible. Every constant animation lowers the contrast of the next real change.
3. Gray/quiet is normal; colour, motion and blinking are for abnormal. This is the common reading of
   ISA-101 style "high performance" HMI practice (vendor and trade-press sources only; I did not read
   the standard, which is paid). Practitioners also say that grayscale itself is a misconception:
   the point is contrast that works in the room's light, with colour added for meaning
   (Control Engineering interview). Take: healthy = desaturated, trouble = the only saturated hue.
4. Attention capture. Yantis and Jonides (1984, 1988): a new object appearing abruptly captures
   attention in visual search, while a colour or brightness difference alone did not in their setup.
   Folk, Remington and Johnston (1992) countered that capture also depends on what the observer is
   looking for, and colour can capture too. Use: a new problem should appear (grow in, abruptly
   enough to be seen, e.g. a ring that expands from the node), not merely recolour; resolved problems
   should fade, not appear (fading is not an onset).
5. Do not rely on colour alone (WCAG 1.4.1; also noted in HMI sources): trouble also needs shape or
   position or size change, which is also what makes it legible at 3 m.

### Escalation steps (proposal, not from a source)

| level | state | what shows | motion |
|---|---|---|---|
| 0 | all good | calm Map, dim, slow drift of the camera only | none on nodes; camera < 1 px/s equivalent; no per-node loops |
| 1 | notice (a warning, one node) | node colour shifts to the warning hue, 1 slow ring pulse on arrival | one onset ring, 1 s, then still |
| 2 | trouble (down, lock) | saturated hue, larger node/ring, label shown at reading size; camera tour moves to it next | ring repeats slowly (period >= 2 s), see limits |
| 3 | many things wrong | the trouble list takes the strip; the tour stays on trouble | still no flash; more things, not faster things |

Do not add a "demand action" level with full-screen takeover: the Wall is a viewing screen and the
finger takeover is a user act. Matthews et al.'s toolkit (UIST 2004) frames the design problem as
abstraction of data, choice of notification level, and transitions between levels; I could not read the
paper's level names, so the table above is my own, not theirs.

### Hard limits and numbers

- WCAG 2.3.1: no more than 3 flashes in any one second, unless below the flash thresholds. A general
  flash is a pair of opposing relative-luminance changes of 10% or more of max luminance (darker state
  below 0.80); red flash is a pair of transitions involving saturated red. Area threshold: combined
  flash area under 0.006 sr, about 25% of a 10 degree field, i.e. 341 x 256 CSS px on a 1024 x 768 reference
  (87,296 px). Keep trouble pulses at period >= 1 s (1 Hz, well below 3/s) and small. A red ring pulse
  is the riskiest case; use slow luminance change, not on/off.
- WCAG 2.2.2: moving, blinking, scrolling content that starts automatically, lasts more than 5 s and
  sits next to other content needs a way to pause/stop/hide, except where essential; auto-updating
  content needs the same, with no 5 s exemption. The Wall is a live monitoring view, which
  plausibly counts as essential, but the Reduced motion option (README D5) and a touch to pause are
  the cheap, honest answer. (This is my reading, not legal advice.)
- Proposed motion budget (not sourced): at most about 3 simultaneous moving elements besides the camera;
  onset 300-600 ms; fades of resolved states 1-2 s; no loop shorter than 2 s except the arrival ring.

## What laneboard's Wall could take

1. Healthy nodes get no animation at all. Life comes from the camera tour and from real data events
   (a message dot, the extras glow from T2 should be very slow, if it moves).
2. Two kinds of change, both only on real events: onset (new trouble: ring expands from node, once)
   and settle (resolved: fade over 1-2 s). Test: with zero events the frame diff over 10 s is
   small (the camera only).
3. Trouble uses hue plus shape plus size plus label (never hue alone). The label of a trouble node
   appears; healthy labels may be dimmer or absent at distance (ties to Q3).
4. The camera tour visits trouble first, then returns to the wide shot; a person's touch stops the
   tour (the individual is in charge) and it resumes after a delay (Q6 gives timeouts).
5. A test for the budget: count nodes with a running animation when the demo has 0 problems (expect 0)
   and with 1 problem (expect 1-2 elements).
6. The 4x CPU-throttled film (fps >= 27) doubles as a check that calm is not paid for by a busy renderer.

## Sources

- Weiser, M. and Brown, J. S., "Designing Calm Technology" (1995/96), as hosted at
  https://calmtech.com/papers/designing-calm-technology , read 2026-10-25 (quotes above are from it).
- WCAG 2.2 Understanding SC 2.2.2 Pause, Stop, Hide:
  https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html , read 2026-10-25.
- WCAG 2.2 Understanding SC 2.3.1 Three Flashes or Below Threshold:
  https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html , read 2026-10-25.
- Yantis, S. and Jonides, J. (1984, 1988) on abrupt onsets, via search results only (abstract level):
  https://pubmed.ncbi.nlm.nih.gov/2137514/ , and Folk, Remington and Johnston (1992) as described there;
  read 2026-10-25. I did not read the full papers.
- Matthews, Dey, Mankoff, Carter, Rattenbury, "A toolkit for managing user attention in peripheral
  displays", UIST 2004: https://www2.eecs.berkeley.edu/Pubs/TechRpts/2003/5782.html (abstract only),
  read 2026-10-25. The full-text PDFs (Berkeley EECS-2006-113, Stasko et al. AVI 2006, Microsoft
  "ambientable") came back as unreadable binary through my fetch tool; not used.
- Mankoff et al., "Heuristic Evaluation of Ambient Displays", CHI 2003, doi 10.1145/642611.642642
  (abstract level via search); heuristic names not confirmed.
- ISA-101 style practice, secondary only: Control Engineering "High-performance HMIs":
  https://www.controleng.com/high-performance-hmis-designs-to-improve-operator-effectiveness/ ;
  GoJS demo https://gojs.net/latest/samples/hmiOperatorScreen ; read via search summaries 2026-10-25.
  The standard text itself was not read.

## Could not confirm

- A published figure for acceptable ambient motion on an always-on screen.
- The notification-level names in Matthews et al. and the Mankoff heuristics' wording.
- Whether ISA-101 itself prescribes grey backgrounds (secondary sources say it leans that way).
