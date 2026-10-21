// Route module: feeds pushed to this board (docs/map.md "Pushing a feed").
//
//   POST /api/map/feeds   one feed as JSON -> 201 {ok, source, at}
//                         403 {error} unless the caller is this machine (`local`);
//                         400 {error} bad JSON, shape or source; 413 over BODY_LIMIT;
//                         409 when this board does not read feeds (a builder a hub
//                         watches, feedsEnabled() false); written atomically to
//                         <map.feedsDir>/<source>.json
//
// This is what `laneboard feed <kind> --push <url>` calls. The route sits
// behind the normal guards (Host/Origin and the `x-laneboard` header,
// server/security.mjs), and those let a tailnet (`direct`) caller through too,
// so the route itself answers 403 unless `req.auth.kind` is `local`: it takes
// feeds from this machine only. A feed from another machine still comes over
// the ssh forced command, and a signed intake on a hub is the owner's call
// (PROGRESS "For the owner").
//
// The body is checked with the same feedProblem readFeeds uses, so what is
// accepted is what the Map draws; the source must be a SOURCE_ID (the CLI's
// check) because it names the file. The feed is written as it was posted,
// with `at` set to the server's time when it had none. The Map picks the file
// up on its next tick, like a feed dropped in by `--out`.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config as globalConfig } from '../config.mjs';
import { feedProblem, feedsEnabled } from '../map.mjs';
import { SOURCE_ID } from '../feeders/index.mjs';

export const FEEDS_PATH = '/api/map/feeds';
/** A feed is a few hundred guests at most; a body over 1 MiB is not read to the end. */
export const BODY_LIMIT = 1024 * 1024;

/**
 * Check one posted body: `{ok: true, source, feed}` or `{ok: false, error}`.
 * `feed` is the parsed object with `at` filled in.
 */
export function checkFeed(text, now = Date.now()) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  let feed;
  try { feed = JSON.parse(text); } catch { return { ok: false, error: 'not JSON' }; }
  const problem = feedProblem(feed);
  if (problem) return { ok: false, error: problem };
  if (typeof feed.source !== 'string' || !SOURCE_ID.test(feed.source)) {
    return { ok: false, error: 'source must be letters, digits, . _ - (64 at most, no leading dot)' };
  }
  if (feed.at == null) feed.at = now;
  return { ok: true, source: feed.source, feed };
}

/** `<feedsDir>/<source>.json`, or null for a source that is not a safe file name. */
export function feedFile(feedsDir, source) {
  if (typeof feedsDir !== 'string' || !feedsDir || typeof source !== 'string' || !SOURCE_ID.test(source)) return null;
  return path.join(feedsDir, `${source}.json`);
}

/** Write the feed to a temp name in the same dir, then rename it into place (dir 0700, file 0600). */
export async function writeFeed(feedsDir, source, feed, { fsImpl = fsp } = {}) {
  const file = feedFile(feedsDir, source);
  if (!file) throw new Error('bad source');
  await fsImpl.mkdir(feedsDir, { recursive: true, mode: 0o700 });
  // A dot name: readFeeds only reads `*.json`, so a half-written temp is never a feed.
  const tmp = path.join(feedsDir, `.${source}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fsImpl.writeFile(tmp, `${JSON.stringify(feed)}\n`, { mode: 0o600 });
    await fsImpl.rename(tmp, file);
  } catch (err) {
    await fsImpl.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return file;
}

export default {
  name: 'feeds',
  modes: ['builder'],
  register(ctx) {
    ctx.route('POST', FEEDS_PATH, async (req, res) => {
      if (req.auth?.kind !== 'local') return ctx.json(res, { error: 'feeds are pushed from this machine only' }, 403);
      const cfg = ctx.config ?? globalConfig;
      if (!feedsEnabled(cfg)) return ctx.json(res, { error: 'this board does not read feeds: a hub watches it, push to the hub' }, 409);
      let text;
      try {
        text = (await ctx.readBody(req, BODY_LIMIT)).toString('utf8');
      } catch {
        return ctx.json(res, { error: 'body too large' }, 413);
      }
      const r = checkFeed(text);
      if (!r.ok) return ctx.json(res, { error: r.error }, 400);
      try {
        await writeFeed(cfg.map?.feedsDir, r.source, r.feed);
      } catch {
        return ctx.json(res, { error: 'could not write the feed' }, 500);
      }
      return ctx.json(res, { ok: true, source: r.source, at: r.feed.at }, 201);
    });
  },
};
