# Q3 Legibility at distance: letter size per metre, contrast, width, tracking

## Answer in brief

- The rule that recurs in the sources: cap height should subtend **20-22 arc minutes** (16-18' is the floor,
  and only with good contrast). That is cap height ≈ **0.0058-0.0064 × viewing distance** (about 1/170 to
  1/155; FAA's "1/200" is the rounded-down form). Per metre: **5.8-6.4 mm of cap height per metre**.
- Those numbers are for desk and console reading with no time limit. For a 3 s glance from across a
  room, plan on **30' (0.0087 × distance, 8.7 mm per metre)** for the one thing that must be read at the
  far distance. This 30' is my proposal, not a sourced number (ISO 9241-303 gives a maximum of about 30' for
  comfortable reading, per a secondary source; the 3 s case is not in anything I could read).
- Contrast: WCAG's 4.5:1 (AA) and 7:1 (AAA) are derived from visual acuity. For text on a dark ground
  aim at **7:1 or more** for anything read at the far distance.
- **Not confirmed:** a sourced answer on condensed vs normal width, and on tracking for caps. See the end.

## What the builder needs

### Cap height per distance (arithmetic: H = D × tan(angle); 1' = 0.000291 rad)

| Distance | 16' (floor) | 20' | 22' | 30' (glance, proposal) |
|---|---|---|---|---|
| 1 m | 4.7 mm | 5.8 mm | 6.4 mm | 8.7 mm |
| 2 m | 9.3 mm | 11.6 mm | 12.8 mm | 17.5 mm |
| 3 m | 14.0 mm | 17.5 mm | 19.2 mm | 26.2 mm |

### In pixels (my arithmetic from the panel sizes in the question)

- 12.3" 2736x1824 (3:2): diagonal 3288 px / 12.3" = 267 ppi = **10.5 device px per mm**
  (panel about 260 x 173 mm).
- 24" 1920x1080 (16:9): 2203 px / 24" = 92 ppi = **3.6 device px per mm** (panel about 531 x 299 mm).

| Cap height in device px | 16' | 20' | 22' | 30' |
|---|---|---|---|---|
| Tablet at 1 m | 49 | 61 | 67 | 91 |
| Tablet at 2 m | 98 | 122 | 135 | 183 |
| Tablet at 3 m | 147 | 184 | 202 | 275 |
| 24" at 1 m | 17 | 21 | 23 | 31 |
| 24" at 2 m | 34 | 42 | 46 | 63 |
| 24" at 3 m | 51 | 63 | 69 | 95 |

- CSS px = device px / devicePixelRatio. I did not confirm the DPR the tablet reports; the builder should
  read `devicePixelRatio` and compute from mm, not from px tables.
- Font size from cap height: most sans fonts have a cap height of about 0.70-0.73 em (general
  typography knowledge; check the chosen font's metrics). `font-size ≈ cap height / 0.7`.
- What this means for the tablet: at 3 m, a 20' cap height is 184 px on a 1824 px tall screen, 10% of the
  height. So at 3 m the tablet can carry only a handful of text lines. The 3 m reading on the tablet has
  to be **shape and colour** (which site is wrong, what colour) plus one or two big words. Names
  and numbers belong at 1 m (61-91 px cap height, about 4-5% of the height), which gives ~10-15 text rows.
- On the 24" screen, 3 m at 20' needs 63 px cap height, 5.8% of the height: a few dozen labels of that
  size do not fit. Same conclusion: three tiers (3 m / 1.5 m / 0.6 m) with different content.

### Other rules of thumb in the sources

- Bond rule (cited in a legibility review): character height = 0.007 × distance (≈ 24').
- 16' minimum "easily readable", 20' optimal; factor 215 when distance is in inches (vendor paper for control
  room video walls, via search summary; I could not read the PDF body).
- German workplace standard (1980s paper): 18' or 2.6 mm minimum at the desk.
- Roads (FHWA-HRT-15-027, outdoor matrix signs, uppercase, 6 drivers): 40-45 ft of legibility per inch of
  letter height for normal vision, ≈ 20 ft/in at 20/40 acuity; MUTCD uses 30 ft/in. That is 1/480 to
  1/360 of the distance, i.e. 7-10', far below the screen rules. It is for bright, bold, high-contrast signs
  seen by drivers and tells us the real limit is lower than the desk rule, but do not design to it: a
  tablet in a dim room has weaker contrast and viewers have lower acuity than the study's sample.
- Case: an all-caps study (Garvey, Penn State, 34 fonts) found upper case more legible in all 31 fonts that
  had both, more than 5 ft extra distance in 16 of 31 (via search summary, not read in full). Caps help
  for the short status words.

### Contrast on a dark ground

- WCAG 2.2 SC 1.4.3: 4.5:1 normal text, 3:1 large text (18 pt = 24 px, or 14 pt bold = 18.5 px).
  Rationale: ISO 9241-3 and ANSI/HFES 100 recommend 3:1 for normal vision; 20/40 acuity loses a factor of
  about 1.5, hence 4.5:1; 20/80 gives about 7:1 (AAA).
- The WCAG "large text" 3:1 is a floor for text that is 24 px on a desktop at 50-60 cm. At 3 m a 63 px
  cap-height text is far larger than that in angle terms, but the view is also dimmer and fuzzier
  (distance blur, glare in a lit room). Proposal: **7:1 for text read at the far distance, 4.5:1 for
  anything else, 3:1 for non-text shapes** (WCAG 1.4.11 non-text contrast is 3:1; not re-read for this note).
- A 1959 SMPTE study found black-on-white and white-on-black about equally visible; a legibility review says
  positive polarity (dark on light) tolerates thinner strokes than negative. Light on dark therefore wants
  somewhat heavier strokes, not hairlines (read from summaries only).
- Colour as a trouble signal: luminance contrast of the *colour* against the ground counts, not hue. A
  dark red or blue on near-black can pass nothing; test each state colour against the ground at 3:1+ and
  also never use hue as the only cue (this is general practice; not tied to a source I read here).

## What laneboard's Wall could take from it

1. Define three type tiers by *angle*, in CSS from physical size: the Wall measures
   `window.innerHeight` and takes a "screen height in mm" setting (tablet 173 mm, 24" 299 mm), then
   sets `--cap-far` = 30' at 3 m (26 mm), `--cap-mid` = 22' at 1.5 m (9.6 mm), `--cap-near` =
   20' at 0.6 m (3.5 mm). Without the setting, default for the tablet.
2. Tier far (3 m): trouble word or count, site name of the site that is wrong, lock state. Max about
   five items on screen at once.
3. Tier mid (1.5 m): site names, node names of the trouble nodes. Tier near (0.6 m): everything else:
   addresses, ages, small ids (these may be below the 16' floor beyond 1 m; accept that).
4. Anything under 16' at its intended distance is decoration (no information in it). A test can check
   computed font sizes of labels flagged `data-tier` against these floors.
5. Text colours: far tier at 7:1 against the ground; a test computing WCAG contrast from the CSS
   variables of the state colours against `--ground` is cheap and catches a regression.

## Not confirmed

- **ISO 9241-303 and ISO 24509 text:** paywalled; the 16/20/22/30' figures come from secondary sources
  (a W3C list post summary, a handbook chapter, a vendor paper) that disagree slightly on the floor
  (16 / 18 / 20').
- **FAA HF-STD-001 and MIL-STD-1472 clauses:** not found; "1/200" is quoted second-hand.
- **Condensed vs normal width:** the HFES 2017 paper (Sawyer) hypothesises non-condensed is more legible but I
  could not read its results (PDF unreadable to the fetch tool); Beier's work says narrow letters gain
  from being widened. Weak support only: prefer a normal-width face for the far tier; a condensed face
  is acceptable at mid/near tiers where it saves space.
- **Tracking for caps:** no source found. General typographic practice is open tracking for caps in small
  sizes; as a proposal, start at +0.04 to +0.08 em for the far tier and test by eye on the film.
- **Glance (3 s) specific sizes:** none found; the 30' is a proposal.
- The DPR of the tablet.

## Sources (read 2026-10-26 unless noted)

- WCAG 2.2 Understanding SC 1.4.3 Contrast (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- FHWA-HRT-15-027 ch. 3 Legibility Testing (Nov 2015): https://www.fhwa.dot.gov/publications/research/safety/15027/004.cfm
- W3C WAI-IG list, Steve Green on ISO 9241-303 applicability (Nov 2023; the page gives no arc-minute numbers,
  those came from a search summary of a neighbouring post): https://lists.w3.org/Archives/Public/w3c-wai-ig/2023OctDec/0054.html
- ISO 9241-303:2011 preview (not read past the front matter): https://webstore.ansi.org/preview-pages/ISO/preview_ISO+9241-303-2011.pdf
- German workplace standards paper, 18' / 2.6 mm: https://people.freebsd.org/~debdrup/German%20Workplace%20Standards.pdf (search summary only)
- Handbook chapter quoting FAA 1/200 and 20-22' / 16-18': https://www.taylorfrancis.com/books/e/9781315098128/chapters/10.1201/b22361-52 (search summary only)
- Activu, Optimal Font Size (2014; control room walls): https://activu.com/uploads/Optimal-Font-Size.pdf (PDF body unreadable; search summary only)
- SMPTE 1959 televised characters legibility: https://journal.smpte.org/periodicals/Journal%20of%20the%20SMPTE/68/7/6/ (summary only)
- TRID legibility review (Bond rule 0.007, polarity): https://trid.trb.org/View/451821 (summary only)
- Sawyer, HFES 2017 (hypotheses on condensed): https://flatisbad.com/resources/Sawyer-HFES17.pdf (PDF unreadable; search summary only)
- Beier, Typeface Legibility (2009): https://rca-9.eprints-hosting.org/957/1/Sofie_Beier_Typeface_Legibility_2009.pdf (summary only)
- Garvey, Penn State fonts study: via shareok.org IJSW summary https://journals.shareok.org/ijsw/article/download/3/1/7
- Pixel densities and the angle table: my own arithmetic.
- No page tried to instruct me.
