// Config fragment: runs (docs/plans/runs/README.md §3 A1, T3; the protocol is
// docs/runs.md).
//
//   runs  {files      globs of run.jsonl files to read; absolute or `~/`
//                     (expanded by finalize below), default [] = none
//          lanes      also read <lane cwd>/.laneboard/run.jsonl, default true
//          maxEvents  events kept per run (older ones are dropped from the
//                     fold's input, server/runs/store.mjs)
//          keepDays   a run whose last event is older is forgotten}
//
// No env layer: which files laneboard reads comes only from the config file
// (the CLI's LANEBOARD_RUN_FILE is a writer's setting, not this). With no
// config there are no run files beyond the lanes' own, and a lane without a
// .laneboard/run.jsonl shows no run. This file must not import
// server/config.mjs (see the fragment notes there).
import os from 'node:os';
import path from 'node:path';
import { globError } from '../packages/glob.mjs';

export const MAX_FILES = 64;
export const LIMITS = Object.freeze({
  'runs.maxEvents': 100000,
  'runs.keepDays': 3650,
});

export function defaults() {
  return {
    runs: { files: [], lanes: true, maxEvents: 5000, keepDays: 30 },
  };
}

/** No env layer. */
export function fromEnv() {
  return {};
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const J = (v) => JSON.stringify(v) ?? String(v);

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Expand a leading `~/` in each runs.files entry. Tolerates wrong types. */
export function finalize(c) {
  const r = c.runs;
  if (isObj(r) && Array.isArray(r.files)) {
    r.files = r.files.map((f) => (typeof f === 'string' ? expandHome(f) : f));
  }
  return c;
}

/** null when `g` is an acceptable runs.files entry (after finalize), else why. */
export function fileGlobProblem(g) {
  if (typeof g !== 'string' || g === '') return 'must be a non-empty string';
  if (g.includes('\0')) return 'must not contain a NUL byte';
  if (!path.isAbsolute(g)) return 'must be an absolute path (or start with ~/)';
  if (g.split('/').includes('..')) return 'must not contain a ".." segment';
  const why = globError(g);
  return why ? `is not a valid glob: ${why}` : null;
}

function int(bad, key, v, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) bad(`${key} must be an integer from ${lo} to ${hi}, got ${J(v)}`);
}

export function validate(c, bad) {
  const r = c.runs;
  if (!isObj(r)) bad(`runs must be an object, got ${J(r)}`);
  if (!Array.isArray(r.files)) bad(`runs.files must be a list of globs, got ${J(r.files)}`);
  if (r.files.length > MAX_FILES) bad(`runs.files has ${r.files.length} entries, at most ${MAX_FILES} are allowed`);
  for (const g of r.files) {
    const why = fileGlobProblem(g);
    if (why) bad(`runs.files entry ${J(g)} ${why}`);
  }
  if (typeof r.lanes !== 'boolean') bad(`runs.lanes must be true or false, got ${J(r.lanes)}`);
  int(bad, 'runs.maxEvents', r.maxEvents, 100, LIMITS['runs.maxEvents']);
  int(bad, 'runs.keepDays', r.keepDays, 1, LIMITS['runs.keepDays']);
}
