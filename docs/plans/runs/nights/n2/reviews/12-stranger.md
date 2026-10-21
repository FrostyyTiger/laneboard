# Review round 12: the stranger

Walk: README as written, a copy on a free port with the README's env, `curl` on the views and
API, then the new `laneboard feed` (tailscale, proxmox, `--out`, `--push`). No browser tool used.

1. **`laneboard feed --push` cannot work: the board answers 404.** `docs/map.md` ("Pushing a
   feed") and `laneboard feed --help` say it POSTs to `<url>/api/map/feeds`. Found by running
   `laneboard feed tailscale --push http://127.0.0.1:7795` (exit 1, "refused the feed: HTTP 404")
   and a raw `curl -X POST -H 'x-laneboard: 1' .../api/map/feeds` (404). `grep` shows the path
   only in `bin/laneboard` and the docs, there is no server route. Either land the route or mark
   `--push` as not yet available in the docs and `--help`.

2. **The stated test port 7790 was already taken** by another laneboard on the machine. The
   first start died with `EADDRINUSE` (visible only in the log: I sent `&` to the background).
   Worse, `curl 127.0.0.1:7790` still answered, from the other board (`/api/runs` showed a
   `demo` run, `/api/map` a different title), so a stranger would take someone else's data for
   the fresh copy's. README says "pick a port nothing listens on" but after the first start
   fails nothing tells you the answers you get are from someone else. A line in the server
   output or the README ("if the port is busy the page you see is not yours; check the log")
   would help.

3. **The README's test copy is not isolated for reads.** `laneboard ls` against the copy listed
   the machine's real sessions and directories (`loop`, `_laneboard`). It writes nothing, as
   promised, but "touches neither the config file, the database nor the state dir" reads like a
   clean slate. Say that sessions are still read from the machine.

4. **`/api/map` with no config has a title that is the hostname-like builder id** (here
   `run-runs-n1`) and shows a one-builder fleet block although there is no `fleet` block. Not
   wrong, but the README says "With no config file at all ... fleet off"; the `fleet.builders`
   entry in the Map JSON surprised me.

5. **The tailscale feed contains the real tailnet addresses and peer names** (printed by default
   to stdout). `docs/map.md` never warns that a feed is machine data to keep out of bug reports
   or screenshots. One sentence would do.

6. **Start-up log noise for a stranger:** `ERROR fleet: the audit log could not be opened
   (AUDIT_LOCKED)` appeared when the first (failed) start collided with the running board. It
   reads as a fault in the copy; it is the other process's lock. Same cause as 2.

Fine: `npm ci` was already done here (not re-run); `feed bogus` and `feed proxmox` with no flags
exit 2 with a usable message; `feed tailscale --out` wrote valid JSON.
