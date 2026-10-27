# Q12 Touch on a 3D map: orbit, dolly, inertia, tap vs drag, hitting a small moving target

## Answer

- One finger drags = orbit (three.js `OrbitControls`, Cesium rotate on left drag); two fingers = dolly (pinch) plus pan or tilt. Mapbox/MapLibre use one finger = pan, two fingers = zoom + rotate, two fingers dragging vertically = pitch.
- Pinch is a **ratio**: three.js uses `ratio ** zoomSpeed`, MapLibre `log2(d / lastD) * rate`. Both are multiplicative, so equal finger spread gives equal zoom "feel" at any distance. Use the ratio of finger distances per frame.
- Inertia is a per-frame decay (three.js: remaining delta times 0.95 each frame at `dampingFactor` 0.05) or a time-based decay (Cesium `exp(-tau t)`, `tau = (1 - inertia) * 25`; MapLibre fixed deceleration per second). Time based is frame-rate independent: pick that for a throttled tablet.
- Tap vs drag: Mapbox/MapLibre tap = under 500 ms and under 30 px of movement; click tolerance 3 px (MapLibre option default) or 1 px (the mouse handler fallback). three.js has no dead zone at all.
- A small target is hit by giving it a larger invisible pick radius in screen space, not by exact geometry (details below).

## Numbers for the builder

| Thing | three.js OrbitControls | Cesium ScreenSpaceCameraController | MapLibre / Mapbox GL |
|---|---|---|---|
| 1 finger | rotate | rotate (`LEFT_DRAG`) | pan |
| 2 fingers | dolly + pan | pinch = zoom and tilt (both in default lists) | zoom + rotate; both fingers vertical = pitch |
| Damping / inertia | `dampingFactor` 0.05 per frame (off by default) | `inertiaSpin` 0.9, `inertiaTranslate` 0.9, `inertiaZoom` 0.8 (0 = none) | `linearity` 0.3, easing bezier(0,0,0.3,1); decel per second: pan 2500, zoom 20, bearing 1000, pitch 1000; max speed: pan 1400, zoom 1400, bearing 360 deg/s, pitch 90 deg/s |
| Velocity window | none (decay of last delta) | inertia only if press-to-release < 0.4 s (`inertiaMaxClickTimeThreshold`) | last 60 ms of movement (`VELOCITY_WINDOW`) |
| Pinch to zoom | `pow(dEnd/dStart, zoomSpeed)` | handled in the event aggregator (not confirmed how) | `log2(d / lastD) * zoomRate` (1) |
| Wheel | `pow(0.95, zoomSpeed * abs(deltaY * 0.01))`; deltaY x16 in line mode, x100 in page mode, x10 for ctrl-wheel (trackpad pinch) | WHEEL | zoom per wheel delta (not read) |
| Pitch clamp | polar 0 to PI by default (you set it) | `maximumTiltAngle` undefined = free; flip blocked | `maxPitch` default 60, range 0-180 per MapLibre docs |
| Per-frame cap | none | `maximumMovementRatio` 0.1 of window size per frame | `maxSpeed` above |
| Drag start dead zone | none | none for touch (only a 0.5 px skip for inertia) | click tolerance 3 px (MapLibre option); mouse handler 1 px |
| Rotate speed | `2*PI * dx / clientHeight` per px (one screen height of drag = one full turn) | | |

Two-finger disambiguation in MapLibre (the useful part, it is the only one of the four that writes it down):
- zoom starts after the distance changes by 0.1 zoom units (log2 ratio about 7 %);
- rotate starts after 25 px of movement along the circle the fingers describe (so the angle needed is larger when fingers are close together);
- pitch needs both fingers to move at least 2 px, mostly vertically, in the same direction; if only one finger moves it waits 100 ms before rejecting; the pitch delta is the mean vertical movement times -0.5 (degrees per px).
Each gesture has its own threshold and the first to pass wins; that is how a pinch does not rotate by accident.

Tap: single-tap recognizer aborts if more fingers arrive, any finger moves over 30 px, or the touch lasts over 500 ms; multi-tap interval 500 ms (Mapbox `tap_recognizer`).

Palm and contact size: the W3C Pointer Events spec gives `width`/`height` as contact geometry in CSS px, default 1 when the hardware does not report it. A user agent *may* send `pointercancel` for palm rejection and "it is not possible for authors to suppress this behavior". None of the three libraries filters by contact size; they rely on the OS. A page that wants to is on its own (see below).

Hitting a small moving target: three.js `Raycaster.params.Points.threshold` / `Line.threshold` are world-unit radii (default 1), meshes ignore them, and the docs advice is an invisible larger proxy. Values from memory, the page I fetched was only its nav index; unconfirmed.

## What laneboard's Wall could take

1. **One finger = orbit, two fingers = pinch dolly (ratio per frame) + two-finger drag pan.** Same as OrbitControls, so a user who has touched Google Earth or a three.js demo already knows it. Keep no pitch dial: clamp pitch to a band (my suggestion, not from a source: 20 to 80 degrees from the vertical so the galaxy never goes flat edge-on or looks straight down).
2. **Dolly = `dist *= (d_prev / d_now)`** per move event, clamped to min/max distance; wheel = `0.95 ** (k * |deltaY| * 0.01)`.
3. **Inertia, time-based:** on release use the velocity of the last 60 ms (MapLibre), decay `v *= exp(-t / tau)` with tau about 0.3-0.5 s for orbit (Cesium 0.9 gives `tau = 2.5` in its units of seconds; that feels long on a wall: a guess, test it), and skip inertia if the finger rested before release (velocity under a small value). Cap the per-frame angle at a fraction of the screen as Cesium does (0.1 of the width) so a stutter at 4x CPU throttle does not spin the galaxy.
4. **Tap vs drag:** tap = under 500 ms and under 10 px (Mapbox's 30 px is for a map with a mouse-like use; a finger on a 13" tablet drifts about that much, but a 30 px slop makes a slow orbit start feel dead. Use drag start at 8-10 px for touch; this number is a judgement, not a sourced one). Cancel the tap when a second finger lands. Treat `pointercancel` as pointerup with no tap.
5. **Palm:** reject any touch whose `width` or `height` exceeds a threshold only if the device reports geometry (value 1 means "not reported"). The threshold needs measurement on the Surface; no source gives a number. Open question, see below.
6. **Hit test a moving sun/planet in screen space:** project each target's centre to the screen each frame (it is already needed to draw its label), then on tap pick the nearest within `max(sprite radius, 22-24 px)` (Q6 has the finger size in mm); prefer the one with trouble on a tie. Cheaper than raycasting and gives the same "fat finger" tolerance as an invisible proxy. While the target moves, hit-test against the position at `pointerdown`, not at `pointerup`, so a planet that drifts 10 px in 100 ms does not slip away.
7. **Auto-orbit hands over:** the manual drag should overwrite the camera angle directly, and inertia then starts from the current angle: no blending needed because the idle loop is paused (Q13 covers the hand-back).

## Could not confirm

- Cesium's pinch maths (it lives in `CameraEventAggregator`, not fetched).
- three.js Raycaster defaults from the docs page (page returned only navigation); the values are from memory.
- Any numeric palm-rejection rule from a primary source; the only primary statement is that the UA may cancel and authors cannot stop it.
- Mapbox GL JS `main` has moved handler files; the MapLibre fork was read instead. They share these constants as of their common ancestor, not checked file by file.
- Google Earth's own touch rules: no primary write-up found; not used.

## Sources (read 2026-10-26)

- https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/controls/OrbitControls.js (OrbitControls source: damping, zoom, rotate, touches)
- https://cesium.com/learn/cesiumjs/ref-doc/ScreenSpaceCameraController.html (inertia, mappings, maximumMovementRatio)
- https://raw.githubusercontent.com/CesiumGS/cesium/main/packages/engine/Source/Scene/ScreenSpaceCameraController.js (exp decay, tilt, click threshold)
- https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/ui/handler/two_fingers_touch.ts (pinch/rotate/pitch thresholds)
- https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/ui/handler_inertia.ts (inertia constants)
- https://raw.githubusercontent.com/mapbox/mapbox-gl-js/main/src/ui/handler/tap_recognizer.ts (tap 500 ms / 30 px)
- https://raw.githubusercontent.com/mapbox/mapbox-gl-js/main/src/ui/handler/mouse.ts (1 px drag tolerance)
- https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/ (maxPitch 60, clickTolerance 3)
- https://www.w3.org/TR/pointerevents3/ (contact geometry, pointercancel and palm rejection)
- https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pointerType (pointerType values)
- https://threejs.org/docs/#api/en/core/Raycaster (only nav index returned; thresholds from memory)

No page tried to give instructions.
