# Review r49, the stranger

Walked README.md: scratch copy on 7790 (port was free; `ss -ltn` first), curl on the views and
APIs, the CLI against the copy, and headless Chromium screenshots at 390 px of map, board,
morning (the views touched by T25-T30). Worst first.

1. **At 390 px the page is wider than the screen and nothing says so.** Found in the
   screenshots: the bottom nav shows MAP / LIST / INBO… and is cut off, so the other views
   (runs, packages, box…) are not reachable by touch from it; the Morning window row ends
   in a clipped "sin…", its "What it cost" table loses the Sessions column, the Board's lane
   card runs past the right edge, the Map's Find box is cut. T29 and T30 claim 390 is
   readable; on an empty copy it is not.
2. **A fresh `:memory:` copy opens with a red "DOWN 1" in the top strip.** Nothing is
   configured, nothing is down in the README's terms. Clicking it was not possible
   headless; `/api/map` shows one builder with `link: "up"`, so what counts as down is
   unclear.
3. **The Map on a clean copy is a title and an empty radar.** `/api/map` has a title
   `run-runs-n1` and a builder `RRN` that I did not configure (`LANEBOARD_CONFIG=/dev/null`):
   they come from somewhere (environment of the shell I ran in?). README says nothing is
   read except sessions and directories. A stranger cannot tell where the name comes from.
4. **The README table never gives the API paths.** `/api/board`, `/api/inbox`, `/api/box`,
   `/api/audit` are 404, `/api/runs`, `/api/map`, `/api/morning`, `/api/credit`,
   `/api/packages` answer. Only found by guessing; docs list only some. (Same as r41 #5,
   still open.)
5. **Unknown values and paths still answer 200.** `/api/morning?window=bogus` returns the
   `tonight` window with no hint; `/nope` serves the page.
6. **The test-copy paragraph is long and repeats itself.** Five variables are said to be
   needed, then explained twice (the shorter form, the real state dir). The
   `laneboard ls` against the copy still lists the real machine's session `loop`, and
   `ls` prints no line saying which URL answered (r41 #2, open).
7. **`npm ci` needs build-essential, but nothing checks.** I did not rerun it (node_modules
   present); README does not say what the error looks like or whether prebuilt binaries
   are tried first.
