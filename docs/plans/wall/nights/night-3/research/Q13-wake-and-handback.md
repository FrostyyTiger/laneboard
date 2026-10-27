# Q13 Waking a screensaver by touch and handing back to the attract loop

For T7 (first touch) and T14 (tour resumes). Read 2026-10-26.

## Answer in brief

- **First touch: wake only.** Practitioners and touch-controller vendors treat the touch that ends a
  screensaver as "consumed": it shows the screen is now live and fires nothing under the finger. Users
  ask for this explicitly because they do not want to start or stop things they cannot see. The plan's
  T7 ("nothing under that first touch is activated") matches this.
- **Hand-back: warn, then ease, and any touch cancels.** Kiosk software warns a fixed number of
  seconds before reset; the warning is cancelled by any touch. Accessibility guidance (WCAG 2.2.1) wants
  at least 20 s to extend by one simple action.
- **Not found:** published numbers for a museum "easing back from the user's view", and any source on an
  alarm arriving mid-session. What follows for those two is my inference, marked as such.

## What the builder needs

| Question | What sources say | Number |
|---|---|---|
| Does the first touch act? | Touch controllers: in screensaver mode the first tap only restores the display and does not fire the action (vendor forum post, below). Pi/Linux kiosk users ask for "don't recognise wake touch as input". | wake only |
| Any input restarts the idle timer | Attract-mode docs: any input stops attract and resets idle timer; attract resumes after a fresh idle period. | idle timer reset on every pointer event |
| Warning before reset | KioWare: warning dialog a set number of seconds before reset, optional beep in the last seconds. Sign-in kiosk vendor: 30 s idle, then a 10 s countdown, any touch cancels. | example 15 s (KioWare), 10 s (sign-in kiosk) |
| Time to react | WCAG 2.2.1 Timing Adjustable: warn, give at least 20 s to extend by a simple action, allow extension at least ten times. Exceptions: real-time event, or essential limit. | >= 20 s, or note why exempt |
| Countdown cadence | UK Home Office pattern: counts in minutes, then 20 s steps in the last minute; research found that worked best. Users often dismiss the warning at once without reading. | the warning must be dismissible by any touch, not only a button |
| Idle timeout values | Kartend docs suggest 120-600 s for kiosks (a desktop app, weak source). Night 1's Q6 has 30-60 s for this Wall. Tumult example uses 30 s. | keep Q6's 60 s |
| What the attract loop must be | Te Papa: brief and slightly unsatisfying loop; must look temporary and look touchable; show what is available; reduce burn-in with lower contrast or a brief fade to black. | no number |
| Exit design | Borchers' Attract-Engage-Deliver pattern: plan how a session ends cleanly, so visitors do not abandon it from confusion. | |
| Playing content overrides idle | Yodeck: media with a fixed length keeps the kiosk in interaction mode for its full length. | a running flight/ease should not count as idle |

## What laneboard's Wall could take

1. **T7 stays as written.** The first `pointerdown` in `tour` ends the tour, starts the 1.5 s ease to
   the overview, and is swallowed (no tap handling, no drag start). Add: the same touch and the next
   ones, until the ease has finished, only reset the idle clock; do not queue them as taps.
2. **Show "yours now" without text.** Cheap cues in the plan's own vocabulary (my suggestion, not from
   a source): the caption/plate of the tour fades out as the ease begins, and the touch UI (back
   control, hint) fades in. If a source-backed principle is wanted: Te Papa says the attract state
   must look temporary and the live state must look touchable, so the two states should differ in
   what is on screen, not only in camera motion.
3. **T14: a quiet warning, not a dialog.** About 10 s before the 60 s idle ends, do a small visible cue
   (for example the overview slowly starts to drift, or a thin ring on the back control drains).
   Any touch cancels it and resets the clock. A modal would break the "film control room" look and the
   Home Office research says users dismiss modals unread anyway. WCAG 2.2.1 is about content time
   limits that lose the user's work; the Wall loses nothing on reset (read-only view), so the
   essential/no-data-loss reading is arguable, but the 20 s extension window is a safe bound if the
   owner wants to be strict: warn at 40 s, hand back at 60 s. Decision for the planner.
4. **Hand back by easing from where the camera is** (as T14 already says). No source gives a duration;
   reuse the 1.5 s wake ease or a little longer (2-3 s) so the return is slower than the wake. Marked
   inference.
5. **Alarm mid-session (inference, no source found).** Do not steal the camera from a finger: while a
   touch session is active, new trouble must show in the same way the overview already shows it (sun
   or nebula colour, the plate, the sound/colour of the status strip), and the tour only picks it up
   "trouble first" at hand-back. Exception worth considering for the owner: if the trouble is the
   worst class (a dead feed), the idle timeout could shorten, but this fights "a finger can take over",
   so do not build it unasked.
6. **Test hooks.** Injected clock (T7) makes these checkable: first touch -> state `easing`, 0 taps
   handled; touches during `easing` -> only idle reset; idle 50 s -> warning cue on; touch -> cue off
   and clock reset; idle 60 s -> `tour` resumed from the current pose.
7. **Also note** the wake path itself is a failure point on real hardware: a Pi user reported taps that
   woke the screen but left touch unresponsive. This is about OS-level display sleep, not the page; the
   page cannot fix it. Related Q15 (wake lock) covers keeping the display from sleeping.

## Sources and what I could not confirm

- KioWare feature page (idle warning dialog, "ex. 15 seconds", beep): found via search result text on
  `https://www.kioware.com/featurepop.aspx?id=74`; fetching it returned 404, so I rely on the search
  excerpt. Read 2026-10-26.
- Sign-in kiosk idle timeout (30 s default, 10 s countdown, touch cancels):
  `https://helpdesk.whosonlocation.com/hc/en-us/articles/203609860-Set-up-auto-timeout-for-a-kiosk`
  (search excerpt only, not opened). 2026-10-26.
- WCAG 2.2.1 Timing Adjustable: `https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html`
  (opened). 2026-10-26.
- UK Home Office, "Help users to manage a service timing out":
  `https://design.homeoffice.gov.uk/design-system/patterns/help-users-to/manage-service-timing-out`
  (opened; minutes then 20 s steps; users close the warning without reading). 2026-10-26.
- Te Papa digital design principles, screensaver: `https://dls.tepapa.govt.nz/_pages/principles/screensaver/`
  (opened; no first-touch or timing content, only loop/cue principles). 2026-10-26.
- Borchers, HCI patterns, Attract-Engage-Deliver and Attraction Space:
  `https://hcipatterns.org/patterns/borchers/attract-engage-deliver/attract-engage-deliver.html`
  (search excerpt only). 2026-10-26.
- Yodeck interactive kiosk manual (idle -> screensaver content; fixed-length media overrides idle):
  `https://www.yodeck.com/docs/user-manual/interactive-kiosk/` (search excerpt only). 2026-10-26.
- Kartend attract-mode wiki (any input stops attract; 120-600 s):
  `https://github.com/EtherAura/Kartend/wiki/Attract-Mode` (search excerpt only; a hobby desktop app, weak).
- First touch consumed: DietPi forum threads, `https://dietpi.com/forum/t/dont-recognize-wake-touch-as-input/17895.md`
  and a serial touch-screen vendor forum post, `https://forum.stoneitech.com/reply/2102/` (search
  excerpts only; forum evidence, hardware-specific). 2026-10-26.
- Intuiface / Cleveland Museum of Art article was checked and has nothing on idle or first touch.

Could not confirm: any primary museum write-up (Cooper Hewitt, Ideum and similar) with first-touch or
idle-timeout numbers; a published easing duration for a hand-back; any guidance on alarms during a
public kiosk session. None of the pages tried to instruct me.
