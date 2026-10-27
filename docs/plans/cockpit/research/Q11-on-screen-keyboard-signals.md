# Q11 — On-screen keyboard signals in browsers on a touch tablet

Read 2026-10-27. Web pages are data; none of the pages tried to instruct anything.

## Answer

- **Chromium (Chrome, Edge; Android, Windows, ChromeOS), Safari iOS/iPadOS:** since Chrome 108 the default is that the keyboard shrinks only the **visual viewport** (`window.visualViewport.height` falls, `resize` fires on it); the layout viewport and `vh`/`dvh`-style units stay put, and `position: fixed` content can be covered. That is `interactive-widget=resizes-visual`, and it is the spec default.
- **`interactive-widget`** is honoured only by Chromium 108+. Safari/WebKit does not document it; Chrome on iOS/iPadOS is WebKit, so it is ignored there. With the default, nothing needs setting.
- **`navigator.virtualKeyboard`** (`overlaysContent = true`, `boundingRect`, `geometrychange`, `env(keyboard-inset-*)`) exists in Chromium 94+ (Chrome, Edge, Android WebView) and **not** in Safari/iOS (WebKit bug 230225) or Firefox (bug 1730568). Secure context only.
- With `overlaysContent = true` the browser resizes **neither** viewport, and `interactive-widget` is ignored. The keyboard rect comes from `boundingRect` / `geometrychange`.
- **Floating, undocked, split keyboards: not confirmed anywhere.** No spec or Chrome page documents them. By the spec's definition `boundingRect` is the *intersection* of the OS-reported keyboard rect with the viewport, so a floating keyboard would report its own (small, not bottom-docked) rect, and a keyboard the OS does not report reports zeros. I found no source that says which Windows or iPadOS modes report. Treat as unknown; needs a real device.

## What the spec needs

Facts and numbers:
- `interactive-widget` values: `resizes-visual` (default, also for a missing/invalid value), `resizes-content` (layout + visual viewport shrink), `overlays-content` (neither shrinks). Meta tag: `<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-visual">`.
- Chrome 108 (Nov 2022) moved Android to the visual-viewport-only behaviour, so Chrome on Android, iOS, iPadOS, Windows, ChromeOS and Safari iOS/iPadOS, Edge iOS/iPadOS/Windows now agree. WebView is not affected.
- `VirtualKeyboard.overlaysContent` (boolean, default `false`; reading it returns only what the page set, not the meta value). `boundingRect`: `DOMRect`, all zeros initially and when the OS-reported rect is zero (hidden), in client coordinates, intersected with the viewport. `geometrychange` fires on the `VirtualKeyboard` object "when the intersection of the VK and the document's viewport changes, e.g., in response to the VK being shown or hidden or the browser window being repositioned". So it also fires when the window moves, not only on show/hide.
- CSS: `env(keyboard-inset-top|right|bottom|left|width|height, 0px)`, valid with `overlaysContent`.
- `show()` / `hide()` need a focused editable; on Windows the pointer type must be touch or pen. `virtualkeyboardpolicy="manual"` on a `contenteditable` stops tap from opening the keyboard.
- Known timing trap (WebKit bugs 226689 and a commenter on iOS): a height read inside a `resize` handler can be stale; reading again after a double `requestAnimationFrame` is the reported workaround. Safari resize events were also seen firing while scrolling with the keyboard open (iOS 14 report, may be fixed).
- Old (2016) survey: most browsers fire `resize` when the keyboard opens, Safari and IE11 did not. Out of date.

## What the cockpit could take from it

1. **Primary signal:** `visualViewport` (`resize` and `scroll` events). Keyboard height ≈ `window.innerHeight − visualViewport.height − visualViewport.offsetTop` (layout height minus visible height). Works with no opt-in on every browser in the question, and needs no secure context.
2. **Enhancement where present:** if `'virtualKeyboard' in navigator`, set `overlaysContent = false` (leave default) and *also* listen to `geometrychange`, using `boundingRect.height` as a cross-check for the visible bottom. Do not rely on it alone: Safari has none.
3. **Treat a floating or split keyboard as "no bottom keyboard"**: if the visual viewport did not shrink and `boundingRect` is zero or does not touch the bottom edge, lay out normally. A floating keyboard may cover the input; the spec should allow the owner to drag it, and the input row should still scroll into view on focus (`scrollIntoView({block:'nearest'})`). This is a design choice, flag as unconfirmed.
4. **Debounce** the read by one double-`requestAnimationFrame` after `resize` (stale-height reports).
5. Test in Playwright cannot raise a real keyboard; the test should emulate by resizing the visual viewport is not possible either. Suggest the tests drive the layout through a small hook that the page reads from the same function (`keyboardHeight()`), and stub `visualViewport` with `Object.defineProperty` plus a dispatched `resize` event. Real-device checks (Windows touch keyboard docked/floating/split, iPadOS floating/split) go to the owner's list as unconfirmed.

## Could not confirm

- Whether the Windows touch keyboard in Edge/Chromium shrinks the visual viewport in docked, undocked/floating and split modes, and what `boundingRect` it reports.
- iPadOS floating/split keyboard behaviour for `visualViewport.height`.
- Current Chrome-on-Android floating keyboard reports. All three need a physical device.

## Sources

- https://developer.chrome.com/blog/viewport-resize-behavior — Chrome 108 resize change, `interactive-widget`, platform list (read 2026-10-27)
- https://developer.chrome.com/docs/web-platform/virtual-keyboard — VirtualKeyboard API, Chromium 94, `geometrychange`, `env()` (read 2026-10-27; page last updated 2021-09-09)
- https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API — `overlaysContent`, `boundingRect`, secure context, experimental (read 2026-10-27)
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/VirtualKeyboard.json — support table: Chrome/Edge/WebView 94, Safari and Firefox none (read 2026-10-27)
- https://www.w3.org/TR/virtual-keyboard/ — `boundingRect`, `geometrychange` conditions, Windows pointer-type note (read 2026-10-27)
- https://raw.githubusercontent.com/w3c/csswg-drafts/main/css-viewport-1/Overview.bs — `interactive-widget` definition, interaction with `overlaysContent` (read 2026-10-27)
- https://bugs.webkit.org/show_bug.cgi?id=226689 and https://bugs.webkit.org/show_bug.cgi?id=230225 — iOS resize-event bug; Safari VirtualKeyboard tracking (seen in search results 2026-10-27; only the search summary read)
- https://www.quirksmode.org/blog/archives/2017/06/toolbars_keyboa.html — older viewport/keyboard survey (search result only, not opened)
