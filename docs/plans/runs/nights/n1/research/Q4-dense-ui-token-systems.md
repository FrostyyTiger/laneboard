# Q4 Token systems of dense dark/light product UIs (Primer, Carbon, Grafana, Linear)

## Answer

- All four converge on a **small type scale around a 14px body** (12px for labels/captions), line
  heights on a 4px grid (18/20/22/24px), and a **4/8px spacing grid** with 2px and 6px half-steps.
- Control heights are **24/28/32/40/48px** (Primer) or 24/32/40/48px (Carbon); a dense tool lives at
  24-32px.
- Focus is a **2px ring** (Primer: width 2px, offset -2px, i.e. inside; Carbon: 2px, blue in light,
  white in dark, 3:1 contrast).
- Elevation: light themes use grey-tinted shadows at low alpha; dark themes use much higher alpha
  (0.4-1.0) plus a **1px ring** (`0 0 0 1px` border colour) because shadows barely show on dark.
  Carbon dark themes elevate by lighter layer colour, not shadow. None of the four documents a
  translucent/blurred floating layer: that part is not confirmed by any source here.
- Linear generates a theme from **three inputs (base, accent, contrast) in LCH** and derives
  surface elevation from them. That is the idea to take for laneboard's tokens.

## Details

### GitHub Primer (primitives, `--base-size-*`, MIT)

Type styles (rem at a 16px root, shown in px; the weight of body styles is not on the page):

| Style | Size | Line height | Weight |
|---|---|---|---|
| caption | 12 | 1.25 | 400 |
| body small | 12 | 1.625 | - |
| body medium | 14 | 1.5 | - |
| body large | 16 | 1.5 | - |
| title small | 16 | 1.5 | 600 |
| title medium | 20 | 1.625 | 600 |
| code block | 13 | 1.5 | 400 |
| inline code | 0.9285em | - | 400 |

- Line heights are unitless and "align to a 4px grid"; weights come from CSS variables, not raw
  numbers.
- Mono stack: `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace`.
  Sans stack starts with 'Mona Sans VF', then `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`.
- Spacing `--base-size-N` (px): 2 4 6 8 12 16 20 24 28 32 36 40 44 48 64 80 96 112 128 (and negatives).
  Layout also has stack gap/padding in condensed, normal, spacious.
- Radius: small 3, medium/default 6, large 12, full 9999.
- Focus: `--outline-focus-width` 2px, `--outline-focus-offset` -2px.
- Controls: xsmall 24, small 28, medium 32, large 40, xlarge 48.
- Overlay: offset 4px, radius 6px, padding condensed 8px / normal 16px, block padding 4px / 12px.
- Shadows (`color (alpha) x y blur spread`; light | dark):
  - resting.small: neutral13 (0.04) 0 1 1 0 + (0.03) 0 1 2 0 | black (0.6) 0 1 1 0 + (0.6) 0 1 3 0
  - resting.medium: (0.10) 0 1 1 0 + (0.12) 0 3 6 0 | (0.4) 0 1 1 0 + (0.8) 0 3 6 0
  - floating.small: ring 0 0 0 1 at 0.25 alpha, (0.04) 0 6 12 -3, (0.12) 0 6 18 0 | ring at alpha 1, (0.4) 0 6 12 -3, (0.4) 0 6 18 0
  - floating.large (modals): (0.24) 0 40 80 0 | black 0 24 48 0
  - the ring colour is `overlay.borderColor`: invisible (alpha 0) in light medium+, solid in dark.
  - Multi-layer shadows: a tight one for contact, a wide soft one for lift.

### IBM Carbon (Apache-2.0)

- Spacing `$spacing-01..13`: 2 4 8 12 16 24 32 40 48 64 80 96 160 px. The 2x Grid mini unit is 8px;
  the sizing scale is 8 16 24 32 48 64 80.
- Productive type (IBM Plex; base 14px):
  - body-compact-01 14/18 w400 ls .16px; body-01 14/20 w400 ls .16px
  - heading-compact-01 14/18 w600; heading-01 14/20 w600
  - heading-03 20/28 w400; heading-04 28/36; heading-05 32/40
  - label-01, helper-text-01, legal-01: 12/16 w400 ls .32px
  - code-01 (Plex Mono) 12/16 w400 ls .32px
  - Rule: compact variants for short component text (up to 4 lines), non-compact for paragraphs.
- Themes: White #ffffff, Gray 10 #f4f4f4, Gray 90 #262626, Gray 100 #161616 (`$background`).
  Dark layering: on Gray 100 the layers are Gray 90, 80, 70; on Gray 90 they are Gray 80, 70, 60
  (elevation by lighter surface). Tokens: `$layer`, `$layer-hover`, `$layer-selected`, `$layer-disabled`.
- Focus: `$focus` is Blue 60 in light themes and white in dark; 2px border; must reach 3:1
  contrast; an optional `$focus-inset` is added inside to reach it.
- Motion (productive): standard `cubic-bezier(0.2, 0, 0.38, 0.9)`, entrance `(0, 0, 0.38, 0.9)`,
  exit `(0.2, 0, 1, 0.9)`. Durations: fast-01 70ms, fast-02 110ms, moderate-01 150ms,
  moderate-02 240ms. Micro-interactions should stay within 90-120ms.
- Not confirmed: the `$overlay` value (the colour page lists it without a value).

### Grafana (`packages/grafana-data/src/themes`, AGPL-3.0: take numbers, not code)

- Fonts: Inter, Helvetica, Arial, sans-serif; mono Roboto Mono. Root and base size 14px.
- Variants (size/line height px, letter spacing px): xxl 28/32 (-0.25), xl 24/28, lg 22/24,
  md 18/22 (0.25), base 14/22 (0.15), sm 12/18 (0.15), code 14/16 (0.15). Sizes and line heights
  must be even integers.
- Spacing: `gridSize` 8; tokens x0_5 = 4px, x1 = 8px, x2 = 16px ... x10.
- Shadows, dark: z1 `0 1px 2px rgba(1,4,9,.75)` (on page), z2 `0 4px 8px rgba(1,4,9,.75)`
  (dropdowns, menus, tooltips), z3 `0 8px 24px rgb(1,4,9)` (modals, drawers).
  Light: z1 `0 1px 2px rgba(24,26,27,.2)`, z2 `0 4px 8px rgba(24,26,27,.2)`,
  z3 `0 13px 20px 1px rgba(24,26,27,.18)`.
- The shadow colours are the same near-black navy as Primer's dark: tint shadows to the surface
  hue rather than pure black.
- Not read: Grafana's shape (radius) and zIndex files; the fetch did not return their contents.

### Linear (blog post, no token values published)

- Themes are generated from **base colour, accent colour and contrast** in **LCH** (perceptually
  uniform), replacing 98 hand-set variables per theme; the same generator elevates surfaces
  (background, panel, dialog, modal). A contrast input gives high-contrast themes.
- Inter for body text, Inter Display for headings. The chrome accent is limited in the
  calculation to keep a neutral look. Text and icons are higher contrast than before (neutral icons).
- Not confirmed: Linear's actual px scale, radii and focus ring (not published in the source read).

## What laneboard could take

1. **Scale:** 12 / 13 / 14 / 16 / 20px type with 4px-grid line heights (16, 18, 20, 24); 14px body,
   12px labels and captions; mono 12-13px. Tabular numerals for run counters (not in the sources; a
   CSS choice).
2. **Spacing:** one 4px base with 2 and 6 as half-steps: 2 4 6 8 12 16 24 32 48. Controls 24 / 28 / 32.
3. **Radius:** 3 (chips), 6 (controls, overlays), 12 (modals), 9999 (pills).
4. **Focus:** 2px ring, solid, never removed; in dark use a light ring, in light a blue one; add a
   1px inner gap if contrast on the surface is under 3:1.
5. **Elevation:** two mechanisms by theme. Light: low-alpha multi-layer shadow (tight + wide).
   Dark: lighter surface per level (Carbon) plus a 1px border ring (Primer), shadow alpha 0.4+.
   For a translucent floating layer, no source gives values; a builder choice, test contrast of
   text on the layer over both themes.
6. **Theme from few inputs:** derive surfaces from `--base`, `--accent`, `--contrast` (Linear idea)
   with `color-mix()` or `oklch()` in plain CSS, so a theme needs three values. This fits "no build
   step" and "works with no config".
7. **Motion:** 70 / 110 / 150 / 240ms durations with Carbon's productive easings; honour
   `prefers-reduced-motion`.
8. **System fonts only** (no webfont dependency): Primer's system and mono stacks above.

## Sources (all read 2026-10-20)

- https://primer.style/product/primitives/typography/ (text styles, font stacks)
- https://primer.style/product/primitives/size/ (base-size, radius, outline, control, overlay)
- https://primer.style/foundations/typography (line heights on a 4px grid, rem units)
- https://raw.githubusercontent.com/primer/primitives/main/src/tokens/functional/shadow/shadow.json5 (shadows)
- https://carbondesignsystem.com/elements/spacing/overview/
- https://carbondesignsystem.com/elements/2x-grid/overview/
- https://carbondesignsystem.com/elements/typography/type-sets/
- https://carbondesignsystem.com/elements/color/overview/
- https://carbondesignsystem.com/elements/motion/overview/
- https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createTypography.ts
- https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createShadows.ts
- https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createSpacing.ts
- https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createTheme.ts
- https://linear.app/now/how-we-redesigned-the-linear-ui

Page-text notes: figures come from a summarising fetch tool, not a raw read of each page, so
re-check any single value before it becomes a hard requirement. No page tried to give instructions.
The shadow pages did not mention Primer's `primer.style/foundations` shadow docs; the values are
from the token source file.
