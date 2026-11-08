// Config fragment: engines (docs/engines.md; docs/plans/runs-first/engine.md §1).
//
//   engines  [{id, kind, ...}]  the run engines laneboard reads, default [].
//            id         lower-case slug, unique, not `jsonl` (that one is always on)
//            kind       `none` | `fake` (server/engine/index.mjs TABLE)
//            dir        fake only: the fixture folder, absolute; default the
//                       contract's published examples (test/fixtures/engine/v1)
//            timeoutMs  one call's limit, default 10000 (100..120000)
//            staleMs    no good answer for this long is `stale`, default 30000
//            downMs     ... and for this long `down`, default 120000 (>= staleMs)
//
// The `jsonl` engine (run.jsonl files, docs/runs.md) needs no entry: it reads
// the runs collector's store, which `runs.files`, `runs.lanes` and the API's
// own folder already configure. No env layer. This file must not import
// server/config.mjs (see the fragment notes there).
import path from 'node:path';

/** The kinds a config entry may name; server/engine/index.mjs asserts its table agrees. */
export const ENGINE_KINDS = Object.freeze(['none', 'fake']);
export const MAX_ENGINES = 8;
export const RESERVED_IDS = Object.freeze(['jsonl']);
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KEYS = ['id', 'kind', 'dir', 'timeoutMs', 'staleMs', 'downMs'];
export const LIMITS = Object.freeze({
  timeoutMs: [100, 120_000],
  staleMs: [1000, 24 * 3600_000],
  downMs: [1000, 7 * 24 * 3600_000],
});

export function defaults() {
  return { engines: [] };
}

/** No env layer. */
export function fromEnv() {
  return {};
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const J = (v) => JSON.stringify(v) ?? String(v);

export function validate(c, bad) {
  const list = c.engines;
  if (!Array.isArray(list)) bad(`engines must be a list of {id, kind}, got ${J(list)}`);
  if (list.length > MAX_ENGINES) bad(`engines has ${list.length} entries, at most ${MAX_ENGINES} are allowed`);
  const seen = new Set();
  list.forEach((e, i) => {
    const at = `engines[${i}]`;
    if (!isObj(e)) bad(`${at} must be an object {id, kind}, got ${J(e)}`);
    for (const k of Object.keys(e)) if (!KEYS.includes(k)) bad(`${at}.${k} is not a known key (${KEYS.join(', ')})`);
    if (typeof e.id !== 'string' || !ID.test(e.id)) bad(`${at}.id must be a lower-case slug (a-z, 0-9, -), got ${J(e.id)}`);
    if (RESERVED_IDS.includes(e.id)) bad(`${at}.id ${J(e.id)} is reserved: the jsonl engine is always on`);
    if (seen.has(e.id)) bad(`${at}.id ${J(e.id)} is used twice`);
    seen.add(e.id);
    if (!ENGINE_KINDS.includes(e.kind)) bad(`${at}.kind must be one of ${ENGINE_KINDS.join(', ')}, got ${J(e.kind)}`);
    if (e.dir !== undefined) {
      if (e.kind !== 'fake') bad(`${at}.dir is only for kind fake`);
      if (typeof e.dir !== 'string' || !path.isAbsolute(e.dir) || e.dir.split('/').includes('..') || e.dir.includes('\0')) {
        bad(`${at}.dir must be an absolute path without "..", got ${J(e.dir)}`);
      }
    }
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
      if (e[k] === undefined) continue;
      if (!Number.isInteger(e[k]) || e[k] < lo || e[k] > hi) bad(`${at}.${k} must be an integer from ${lo} to ${hi}, got ${J(e[k])}`);
    }
    if (e.staleMs !== undefined && e.downMs !== undefined && e.downMs < e.staleMs) bad(`${at}.downMs must not be below staleMs`);
  });
}
