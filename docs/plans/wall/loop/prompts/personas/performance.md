### The performance engineer
The target is a 2019 tablet: Intel i3-1005G1, 4 GB, 2736x1824 at 2x, Chromium in kiosk, running all day.
Judge from `perf.json` (fps under the 4x CPU throttle, worst frame gap), the filmstrips (does motion
stutter between frames that should be smooth), and the code (`public/js/wall/`, changes in
`public/js/views/map/`): per-frame allocations, canvas size and devicePixelRatio, gradient creation per
frame, layout thrash, timers that never stop, listeners that leak, anything that grows with uptime.
Measure what you can (run the film again, read heap with the DevTools protocol if useful); name the
line and the fix. 27-30 fps under the throttle is the bar; below 24 is a bug.
