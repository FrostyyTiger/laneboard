# Q6 Touch on wall and kiosk screens

Read 2026-10-26. For night 2 (touch explorer).

## Answer

1. Size touch targets by millimetres, not pixels: **10 mm minimum, 15-20 mm for the main actions, about 2 mm
   gaps** (NN/g). WCAG 2.2 only gives CSS-pixel floors (24 px AA, 44 px AAA), which are too small for a
   tablet on a wall viewed by strangers.
2. Use only the standard gestures (tap, drag to pan, pinch to zoom) and give each a visible button
   (back, +, -, home). Never make a gesture the only way to do something.
3. Idle: vendors default to **30-60 s** before a kiosk resets to its start view. These are product
   defaults, not research. The setting trades being rushed against leaving a stranger's state on screen.
4. "Touch to explore": a short call-to-action is the usual baseline. One study (Müller et al., CHI 2012)
   found showing passers-by their own reflection beat a call-to-action, which does not fit a status wall.
   Keep it to one quiet line plus a gentle motion cue, and hide it while trouble is shown.

## What the builder needs

### Target sizes for the Wall tablet (arithmetic, mine)

The reference tablet is 2736x1824 at 12.3", so the diagonal is 3288 px and the density is about 267 ppi
(0.095 mm per device px). If the browser runs at 200 % scale, the viewport is 1368x912 CSS px, the same
width `shoot.mjs` uses, and 1 CSS px is about 0.19 mm. I did not confirm the scale factor the tablet
reports. Check `devicePixelRatio` on the real device.

| physical size | CSS px at 267 ppi, dpr 2 | 24" 1080p (92 ppi, dpr 1) |
|---|---|---|
| 7 mm (finger-contact floor) | 37 | 25 |
| 10 mm (NN/g minimum) | 53 | 36 |
| 15 mm (main controls) | 79 | 54 |
| 20 mm (NN/g primary example) | 105 | 72 |
| 2 mm gap | 10 | 7 |

- Build with `rem`/`px` values chosen for the tablet, and check them with `matchMedia('(pointer: coarse)')`.
  Do not assume a 1080p wall screen is touch at all.
- The mosaic tile (Q5) is probably under 10 mm at 100-150 nodes. The hit area may be larger than the drawn
  tile, or a tap may zoom to the site first (see below).
- Fingertips are 16-20 mm wide, thumbs about 25 mm (NN/g, citing the MIT Touch Lab). A strip of controls
  along the screen edge works better than small icons in the picture.

### Gestures

- Apple's HIG advice: use the standard gestures, make them discoverable, prefer standard controls over
  custom gestures, and always give a visible alternative. I read this through a summarising tool, not the
  full page. Treat the wording as unconfirmed.
- Suggested set: tap a site to fly there (the camera tour already knows the move), tap a node for its
  card, a `Back` button always visible once zoomed, pinch and drag allowed but never needed, and double
  tap not used.
- A tap on empty space should do nothing, not reset. Accidental brushes by passers-by are common.

### Idle timeouts

- Defaults seen: 30 s (Kiosk Group, recommends 30-60 s), 60 s (another kiosk platform), 5-30 s (visitor
  check-in). Library patron kiosks suggest 5-15 min for long sessions.
- Each touch restarts the timer, and expiry returns to the home view (Kiosk Pro).
- A proposal for the Wall: 45 s after the last touch go back to the tour, with a quiet 5 s shrinking line
  as warning. If trouble appears, the tour wins at once, because readable trouble comes first (README §2).
  The 45 s is my choice from the 30-60 s range, not a sourced value.

### "Touch to explore" without clutter

- Müller et al. (CHI 2012) describe the *landing effect* (people notice a display is interactive late and
  walk back) and the *honeypot effect* (people crowd behind someone already interacting). Both suggest the
  invitation must be visible from a few metres and must stay visible while somebody uses the screen. I
  could not read the PDF text, so the +90 % (mirror image) and +47 % (silhouette) figures come from the
  search summary only.
- A text call-to-action such as "touch screen to begin" is the common baseline in that study.
- Proposal: one line in the caption area, "Touch to explore", at the grey kicker level. Pulse a ring on
  one non-trouble site every ~20 s. Remove the line for good during a session, and bring it back at reset.

## What the Wall could take

1. A `touch.css` block in `wall.css`, behind `@media (pointer: coarse)`, that sets `--hit: 10mm` for all
   controls and `15mm` for Back. CSS `mm` is unreliable on browsers, so also set a px fallback from the table.
2. A hit-area layer: invisible circles of at least 10 mm over each tile, with the site as a fallback.
3. Idle logic: one timer, reset on `pointerdown`, 45 s, returns to the tour. Trouble overrides it.
4. Test: a unit test that every `[data-touch]` control has a hit size of at least the 53 px (tablet) value.

## Could not confirm

- The tablet's real `devicePixelRatio` and CSS viewport.
- Apple's and Google's own pages (44 pt / 48 dp, "about 9 mm"): only secondary blogs came back. The
  9 mm claim is approximate and varies by device.
- Any research on idle timeouts. All numbers are vendor defaults.
- Whether a text call-to-action beats other invitations on a status display: no direct study found.
- `design.cms.gov` idle-timeout page gives no timings (only that it warns in a modal), so it is not evidence
  for a number.

## Sources

- W3C, Understanding SC 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html (2026-10-26). 24x24 CSS px, five exceptions, no physical size.
- WCAG 2.5.5 Target Size (Enhanced), 44x44 CSS px: only secondary sites, e.g. https://www.disabilityworld.org/toolkit/standards/wcag/2-5-5-target-size-enhanced/ (2026-10-26).
- Nielsen Norman Group, Touch Target Size: https://www.nngroup.com/articles/touch-target-size/ (2026-10-26). 1 cm minimum, 2 cm example, 2 mm gaps, fingertip 1.6-2 cm.
- Apple HIG Gestures: https://developer.apple.com/design/human-interface-guidelines/gestures (2026-10-26, via summary only).
- 44 pt / 48 dp / "about 9 mm": https://blog.openreplay.com/improving-tap-targets-mobile-ux/ and https://frontendchecklist.io/rules/accessibility/touch-targets (2026-10-26, secondary).
- Kiosk idle defaults: https://support.kioskgroup.com/article/991-idle-time-limit, https://touchscreenwebsite.com/blog/school-touchscreen-idle-timeout-policy-public-recognition-displays/ (2026-10-26, vendor docs).
- Müller et al., "Looking Glass" CHI 2012: https://www.medien.ifi.lmu.de/pubdb/publications/pub/mueller2012chi/mueller2012chi.pdf (2026-10-26, abstract-level via search only; PDF text unreadable).
- US CMS design system, idle timeout: https://design.cms.gov/components/idle-timeout/ (2026-10-26).

No page tried to instruct me.
