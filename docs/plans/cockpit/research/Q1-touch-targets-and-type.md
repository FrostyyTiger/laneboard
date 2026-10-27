# Q1: touch targets, type sizes and hold thresholds for a desk tablet

## Answer

- **Targets:** WCAG 2.2 AA needs 24x24 CSS px (SC 2.5.8), AAA needs 44x44 (SC 2.5.5). Apple says 44x44 pt, Material says 48x48 dp. Plan on **48 CSS px minimum** for anything the owner taps, **56+ px** for frequent or hard-to-undo actions, and at least 8 px between neighbours.
- **Type:** ergonomics standards (ISO 9241-3xx family, via secondary sources) give 16 arcmin as the minimum and 20-22 arcmin as the recommended character height. At 60-70 cm that is about 2.8-3.0 mm minimum and 3.5-4.5 mm recommended. On the assumed screen (below) that is roughly 22 px minimum and 26-30 px recommended font size for text read at arm's length; Apple's own floor for handheld use is 11 pt.
- **Hold vs tap:** Android long press is 400 ms (AOSP default), tap-vs-scroll 100 ms, touch slop 8 dp. Apple's long-press recogniser default is 0.5 s (see "Not confirmed"). A hold of **400-500 ms** with **8-10 px** slop is the platform consensus. WCAG 2.5.2 (level A) says do not fire on the down event; fire on release or allow cancel.

## What the spec needs

| Item | Value | Source |
|---|---|---|
| WCAG 2.5.8 minimum target (AA) | 24x24 CSS px; smaller allowed if a 24 px circle centred on it touches no other target | WCAG 2.2 Understanding 2.5.8 |
| WCAG 2.5.5 enhanced (AAA) | 44x44 CSS px; exceptions: equivalent, inline, user agent, essential | Understanding 2.5.5 |
| WCAG 2.5.2 pointer cancellation (A) | no down-event action, or abort/undo, or up reverses it | Understanding 2.5.2 |
| Material / Android | 48x48 dp minimum touch target, visible element may be smaller with padding | Android accessibility guide |
| Apple | 44x44 pt hit target | Apple HIG (not confirmed from the page, see below) |
| Android `DEFAULT_LONG_PRESS_TIMEOUT` | 400 ms (user setting can override) | AOSP `ViewConfiguration.java` |
| Android `TAP_TIMEOUT` | 100 ms | same |
| Android `DOUBLE_TAP_TIMEOUT` | 300 ms | same |
| Android `TOUCH_SLOP` | 8 dp (paging slop 16 dp) | same |
| Android pressed state | 64 ms | same |
| Android hover tooltip | shows 500 ms, hides 15 s | same |
| Character height, minimum | 16 arcmin | secondary: W3C mailing list, Activu PDF |
| Character height, recommended | 20-22 arcmin | same |
| ISO 9241 assumed desktop distance | 600 mm, range 450-750 mm | W3C mailing list post |

### Converting visual angle to CSS px (derived, my arithmetic)

Character height h = d * tan(angle). At d = 600 mm: 16' = 2.8 mm, 20' = 3.5 mm, 22' = 3.8 mm. At d = 700 mm: 3.3 / 4.1 / 4.5 mm.

The physical size of the owner's tablet is not in the files I read. **Assumption for the numbers below: 2736x1824 physical px on a 12.3 in panel, about 267 ppi, so 1368 CSS px is about 260 mm wide and 1 CSS px is about 0.19 mm (5.3 px/mm).** If the real panel differs, scale everything by (real px/mm) / 5.3.

- Capital height 2.8 mm = about 15 CSS px, so font-size about 21-22 px (cap height about 0.7 em). This is the floor for secondary labels at 60 cm.
- Capital height 3.5-4.5 mm = about 18-24 CSS px, so font-size about 26-34 px. Use this for text the owner reads while speaking (live transcript, agent answer).
- A 48 dp target is 7.6 mm (at the 160 dpi dp definition); at 5.3 px/mm that is about 40 CSS px, and 44 CSS px is 8.3 mm. So 48 CSS px (9 mm) clears both Apple and Material physically, with margin for a slanted screen and a hand that is not aimed carefully.

## What the cockpit could take from it

1. Every tappable thing is at least 48x48 CSS px, the hit area may exceed the drawn shape (padding), gap at least 8 px. Primary actions (talk, stop/interrupt, confirm a fenced action) at least 64x64.
2. Type scale at 1368x912: transcript and agent text 28 px; card titles and lane names 24 px; secondary labels 22 px; nothing below 20 px except non-essential decoration. Test: Playwright computes `getBoundingClientRect` and `getComputedStyle` for every `[data-tap]`/button/link and fails below 48 px or 20 px.
3. Hold gesture (if any, for example hold-to-talk): fire "armed" feedback at 100 ms (pressed state), commit the hold at 400 ms, cancel if the finger moves more than 10 CSS px (8 dp slop, a little more for a large screen). Never make hold the only way: provide a visible tap alternative (Apple and WCAG both say so). Act on release or give an undo (WCAG 2.5.2).
4. Double tap window 300 ms; avoid depending on it.
5. Keep hold and tap thresholds as named constants in one place so the owner can change them (`D<n>` decision, overrule: change the constants).
6. Ask the owner (Q-O) for the tablet's physical size and the real viewing distance; the type scale above is derived from an assumption.

## Not confirmed

- The Apple HIG pages returned only titles to the fetch tool; the summariser filled in 44 pt, the 11 pt text floor and the 0.5 s long-press default from its own memory. Treat those as unverified until someone reads the live page. The same goes for SwiftUI `onLongPressGesture` defaults (0.5 s, 10 pt).
- The Material page excerpt confirmed 48 dp but not a spacing value; "8 dp between targets" is common practice, not confirmed here.
- ISO 9241-303 and ANSI/HFES 100 are paywalled. 16' and 20-22' come from secondary sources (W3C mailing list post, an Activu PDF) that agree with each other. A 1984 German paper cited there gives 18' (2.6 mm).
- No source found for browser (Chromium) touch long-press timing in CSS px; Chromium's own long-press for context menus on Android follows the platform value.
- Tablet physical size and viewing distance: not in the repo files read.

## Sources

- WCAG 2.2 Understanding 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html (read 2026-10-26)
- WCAG 2.2 Understanding 2.5.5 Target Size (Enhanced): https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html (read 2026-10-26)
- WCAG 2.2 Understanding 2.5.2 Pointer Cancellation: https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html (read 2026-10-26)
- Android accessibility guide, touch target 48dp: https://developer.android.com/guide/topics/ui/accessibility/apps (search result, 2026-10-26)
- Material 3 accessibility, 48dp: https://m3.material.io/foundations/designing/structure (read 2026-10-26, excerpt only)
- AOSP ViewConfiguration constants: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/view/ViewConfiguration.java (read 2026-10-26)
- Apple HIG accessibility / typography: https://developer.apple.com/design/human-interface-guidelines/accessibility and .../typography (page text not retrieved; values unverified)
- Visual angle: W3C CSS archive post https://lists.w3.org/Archives/Public/public-css-archive/2020Jun/0612.html ; Activu https://activu.com/uploads/Optimal-Font-Size.pdf (search snippets, 2026-10-26)
