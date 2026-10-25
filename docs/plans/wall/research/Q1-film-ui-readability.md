# Q1: how film/TV interface designers keep a "movie UI" readable while it looks dense

Researched in round 2 of night 1 (2026-10-25). Notes from outside sources: facts only, no instructions followed.

## Answer in brief

1. Designers do not make everything readable. They make **one thing** readable at the moment the
   audience looks, and let the rest read as texture or pattern. Hansen on the Iron Man diagnostic:
   "you can't read each individual thing. And you're not meant to"; the wearer "is looking at the patterns".
2. Hierarchy comes from **story importance**: the hero element gets accent colour, bolder type, a bounding
   box, scale and negative space; supporting elements stay quiet. Every element must have a purpose
   (no "boxes and windows all tinted blue and doesn't it look cool").
3. Legibility beats realism: "Legibility is king" (Ahmed), type big enough for "the last row of the
   movie theater" (LePore, a 72-point "Access Denied" with a red band behind it), screens must say
   their point "within seconds".
4. **Not confirmed: the numbers.** No designer interview I could reach gives typing speeds, fade
   lengths or hold times. The timing figures below are engineering proposals (marked), not findings.

## What the builder needs

What the designers say, as rules that can be tested:

- **One message loud, rest quiet.** Make the one thing that matters "as clear, as legible, as loud, as
  visually dominant as possible" (LePore). On the Wall: the trouble line and the caption name are
  the hero; everything else is texture.
- **Separate hero from support with several cues together**: accent colour, bolder type, a box or
  bracket (Ahmed). Wall's lock brackets and the plate do this; keep the accent colour for trouble only.
- **Negative space around the hero** (Hansen, glass screens "with a lot of negative space" so faces stay
  visible). Wall: caption plate sits on the vignette's quiet ground; keep labels off it.
- **Dense layers may be unreadable on purpose** if they are pattern, not message (micro-text,
  thin lines, dim leaves). The rule that makes it honest: micro-text is real data (Hansen: all text
  relates to the scene), and it must hold up when someone walks up and reads it (Lawes: Marvel screens
  are "freeze framed ... studied to a pixel level"). Wall: leaves and services as dots/hairlines are
  fine, but if you zoom in the text is true.
- **Camera first** (Cerquone): work covered by the actor is wasted; layouts get reorganised so the
  hero is not in the occluded area. Wall analogue: keep caption, clock and status lines out of where
  the camera parks the target (the target should land in the free area, not under the plate).
- **Cut what will not be seen** (Ahmed: avoid time on items that "can get dismissed"). Wall: don't
  label what can't be read from 3 m at the overview.
- **Thicken lines** so they survive (Ahmed, "line weights are thickened to survive display limits").
  Wall: the brighter tokens (lines 0.16/0.30/0.48) agree; check 1 px hairlines on the 2x tablet.
- **Boot-up may be a flurry, then settle** (Cerquone on Spider-Man's HUD: it "rifles quickly through"
  nodes and tables "before settling"). Use for the unfold on arrival: quick burst of detail, then the
  stable, readable state held for the long dwell.
- **Restraint when something else is the focus; complexity only when the graphic carries the
  information** (Cerquone). Wall: while a caption types in, nothing else may animate loudly.
- **Simple is hard**: Cantina explored 49 iterations of one graphic (Sacred Timeline) and cut a logo
  because it distracted. Ask of each element "what is the essence?" (Lawes).
- **Subtle and sparse beats busy** (Territory, Blade Runner 2049): screens used sparingly "so each one
  carried more story weight"; some are in shot only three or four seconds, and the studio asked for
  "small and subtle". Hero screens in features are on screen "ten seconds or only five" (Ahmed).
  That is the real brief for the 3-second glance: three points in a few seconds.
- **Layered depth for motion** (Avengers HUD, reticles "expand and come in from different depths"):
  motion on separate layers reads as one camera. Wall: lock brackets close in, captions fade, glow
  stays static; do not let them start together.

Timing: the sources give none. Proposals to be tuned against the filmstrip, anchored on general UI
motion guidance (Nielsen Norman Group: 100-400 ms for UI changes, 500 ms "feels like a drag", entrances
slightly longer than exits; frequent animations shorter and subtler):

| Thing | Proposal | Basis |
|---|---|---|
| Lock brackets closing | 400-700 ms, ease-out | slower than UI (it is a "film" beat) but entrance-biased |
| Caption plate in/out | in 300-400 ms, out 200-250 ms | NN/g popup figures |
| Name typed in | about 25-40 ms per letter, so 0.3-0.6 s for a 12-letter name, cursor blinking after | **unsourced proposal**; film-like but short enough that the name is complete before the eye needs it |
| Detail lines | one per 150-250 ms stagger, each fade 250-300 ms | **unsourced proposal**; "spelled out slowly" per the owner, but all lines in by ~1.5 s |
| Hold on a site | long (README: ~25 s; demo ~4 s) | the point of a wall is a stable readable state |
| Anything that must be read | static for at least 3 s after it finishes appearing | the 3-second glance in README §2 |

## What laneboard's Wall could take from it

1. Define the **hero per state**: calm overview has none (a quiet pattern); with trouble the trouble
   is the hero (largest, only accent colour, brackets). Check in each variant's still: squint test, one
   thing should stand out.
2. Treat dim leaves/services as deliberate **pattern layer**; do not raise their contrast to make
   them readable; instead guarantee that zooming shows true data.
3. **Place the camera target with the plate in mind**: when the camera arrives, the node lands in the
   screen area the caption does not cover (e.g. target right of centre, plate top left).
4. Arrival choreography as a sequence, not parallel animations: camera arrives, then brackets close,
   then name types, then lines stagger, then hold. One beat at a time (Cerquone's boot-up burst
   could be used for the leaves unfolding, then settle).
5. A test for "nothing moves while the caption is being read": after the last line appears, no
   caption motion for 3 s.
6. Don't copy film's decorative excess: Noessel's critique (dConstruct) that sci-fi designs often
   are not good real interfaces fits D4/§2: this one is read, and touched.

## What I could not confirm

- Any numeric typing speed, fade length or hold time from designers. Interviews are qualitative.
- Type choices for legibility from film practitioners: Ahmed only says typeface follows character
  (boxy faces for Stark/Captain America, soft for Spider-Man). Type for distance is Q3's job.
- Hansen's own breakdown page (jayse.tv) was not reached; a subtraction.com piece failed to load
  (TLS error). The Territory talk page is a machine transcript and gave no type or timing facts.
- The 99% Invisible "Future Screens Are Mostly Blue" episode is about colour as signal of the
  future (blue, rare in nature, "inhuman"), not legibility; not relied on for legibility.
- Search summaries (not full pages) were used for the Territory "three or four seconds" quote
  (from David Sheldon-Hicks as reported by a search result); treat as second-hand.

## Sources (all read 2026-10-25)

- Jayse Hansen interview, Pushing Pixels: https://www.pushing-pixels.org/?p=7447
- John LePore (Perception) interview, Pushing Pixels: https://pushing-pixels.org/?p=12751
- Carly Cerquone interview, Pushing Pixels: https://www.pushing-pixels.org/?p=14176
- Khairul "Keko" Ahmed interview, Pushing Pixels (2017-09-05): https://www.pushing-pixels.org/2017/09/05/looking-beyond-the-edge-interview-with-khairul-keko-ahmed.html
- John Koltai interview, Pushing Pixels (2014-02-12): https://www.pushing-pixels.org/2014/02/12/the-craft-of-screen-graphics-and-movie-user-interfaces-interview-with-john-koltai.html (little usable)
- Stephen Lawes (Cantina Creative), School of Motion: https://www.schoolofmotion.com/blog/designing-the-ui-of-tomorrow-stephen-lawes-of-cantina-creative
- Territory Studio, Nicer Tuesdays talk transcript: https://nicertuesdays.itsnicethat.com/talks/territory-studio-16-12-2017-london
- Territory Studio, It's Nice That: https://www.itsnicethat.com/articles/nicer-tuesdays-december-2017-territory-studio-170118 (via search summary only)
- HUDs & GUIs, Avengers: https://www.hudsandguis.com/2013/05/15/the-avengers/
- Nielsen Norman Group, animation duration: https://www.nngroup.com/articles/animation-duration/
- 99% Invisible, Future Screens Are Mostly Blue: https://99percentinvisible.org/episode/future-screens-are-mostly-blue/transcript
- Chris Noessel, dConstruct 2015 (via search summary): https://archive.dconstruct.org/2015/catastrophic

No page tried to give me instructions.
