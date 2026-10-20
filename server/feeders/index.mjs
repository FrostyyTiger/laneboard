// Feeders: small readers that turn one source into one feed (docs/map.md "The
// feed format"), run by `laneboard feed <kind>` next to the source. Unlike the
// providers they are chosen per command, not by a config key, and the server
// never runs one: the board only reads the feeds they write (the feeds route
// takes SOURCE_ID from here).
//
// | kind | reads |
// | --- | --- |
// | none | nothing; an empty feed that says so |
// | tailscale | `tailscale status --json` on this machine |
// | proxmox | the PVE API's `/cluster/resources`, with a read-only token |
//
// A feeder is plain ESM with `name`, a pure `toFeed(input, {source, now,
// every})` and an async `read(opts)` that returns `{ok:true, input}` or
// `{ok:false, error}` and never throws. docs/providers.md has the interface.
import * as none from './none.mjs';
import * as tailscale from './tailscale.mjs';
import * as proxmox from './proxmox.mjs';

export const TABLE = { none, tailscale, proxmox };

export const feederNames = Object.keys(TABLE);

/** A feed's `source`: it names the file `<feedsDir>/<source>.json`, so no
 *  slash, no leading dot, 64 characters at most. */
export const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The feeder called `kind`, or null. */
export function feeder(kind) {
  return Object.hasOwn(TABLE, kind) ? TABLE[kind] : null;
}

/**
 * Read once and map: `{ok:true, feed}` or `{ok:false, error}`. `source`
 * defaults to the kind; `now` is the feed's `at`.
 */
export async function collect(kind, { source, now, every, ...readOpts } = {}) {
  const f = feeder(kind);
  if (!f) return { ok: false, error: `unknown feeder: ${kind} (one of ${feederNames.join(', ')})` };
  let r;
  try { r = await f.read(readOpts); } catch (err) { r = { ok: false, error: String(err?.message || err) }; }
  if (!r?.ok) return { ok: false, error: r?.error || `${kind}: read failed` };
  const opts = { source: source || kind, now: now ?? Date.now() };
  if (every != null) opts.every = every;
  return { ok: true, feed: f.toFeed(r.input, opts) };
}
