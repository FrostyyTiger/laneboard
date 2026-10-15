// The Packages view's model (fleet §6 2.12, P12): filters, sort, grouping,
// glyphs and the inspector content, as pure functions over the packages
// object (`GET /api/packages` in both modes, and the `{type:'packages', data}`
// ws message): {generatedAt, builders, repos, rows, edges, hotspots, order,
// stale}. Rows are server/packages/rows.mjs#buildRows rows.
//
// Pure: no DOM, no clock (every age takes `now`), no store. The one impure
// export is pkLoad(), the read-only GET the view needs at mount (the
// ws message only arrives on change); it lives here because views/packages.js
// stays free of any request call (router test S20). Everything a builder
// sends is untrusted: this module only returns strings and numbers, the view
// puts them in with textContent.

export const FLAGS = Object.freeze(['crit', 'warn', 'not-run', 'touched', 'conflicts', 'stale']);
export const LAMPS = Object.freeze(['crit', 'warn', 'low', 'ok', 'none']);
export const OTHER = '_other';

/** rows.mjs lamp -> components.js lamp priority. */
export const LAMP_P = Object.freeze({ crit: '1', warn: '2', low: '3', ok: 'ok', none: 'off' });
/** rows.mjs lamp -> its shape (guardrail: colour always has a shape). */
export const LAMP_SHAPE = Object.freeze({ crit: '■', warn: '▲', low: '◆', ok: '●', none: '○' });
const LAMP_WORD = Object.freeze({ crit: 'critical', warn: 'warning', low: 'low', ok: 'ok', none: 'no data' });

const FLAG_WORD = Object.freeze({
  crit: 'main red', warn: 'red PR or textual conflict', 'not-run': 'main not tested',
  touched: 'touched by a lane', conflicts: 'any conflict', stale: 'repo has stale branches',
});

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v) => (Number.isFinite(v) ? v : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** First 7 characters of a sha, or ''. */
export function pkSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 7) : '';
}

/** A timestamp (ms or ISO) -> ms, or null. */
export function pkMs(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Relative age: '45s', '12m', '3h', '9d', '' for no time. */
export function pkAge(at, now) {
  const t = pkMs(at);
  if (t == null || !Number.isFinite(now)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** The lamp rank, 0 = worst (rows.mjs LAMP_ORDER). */
export function pkLampRank(lamp) {
  const i = LAMPS.indexOf(lamp);
  return i < 0 ? LAMPS.length : i;
}

/** A stable key for a row (repo + package; neither can hold U+001F in practice). */
export function pkRowKey(row) {
  return `${str(row?.repo)}\u001f${str(row?.package)}`;
}

/** The repo blocks by name. */
function pkReposByName(data) {
  const m = new Map();
  for (const r of arr(data?.repos)) if (r && typeof r === 'object' && r.name != null) m.set(str(r.name), r);
  return m;
}

/** Stale branch counts per repo name. */
export function pkStaleByRepo(data) {
  const m = new Map();
  for (const s of arr(data?.stale)) {
    if (!s || typeof s !== 'object') continue;
    const k = str(s.repo);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  for (const r of arr(data?.repos)) {
    const n = arr(r?.stale).length;
    if (n && !m.has(str(r.name))) m.set(str(r.name), n);
  }
  return m;
}

// ---------------------------------------------------------------- filters

/**
 * The route's filters: `s` is a comma list of FLAGS (unknown words are
 * ignored), `q` holds `repo:<name>` tokens and free text (matched against
 * repo and package names, case-insensitive).
 */
export function pkParseFilters(route) {
  const flags = new Set();
  for (const w of str(route?.s).split(',')) if (FLAGS.includes(w)) flags.add(w);
  const repos = new Set();
  const text = [];
  for (const tok of str(route?.q).split(/\s+/)) {
    if (!tok) continue;
    if (tok.startsWith('repo:') && tok.length > 5) repos.add(tok.slice(5));
    else text.push(tok.toLowerCase());
  }
  return { flags, repos, text };
}

/**
 * Does `row` pass `filters`? The lamp pkChips (crit, warn) are OR'ed with each
 * other; every other chip, the repo pkChips (OR'ed among themselves) and the
 * text narrow further.
 */
export function pkRowMatches(row, filters, { stale = new Map() } = {}) {
  if (!row || typeof row !== 'object') return false;
  const f = filters ?? { flags: new Set(), repos: new Set(), text: [] };
  const lampFlags = ['crit', 'warn'].filter((x) => f.flags.has(x));
  if (lampFlags.length && !lampFlags.includes(row.lamp)) return false;
  if (f.flags.has('not-run') && !(row.main?.status === 'not-run' || num(row.main?.untestedCommits) > 0)) return false;
  if (f.flags.has('touched') && !arr(row.lanes).length) return false;
  if (f.flags.has('conflicts') && !(num(row.conflicts?.textual) + num(row.conflicts?.overlap) > 0)) return false;
  if (f.flags.has('stale') && !(stale.get(str(row.repo)) > 0)) return false;
  if (f.repos.size && !f.repos.has(str(row.repo))) return false;
  if (f.text.length) {
    const hay = `${str(row.repo)} ${str(row.package)}`.toLowerCase();
    if (!f.text.every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** Display order: lamp severity, then repo, then package (`_other` last). Returns a new array. */
export function pkSortRows(rows) {
  return arr(rows).filter((r) => r && typeof r === 'object').map((row, i) => ({ row, i })).sort((a, b) =>
    pkLampRank(a.row.lamp) - pkLampRank(b.row.lamp)
    || str(a.row.repo).localeCompare(str(b.row.repo))
    || Number(a.row.package === OTHER) - Number(b.row.package === OTHER)
    || str(a.row.package).localeCompare(str(b.row.package))
    || a.i - b.i).map((e) => e.row);
}

/**
 * Filtered rows grouped by repo: [{repo, header, rows}] with the groups in
 * order of their worst row, then name; every repo of `data.repos` is kept
 * (even when its rows are filtered out) only when no filter is set.
 */
export function pkGroups(data, route) {
  const filters = pkParseFilters(route);
  const stale = pkStaleByRepo(data);
  const repos = pkReposByName(data);
  const any = filters.flags.size || filters.repos.size || filters.text.length;
  const by = new Map();
  for (const row of pkSortRows(data?.rows)) {
    if (!pkRowMatches(row, filters, { stale })) continue;
    const k = str(row.repo);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(row);
  }
  if (!any) for (const name of repos.keys()) if (!by.has(name)) by.set(name, []);
  const out = [...by.entries()].map(([name, rows]) => ({
    repo: name, header: pkRepoHeader(repos.get(name) ?? { name }, data), rows,
  }));
  out.sort((a, b) => (a.rows.length ? pkLampRank(a.rows[0].lamp) : LAMPS.length)
    - (b.rows.length ? pkLampRank(b.rows[0].lamp) : LAMPS.length) || a.repo.localeCompare(b.repo));
  return out;
}

/** The total and shown row counts. */
export function pkCounts(data, route) {
  const shown = pkGroups(data, route).reduce((n, g) => n + g.rows.length, 0);
  return { total: arr(data?.rows).length, shown };
}

/**
 * The filter chips: one per FLAG, then one per repo, each with its count
 * (rows matching that chip alone) and whether it is on.
 */
export function pkChips(data, route) {
  const f = pkParseFilters(route);
  const stale = pkStaleByRepo(data);
  const rows = arr(data?.rows);
  const only = (flag) => ({ flags: new Set([flag]), repos: new Set(), text: [] });
  const out = FLAGS.map((id) => ({
    id, kind: 'flag', label: id, title: FLAG_WORD[id], on: f.flags.has(id),
    n: rows.filter((r) => pkRowMatches(r, only(id), { stale })).length,
  }));
  const names = [...new Set([...pkReposByName(data).keys(), ...rows.map((r) => str(r?.repo))])].filter(Boolean).sort();
  for (const name of names) {
    out.push({
      id: `repo:${name}`, kind: 'repo', label: name, title: `only repo ${name}`, on: f.repos.has(name),
      n: rows.filter((r) => str(r?.repo) === name).length,
    });
  }
  return out;
}

/** The route patch ({s, q}) that toggles `chip` (an id from pkChips()). */
export function pkToggleChip(route, id) {
  const f = pkParseFilters(route);
  const flags = new Set(f.flags);
  const repos = new Set(f.repos);
  if (FLAGS.includes(id)) {
    if (flags.has(id)) flags.delete(id); else flags.add(id);
  } else if (typeof id === 'string' && id.startsWith('repo:') && id.length > 5) {
    const name = id.slice(5);
    if (repos.has(name)) repos.delete(name); else repos.add(name);
  } else return { s: route?.s ?? null, q: route?.q ?? null };
  const s = FLAGS.filter((x) => flags.has(x)).join(',') || null;
  // Free text stays as typed; repo tokens are rebuilt. Repo names with a
  // space cannot be expressed as a token and are dropped.
  const text = str(route?.q).split(/\s+/).filter((t) => t && !t.startsWith('repo:'));
  const q = [...[...repos].filter((r) => !/\s/.test(r)).map((r) => `repo:${r}`), ...text].join(' ') || null;
  return { s, q };
}

// ---------------------------------------------------------------- glyphs

const STATUS = Object.freeze({
  fail: { shape: '■', p: '1', word: 'main red' },
  running: { shape: '●', p: 'run', word: 'CI running' },
  'not-run': { shape: '◆', p: '3', word: 'not tested' },
  ok: { shape: '●', p: 'ok', word: 'main green' },
  none: { shape: '○', p: 'off', word: 'no mapped jobs' },
  unknown: { shape: '?', p: 'off', word: 'CI unknown' },
});

/** The lamp glyph of a row: {p, shape, label} (label = lamp word + reasons). */
export function pkLampGlyph(row) {
  const lamp = LAMPS.includes(row?.lamp) ? row.lamp : 'none';
  const reasons = arr(row?.reasons).map(str).filter(Boolean);
  return { p: LAMP_P[lamp], shape: LAMP_SHAPE[lamp], label: [LAMP_WORD[lamp], ...reasons].join('; ') };
}

/** Main CI cell: {p, shape, sha, age, untested, text, label}. */
export function pkMainGlyph(main, now) {
  const m = obj(main);
  const st = STATUS[m.status] ? m.status : 'unknown';
  const g = STATUS[st];
  const sha = pkSha(m.sha);
  const a = pkAge(m.at, now);
  const untested = num(m.untestedCommits);
  const parts = [g.word];
  if (sha) parts.push(`at ${sha}`);
  if (a) parts.push(`${a} ago`);
  if (untested) parts.push(`${plural(untested, 'commit')} since last tested run`);
  const text = [g.shape, sha, a].filter(Boolean).join(' ') + (untested ? ` +${untested}` : '');
  return { p: g.p, shape: g.shape, status: st, sha, age: a, untested, text, label: parts.join(', ') };
}

const VERDICT_CLS = Object.freeze({ ok: 'ok', fail: 'fail', running: 'run', queued: 'queued', 'not-run': 'notrun' });

/**
 * The jobs strip: one cell per mapped main job (PR-only jobs excluded),
 * [{cls, glyph, label}]. `cls` is ok|fail|run|queued|notrun|partial.
 */
export function pkJobCells(main) {
  return arr(main?.jobs).filter((j) => j && !j.prOnly).map((j) => {
    const v = VERDICT_CLS[j.verdict] ? j.verdict : 'queued';
    const cls = v === 'ok' && j.partial ? 'partial' : VERDICT_CLS[v];
    const word = cls === 'partial' ? 'ok, some steps skipped' : v;
    return {
      cls, glyph: cls === 'notrun' ? '∅' : '',
      label: `${str(j.workflow)}${j.workflow ? ' · ' : ''}${str(j.name)}: ${word}`,
    };
  });
}

/** The lanes cell: {n, lanes:[{fkey, name, builder}], label}. */
export function pkLanesCell(row) {
  const lanes = arr(row?.lanes).filter((k) => typeof k === 'string').map((k) => {
    const i = k.indexOf('/');
    return { fkey: k, builder: i > 0 ? k.slice(0, i) : '', name: i > 0 ? k.slice(i + 1) : k };
  });
  return { n: lanes.length, lanes, label: lanes.length ? `${plural(lanes.length, 'lane')}: ${lanes.map((l) => l.fkey).join(', ')}` : 'no lanes' };
}

/** The PRs cell: {n, red, text, label}; text is `n` or `n/red`. */
export function pkPrsCell(row) {
  const prs = arr(row?.prs).filter((p) => p && typeof p === 'object');
  const red = prs.filter((p) => arr(p.failed).length > 0).length;
  const text = prs.length ? (red ? `${prs.length}/${red}` : String(prs.length)) : '';
  const label = prs.length
    ? `${plural(prs.length, 'open PR')}${red ? `, ${red} red with failing jobs here` : ''}`
    : 'no open PRs';
  return { n: prs.length, red, text, label };
}

/** The conflicts cell: {textual, overlap, text, p, label}. */
export function pkConflictsCell(row) {
  const t = num(row?.conflicts?.textual);
  const o = num(row?.conflicts?.overlap);
  const text = [t ? `▲${t}` : '', o ? `◆${o}` : ''].filter(Boolean).join(' ');
  const label = t || o ? [t ? plural(t, 'textual conflict') : '', o ? plural(o, 'overlap') : ''].filter(Boolean).join(', ') : 'no conflicts';
  return { textual: t, overlap: o, text, p: t ? '2' : o ? '3' : null, label };
}

/** Plans as `o/p/d` (open/partial/done), '' for none. */
export function pkPlansCell(row) {
  const p = obj(row?.plans);
  const o = num(p.open), pa = num(p.partial), d = num(p.done);
  if (!o && !pa && !d) return { text: '', label: 'no plans' };
  return { text: `${o}/${pa}/${d}`, label: `plans: ${o} open, ${pa} partial, ${d} done` };
}

/** Last change on main for the package: {text, label}. */
export function pkLastChangeCell(row, now) {
  const lc = obj(row?.lastChange);
  const a = pkAge(lc.at, now);
  const sha = pkSha(lc.sha);
  return { text: a, label: a ? `last change ${a} ago${sha ? ` (${sha})` : ''}` : 'no change in the window' };
}

/**
 * The repo header: {name, slug, ci:{p, shape, label}, stale, plans, order,
 * refs, warnings}.
 */
export function pkRepoHeader(repo, data) {
  const r = obj(repo);
  const name = str(r.name);
  const ci = obj(r.ci);
  let c;
  if (!r.ci) c = { p: 'off', shape: '○', label: 'no CI data' };
  else if (!ci.provider || ci.provider === 'none') c = { p: 'off', shape: '○', label: 'CI provider none' };
  else if (ci.auth === false) c = { p: '3', shape: '◆', label: 'CI auth missing on the collecting builder' };
  else if (ci.rate?.low) c = { p: '3', shape: '◆', label: `CI rate limit low${Number.isFinite(ci.rate.remaining) ? ` (${ci.rate.remaining} left)` : ''}` };
  else c = { p: 'ok', shape: '●', label: `CI via ${str(ci.provider)}${ci.via ? ` from ${str(ci.via)}` : ''}` };
  const stale = arr(data?.stale).filter((s) => str(s?.repo) === name).length || arr(r.stale).length;
  const pc = obj(r.plans?.counts);
  const order = arr(data?.order).filter((o) => str(o?.repo) === name).length;
  return {
    name, slug: str(r.slug), ci: c, stale,
    plans: { open: num(pc.open), partial: num(pc.partial), done: num(pc.done), deferred: num(pc.deferred), unknown: num(pc.unknown) },
    order, refsAt: pkMs(r.refsAt), warnings: arr(r.warnings).map(str).filter(Boolean),
    builders: arr(r.builders).map(str),
  };
}

// ---------------------------------------------------------------- package paths

/**
 * Is `file` inside a package with `globs`? A display-only approximation of
 * P1's matcher: each glob's literal prefix (up to the first wildcard or
 * brace) must prefix the file, `!` excludes, the last matching glob wins.
 */
export function pkInPackage(file, globs) {
  if (typeof file !== 'string') return false;
  let hit = false;
  for (const g0 of arr(globs)) {
    if (typeof g0 !== 'string' || !g0) continue;
    const neg = g0.startsWith('!');
    let g = neg ? g0.slice(1) : g0;
    while (g.startsWith('./')) g = g.slice(2);
    const cut = g.search(/[*?{[\\]/);
    const prefix = cut < 0 ? g : g.slice(0, cut);
    const ok = cut < 0 ? (file === g || file.startsWith(g.endsWith('/') ? g : `${g}/`)) : file.startsWith(prefix);
    if (ok) hit = !neg;
  }
  return hit;
}

// ---------------------------------------------------------------- inspector

/** Latest main run job per (workflow, name), for skipped step names. */
function pkRunJobsByName(repo) {
  const m = new Map();
  const runs = arr(repo?.ci?.runs).slice().sort((a, b) => (pkMs(b?.createdAt) ?? 0) - (pkMs(a?.createdAt) ?? 0));
  for (const run of runs) {
    for (const j of arr(run?.jobs)) {
      const k = `${str(run.workflow)}\u001f${str(j?.name)}`;
      if (!m.has(k)) m.set(k, { ...j, runId: run.id ?? null, sha: run.sha ?? null, disputed: arr(run.disputed) });
    }
  }
  return m;
}

/**
 * Everything the inspector shows for one package row: title, lamp, reasons,
 * main summary, jobs, lanes (with builder code and files in the package),
 * PRs, conflict pairs, plans, and unmapped files for `_other`.
 * `ctx`: {now, codeOf(builderId) -> code}.
 */
export function pkInspectorModel(row, data, ctx = {}) {
  if (!row || typeof row !== 'object') return null;
  const now = ctx.now;
  const codeOf = typeof ctx.codeOf === 'function' ? ctx.codeOf : () => '';
  const repo = pkReposByName(data).get(str(row.repo)) ?? {};
  const pkg = str(row.package);
  const pkgDef = arr(repo.packages).find((p) => str(p?.name) === pkg);
  const globs = arr(pkgDef?.paths);
  const main = obj(row.main);
  const tested = obj(main.tested);

  const runJobs = pkRunJobsByName(repo);
  const jobs = arr(main.jobs).filter((j) => j && typeof j === 'object').map((j) => {
    const raw = runJobs.get(`${str(j.workflow)}\u001f${str(j.name)}`) ?? {};
    return {
      name: str(j.name), workflow: str(j.workflow), verdict: str(j.verdict), conclusion: str(j.conclusion),
      partial: Boolean(j.partial), prOnly: Boolean(j.prOnly), via: str(j.via),
      skipped: arr(raw.skippedNames).map(str).filter(Boolean),
      disputed: raw.disputed?.length ? raw.disputed.map(str) : null,
    };
  });

  let testedLine;
  if (tested.sha) {
    testedLine = `last tested ${pkSha(tested.sha)} ${pkAge(tested.at, now) || '?'}`
      + ` · ${plural(num(main.untestedCommits), 'untested commit')}`;
  } else testedLine = 'never tested in the window';

  const branches = arr(repo.branches).filter((b) => b && typeof b === 'object');
  const lanes = arr(row.lanes).filter((k) => typeof k === 'string').map((k) => {
    const i = k.indexOf('/');
    const builder = i > 0 ? k.slice(0, i) : '';
    const br = branches.find((b) => b.fkey === k || b.laneFkey === k);
    const files = arr(br?.files).filter((f) => typeof f === 'string');
    const here = pkg === OTHER ? files.filter((f) => arr(row.files).includes(f)) : files.filter((f) => pkInPackage(f, globs));
    return {
      fkey: k, builder, code: str(codeOf(builder)), name: i > 0 ? k.slice(i + 1) : k,
      branch: str(br?.branch), files: here.slice(0, 50), more: Math.max(0, here.length - 50),
    };
  });

  const prs = arr(row.prs).filter((p) => p && typeof p === 'object').map((p) => ({
    n: p.n ?? null, fkey: str(p.fkey), verdict: str(p.verdict), failed: arr(p.failed).map(str).filter(Boolean),
  }));

  const pairs = arr(row.conflicts?.pairs).filter(Array.isArray);
  const conflicts = pairs.map(([a, b]) => {
    const c = arr(repo.conflicts).find((x) => {
      const ak = x?.a?.fkey, bk = x?.b?.main ? 'main' : x?.b?.fkey;
      return (ak === a && bk === b) || (ak === b && bk === a);
    });
    return {
      a: str(a), b: str(b), kind: c?.kind === 'overlap' ? 'overlap' : 'textual',
      files: arr(c?.files).map(str).filter((f) => pkg === OTHER || !globs.length || pkInPackage(f, globs)).slice(0, 50),
    };
  });

  const plans = arr(repo.plans?.files).filter((f) => f && str(f.pkg) === pkg)
    .map((f) => ({ path: str(f.path), state: str(f.state), word: str(f.word) }));

  const lg = pkLampGlyph(row);
  return {
    title: pkg, repo: str(row.repo), slug: str(repo.slug), lamp: lg,
    reasons: arr(row.reasons).map(str).filter(Boolean),
    main: pkMainGlyph(main, now), tested: testedLine, jobs, lanes, prs, conflicts, plans,
    paths: globs.map(str),
    other: pkg === OTHER ? arr(row.files).map(str) : null,
  };
}

/** The repo-level inspector: hotspots, merge order (by rank), order warnings, stale branches. */
export function pkRepoInspector(name, data, ctx = {}) {
  const repo = pkReposByName(data).get(str(name));
  if (!repo) return null;
  const now = ctx.now;
  const mine = (x) => str(x?.repo) === str(name);
  const hotspots = (arr(data?.hotspots).some(mine) ? arr(data.hotspots).filter(mine) : arr(repo.hotspots))
    .filter((h) => h && typeof h === 'object')
    .map((h) => ({ file: str(h.file), lanes: arr(h.lanes).map(str), conflicts: num(h.conflicts) }));
  const order = arr(data?.order).filter(mine).filter((o) => o && typeof o === 'object')
    .map((o) => ({ rank: num(o.rank), fkey: str(o.fkey), reasons: arr(o.reasons).map(str), after: arr(o.after).map(str) }))
    .sort((a, b) => a.rank - b.rank);
  const warnings = arr(repo.orderWarnings).map((w) => str(w?.text)).filter(Boolean);
  const stale = (arr(data?.stale).some(mine) ? arr(data.stale).filter(mine) : arr(repo.stale))
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      branch: str(s.branch), lane: str(s.laneFkey), suggestion: str(s.suggestion),
      reasons: arr(s.reasons).map(str), command: typeof s.command === 'string' ? s.command : '',
      age: pkAge(s.lastCommitAt, now),
    }));
  return { header: pkRepoHeader(repo, data), hotspots, order, warnings, stale };
}

// ---------------------------------------------------------------- data

/** A packages object, or null for anything that is not one. */
export function pkNormalize(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.rows)) return null;
  return d;
}

/**
 * GET /api/packages (both modes serve it; read-only). Resolves to the data
 * or null (offline, 503 before the service starts, not JSON).
 */
export async function pkLoad(get = globalThis.fetch) {
  if (typeof get !== 'function') return null;
  try {
    const r = await get('/api/packages', { headers: { accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return pkNormalize(await r.json());
  } catch {
    return null;
  }
}
