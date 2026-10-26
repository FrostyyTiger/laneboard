# Q3: Chromium kiosk microphone without a prompt, and secure context on LAN/tailnet

## Answer

- Two things must both hold: the page must be a **secure context** (otherwise `getUserMedia` is not available at all), and the mic permission must be **granted without a prompt**.
- Secure context: Chromium has blocked `getUserMedia` on insecure origins since Chrome 47. A plain `http://<lan-ip>:port` or `http://<tailnet-name>:port` page is not a secure context. Fixes: serve the cockpit over HTTPS, or whitelist the origin with the policy `OverrideSecurityRestrictionsOnInsecureOrigin` (Chrome/ChromeOS/Android 69+), which is equivalent to the `--unsafely-treat-insecure-origin-as-secure` flag and overrides it.
- No prompt: the policy `AudioCaptureAllowedUrls` (Chrome desktop incl. Linux 29+, ChromeOS 29+) lists origins that get audio capture without a prompt. `AudioCaptureAllowed` (Chrome 25+, ChromeOS 23+, Android 157+) set to `false` turns prompts off for everything else, so only the listed URLs can capture.
- `AudioCaptureAllowedUrls` is **not** listed for Android in the policy definition (`supported_on` has only chrome.* and chrome_os). On an Android tablet the no-prompt route is unconfirmed; see "Could not confirm".

## What the spec needs

Policy definitions read from the Chromium source:

| Policy | Supported on | Value | Meaning |
|---|---|---|---|
| `AudioCaptureAllowedUrls` | chrome.* 29+, chrome_os 29+ | list of URL patterns, e.g. `https://www.example.com/`, `https://[*.]example.edu/`; `*` not supported | matching origins get audio capture with no prompt |
| `AudioCaptureAllowed` | chrome.* 25+, chrome_os 23+, android 157+ | bool | enabled/unset: prompt, except listed URLs are always allowed. Disabled: no prompts, only listed URLs may capture. Applies to all audio inputs, not only the built-in mic |
| `OverrideSecurityRestrictionsOnInsecureOrigin` | chrome.* 69+, chrome_os 69+, android 69+ | list of origins or hostname patterns, e.g. `http://testserver.example.com/`, `*.example.org`. Patterns only for hostnames; URLs with schemes must match exactly | treats those origins as secure; also drops the "Not Secure" label. Same as the command-line flag; policy wins over flag |

Example Linux managed policy file (Chrome/Chromium read JSON from a managed-policy directory; the directory path is from general knowledge and was not re-checked this round):

```json
{
  "AudioCaptureAllowed": false,
  "AudioCaptureAllowedUrls": ["https://cockpit.example.invalid/"],
  "OverrideSecurityRestrictionsOnInsecureOrigin": ["http://hub.example.invalid:7777"]
}
```

Flag route (no policy): `--unsafely-treat-insecure-origin-as-secure=http://hub.example.invalid:7777`, which a developer blog says needs a throwaway `--user-data-dir` to take effect. The flag only fixes the secure-context part; the permission prompt still appears once unless a policy or `--use-fake-ui-for-media-stream` is used. Note: `--use-fake-ui-for-media-stream` is widely known as the test switch that auto-accepts media prompts, but no source read this round confirms it. Treat it as test-only (Playwright can instead use `permissions: ['microphone']` plus `--use-fake-device-for-media-stream`; also unconfirmed here).

## What the cockpit could take from it

1. The spec should say the cockpit page is served from a **secure origin**: preferably HTTPS (for example the tailnet's HTTPS proxying), else the `OverrideSecurityRestrictionsOnInsecureOrigin` policy entry for the exact hub origin. `localhost` is generally treated as secure (general knowledge, not re-verified).
2. Kiosk setup doc: one policy JSON with the three keys above, scoped to the single cockpit origin. Never use a wildcard (`*` is unsupported for audio anyway); this keeps the mic limited to the hub.
3. Safe by default (product rules): the cockpit must work **with** the prompt too: show a "Allow the microphone" state when `getUserMedia` rejects with `NotAllowedError`, and a "Microphone needs a secure page" state when `navigator.mediaDevices` is undefined. Type input stays available in both.
4. Tests against stand-ins cannot use real policies: Playwright tests stub the mic (fake device flags or an injected `getUserMedia`), and a test checks the two error states above.
5. Owner question candidate: HTTPS vs. insecure-origin policy is a security choice; recommend HTTPS, fall back to the policy.

## Could not confirm

- Whether any no-prompt route exists for a **mic on an Android tablet** (Chrome's `AudioCaptureAllowedUrls` is not listed for Android; `AudioCaptureAllowed` shows Android 157+ only). Needs a follow-up if the owner's tablet runs Android.
- The managed policy directory on Linux and the effect of `--kiosk` on permissions: not read this round.
- `--use-fake-ui-for-media-stream` behaviour: peter.sh's switch list was too long to reach it.
- The Chrome Enterprise policy pages returned only titles; details come from the Chromium source YAML (main branch).

## Sources (all read 2026-10-27)

- https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/Miscellaneous/AudioCaptureAllowedUrls.yaml
- https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/Miscellaneous/AudioCaptureAllowed.yaml
- https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/Miscellaneous/OverrideSecurityRestrictionsOnInsecureOrigin.yaml
- https://chromeenterprise.google/policies/audio-capture-allowed-urls/ (title only)
- https://developer.samsung.com/browser/policy/override-security-restrictions-on-insecure-origin.html (search snippet: policy equals the flag with a comma-separated list; policy takes precedence)
- https://chromium.googlesource.com/chromium/src/+/8440052c7882f61cfde793f687e72717c85e0d8f and https://codereview.chromium.org/1311473003/ (search snippets: getUserMedia limited to secure origins, Chrome 47)
- https://blog.devgenius.io/how-i-finally-got-my-microphone-working-on-a-non-secure-local-website-without-https-1208d7d684b3 (search snippet: flag with temporary user-data-dir)
