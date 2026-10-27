# Q15 — Touch that never breaks a kiosk (Chromium on a Windows touch tablet) and Screen Wake Lock

## Answer

- The page can stop: pinch zoom, double-tap zoom, browser panning (`touch-action: none` on the Wall's root/canvas),
  scroll chaining and bounce inside the page (`overscroll-behavior: none` on `html` and `body`), the long-press context
  menu (`contextmenu` handler). It cannot reliably stop Windows' own edge swipes (Widgets from the left, Notification
  Center from the right, the taskbar, 3/4-finger gestures); that is OS policy (`AllowEdgeSwipe`) or Assigned Access.
  Chromium's own back/forward edge swipe is a Chromium flag, and reports on whether it works are mixed.
- Screen Wake Lock needs a secure context. `https://` or `http://localhost` is fine; a plain `http://` LAN address
  is not, so on a real tablet `navigator.wakeLock` may simply be missing. The code must feature-detect and stay silent.
- Wake Lock needs no user tap (the spec has no activation check), but it is refused when the document is hidden and
  released when the document becomes hidden. Re-request on `visibilitychange`. Browsers may also refuse or drop it on
  low battery, and an OS or power policy can override it.

## What the builder needs

CSS / JS the page controls (all verified against MDN unless marked):
- `touch-action: none` on the element that owns gestures (the galaxy canvas or its wrapper). MDN: the browser
  intersects the `touch-action` of the touched element and its ancestors up to the first scroll container, so any
  restriction on the way applies; set it on the top element, not on every child. A change after a gesture has started
  does not affect that gesture. `manipulation` only removes double-tap zoom (and the click delay); it still lets
  the browser pan and pinch, so it is the wrong choice for a canvas that does its own pinch (Q12).
- With Pointer Events, if the browser starts a gesture the page gets `pointercancel`: handle it as "finger lifted,
  no tap". `touch-action: none` prevents it.
- `overscroll-behavior: none` on `html` and `body` (MDN: applies to scroll containers; `none` also removes bounce,
  `contain` keeps it). Keep the Wall `overflow: hidden` with `height: 100dvh`; a page that cannot scroll has nothing
  to pull-to-refresh. MDN does not say that it stops the browser's back/forward edge swipe; do not rely on it for that.
- `contextmenu` → `preventDefault()` on the Wall root, and `user-select: none; -webkit-touch-callout: none` on
  labels, so a long press on a planet is not a menu or a text selection. (Long-press as an app gesture is the page's
  to define; Q6 has the timings.)
- Viewport meta: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no` is honoured by mobile
  browsers; desktop Chromium on Windows with a touchscreen does pinch-zoom the page unless `touch-action` blocks it,
  so the meta tag is a belt, not the braces. MDN warns that `touch-action: none` blocks low-vision zoom: acceptable
  on a wall/kiosk page that has its own zoom, and worth a line in the docs. (Viewport meta behaviour on desktop:
  from experience, not confirmed in a primary source I read.)
- Optional safety net: `gesturestart` / multi-touch `touchmove` `preventDefault()` with `{passive:false}` (reports
  from kiosk forums say JS handling was what finally worked when flags did not).

Chromium flags (launch command; the owner's kiosk shortcut, not the page):
- `--kiosk` (fullscreen, no UI), `--overscroll-history-navigation=0` (the flag's description: 1 enables, 0
  disables, default enabled). One 2014 kiosk write-up says it worked; a balena forum post says a left swipe still
  navigated back despite it. Conflict: test on the exact build.
- `--disable-pinch`: one forum user found it helpful, a Qt forum user still could pinch. Unconfirmed; treat as
  optional and keep the page-level `touch-action: none` as the real guard.
- Pull-to-refresh: could not find a Windows/desktop policy for it; I found nothing on a `PullToRefreshEnabled`
  policy, so do not cite one. On desktop Chromium, pull-to-refresh is mainly an Android/ChromeOS behaviour; with
  `overflow:hidden` and `overscroll-behavior:none` there is nothing for it to act on.
- Chrome policies named in Google's docs: `TouchVirtualKeyboardEnabled` (on-screen keyboard; the Wall has no text
  fields, so it should never appear), `BrowserGuestModeEnabled` / `BrowserGuestModeEnforced` (stateless session).

OS side (Windows; owner, not the page):
- Group Policy "Allow edge swipe" = Disabled (Computer Configuration > Administrative Templates > Windows Components >
  Edge UI), registry `HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI\AllowEdgeSwipe` = 0 (MDM CSP
  `LockDown/AllowEdgeSwipe`, from a community source, verify on Microsoft Learn). Group Policy editor needs
  Pro/Enterprise/Education. Reported effect: no system UI from any edge. A medical-kiosk thread says the taskbar still
  appeared after a reboot until the first tap: anecdotal. Updates can reset the policy.
- Windows Assigned Access (single-app kiosk) is the proper lock-down. I could not confirm in this round how it
  treats edge swipes on a Surface, nor any Surface-specific setting. Say so to the owner rather than promise.
- Net: the first ~10 mm of every screen edge may belong to Windows. Keep the Wall's own controls (back control, T13)
  away from the screen edges by an inset, e.g. 24 css px, unless the owner has disabled the edge swipe.

Wake Lock (MDN, W3C spec, web.dev/Chrome docs):
- Chrome/Edge 84+, Firefox 126+, Safari 16.4+. `[SecureContext]`, window only.
- `request('screen')` rejects with `NotAllowedError` if: the document is not fully active, hidden, the permissions
  policy `screen-wake-lock` disallows it (default allowlist `self`, so a Wall in a cross-origin iframe fails
  without `allow="screen-wake-lock"`), the UA/platform denies it (power saver), or permission is denied. The spec has no
  user-activation requirement and does not mention fullscreen. Low battery is advisory: a UA may ignore or
  release; the spec says an OS-level failure can look like success.
- Released when the document becomes hidden (minimised, other tab, display off); a sentinel cannot be reused.
  Pattern: keep one `sentinel` variable, `request()` at start, and on `visibilitychange` → visible, request a new
  one if there is none (the MDN snippet does this; better: also when `sentinel.released`). Listen for `release` to
  clear the variable. Wrap in `try/catch` and ignore the error silently (README rule: nothing that nags).
- Not a substitute for the OS: Windows "turn off the screen after N minutes" on battery or a group policy can still
  win in ways I could not confirm; the owner should also set the power plan to never sleep on the display.
  The Wake Lock also does not stop a scheduled lock screen or screensaver set by policy.

## What laneboard's Wall could take

1. T7 (touch): `touch-action: none` on the stage wrapper; `overscroll-behavior: none` and `overflow:hidden` on
   `html, body`; a `contextmenu` preventDefault on the stage; `pointercancel` treated as "no tap"; a test that
   reads the computed styles (`getComputedStyle(stage).touchAction === 'none'`) and that dispatches a `contextmenu`
   event and sees `defaultPrevented`.
2. Keep controls an edge inset (24 css px or more) away from screen edges; documented in the Kiosk note.
3. Wake lock (Later): `if (!('wakeLock' in navigator)) return;` at start, request, re-request on visible, clear on
   `release`; a test with a fake `navigator.wakeLock` (as night 2's T32 text already asks): one request at start,
   one more after hidden → visible, no error shown when the request rejects. In the docs: it needs HTTPS or
   localhost; a LAN http URL has no wake lock. Options for the owner: serve the Wall on https, open it as
   `http://localhost` through a tunnel/proxy on the tablet, or start Chromium with the "treat insecure origin as
   secure" flag for that one origin (a Chromium flag `--unsafely-treat-insecure-origin-as-secure=http://host:port`
   with a profile dir; named from memory, not read in a primary source this round — verify before documenting).
4. A "Kiosk" section in the docs: launch line (`--kiosk --overscroll-history-navigation=0`, optional
   `--disable-pinch`), the Windows `AllowEdgeSwipe` policy, power plan, and the honest note that edge swipes and
   Assigned Access were not confirmed on a Surface.

## Could not confirm

- Whether `--overscroll-history-navigation=0` still works in current Chromium on Windows (mixed reports, old).
- Whether `--disable-pinch` works on Windows (mixed).
- Any Chromium pull-to-refresh policy on desktop; Assigned Access vs edge swipes on Surface; Microsoft's own
  documentation of `AllowEdgeSwipe` (only community pages read).
- The insecure-origin flag name (not read in a source this round).
- A search result page (a 2014 write-up) was a blog; none of the pages tried to give instructions.

## Sources (read 2026-10-26)

- MDN, Screen Wake Lock API: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- W3C, Screen Wake Lock API: https://www.w3.org/TR/screen-wake-lock/
- Chrome for Developers, Wake Lock: https://developer.chrome.com/docs/capabilities/web-apis/wake-lock
- MDN, touch-action: https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- MDN, overscroll-behavior: https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior
- Chromium, permissions for powerful features (secure context rule only): https://chromium.googlesource.com/chromium/src/+/main/docs/security/permissions-for-powerful-web-platform-features.md
- Search results (summaries only, pages not opened): 404 Tech Support on back/forward swipe
  https://www.404techsupport.com/2014/02/disable-backforward-navigation-swiping-gestures-in-google-chrome-for-windows/ ;
  balena forum https://forums.balena.io/t/how-to-disable-left-swipe-on-chromium/368877 ;
  moOde forum https://moodeaudio.org/forum/showthread.php?tid=6927 ; Qt forum https://forum.qt.io/post/467340 ;
  Toradex https://community.toradex.com/t/running-chromium-with-zoom-disabled/20364 ;
  Intuiface, Disable Edge Swipe on Windows https://support.intuiface.com/hc/en-us/articles/24875354537244-Disable-Edge-Swipe-Gestures-on-Windows ;
  Windows 11 Forum https://www.elevenforum.com/t/enable-or-disable-touch-screen-edge-swipe-gestures-in-windows-11.3717/ ;
  medical kiosk thread https://www.elevenforum.com/t/medical-kiosk-taskbar-problem.27384/ ;
  Google Chrome Enterprise virtual keyboard policies https://support.google.com/chrome/a/answer/14745448
