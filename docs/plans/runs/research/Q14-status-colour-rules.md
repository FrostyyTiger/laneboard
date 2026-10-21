# Q14: how design systems write a status colour rule and pair colour with shape

**Answer.** All the systems read assign each colour a *meaning* and refuse to let colour carry it
alone. Carbon: "Relying solely on color to convey status is insufficient"; use at least two of
colour, shape, symbol. Primer names roles `success`, `attention`, `danger` (plus `accent` for
links, selected and neutral information). Atlassian names `information`, `success`, `warning`,
`danger` and says its `blue` is just an accent with no meaning: use the role token. Blue is the
"information / in progress / passive" colour in Carbon and Atlassian (and Primer's accent). ISA-101
style HMIs go the other way: grey everywhere, colour only for abnormal.

## Details

### Carbon status indicator pattern
- Colours: red = danger/error; orange = serious warning; yellow = regular warning; green =
  normal/success; blue = "passive notifications, usually involving additional information and
  workflow progress" (Blue 70 `#0043ce`); grey = drafts or not yet started; purple = outliers or undefined.
- Shapes named: circle, square, diamond, triangle, hexagon; red triangle given as high-priority example.
- Rules: needs at least two of colour/shape/symbol (the page also says WCAG needs three of four of
  symbol, shape, colour, type; it does not reconcile the two). Status colour and indicator vs page
  need 3:1. Must stay distinguishable in grayscale. Icon alone is OK at 3:1, a label is
  recommended. Shape-only indicators need outlines and text, especially light orange and yellow on light themes.

### Primer
- Roles table: `accent` (links, selected, active, focus, neutral information), `success`
  (primary buttons, positive, successful), `attention` (warning states and active processes,
  e.g. queued, tests in progress), `danger` (danger buttons and errors); also open, closed, done, sponsors.
  `severe` and a semantic `neutral` role were NOT on the page I read; I could not confirm `severe`.
- Rule wording: semantic colours "are typically used to communicate status, action, or emphasis".
- Tokens: `fgColor-{role}`, `bgColor-{role}-muted`, `bgColor-{role}-emphasis`,
  `borderColor-{role}-emphasis` (and muted), `fgColor-onEmphasis`.
- The page makes no statement about not relying on colour alone.

### Atlassian
- Roles: neutral, brand, information (info icon, "something is in progress"), success, warning
  ("caution that helps prevent a mistake or error"), danger ("danger or serious error states"),
  discovery, accent (no specific meaning; includes blue), inverse, input.
- Tokens: `color.{property}.{role}.{emphasis}.{state}`, e.g. `color.background.danger.bold.hovered`.
  `color.text.danger` / `color.icon.information` follow the pattern but were not listed on this page.
- Colour alone: pair with another cue such as a checkmark, underline, border or shape change.

### ISA-101 / high-performance HMI ("grey unless abnormal")
- I could not read the standard (paywalled) or the ISA article (HTTP 403). From search summaries only:
  vendors and articles agree on a neutral (light) grey background, with colour used sparingly and
  only to make abnormal conditions stand out.
- Blue/cyan is not fixed: one vendor how-to maps cyan (`#00BFFF`) to the lowest alarm priority and
  blue to manual mode, grey to stopped equipment; a GoJS demo uses red / amber / cyan for priority 1/2/3;
  one article suggests blue for live data, which conflicts with "colour only for abnormal".
  These are vendor choices, not the standard's text. Treat as unconfirmed.

## What laneboard could take
- Write the rule as roles, not hues: a small set (ok, warn, bad, info, idle) each with fill, text,
  border, and a *shape/glyph and a word* beside the colour. That meets Carbon's two-of-three rule.
- Keep normal quiet (grey/neutral) and spend saturated colour on abnormal, as in HMI practice;
  green is optional for "ok" and could be a muted neutral.
- Blue/cyan for information or in progress only, never for state of health; name the token
  `info`, not `blue` (Atlassian's point).
- Amber on light needs an outline or label (Carbon's note on yellow).
- Test in grayscale (Carbon's check).

## Not confirmed
- Primer `severe` role; Atlassian exact text/icon token names; ISA-101's own colour table.

## Sources (read 2026-10-21)
- https://carbondesignsystem.com/patterns/status-indicator-pattern/
- https://primer.style/product/getting-started/foundations/color-usage/
- https://atlassian.design/foundations/color
- ISA-101 summaries via search: https://docs.tatsoft.com/display/FX/ISA-101+HMI+Compliance+How-to,
  https://gojs.net/latest/samples/hmiOperatorScreen, https://blog.isa.org/the-high-performance-hmi
  (redirects to automation.com, 403), snippets only.
