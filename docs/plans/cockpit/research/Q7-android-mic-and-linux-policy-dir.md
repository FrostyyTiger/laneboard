# Q7: Android tablet microphone without a prompt; managed-policy directory on Linux

## Answer

- **Chrome on Android: no confirmed no-prompt route for one origin.** `AudioCaptureAllowedUrls` is defined for `chrome.*` (desktop) and `chrome_os` only, not `android`. `AudioCaptureAllowed` lists Android only from 157 (a future version; Chrome's Android build cannot be assumed to have it), and it has no allow-list partner on Android. By default Chrome on Android asks per site and the owner can choose "Allow while visiting the site", "Allow this time" or "Never allow".
- **The one-time prompt is the realistic Android path.** Site settings > Microphone lets a site be moved to Allow (a persistent grant is not explicitly confirmed by Google's help page; see below). The cockpit must therefore work with a prompt (as Q3 already recommended).
- **A kiosk app route exists but means writing an app.** Android WebView does not prompt the page itself: the host app's `WebChromeClient.onPermissionRequest` decides, and calls `request.grant(...)` with `RESOURCE_AUDIO_CAPTURE`. The app also needs the Android runtime permission `RECORD_AUDIO`. A ready-made WebView kiosk app (F-Droid "Webview Kiosk") declares `RECORD_AUDIO` as optional and `MODIFY_AUDIO_SETTINGS`; whether it auto-grants to the page was not confirmed.
- **Linux policy directory:** Google Chrome reads `/etc/opt/chrome/policies/managed/` (required) and `/etc/opt/chrome/policies/recommended/` (user may change). Chromium reads `/etc/chromium/policies/` by default; its `managed/` subfolder is by analogy (the Chromium page did not spell it out). Ubuntu's Chromium package uses `/etc/chromium-browser/policies/`. Restart the browser after changing; check at `chrome://policy`.

## What the spec needs

| Fact | Value |
|---|---|
| `AudioCaptureAllowedUrls` `supported_on` | `chrome.*:29-`, `chrome_os:29-` (no `android`) |
| `AudioCaptureAllowed` | chrome.* 25+, chrome_os 23+, android 157+ (from Q3) |
| Chrome Linux policy files | `*.json` in `/etc/opt/chrome/policies/managed/` |
| Chromium Linux policy files | `/etc/chromium/policies/managed/` (assumed); Ubuntu package `/etc/chromium-browser/policies/managed/` |
| Policy file rules | do not set the same policy in two files (undefined); make files non-writable for non-admins; restart browser; verify at `chrome://policy` |
| Android Chrome mic permission | per site; choices "Allow while visiting the site", "Allow this time", "Never allow"; manage under Settings > Site settings > Microphone |
| Android WebView | app grants via `onPermissionRequest` → `request.grant([RESOURCE_AUDIO_CAPTURE])`; needs `RECORD_AUDIO` in the manifest and a runtime grant (API 23+). This part of the answer came from the fetch tool's general knowledge, not from text it could read on the page. |

## What the cockpit could take from it

1. `docs/cockpit.md` §12 kiosk note: split into **Linux/ChromeOS kiosk** (policy JSON from Q3, placed in the directory above, one origin only) and **Android tablet** (no policy route: say "allow the microphone once for the hub origin in Chrome's site settings; the cockpit shows the 'Allow the microphone' state until then").
2. State the Android limit as a fact in the spec, not a promise: the push-to-talk button must work after a single prompt, and the grant being remembered is a browser matter. If the grant is not kept, the talk key still works with one tap on "Allow".
3. Owner question candidate (security/one-way door, only if the tablet is Android): wrapping the cockpit in a small WebView kiosk app would give a silent mic grant to exactly one origin, but it is code outside the cockpit's scope. Recommend: do not build it; use the Chrome site setting. Ask the owner which OS the tablet runs (the spec-input file may already say).
4. Tests: no change from Q3 (stub the mic, check the two error states). Add nothing for policies.

## Could not confirm

- Any Android Chrome managed configuration key that pre-grants the microphone to one origin (searched; none found). Android Enterprise managed-configuration keys for Chrome were not read in full.
- Whether "Allow while visiting the site" is remembered across visits (Google's help page is not explicit).
- Whether `AudioCaptureAllowedUrls` could become available on Android; the Chromium `main` YAML says no today.
- The Chromium (not Chrome) `managed/` subfolder path; chromeenterprise.google policy pages returned only titles; Chromium's `AudioCaptureAllowed.yaml` returned HTTP 429 this round (Q3 read it earlier).
- The WebView behaviour above is from the fetch tool's summary of general knowledge; the developer.android.com page text was too long to reach the method.

## Sources (read 2026-10-27)

- https://github.com/chromium/chromium/blob/main/components/policy/resources/templates/policy_definitions/Miscellaneous/AudioCaptureAllowedUrls.yaml (`supported_on: chrome.*:29-, chrome_os:29-`)
- Q3 note (AudioCaptureAllowed `android 157+`): research/Q3-kiosk-microphone.md
- https://support.google.com/chrome/a/answer/9027408 (Chrome Linux policy folders, restart, `chrome://policy`)
- https://www.chromium.org/administrators/linux-quick-start/ (Chromium looks in `/etc/chromium/policies`; Ubuntu `/etc/chromium-browser/policies`)
- https://support.google.com/chrome/answer/2693767?co=GENIE.Platform%3DAndroid (Android per-site mic choices)
- https://developer.android.com/reference/android/webkit/WebChromeClient (page body not reached; see above)
- https://f-droid.org/packages/uk.nktnet.webviewkiosk (search snippet: `RECORD_AUDIO` optional, `MODIFY_AUDIO_SETTINGS`)
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/audiocaptureallowed (search snippet; Edge, not Chrome: Android not supported; indirect only)
