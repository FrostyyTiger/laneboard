# Section 4: Industrial design system, app shell, navigation

**Integration notes (integrator):**
- Paths follow §1's split: CSS is already in `public/css/**` (F2) and the map code in `public/js/views/map-canvas.js` (F1), which §5 splits into `public/js/views/map/*`. `public/styles.css`/`public/map.css`/`public/map.js` no longer exist when these tasks run; "cut down styles.css" means restyling the per-area files F2 created.
- The `/vendor/*` fall-through in `server/http.mjs` moved to §1 F1; this section edits no server file.
- T4.10 (map chrome) is folded into §5: M3 (palette from tokens, flat dot grid, brackets, no glass/vignette, `map-needs` panel removed) and M4 (`setInsets`, `selectNext`, `focusFind`, removal of the map's own `onKey`). D8 registers the map-scoped keys and calls those methods.
- This section's hotkey map is authoritative. Added rows: `o`/`O` (map overlay next/prev, §5), view-scoped `a d r p` in Inbox (§8: approve, deny, release, pause), `c` in Diff (§10: comment); a view-scoped binding wins over the global one while that view is active. `\` split state is `localStorage["lb.split"]` (§5 uses it, no `split=` URL param).
- Router: `open=term|transcript` is accepted into the conventions; VIEWS gains a hidden drill-down `diff` (§10). §1 F8a ships the grammar with `DEFAULT_VIEW="board"`; D4 flips it to `map`.
- Tiers are the server names `read | click | ask | confirm` (was "tier 0/1/2"): `read`/`click` no dialog; `ask` verb + Cancel; `confirm` typed `${VERB} ${target}`; any target `*` or multi-target fan-out uses the typed form with the builder id, `fleet`, or the count (`BROADCAST 7`). The live table is `hello.actions`, fallback `ACTION_TIERS` in `public/js/core/actions.js` (§1 F8a).
- Annunciator tiles are fixed to 8 and map §7's alarm kinds (table in 2.5); tile states are `normal | unack | ack` (`rtn` deferred: §7 drops cleared alarms). The kind→tile map is the pure `public/js/core/alarm-tiles.js` (D7). `ack-alarm` takes `target:<alarmId>` or `target:"*"` with `args:{tile, builder?}`.
- Guardrail 9: the `previewHtml` exception is gone (§1 F6 renders `previewLines` client-side); CSP keeps `style-src 'unsafe-inline'` for xterm, but this code still never uses `setAttribute("style")`.
- New tasks with thin specs: D11 Box view, D12 Audit view, D13 Credit view (fleet), D14 notification prefs sheet (nobody owned these views). D4 creates the view registry `public/js/views/index.js` and stubs for `inbox`, `packages`, `audit`, `diff`, plus `test/frontend-static.test.mjs` (§11 QA layer 3).
- Task ids are now D1-D14 (T4.n → Dn); deps match the global DAG in README.md. Private details moved to `private/04-private.md`.

## 1. Goal and scope

Replace today's single-host "mission-control dense" look (`public/styles.css:1-29`, accent violet `--accent: oklch(70% 0.15 292)` at `:66`, glass on the topbar/toast `:217`, `:329` and the map HUD `map.css:40-50`) with an **ISA-101 high-performance HMI** shell for the fleet. Grey is the baseline, colour means abnormal, and the Map is the home screen. The user's brief: overview first, less is more, icons and short labels, industrial, nothing fancy.

**In scope:** `tokens.css` (dark and light), vendored fonts and an icon sprite, the shell layout at three breakpoints, the router and hotkeys, the component kit (lamp, annunciator, segment bar, sparkline, plate, brackets, panel, table, palette, scope chips, toast, confirm dialog), restyling the Map chrome, and the Board lane data block.
**Out of scope:** what the views contain beyond the Board card, Box, Audit and Credit (packages: §6 P12; inbox: §8 C13; morning: §10 R15; diff/peek/archive: §10), all built with this kit; server data (alarms, stuck, health: §7; approvals, budget: §8); the action tiers themselves (§2); the module split of `app.js` (§1).

Levels of display (ISA-101):

| Level | What | Where |
|---|---|---|
| L1 | Fleet overview | `#/map?b=all` (home), annunciator, rail ALL row |
| L2 | One builder | `#/map?b=<id>` or `#/board?b=<id>` (rail row selected) |
| L3 | One lane | inspector drawer, `sel=<fkey>` |
| L4 | Terminal / transcript | `sel=<fkey>&open=term` (centre takeover on desktop, full sheet on phone) |

`Enter` goes down one level and `u`/`Backspace` goes up one.

## 2. Design

### 2.1 Files (all new unless marked)

```
public/css/tokens.css        tokens, @font-face, themes, keyframes        (T4.1)
public/css/base.css          reset, [hidden], html/body type, focus, scrollbars (T4.1)
public/css/components.css    lamp plate panel segbar spark brackets dt chips btn toast dialog (T4.3)
public/css/shell.css         grid areas, header, legend, breakpoints        (T4.4)
public/css/rail.css  inspector.css  tape.css  annunciator.css  palette.css  board.css  phone.css
public/vendor/fonts/jetbrains-mono/{JetBrainsMono-Regular,JetBrainsMono-SemiBold}.woff2 + OFL.txt
public/vendor/fonts/barlow-condensed/{BarlowCondensed-Medium,BarlowCondensed-SemiBold}.woff2 + OFL.txt
public/vendor/lucide/sprite.svg + LICENSE (ISC)
scripts/icons.json           concept -> lucide name table (source of truth)
scripts/build-sprite.mjs     node scripts/build-sprite.mjs <lucide-static>/icons > public/vendor/lucide/sprite.svg
public/js/core/icons.js      icon(), ICONS
public/js/core/router.js     parseHash, formatHash, navigate, onRoute (pure parse/format)
public/js/core/commands.js   command registry shared by hotkeys + palette
public/js/ui/{shell,rail,inspector,tape,annunciator,palette,fuzzy,hotkeys,sheet,confirm,toast,components,spark}.js
public/js/views/board.js     (modified; created by §1)
public/dev/kit.html          static component gallery for HUMAN review (no data, no network)
```

`server/http.mjs:115-127`: today `/vendor/*` only serves the four xterm files mapped out of `node_modules` and returns 404 for anything else (`:126`). §1 F1 changes it so that an unmapped `/vendor/<rel>` falls through to `serveStatic(res, publicDir, 'vendor/'+rel, {immutable:true})`. MIME already has `.woff2` (`:18`) and `.svg` (`:15`).

After §1 F2, the legacy rules live in `public/css/{base,shell,rail,board,terminal,misc,lanes}.css` and `public/css/views/{data,box,map}.css`; D1 rewrites `tokens.css`/`base.css`, D4 `shell.css`, D5 `rail.css`, D9 `board.css`, the rest keep their rules until their view is redesigned. `tokens.css` keeps **alias tokens** with the old names (`--bg-surface --bg-elevated --bg-sunken --text-1..3 --crit --warn --ok --info --idle --accent --font-mono --font-ui --radius*`), so those views and the map keep resolving. The map's `readPalette` (§5 M3, from `map.js:77-93`) reads these names through `getComputedStyle`; §5 must use these token names (`--text-1..3`, `--line*`, `--bg-canvas`, `--accent`, `--p1..p3`, `--ok`, `--font-mono`, `--font-label`).

### 2.2 tokens.css

Dark is the default (`:root`, `[data-theme=dark]`) and light is `[data-theme=light]`. `index.html:2` already sets `data-theme="dark"`. The theme preference lives in `localStorage['lb.theme']`, toggled from the palette (`ACT theme`). On a theme change, `shell.js` dispatches `lb:theme`, and the map (§5 M3 `readPalette`) re-reads its palette on that event.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg-canvas` | `oklch(16% 0.004 250)` | `oklch(93% 0.003 250)` | page, map ground |
| `--bg-surface` | `oklch(19% 0.004 250)` | `oklch(97% 0.002 250)` | panels, rail, inspector |
| `--bg-elevated` | `oklch(22% 0.004 250)` | `oklch(100% 0 0)` | palette, dialog, menu |
| `--bg-sunken` | `oklch(13% 0.004 250)` | `oklch(89% 0.003 250)` | inputs, terminal, tape |
| `--bg-hover` | `oklch(100% 0 0 / 0.04)` | `oklch(0% 0 0 / 0.04)` | row hover |
| `--bg-selected` | `oklch(100% 0 0 / 0.07)` | `oklch(0% 0 0 / 0.06)` | selected row |
| `--line-weak` | `oklch(100% 0 0 / 0.07)` | `oklch(0% 0 0 / 0.08)` | grid lines |
| `--line` | `oklch(100% 0 0 / 0.13)` | `oklch(0% 0 0 / 0.16)` | panel borders |
| `--line-strong` | `oklch(100% 0 0 / 0.26)` | `oklch(0% 0 0 / 0.32)` | plates, focus-free emphasis |
| `--text-1` | `oklch(92% 0.003 250)` | `oklch(20% 0.004 250)` | values |
| `--text-2` | `oklch(72% 0.004 250)` | `oklch(38% 0.004 250)` | labels |
| `--text-3` | `oklch(55% 0.004 250)` | `oklch(52% 0.004 250)` | units, hints, normal-state glyphs |
| `--text-inv` | `oklch(14% 0 0)` | `oklch(98% 0 0)` | text on filled alarm tiles |
| `--accent` | `oklch(70% 0.19 45)` | `oklch(60% 0.19 45)` | **only** selection, focus, primary CTA |
| `--accent-weak` | `oklch(70% 0.19 45 / 0.16)` | `oklch(60% 0.19 45 / 0.14)` | selected chip bg |
| `--p1` (crit, ■) | `oklch(62% 0.23 25)` | `oklch(52% 0.22 25)` | permission, approval, builder down, cap hit |
| `--p2` (warn, ▲) | `oklch(84% 0.16 95)` | `oklch(66% 0.15 85)` | question, stuck, CI fail, budget ≥80 % |
| `--p3` (low, ◆) | `oklch(74% 0.11 220)` | `oklch(52% 0.12 230)` | conflict predicted, stale builder |
| `--ok` (●) | `oklch(66% 0.07 150)` | `oklch(48% 0.08 150)` | CI pass, done; muted on purpose |
| `--run` | `var(--text-2)` | `var(--text-2)` | working: grey plus an activity glyph, no hue |
| `--off` | `var(--text-3)` | `var(--text-3)` | idle, shell, dead |
| `--p1-weak --p2-weak --p3-weak` | colour at `/ 0.16` | `/ 0.14` | tile/row tint |
| `--p1-line --p2-line --p3-line` | colour at `/ 0.5` | `/ 0.55` | borders |

Old aliases: `--crit: var(--p1); --warn: var(--p2); --info: var(--p3); --idle: var(--off); --border*: var(--line*)`. The accent (hue 45) and `--p1` (hue 25) are separated by lightness and chroma, and **p1 is never shown without its ■ shape**.

Type: `--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace` for all data. `--font-label: "Barlow Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif` for labels, plates and titles, always uppercase with `letter-spacing: var(--ls-label)` (0.06em). `--font-ui: var(--font-label)`, because the map uses it for room labels (`map.js:1498`, now `public/js/views/map/render.js`). Prose (assistant line, prompts) uses mono at 12px. `html, body { font-variant-numeric: tabular-nums slashed-zero; font-feature-settings: "tnum", "zero"; }`, which keeps the existing guard test (`test/frontend.test.mjs:295`) satisfied.
Scale: `--fs-10: 10px` (legend keys, tape, micro labels) · `--fs-11` (plates, panel titles, tile labels) · `--fs-12` (dense data, default body) · `--fs-13` (comfortable data) · `--fs-16` (inspector title) · `--fs-20` (annunciator count on phone, KPI) · `--fs-28` (map hero count). `--lh-tight: 1.1; --lh: 1.35`. Weights are only 400/600 mono and 500/600 label.
Spacing (4px base): `--sp-1:4px --sp-2:8px --sp-3:12px --sp-4:16px --sp-6:24px --sp-8:32px`.
Rows: `--row-dense:28px --row-comfy:36px --row-touch:44px`. `--row-h` resolves from `[data-density=dense|comfy]` on `<html>` (default dense ≥1200, comfy 700-1199, touch under `(pointer: coarse)`).
Sizes: `--header-h:40px --rail-w-min:56px --rail-w:220px --insp-w:360px --tape-h:28px --tape-h-open:200px --icon-s:14px --icon-m:16px --icon-l:20px --lamp:8px`. Z-index: `--z-rail:10 --z-insp:20 --z-tape:30 --z-sheet:40 --z-palette:50 --z-toast:60 --z-dialog:70`.
Shape: `--radius:2px` (everything), `--bw:1px`. Shadows: none. Depth comes from borders and the surface step only.
Textures (the only gradient functions allowed, hard stops only):
`--tex-dots: radial-gradient(circle, var(--line) 0.75px, transparent 1px) 0 0 / 16px 16px` for the map ground and empty canvases.
`--tex-hatch: repeating-linear-gradient(45deg, var(--line) 0 1px, transparent 1px 6px)` for stale/offline builder rows, dead lanes and stale tiles.
`--bracket-img` (four 8×2px corner hard stops, see §2.5) for the selection.
Motion: `--dur:120ms; --ease:cubic-bezier(.2,0,0,1)`, and only opacity, transform and width transition. `@keyframes lb-flash { 0%,49% {opacity:1} 50%,100% {opacity:.35} }` runs at `1s linear infinite` (1 Hz). Under `@media (prefers-reduced-motion: reduce)`, `--dur:0ms` and `[data-unack]` gets `animation:none` and `outline:1px dashed currentColor; outline-offset:1px` instead.
Flash phase sync: every flashing node gets `style.animationDelay = -(performance.now() % 1000) + 'ms'` when it is inserted (`components.js:syncFlash(node)`), so all unacked tiles blink together.

Fonts: four `@font-face` blocks in `tokens.css`, `font-display: swap`, latin subset, `unicode-range: U+0000-00FF,U+2000-206F,U+2190-21FF,U+2500-25FF,U+20AC`. `index.html` preloads two of them: `<link rel="preload" as="font" type="font/woff2" crossorigin href="/vendor/fonts/jetbrains-mono/JetBrainsMono-Regular.woff2">` and `.../BarlowCondensed-SemiBold.woff2`. Sources: JetBrains Mono v2.304 release `fonts/webfonts/`, Barlow Condensed from the `jpt/barlow` repo (`fonts/woff2/`). Both are OFL-1.1, and each `OFL.txt` is copied verbatim. No new npm dependency.

### 2.3 Icons

Vendored from `lucide-static` (pinned version, written into the `LICENSE` header). The build script reads `scripts/icons.json`, wraps each SVG body in `<symbol id="i-<concept>" viewBox="0 0 24 24">`, strips the per-file `stroke*`/`fill` attributes, and **exits non-zero on a missing Lucide name** (renamed icons, e.g. `filter`→`funnel`, are fixed in the table). Styling is `.i { width:var(--icon-m); height:var(--icon-m); fill:none; stroke:currentColor; stroke-width:1.75; stroke-linecap:round; stroke-linejoin:round; flex:none }`, with size modifiers `.i-s/.i-l`.

| concept → lucide | concept → lucide | concept → lucide |
|---|---|---|
| `map` → map | `board` → layout-grid | `inbox` → inbox |
| `packages` → package | `audit` → scroll-text | `credit` → coins |
| `box` / `builder` → server | `builder-down` → server-off | `morning` → sunrise |
| `lane` → route | `branch` → git-branch | `pr` → git-pull-request |
| `pr-draft` → git-pull-request-draft | `pr-merged` → git-merge | `ci-pass` → circle-check |
| `ci-fail` → circle-x | `ci-running` → circle-dashed | `ci-none` → circle-minus |
| `s-permission` → shield-alert | `s-question` → message-circle-question | `s-working` → activity |
| `s-done` → circle-check-big | `s-idle` → moon | `s-shell` → square-terminal |
| `s-dead` → circle-off | `pause` → pause | `play` / `resume` → play |
| `kill` → power-off | `restart` → rotate-ccw | `interrupt` → hand |
| `approve` → check | `deny` / `close` → x | `approval` → stamp |
| `broadcast` → radio-tower | `stuck` → hourglass | `budget` → wallet |
| `conflict` → git-compare-arrows | `blocked` → octagon-minus | `review` → eye |
| `ack` → check-check | `alarm` → bell-ring | `bell` → bell |
| `terminal` → terminal | `send` → send-horizontal | `pin` → pin |
| `spawn` → square-plus | `retire` → archive | `search` → search |
| `command` → command | `filter` → funnel | `split` → columns-2 |
| `rail` → panel-left | `inspector` → panel-right | `chev-r/l/d` → chevron-right/left/down |
| `keyboard` → keyboard | `clock` → clock | `cpu` → cpu |
| `mem` → memory-stick | `disk` → hard-drive | `offline` → unplug |
| `theme` → sun-moon | `external` → external-link | `more` → ellipsis |

`public/js/core/icons.js`:
```js
export const SPRITE = '/vendor/lucide/sprite.svg';
export const ICONS = Object.freeze([...concept names...]);   // generated list, kept in sync by test
export function icon(name, { size = 'm', label = null, cls = '' } = {}) // -> SVGSVGElement
// <svg class="i i-m cls" aria-hidden="true" focusable="false"><use href="/vendor/lucide/sprite.svg#i-name"/></svg>
// label given: role="img", aria-label=label, aria-hidden removed, <title>label</title> first child.
// unknown name: console.warn once, falls back to 'alarm' (never throws in render).
export function iconMarkup(name) // string, for the static kit page only; never used with builder data
```
The sprite is an external `<use href>` with the same origin, which works under a strict CSP (`img-src 'self'`). No inline SVG strings are ever built from builder data.

### 2.4 Shell layout

Desktop ≥1200 (the `2000px` ultrawide breakpoint stays, with denser board columns):
```
+-------------------------------------------------------------------------------------------------+
| [#] LANEBOARD |MAP|BRD|INBX|PKG|MORN|CRED|BOX|AUD| scope:[B1 x][▲ STUCK x] |NEED|APPR|BLKD|STCK| 14:02:07Z |
|  40px                                                                         |CI-F|DOWN|BUDG|CONF| 16:02 L  |
+--------+------------------------------------------------------------+-----------------------------+
| ALL  42|                                                            | ┌ LANE · B1/auth ──────── x ┐|
|■B1  12 |                    M A P   (default view)                  | ■ PERMISSION  3/7   12m      |
|  ▇▇▅▁▁ |              dot grid, constellation, brackets             | ⎇ feat/auth  #142 ✓✓✗        |
|●B2  18 |                                                            | ctx 64% ▁▂▄▆  $1.82/5h        |
|  ▅▅▅▅▁ |                                                            | [▶][⏸][✓][✗][>_][⏻]          |
|◌B3 ////|                                                            | transcript tail ...          |
|  (down)|                                                            |      360px, closed by default|
| 220/56 |                                                            |                              |
+--------+------------------------------------------------------------+------------------------------+
| 14:02:05 B1 auth ■ permission · 14:01:50 B2 api ● CI pass · ...    g m MAP  g b BRD  ⌘K CMD  ? HELP |
+-------------------------------------------------------------------------------------------------+
  tape 28px (click/` expands to a 200px log drawer)      legend: right part of the same bar
```
CSS grid on `.shell`: `grid-template: "head head head" var(--header-h) "rail main insp" 1fr "tape tape tape" var(--tape-h) / var(--rail-cur) 1fr 0`. The inspector is an **overlay** inside `main` (`position:absolute; inset-block:0; right:0; width:var(--insp-w); transform:translateX(100%)` → `0` when `[data-insp=open]`, transition `var(--dur)`), so the map never reflows. `views/board.js` adds `padding-inline-end: var(--insp-w)` while it is open. The map is told through `mapView.setInsets({right})` (§5 M4). The legend shares the tape bar to save 20px (less is more). It is context-sensitive (keys of the current view first) and hidden below 1440px, where `?` remains.

Header items: brand plate `LANEBOARD` with the local/hub code. View nav as icon buttons, with 3-4-char labels shown only ≥1440 (`MAP BRD INBX PKG MORN CRED BOX AUD`), plus `title`/`aria-label` long names. Scope chips. The annunciator is a **2×4 grid of 64×18 tiles** (fits the 40px header). The clock shows `HH:MM:SSZ` on the first line and local `HH:MM` with a TZ abbreviation on the second, `--fs-10`, ticking every second with `textContent` only. A connection lamp sits beside the brand, replacing `#conn` (`index.html:28`, keep the id).

Tablet 700-1199: the rail is fixed collapsed (56), and `[`/the rail button expands it as an overlay. The inspector overlays at `min(360px, 100% - 56px)`. The view nav is icons only. The annunciator stays 2×4 at 48×18 with an icon plus count (no label). No legend.

Phone <700:
```
+------------------------------+
|[#] LB  ■3 ▲5      14:02Z  ⌘ |  44px: brand, worst-two priority counters, clock, palette
|[ALL][●B1][■B2][◌B3] →        |  36px builder chip strip, horizontal scroll
|                              |
|          M A P               |  full-screen
|                              |
+==============================+
| ‾‾‾  [MAP|LIST|INBOX]   ⋯    |  bottom sheet: peek 96px / half 50dvh / full
| ■ B2/auth permission  12m    |  (100dvh - 80px - safe-area)
+------------------------------+
```
`ui/sheet.js` handles the snap points: pointer drag on the handle, velocity over 0.5 px/ms snaps in the drag direction, and keyboard `ArrowUp/Down` on the handle (`role="slider" aria-valuetext="half"`). The segmented control `role="tablist"` switches the sheet content: MAP = summary plus the needs-you list, LIST = board rows (28px → 44px touch), INBOX = inbox view. `⋯` opens a menu with the other views. Selecting a lane moves the sheet to half and shows L3. L4 uses the existing full-screen `#sheet` (`index.html:163`) with its quickbar. The old `.tabs` bar (`index.html:131`) is removed, and its breakpoint test is rewritten (T4.4). The tape is hidden on the phone (events are in INBOX).

### 2.5 Components (in `components.css`, builders in `ui/components.js`)

- **Status lamp.** `<span class="lamp" data-p="1|2|3|ok|run|off|stale" [data-unack] role="img" aria-label="permission, unacknowledged">`, sized 8×8. Shape follows priority: p1 square, p2 triangle (`clip-path: polygon(50% 0,100% 100%,0 100%)`), p3 diamond (rotate 45°), ok/run circle (`border-radius:50%`, the one allowed non-2px radius), off is a hollow circle, stale is a hollow circle on `--tex-hatch`. A 1px dark-theme glow (`filter: drop-shadow(0 0 3px currentColor)`) applies only to `[data-p="1"],[data-p="2"]`; this is the single glow in the system. `[data-unack]` flashes. `lamp(p, {unack, label})` returns the element.
- **Annunciator.** `<div class="ann" role="group" aria-label="Alarms">` holds 8 × `<button class="ann-tile" data-tile="STCK" data-p="2" data-state="normal|unack|ack" aria-pressed="false" aria-label="Stuck: 2 lanes, unacknowledged">` with `<span class="ann-label">STCK</span><span class="ann-n">2</span>`. The states follow ISA-18.2 style: `normal` is grey text-3 with an empty count, `unack` is filled `--pN` with `--text-inv` text and flashes, `ack` is filled and steady. (`rtn`, cleared-but-unacked, is deferred: §7's reconcile drops cleared alarms from the live set.) The tile priority is the max over its members. A click toggles the scope filter `s=<tile>` (`aria-pressed`). `a` on a focused tile, or the long-press/context-menu "ACK", sends `ack-alarm` with `target:"*"`, `args:{tile, builder?}` (tier `click`, §2). The tiles are fixed, in this order, and map §7's alarm kinds (`public/js/core/alarm-tiles.js`, `KIND_TO_TILE`):

  | Tile | §7 kinds |
  |---|---|
  | NEED | `needs-input`, `review-overdue` |
  | APPR | `approval` |
  | BLKD | `blocked`, `failed`, `danger` |
  | STCK | `stuck` |
  | CI-F | `ci-red-main`, `ci-red` |
  | DOWN | `builder-down`, `builder-stale`, `health-crit`, `health-warn`, `reboot`, `audit-fork` |
  | BUDG | `budget-warn`, `budget-exceeded` |
  | CONF | `conflict` |

  `review` (P4) has no tile; it lives in the Inbox. Alarm priority `P1..P4` maps to `data-p` as `P1→1, P2→2, P3→3, P4→3`. The store holds alarms as §7 sends them: `{id, kind, priority, builder, target, text, since, acked, ackedBy, ackedAt}`; `fkey = builder + '/' + target` when target is a session or lane. Pure `tileModel(alarms) -> [{tile, p, state, n, members}]` lives in `public/js/core/alarm-tiles.js` and is exported for tests.
- **Segment bar.** `<span class="segbar" role="img" aria-label="12 lanes: 1 permission, 2 question, 6 working, 3 idle">` holds child `<i style="flex-grow:n" data-p=..>`, sized 48×6 with 1px gaps and the order p1, p2, run, ok, off, dead (hatched). Pure `laneMix(lanes) -> {p1,p2,run,ok,off,dead,total}`.
- **Sparkline.** `<svg class="spark" viewBox="0 0 60 16" width="60" height="16" role="img" aria-label="ctx 64%, rising">` with one `<polyline>` (stroke `--text-2`, 1px, no fill), a last-point 2×2 rect, and an optional dashed threshold line in `--p2`. Pure `sparkPoints(values, 60, 16, {min, max}) -> "x,y ..."` in `ui/spark.js`.
- **Stamped plate.** `<span class="plate [plate--solid|plate--p1|plate--p2]">B1</span>`: label font 600 11px uppercase, 1px `--line-strong` border, height 16px, padding 0 4px. Used for builder codes, view titles and palette type tags.
- **Corner brackets.** `.sel` puts a `::after{position:absolute; inset:-3px; background:var(--bracket-img); pointer-events:none}` with four 8px×2px L-corners in `--accent`. It goes on the selected rail row, card, table row and inspector header. The map canvas draws the same geometry (T4.10). Keyboard focus is a separate `:focus-visible { outline:1px solid var(--accent); outline-offset:1px }`.
- **Inset-title panel.** `<section class="panel" aria-labelledby=id><h2 class="panel-t" id=id><span class="panel-name">LANES</span><span class="panel-scope">· ALL</span><span class="panel-n">[42]</span><span class="panel-tools">…</span></h2>…</section>`. The title sits on the top border (`position:absolute; top:-0.65em; left:8px; background:inherit; padding:0 4px`), k9s style, so the rendered text reads `LANES · ALL [42]`.
- **Data table.** `<div class="dt-wrap" tabindex="0"><table class="dt" aria-rowcount>` with a sticky `<thead>` whose `<th aria-sort>` contain `<button>`s; rows are `var(--row-h)`, numerals right-aligned mono, text cells ellipsized with a `title`. Keyboard uses a roving `tabindex` on `<tr>`: `j/k/↑/↓`, `Home/End`, `Enter` to drill, and `Space` to toggle a multi-select checkbox. `tr.is-stale` gets `--tex-hatch`. Pure `sortRows(rows, key, dir)` is stable and puts nulls last.
- **Command palette.** A native `<dialog class="pal">` (focus trap and Esc for free). Inside, `<input role="combobox" aria-expanded aria-controls="pal-list" aria-activedescendant>` and `<ul id="pal-list" role="listbox">` hold `<li role="option" id>` items, each with an icon, a type plate (`HOST LANE PKG ACT VIEW`), a label, a sub-label in text-3, and a right-aligned key hint. Prefixes: `h:`/`host:`, `l:`/`lane:`, `p:`/`pkg:`, `>`/`act:`. It opens with `⌘K`, or `Ctrl-K` outside a terminal, or with `:` (which presets `>`). An empty query lists recent (last 20 ids, `localStorage['lb.pal.recent']`), then the current alarms' lanes, then views. `ui/fuzzy.js` exports a pure `fuzzyScore(q, s) -> number|null`: a subsequence match scoring word-start +8, consecutive +5, case-exact +1, and gap −1. Results are capped at 50. ACT items come from `core/commands.js` and run through `confirm.js`.
- **Scope chips.** `<div class="scope" role="toolbar" aria-label="Scope">` holds `<button class="chip" data-param="b|s|q">` with a lamp or icon, the text and an `x` icon. Removing a chip calls `navigate({[param]: null})`. When there is no scope it shows the plate `ALL`. The phone builder strip reuses `.chip` at 36px.
- **Toast.** Keeps `#toast` (`index.html:184`) as the container `<div class="toasts" aria-live="polite">`. Each toast `<div class="toast" data-kind="info|ok|err">` gets `role="alert"` for err. It is bottom-right above the tape, stacks at most 3, lasts 4s (err 8s), and fades by opacity only. `toast(msg, {kind, action})` keeps the existing name (the frontend test looks for `function toast`).
- **Confirm dialog.** `confirmAction({action, targets, tier, consequence}) -> Promise<{ok, confirm}>` in `ui/confirm.js`, as a native `<dialog class="cfm" role="alertdialog" aria-describedby>`. The tier comes from `hello.actions` (fallback `ACTION_TIERS` in `public/js/core/actions.js`, §1 F8a; it is not redefined here). Rendering: `read`/`click` run with no dialog. `ask` shows a verb button plus Cancel, focused on Cancel. `confirm`, and any action on target `*` or several targets, adds a consequence list (targets as plates) and an input that must equal `${VERB} ${target}` exactly, e.g. `KILL B1/auth`, `PAUSE B1` (builder-wide), `PAUSE FLEET`, or `BROADCAST 7` for a fan-out where the number is the target count. The returned `confirm` is what the caller puts into `args.confirm` (the local target name, the builder id, or `fleet`), or `confirmCount` for broadcast. The confirm button stays disabled until it matches, and paste is allowed. The verb button is `--p1` outline for destructive actions, otherwise `--accent`.

### 2.6 Router and hotkeys

`core/router.js` (pure parse/format plus a thin DOM part):
```js
parseHash('#/board?b=builder-a&s=stuck&q=auth&sel=builder-a%2Fauth&open=term')
 -> { view:'board', b:'builder-a', s:'stuck', q:'auth', sel:'builder-a/auth', open:'term' }
formatHash(route) -> string   // drops defaults (view map, b all), stable key order view,b,s,q,sel,open
navigate(patch, {replace=false})  onRoute(fn)  current()
```
VIEWS are `map board inbox packages morning credit box audit` plus the hidden drill-down `diff` (§10, not in the nav), with an unknown view going to `map`. **Extension to the conventions (accepted by the integrator):** an optional `open=term|transcript` for L4. Legacy hashes stay supported forever: `#session=<name>` (push deep links, `app.js:1898-1904`, built by `server/push.mjs`) maps to `{view:'board', sel:fkey(localId,name), open:'term'}`, and `#board|#morning|#credit|#box|#map` maps to `#/<same>`. On closing L4, `navigate({open:null}, {replace:true})` replaces today's `replaceState('#'+view)` (`app.js:64`). A split preference (`\`) is a view layout setting in `localStorage['lb.split']`, not URL state.

`core/commands.js`: `register({id, title, icon, keys?, when?(ctx), run(ctx), tier?})`, `list(ctx)`, `run(id, ctx)`. Hotkeys and the palette both read from it.
`ui/hotkeys.js`: a pure `resolve(keyEvent, ctx) -> commandId|null` over a `KEYMAP` table, with a 1000 ms chord timeout (same as `app.js:1872`). The one DOM listener first runs `keyBelongsToTerminal` (`app.js:1791`, moved verbatim). When an xterm has focus, **every** key goes to the session, `Ctrl-K` included (readline kill-line), and only `⌘K` (meta) still opens the palette. After that it ignores inputs.

| Keys | Command | Today (`app.js`) | Conflict / migration |
|---|---|---|---|
| `g m` | view map | `g m` = morning (`:51`) | **changed**, morning moves to `g o` |
| `g b` `g i` `g p` `g x` `g a` `g c` `g o` | board, inbox, packages, box, audit, credit, morning | `g p` = map (`:51`) | **changed**, `g p` is packages |
| `[` `]` | prev/next builder (b=) | none | |
| `0` / `1-9` | b=all / builder N in rail order | `1-9` = attention item N (`:1874`) | **changed**; attention jump becomes `n`/`N` next/prev alarm lane (worst first) |
| `j` `k` | move cursor in focused list, map: next/prev lane in attention order | board cursor (`:1880`) | keeps board behaviour; map needs `mapView.selectNext(dir)` |
| `Enter` | drill down one level | open sheet (`:1882`) | L3→L4 equals today's open sheet |
| `u` `Backspace` | up one level | none | |
| `/` | focus find (map find on map, `q=` filter elsewhere) | map only (`map.js:907`) | map's own `onKey` (`map.js:905-913`) is removed by §5 M4; the map exposes `focusFind()` |
| `f`, `c` | map fit, fold (view-scoped) | `map.js:910-911` | kept, registered as map-scoped commands |
| `o` / `O` | map overlay next / prev (view-scoped, §5 2.6) | none | calls `mapView.setOverlay(nextOverlay(...))` |
| `a` `d` `r` `p` (Inbox) | approve / deny (note field) / release to terminal / pause, on the **focused row's** id (§8 2.9) | none | view-scoped; wins over global `a`/`p` while Inbox is active |
| `c` (Diff) | comment on the selected line range (§10 2.12) | none | view-scoped; wins over map `c` (different view) |
| `p` | pin lane to dock | `:1883` | kept |
| `a` / `A` | ack focused alarm / ack all visible (`ack-alarm`, tier `click`) | none | |
| `⌘K`, `Ctrl-K`, `:` | palette | none (meta/ctrl ignored at `:1867`) | |
| `\` | split: map + list side by side (state in `localStorage['lb.split']`, §5 2.7) | none | |
| `` ` `` | expand/collapse event tape | none | |
| `?` | help overlay (generated from KEYMAP) | none | |
| `Esc` | closes the top layer: dialog > palette > help > menu > L4 (focus outside xterm) > inspector (`sel=null`) > scope `s`/`q` | menus + sheet (`:1871`), map deselect (`map.js:909`) | ordered stack in `shell.js:closeTop()` |

### 2.7 Board lane data block (ATC style)

Positions are fixed in mono `ch` columns, so every card has the same anatomy and the eye scans columns. Icons come first and words go to `title`/`aria-label`. Fields: `code` (builder plate), `lane` (id, 18ch, ellipsis), `state` (lamp + glyph + 4-char word `PERM QUES WORK DONE IDLE SHEL DEAD`), `stage n/m` (`lane.progress`, `app.js:883-889`), `PR` (`#number` + icon by state, `app.js:579-595`), `checks` (one glyph per package or job, max 6, then `+n`: pass ●, fail ✗ coloured p2, running ◌, from §6), `ctx %` (p2 ≥65, p1 ≥85, same thresholds as `app.js:705`), `$ 5h` (spend in the rolling 5h window, from session cost; §8 budget windows), `age` (time in state, `ago()`). Flags (stuck, paused, approval, review) take the right edge of line 1 as icons.

Card (Board grid, 2 lines, dense):
```
┌──────────────────────────────────────────────────────────┐
│ B1 ■ PERM  auth-refactor......  3/7   ⏸ ⌛         12m  │  line 1: code state lane stage flags age
│ ⑂ #142 ●●✗◌  ctx 64%  $1.82  opus                  ↑2 ●3 │  line 2: PR checks ctx $5h model git
├──────────────────────────────────────────────────────────┤
│ ▸ Edit server/auth.mjs                                   │  one activity line (tool or marker), as today
│ [✓] [✗] [>_] [⋯]                                         │  actions: icons, tier-aware
└──────────────────────────────────────────────────────────┘
```
Row (List / phone LIST, single 28px line):
```
B1 ■ PERM  auth-refactor....  3/7  #142 ●●✗  64%  $1.82  12m  ⌛
B2 ● WORK  api-cache........  5/5  #139 ●●●  31%  $0.40   2m
B3 ◌ IDLE  docs-sweep.......  -/-   —        -     $0.00   3h      (hatched: builder stale)
```
The preview (`app.js:768-773`), the user prompt and the assistant line move out of the card into the inspector (L3). The card keeps only the one activity line. The "no information was lost" test (`test/frontend.test.mjs:242`) is updated to look for these fields in `views/board.js` or `ui/inspector.js` instead of `app.js`. Pure `dataBlock(lane, session, extras) -> {code, lane, p, word, stage, pr, checks[], ctx, usd5h, age, flags[]}` is exported for tests.

### 2.8 Hard guardrails (enforced by `test/design-guardrails.test.mjs`)

1. No gradients outside the three `--tex-*`/`--bracket-img` tokens. `map.css:12`'s radial vignette goes.
2. No `backdrop-filter`, no glass, no transparency over moving content. `map.css:44-45` and `styles.css:217-226,329-338` are removed.
3. No `box-shadow` at all, and glow (`drop-shadow`) only on `.lamp[data-p="1"|"2"]`.
4. Exactly one accent (`--accent`), used only for selection, focus and primary CTA. No colour literals (`oklch(`, `#hex`, `rgb(`) outside `tokens.css`.
5. Colour only for abnormal. Normal and working are grey. Every coloured status carries a shape (■▲◆●) and text or aria.
6. No animated counters or number tweening, no `requestAnimationFrame` in `ui/` or `views/` except the map. The only keyframes are `lb-flash`. Transitions last 120ms or less and touch only opacity, transform and width.
7. `border-radius` is only `var(--radius)`, `0` or `50%` (lamps).
8. Fonts only via `var(--font-mono|--font-label)`. No icon fonts or emoji.
9. No `innerHTML` with builder data, no exceptions (§1 F6 replaced `previewHtml` with client-rendered `previewLines`; `test/frontend-safety.test.mjs` enforces it). Never `setAttribute('style')`, only `el.style.x`.
10. Labels: at most 4-5 characters on tiles and tabs. The full words go in `title` and `aria-label`.

## 3. Tasks (dependency order; every task: `npm test` green)

Ids and deps match the global DAG in README.md. All run after §1 F1/F2 (and F8a/F8b where named).

- **D1 Tokens, base, fonts** (was T4.1; deps F2). Owns `public/css/tokens.css`, `public/css/base.css`, `public/vendor/fonts/**`, `test/tokens.test.mjs` and `test/design-guardrails.test.mjs`. Downloads the fonts (HUMAN if there is no network: leave a `MISSING` file, and the test reports it as skipped, not failed). **Done when:** tokens test passes (all tokens in §2.2 exist in both themes; a tiny OKLCH→sRGB contrast check: text-1/bg ≥ 7, text-2 ≥ 4.5, text-3 ≥ 3, p1/p2/p3/accent vs bg-canvas ≥ 3); `curl -sI localhost:<port>/vendor/fonts/jetbrains-mono/JetBrainsMono-Regular.woff2` returns `font/woff2` (F1's fall-through); the guardrail test runs on `public/css/**/*.css` (it starts with an allowlist of legacy files that D4/D5/D9/§5 M3 empty).
- **D2 Icon sprite** (was T4.2; deps F1). Owns `scripts/icons.json`, `scripts/build-sprite.mjs`, `public/vendor/lucide/**`, `public/js/core/icons.js` and `test/icons.test.mjs`. **Done when:** the test asserts that every `ICONS` entry has a `<symbol id="i-…">` in the sprite and vice versa, that no symbol carries `stroke=`/`fill=` on its root, that `LICENSE` exists, and that the sprite is under 40 KB. If `lucide-static` cannot be fetched (no network, no new dependency allowed), the task is `BLOCKED` with `NEED-HUMAN: lucide-static <version> tarball`.
- **D3 Component kit** (was T4.3; deps D1, D2, F8a). Owns `public/css/components.css`, `public/js/ui/components.js`, `ui/spark.js`, `ui/toast.js`, `ui/confirm.js`, `public/dev/kit.html` and `test/components.test.mjs` (`laneMix`, `sparkPoints`, `sortRows`, and the confirm text matcher `typedOk(input, verb, target)`). Tiers from `ACTION_TIERS` (F8a) / `hello.actions`.
- **D4 Shell, router, view registry** (was T4.4; deps D3, F8b, F8a, D1, F2). Owns `public/index.html` (shell skeleton, keeping `#offline #conn #toast #sheet #quickbar #ui-error`, linking the CSS in the order tokens, base, components, shell, …, then the legacy files, then `views/*`), `public/css/shell.css`, `public/js/ui/shell.js` (re-exports `toast` from `ui/toast.js`), `public/js/core/router.js` (flip `DEFAULT_VIEW` to `map`), `public/js/app.js` (boot mounts views through the registry), `public/js/views/index.js` (registry: each view module's `default` export `{id, icon, title, mount(el, ctx), unmount(), update(store)}`, falling back to a legacy adapter for the F1-moved views until their owner adds a default export), stub views `public/js/views/{inbox,packages,audit,diff}.js` (each a default export rendering an empty `.panel`), `test/router.test.mjs`, the shell/router/view/breakpoint assertions in `test/frontend.test.mjs` (`:184-225, :315-358`), and `test/frontend-static.test.mjs` (§11 QA layer 3: every `var(--x)` defined in `tokens.css`, every icon id in the sprite, every import resolves, licences next to vendored files, CSP header present on builder and hub index via `test/helpers/boot.mjs`). It rewrites the shell assertions as: zero backdrop-filter, breakpoints 700/1200/2000, eight views plus hidden `diff` in the router, legacy hashes parse. **Done when:** the router test covers round-trip, defaults dropped, legacy `#session=` (→ `open:'term'`) and `#morning`, and unknown view→map; `#/` lands on the map; a test asserts that no URL/hash parameter ever dispatches an action (routes only select and filter).
- **D5 Builder rail** (was T4.5; deps D4, F8b). Owns `ui/rail.js`, `css/rail.css` and `test/rail.test.mjs`. Reads `builders(store)` and the per-builder lanes (§1 store; health from §7 `health` messages, link state from the hub `fleet` rows). Rows show an ALL row plus, per builder, lamp (worst alarm, or state down→p1, stale→p3 with hatch), code plate, lane count `[12]` and segbar; collapsed rows show lamp and code only. The collapse state lives in `localStorage['lb.rail']`. Clicking sets `b=`. Rows have `role="listbox"`/`option` and `aria-selected`.
- **D6b Phone shell** (was T4.6b; deps D4, F8b). Owns `ui/sheet.js`, `css/phone.css` and `test/sheet.test.mjs` (the pure `snapFor(y, vy, h)`). It covers the builder chip strip, the 3-snap sheet and the MAP/LIST/INBOX segmented control, and exports `openSheet(fkey, {mode:'centre'|'sheet'})` used by D6 for L4.
- **D6 Inspector (L3) and L4 takeover** (was T4.6; deps D4, D6b). Owns `ui/inspector.js`, `ui/actionbar.js` (stub: `renderActionBar(el, ctx)` with the button list below; §8 C14 owns it afterwards), `css/inspector.css` and `test/inspector.test.mjs` (the pure `inspectorModel(lane)`). It opens on `sel=` and closes on `sel=null`. Content: header plate plus brackets, data block, ctx and $ sparklines, git/PR/checks, last prompt, assistant line, preview (`previewLines` via `core/ansi.js`), and the action bar slot (`resume pause approve deny terminal interrupt restart kill retire`), each button `icon + aria-label`, through `confirmAction` and `act()` (`core/actions.js`). Exposes a tab registry `registerTab({id, title, mount(el, sel, ctx), unmount()})` (§10 R12 registers PEEK and DIFF). L4 calls D6b's `openSheet(fkey, {mode:'centre'})` on desktop.
- **D7 Tape and annunciator** (was T4.7; deps D4). Owns `ui/tape.js`, `ui/annunciator.js`, `public/js/core/alarm-tiles.js` (`TILES`, `KIND_TO_TILE`, `tileModel`), `css/tape.css`, `css/annunciator.css` and `test/annunciator.test.mjs` (`tileModel` priority max, the unack/ack transitions, the 8 tiles in fixed order, every §7 kind maps to at most one tile). The tape keeps a ring of 500 events from the `event` messages, filters them by scope, renders the newest 1 line collapsed and a `.dt` of 200 rows expanded, and shows the legend at the right. The annunciator reads `alarms(store)` (fed by §7's `{type:'alarms', alarms}` messages). It replaces the `#attention-list`/`#attention-strip` UI.
- **D8 Palette, hotkeys, commands** (was T4.8; deps D4, F8b). Owns `core/commands.js`, `ui/hotkeys.js`, `ui/palette.js`, `ui/fuzzy.js`, `css/palette.css`, `test/hotkeys.test.mjs` (every row of the §2.6 table resolves, view-scoped bindings win while their view is active, chords time out, terminal focus swallows everything except ⌘K, inputs ignored) and `test/fuzzy.test.mjs`. It replaces the keydown handler that F1 moved into `ui/hotkeys.js`. Map-scoped commands call `mapView.focusFind/fit/selectNext/setOverlay` when present (provided by §5 M4); the map's own `onKey` is removed by M4, not here.
- **D9 Board redesign** (was T4.9; deps D4, D3, F8b). Owns `views/board.js`, `views/board-card.js`, `css/board.css`, `test/board.test.mjs` (`dataBlock`: thresholds, the 4-char words, checks overflow `+n`, missing data renders `—`, flags from `stuck`/`paused`/`awaitingApproval`/`reviewReady`), and the "no information was lost" block in `test/frontend.test.mjs:242-293`.
- **(T4.10 Map chrome)**: folded into §5 M3/M4.
- **D11 Box view** (new, thin spec; deps D4, D3). Owns `public/js/views/box.js`, `public/css/views/box.css`, `test/view-box.test.mjs`. Pure `boxModel(store)`: one row per builder from the hub `fleet` rows (or the single local builder): lamp, code plate, `state`, `ageMs`, `latencyMs`, `version` + `versionSkew` (▲ when not `same`), clock skew (▲ when `|clockSkewMs| > 30 s`), the latest §7 `health` sample (cpu/mem/swap/psi/fs as segbars, `alarms` as lamps, 60-point sparklines from `GET /api/fleet/:builder/v1/health?history=1` or `/api/v1/health?history=1`), and a `directUrl` link. Keeps today's box blocks (`boxBlocks`) for the local builder below. Done when the model test covers up/stale/down/misconfigured rows and the render test has `title`/`aria-label` on every icon.
- **D12 Audit view** (new, thin spec; deps D4, D3). Owns `public/js/views/audit.js`, `public/css/views/audit.css`, `test/view-audit.test.mjs`. Hub mode: table of `GET /api/fleet/audit?since=&builder=` (§3 H13) with columns `TS USER VIA B ACTION TARGET OK STATE`, `state ≠ match` rows marked ▲ (`missing-on-builder`, `outcome-differs`) or ◆ (`unknown-settled`). Builder mode: `GET /api/v1/audit?since=` with the chain head and a "verify" hint (`laneboard audit verify`). Filter chips `b`, `q`. Text via `textContent` only.
- **D13 Credit view, fleet** (new, thin spec; deps D4, D3). Owns `public/js/views/credit.js`, `test/view-credit.test.mjs`. Hub mode reads `GET /api/fleet/credit?b=` (§7 O11: `charts.byBuilder`, `account` series, cost rows with `builder` and fkey lanes); builder mode keeps `/api/credit`. Adds a builder column and a builder filter; keeps the existing charts (`usageChart`).
- **D14 Notification prefs sheet** (new, thin spec; deps D4, D3). Owns `public/js/ui/notify-prefs.js`, `test/notify-prefs.test.mjs`. Hub only: a palette action `ACT notifications` opens a sheet bound to `GET/POST /api/notify/prefs` (§7 O9: per-kind toggles, quiet hours `HH:MM`–`HH:MM`, muted fkeys). Pure `prefsModel(prefs, kinds)`; POSTs carry `X-Laneboard: 1`.

## 4. Tests to add

`test/tokens.test.mjs`, `test/design-guardrails.test.mjs`, `test/icons.test.mjs`, `test/components.test.mjs`, `test/router.test.mjs`, `test/frontend-static.test.mjs`, `test/rail.test.mjs`, `test/inspector.test.mjs`, `test/sheet.test.mjs`, `test/annunciator.test.mjs`, `test/hotkeys.test.mjs`, `test/fuzzy.test.mjs`, `test/board.test.mjs`, `test/view-box.test.mjs`, `test/view-audit.test.mjs`, `test/view-credit.test.mjs` and `test/notify-prefs.test.mjs`, with the assertions as listed per task. All of them import only pure modules: no `document` at import time, and DOM code sits behind exported builders called only at runtime. `test/hygiene.test.mjs` must pass over the new files (generic names only in `kit.html` fixtures: `builder-a`, `B1`, `acme`).

## 5. Risks, open questions, human checks

- The `open=` router param extends the conventions; accepted by the integrator (§2.6).
- p1 red and the orange accent are near in hue. Mitigation: shape is mandatory, and the accent never fills a status. HUMAN: check both themes on the real displays (49" ultrawide and phone) at `public/dev/kit.html`.
- Whether the Barlow Condensed uppercase labels stay legible at 10-11px. HUMAN: judge it; the fallback is `--fs-11` as the minimum for labels.
- The 1 Hz flash can be fatiguing. Acked alarms stop flashing by design; HUMAN: confirm that acks persist hub-side (§7 O8 stores live alarms in kv) so a reload does not re-flash.
- Changed keys: `g m`, `g p` and `1-9` change meaning (muscle memory). The `?` overlay lists "changed in fleet UI" for 30 days (`localStorage` flag).
- Ctrl-K inside a terminal goes to readline on purpose, so palette users in a terminal must use ⌘K or Esc first.
- Font downloads need network on the build agent; this is HUMAN if it is offline.
- HUMAN (morning, not a gate: the night does not wait): the overall look ("industrial, nothing fancy") is a taste call. Review `public/dev/kit.html` and the map in the preview; restyle follow-ups are tomorrow's work.

## 6. Dependencies

- **§1** (module split): `public/js/{core,ui,views}` exist, `views/board.js`, `core/store.js` (selectors `builders(store)`, `lanes(store, scope)`, `alarms(store)`, `subscribe`), `core/net.js`, `core/actions.js` (`act`, `ACTION_TIERS`), `core/keys.js` `fkey/parseFkey`, `core/ansi.js`.
- **§2** (actions/tiers): the tier names and `hello.actions`; the `ack-alarm` action is §7's.
- **§7** (stuck, health, alarms), **§8** (approvals, budget, pause), **§10** (reviewReady): the data behind the annunciator, rail lamps, the `$ 5h`/flag fields and the sparklines. Components render `—` or `normal` when the data is absent.
- **§6** (packages/CI): the per-package `checks[]` for the data block and PKG palette entries.
- **§5** (fleet map): owns all map code (`public/js/views/map*`), including the chrome hooks formerly in T4.10.
- **§3**: the `fleet` rows, `/api/fleet/audit`, the read proxy for Box health history.

## 7. PRIVATE (homelab repo)

Private details: homelab repo.
