# Q13: building a light theme that matches a dark-first one

**Answer.** Mature systems do not invert the dark theme. They keep the same *roles* (canvas, raised
surface, border, text, status) and give each role a separate value per mode, chosen so the contrast
target holds on that canvas. Radix targets APCA Lc 60 (low-contrast text) and Lc 90 (high-contrast
text) on the step-2 surface. Carbon keeps the same warning yellow in all four themes but darkens or
lightens red, green and blue per mode. Grafana keeps the same amber fill in both modes but uses a dark
orange-brown for amber *text* on light (`#B04E0C` against `#fbad37` on dark). For laneboard: a
light canvas near-white with a slightly grey raised layer, borders as alpha of the text colour,
and a darker text-variant of every status colour.

## Details

### Radix Colors (12-step scale)
- Step roles: 1 app background, 2 subtle background (interchangeable with 1; cards, sidebars,
  striped tables), 3 component background, 4 hovered, 5 active/selected, 6 subtle border
  (non-interactive: cards, separators), 7 subtle border on interactive, 8 stronger border / focus
  ring, 9 solid fill (highest chroma), 10 hovered solid, 11 low-contrast text, 12 high-contrast text.
- Contrast: steps 11 and 12 are "guaranteed to Lc 60 and Lc 90 APCA contrast ratio" on a step-2
  background of the same scale. The page gives no WCAG number.
- Light and dark are separate scales with the same step meanings. The page suggests a white app
  background in light mode and step 1 or 2 of a grey scale in dark mode, via an alias per mode.
- Yellow and amber (with sky, mint, lime) are the scales where step 9 and 10 take *dark* text,
  not white: a light-canvas yellow badge needs dark text, not the dark theme's light text.

### IBM Carbon (white, g10, g90, g100), values from `@carbon/themes` 11
| token | white | g10 | g90 | g100 |
|---|---|---|---|---|
| background | #ffffff | #f4f4f4 | #262626 | #161616 |
| layer-01 | #f4f4f4 | #ffffff | #393939 | #262626 |
| border-subtle-01 | #c6c6c6 | #e0e0e0 | #6f6f6f | #525252 |
| text-primary | #161616 | #161616 | #f4f4f4 | #f4f4f4 |
| text-secondary | #525252 | #525252 | #c6c6c6 | #c6c6c6 |
| support-error | #da1e28 | #da1e28 | #ff8389 | #fa4d56 |
| support-warning | #f1c21b | #f1c21b | #f1c21b | #f1c21b |
| support-success | #24a148 | #24a148 | #42be65 | #42be65 |
| support-info | #0043ce | #0043ce | #4589ff | #4589ff |
- Surface steps: on g10 the page is grey and the *raised* layer is white (layer lighter than the
  page); on g100 the page is darkest and layers get lighter. So "raised = lighter" holds in both.
- The status hues are the same family in both modes, shifted: red 60 / green 50 / blue 70 on light,
  lighter tints (red 50, green 40, blue 50) on dark.
- Warning yellow is not darkened. A third-party package doc (not IBM) lists it at about 1.68:1 on
  white; Carbon relies on shape and label next to it (see Q14), not on colour contrast.

### GitHub Primer
- "The light and dark neutral scales are inverted, so both themes can share many functional tokens
  without custom overrides." Functional tokens change value with colour mode.
- Neutral minimums: step 8 for interactive control borders against `bgColor-muted`; step 9 for
  text on steps 0-4, step 10 for steps 5-6. High-contrast themes aim for 7:1 for most text.
- Semantic foreground/text/icon colours are adjusted per theme for contrast; no per-mode values on
  the page I read.

### Grafana (`createColors.ts`, `palette.ts`)
| token | dark | light |
|---|---|---|
| background canvas / primary / secondary | #111217 / #181b1f / gray15 | #fbfbfb / #ffffff / #f4f5f5 |
| text primary | rgb(204,204,220) | rgb(36,41,46) |
| text secondary | that colour at 0.65 alpha | 0.75 alpha |
| border weak / medium / strong | text colour at 0.12 / 0.20 / 0.30 | text colour at 0.12 / 0.30 / 0.40 |
| warning main / text | #ff9900 / #fbad37 | #ff9900 / #B04E0C |
| error main / text | #d10e5c / redDarkText | #e0226e / #cf0e5B |
| success main (light) | | #1b855e |
| info main (light) | | #3871dc |
- Notes: borders are alpha of the text colour, and the light alpha steps are *higher* for medium and
  strong (0.3, 0.4 vs 0.2, 0.3) because dark-on-light lines read fainter. `contrastThreshold` 3 in
  both modes; `tonalOffset` 0.15 dark, 0.2 light (light derives hover/shade variants further).
- Amber is the one status that needs two values: the fill stays, the *text* goes dark orange-brown.

### WCAG 2.x vs APCA numbers seen
- WCAG 2.x: 4.5:1 body text, 3:1 large text and non-text UI (Carbon's status guidance uses 3:1 for
  status colour and indicator against the page; Primer high-contrast aims 7:1).
- APCA (Radix): Lc 60 low-contrast text, Lc 90 high-contrast text. I did not find an APCA number
  from Carbon, Primer or Grafana.

### What reads worst when a dark design is inverted (synthesis, not a quote)
These are my inferences from the tables above, not claims from the sources:
1. Amber/yellow: the same hue that glows on dark is near-invisible as text on white (Carbon's
   yellow is ~1.7:1 on white). Needs a darker text variant (Grafana) or a dark text on a yellow fill (Radix).
2. Shadows and glows used for depth on dark do nothing on light; borders take over (hence Grafana's
   stronger alpha borders on light).
3. Thin, low-alpha borders and "dim" secondary text lose contrast faster on light.
4. Fully saturated fills (red, green) that look calm on dark look loud on white; Carbon and Grafana
   use deeper, less luminous versions.
5. "Raised = lighter" flips: on light, raised surface is white on a grey page (Carbon g10) or equal to the page with a border.

## What laneboard could take
- Keep the roles the same; give each a light value. Light canvas near `#f4f4f4`/`#fbfbfb`, raised
  layer white, text near `#161616`/`#24292e`, secondary text about 0.75 alpha or `#525252`.
- Borders as alpha of the text colour with higher alpha on light.
- Two values per status colour where needed: fill and text. Amber text on light about `#B04E0C`.
- Check every pair with a script (WCAG 4.5:1 text, 3:1 for non-text; APCA Lc 60 for secondary text
  if wanted) instead of by eye.

## Not confirmed
- Primer's actual light/dark hex values for attention/danger (the page gives rules, not values).
- Radix's WCAG equivalents for Lc 60 / 90 (not published on the page read).
- Carbon's own warning contrast number (only a third-party figure).

## Sources (read 2026-10-21)
- https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- https://unpkg.com/@carbon/themes@11/lib/index.js (generated theme values; first 100000 chars read)
- https://primer.style/product/getting-started/foundations/color-usage/
- https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createColors.ts
- https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/palette.ts
- https://carbondesignsystem.com/patterns/status-indicator-pattern/ (3:1 rule)
- Yellow ~1.68:1 figure: search snippet of https://socket.dev/npm/package/@polyxd/ds-carbon (third party, unverified)
