# laneboard design: Night (tokens v2)

The rules every view keeps, and the yardstick the designer reviewer judges screenshots against.
The values live in `public/css/tokens.css` (v2, the **Night** direction picked on 2026-10-21, runs
plan §8 Q6); this page says what they are for. Every colour literal of the app sits in that one
file; `test/design-guardrails.test.mjs` and `test/tokens.test.mjs` enforce the rules below that a
test can check.

## Control room first

laneboard is read from across the room at 3 a.m. It follows the high-performance HMI idea (ISA-101):

1. **Grey unless something needs you.** Normal is quiet: grey text, grey marks, grey bars. A
   screen where nothing is wrong has no colour but the one accent.
2. **Hue and shape only for trouble.** A status colour never travels alone: it comes with its
   shape and, where there is room, a word.
3. **One accent.** Safety orange (hue 45) is spent only on selection, focus and the primary call to
   action. It never means a state.
4. **Data first.** Numbers, names and times in the mono face; no decoration, no shadows, no glass,
   no blur. Depth comes from the surface step and a 1 px border.
5. **Movement is data** (`docs/map.md`): nothing animates for decoration; transitions are opacity,
   transform and width only, ≤ 120 ms, off under `prefers-reduced-motion`.

## The colour rule

| What it means | Colour | Mark | Examples |
| --- | --- | --- | --- |
| **news**: working, idle, done, information | grey (`--text-2`, `--text-3`) | `●` working, `○` idle | a lane at work, a finished run, a new PR |
| **wants you**: a decision, an approval, stuck | amber `--p2` | `▲` | NEED, APPR, STCK, CI-F, BUDG, a run's open need |
| **broken**: blocked, down, danger | red `--p1` | `■` | BLKD, DOWN, a failed host |

- **No blue or cyan in content.** Information is grey. `--p3` (hue 220) stays defined for the old
  sheets until the taste tasks retire it from every view; new work does not use it.
- **`▲` and `■` are status shapes only.** A trend is `↑` / `↓` or a signed delta, never `▲`.
- **Green is not "ok".** `--ok` is a muted grey-green, used sparingly; the absence of colour is the
  ok state.
- A tile or count is coloured only while it is non-zero; an empty one is plain grey with no fill.
- **The header tiles are never filled.** Tile and label stay grey; only the count is coloured,
  with its shape before it: `▲ 2` amber for NEED, APPR, STCK, CI-F, BUDG and CONF, `■ 1` red for
  BLKD and DOWN, whatever the alarms' own priorities (`TILE_FIXED_P` in
  `public/js/core/alarm-tiles.js`). An unacknowledged tile adds a 1 px flashing ring in the same
  hue.
- Amber on the light canvas needs its shape or a 1 px border next to it, never a pale fill alone.
- **Board cards** (runs night 4 T15): the lane bar on a card's left edge is grey (`--line-strong`)
  and takes `--p1` / `--p2` only while the card is in trouble; the lane's own hue stays on its
  chip and rail swatch. A field with nothing to show is left out, never printed as `—`. A NEEDS
  YOU item carries its card's lamp (■ / ▲ / ● / ○) and a 1 px border, no fill.

## Type

One mono for data (JetBrains Mono 400/600) and one condensed label face (Barlow Condensed 500/600,
always uppercase with `--ls-label: 0.06em`) for labels, plates and titles. A strict scale, nothing
under 10 px:

| Token | px | Use |
| --- | --- | --- |
| `--fs-10` | 10 | legend keys, tape, micro labels |
| `--fs-11` | 11 | plates, panel titles, tile labels |
| `--fs-12` | 12 | dense data, the default body |
| `--fs-13` | 13 | comfortable data |
| `--fs-16` | 16 | inspector title |
| `--fs-20` | 20 | annunciator count on phone, KPI |
| `--fs-28` | 28 | map hero count |

Line height `--lh: 1.3`, `--lh-tight: 1.1` for one-line titles and counts.

## Rows, spacing, shape

- **Rows** 24 / 32 / 44 px (`--row-dense`, `--row-comfy`, `--row-touch`): dense from 1200 px,
  comfortable below, touch rows on a coarse pointer; `data-density` on `<html>` wins.
- **Header** 36 px, **tape** 24 px.
- **Spacing** on a 4 px grid: `--sp-1` 4 … `--sp-8` 32.
- **Radius** 2 px on everything (`--radius`), **borders** 1 px (`--bw`). No shadows.
- **Focus** is an accent outline, separate from selection (the accent corner brackets).

## Surfaces

Four steps, the same order in both themes; text and lines are one step firmer than v1.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg-sunken` | 9 % | 91 % | wells, the tape, inputs |
| `--bg-canvas` | 12 % | 95 % | the page |
| `--bg-surface` | 16 % | 99 % | panels, cards |
| `--bg-elevated` | 20 % | 100 % | floating layers: palette, inspector, sheets |

Lines are white (dark) or black (light) at 9 / 17 / 32 % (dark) and 10 / 20 / 40 % (light) for
`--line-weak`, `--line`, `--line-strong`. Text steps `--text-1/2/3` keep at least 7 / 4.5 / 3 : 1
on the canvas, the surface and the elevated layer in both themes (`test/design-directions.test.mjs`).

The dark theme is the reference. The light theme is the same design, not an inversion: same
surfaces in the same order, the status hues darkened until they keep their contrast on a light
canvas.

## Light theme

The light block of `tokens.css` is held to the dark theme's finish by numbers, not by eye
(`test/tokens.test.mjs`, the "light:" tests; the method of `docs/plans/runs/research/Q13-light-theme-from-dark.md`):

- **Text** `--text-1/2/3` keeps 4.5:1 on every surface step (sunken, canvas, surface, elevated)
  and on a selected row. Dim text is still body text.
- **Marks and counts** `--p1` / `--p2` keep 4.5:1 on every step, so a tile count is readable as
  text; `--p3`, `--accent` and `--ok` keep 3:1 as marks.
- **Status lines** `--p1-line` / `--p2-line` / `--p3-line` are a 1 px border that carries the state
  on its own (a question card, an attention chip): 3:1 on every step. They sit at 0.8 alpha in
  light against 0.5 in dark, because dark-on-light lines read fainter.
- **Weak fills** `--p1-weak` / `--p2-weak` / `--p3-weak` are never a heavier step on the canvas or
  the surface than the same fill in dark. In light red goes pink and amber goes ochre quickly; a
  fill only hints next to its shape and border, it is never the state.
- **Dim by colour, never by opacity.** A dead session or a builder that is not live is `--text-3`
  (plus the hatch for not live), not a faded card: opacity takes text under 3:1 on light.

Not settled by tokens: the lane-bar working segment and the Map's dot grid. Those are rules of
the view sheets (runs night 4 T27).
