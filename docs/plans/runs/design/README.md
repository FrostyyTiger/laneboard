# Design directions, night 1 (runs plan T10)

**Picked: `night.css`** (§8 Q6, 2026-10-21). It is folded into `public/css/tokens.css` v2 (night 4
T11) and its rules are written in `docs/design.md`; "as now" below means tokens v1. Laid over v2,
`night.css` changes nothing; `test/design-directions.test.mjs` checks every value it sets is in
`tokens.css`.

README §5 and §8 Q1: keep the control-room logic (grey unless something needs you, hue and shape
only for trouble, one accent, data first) and raise the craft. These are three ways to do that,
for the owner to pick one in the morning. The pick becomes `public/css/tokens.css` v2 and a short
`docs/design.md`.

Each direction is a **token override file**: it is laid over `public/css/tokens.css` and only
sets custom properties that file already defines, under the same selectors, in both themes. No
sheet changes, so every view changes at once and nothing else can break.
`test/design-directions.test.mjs` checks that, the design guardrails, the 4 px grid, an ascending
type scale and the contrast floors of `test/tokens.test.mjs` (now also on the surface and the
elevated layer, not only the canvas).

| | `refined.css` | `product.css` | `night.css` |
| --- | --- | --- | --- |
| Idea | the console as it is, cleaner | product-grade calm (GitHub, Linear) | the wall screen at 3 a.m. |
| Label face | Barlow Condensed (as now) | the system sans (`system-ui`), no webfont | Barlow Condensed |
| Type scale (px) `fs-10…28` | 11 11 12 14 16 20 28 | 11 12 13 14 16 20 28 | 10 11 12 13 16 20 28 (as now) |
| Line height | 1.4 | 1.45 | 1.3 |
| Rows dense / comfy / touch | 28 / 36 / 44 (as now) | 32 / 40 / 48 | 24 / 32 / 44 |
| Header | 40 | 48 | 36 |
| Radius | 2 px | 4 px | 2 px |
| Surfaces | clearer 4 % steps, firmer strong line | a cool grey base (hue 260), each layer lighter in dark, white on grey in light | deeper dark canvas, everything one step firmer |
| Text | as now | a little brighter in dark | brighter in dark, darker in light |

## Why

- **refined:** the smallest change that fixes what reads worst today: 10 px text (legend keys,
  the tape) goes to 11 px, the comfortable data step goes to 14 px (the body size Primer, Carbon
  and Grafana use, research/Q4), and the surface steps are far enough apart to see a floating
  layer's edge without a shadow.
- **product:** what §5 calls "one family with a real range of weights": the system sans has
  them on every OS without a download, and it drops the uppercase-condensed plant-floor look.
  Rows at Primer's control heights (32/40/48) and a 14 px body make it calmer and less dense.
  The theme is a cool grey with the same orange accent.
- **night:** the opposite trade: more rows on one screen (24 px dense rows, a 36 px header) and
  more contrast to pay for the smaller targets, for a screen read from across the room.

## View one on the demo

```sh
node test/tools/demo-fleet.mjs --design refined     # or product, night
```

Then open the URL it prints (`http://127.0.0.1:7795/`). The demo's forwarder appends the file to
`/css/tokens.css`, so the whole app wears it; switch the theme in the app to see both. Without
`--design` the demo is the app as it is. The demo is a hub with fake builders: Board, Map, Inbox
and Packages have data; the Runs view is builder-only and shows its note there.

There are no screenshots: the run VM has no browser (see "For the owner" in `../PROGRESS.md`).

## What a token file cannot do (needs sheet changes after the pick)

- **Focus ring:** `base.css` draws a 1 px accent outline; the research (Q4) points to 2 px. That is
  a rule, not a token.
- **Elevation shadow:** `product.css` sets `--shadow-float` for the palette, inspector and sheets,
  but no sheet uses it, and guardrail 3 (`test/design-guardrails.test.mjs`) forbids `box-shadow`.
  Taking it means allowing `box-shadow: var(--shadow-float)` on floating layers only.
- **Translucency** (§5) is not in any direction: guardrail 2 forbids `backdrop-filter`, and no
  source in research/Q4 gives values for it.
- **Motion** (§5 says 150-300 ms) is untouched: guardrail 6 caps transitions at 120 ms.
- **Density modes** stay as they are (`data-density` and the media queries in `tokens.css`);
  the directions only change the row heights those modes pick from.
