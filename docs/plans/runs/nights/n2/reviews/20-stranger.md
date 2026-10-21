# Stranger review, round 20

Walked README.md, docs/map.md (Drift, Reach, feed format), the CLI help and the HTTP views on
a fresh copy (`:memory:` db, `/dev/null` config). Tried the new Drift and Reach overlays with
a topology file, a feed and a HuJSON policy: `ghost` came out `missing`, `feed:hv1/104`
`undeclared`, and the `tag:ci > web` link resolved with `group:admins` listed as unresolved.
Those work as documented. Stumbles, worst first:

1. **The quick-start command in the task (port, db, config only) collides with a running board
   and then lies to you.** I started a second copy on a port that was already taken, with no
   `LANEBOARD_AUDIT_FILE` / `LANEBOARD_STATE_DIR`. The log said
   `ERROR fleet: the audit log could not be opened (AUDIT_LOCKED); every action is refused`,
   then `ERROR uncaughtException Error: listen EADDRINUSE` with a raw stack trace, then exited.
   My next `curl` to that port still answered, from the *other* board, so I looked at the wrong
   instance's data for a while. Found by: the log, and the `/api/map` title not matching what I
   configured. Wanted: an EADDRINUSE message that says "port N is in use, is another laneboard
   running?" (no stack), and the AUDIT_LOCKED line should say which process holds the lock and
   that `LANEBOARD_AUDIT_FILE` / `LANEBOARD_STATE_DIR` avoid it. The README's "second copy"
   block sets them; its first sentence says the copy touches nothing, but the short form does
   touch the real audit log.
2. **README says "Pick a port nothing listens on (`ss -ltn`)" in the paragraph after the CLI
   example, not next to the command that needs it.** Easy to skip; see 1.
3. **A copy started with no config names itself after something I did not set** (`/api/map`
   title and builder id came out as `run-runs-n1`, apparently from the environment or host).
   docs/config.md does not say where the default name comes from. Found by: `curl /api/map`.
4. **`POST /api/map/feeds` accepts anything with a `source`.** `{"source":"hv1","kind":"x","nodes":[]}`
   returned `201 {"ok":true}` although it has no `host` or `guests` (the documented shape), so a
   typo'd push looks like a success. Found by: sending a wrong body on purpose.
5. **No obvious health endpoint.** `/api/health` is 404; docs/install.md and the README do not
   name one for a "is it up" check (the Box view is the only answer). Found by: guessing URLs.
6. **`#/...` views can only be checked with `curl` for a 200 on `/`**, since the hash never
   reaches the server; the README does not say there is no way to see a view's data from the
   shell, nor name the `/api/*` route behind each view. Without a browser I could not look at
   the Drift or Reach overlays, only read the model JSON. Not verified visually.
