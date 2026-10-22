// Fuzzy matching for the command palette (fleet plan §4 2.5, task D8). Pure:
// no DOM, no store, so test/fuzzy.test.mjs imports it as is.
//
//   fuzzyScore(q, s) -> number | null
//     a case-insensitive subsequence match of q in s. Each matched character
//     scores +8 at a word start, +5 when it follows the previous match
//     directly and +1 when its case is exact; every skipped character between
//     two matches costs -1. The best alignment wins (dynamic programming, not
//     the first greedy one). No match is null; an empty query scores 0.
//   fuzzyRanges(q, s) -> [[start, end), ...] | null
//     where that best alignment matched, as merged half-open ranges (runs
//     n5 T52: the palette marks them). Same rules, same nulls; '' -> [].
//   parsePrefix(q)  -> {type: 'HOST'|'LANE'|'PKG'|'NODE'|'ACT'|null, text}
//   rankItems(items, q, {recent, cap}) -> the matching items, best first

export const SCORE = Object.freeze({ wordStart: 8, consecutive: 5, caseExact: 1, gap: -1 });
/** Longest query and candidate considered (the palette truncates nothing it shows). */
export const MAX_Q = 64;
export const MAX_S = 256;
export const CAP = 50;

const isAlnum = (c) => /[\p{L}\p{N}]/u.test(c);

/** True when s[i] starts a word: the first char, after a separator, or a lower->Upper step. */
function wordStart(s, i) {
  if (i === 0) return true;
  const prev = s[i - 1];
  const c = s[i];
  if (!isAlnum(prev)) return isAlnum(c);
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && c !== c.toLowerCase() && c === c.toUpperCase();
}

/**
 * The alignment table: best[i][j] is the best score with query[0..i] matched
 * and query[i] at str[j]; from[i][j] is where query[i-1] sat on that path.
 * Returns {best, from, m, n} or null when nothing can match.
 */
function align(q, s) {
  const query = String(q ?? '').slice(0, MAX_Q);
  const str = String(s ?? '').slice(0, MAX_S);
  const m = query.length;
  const n = str.length;
  if (m > n) return null;
  const ql = query.toLowerCase();
  const sl = str.toLowerCase();
  const NEG = -Infinity;
  const best = [];
  const from = [];
  let prev = null;
  for (let i = 0; i < m; i++) {
    const cur = new Array(n).fill(NEG);
    const back = new Array(n).fill(-1);
    // run = max over k < j-1 of (prev[k] - gap*k): a gap of (j - k - 1)
    // chars costs gap*(j-k-1) = (prev[k] - gap*k) + gap*(j-1) - prev[k].
    let run = NEG;
    let runAt = -1;
    for (let j = i; j < n; j++) {
      if (i > 0 && j - 2 >= 0 && prev[j - 2] !== NEG) {
        const v = prev[j - 2] - SCORE.gap * (j - 2);
        if (v > run) { run = v; runAt = j - 2; }
      }
      if (sl[j] !== ql[i]) continue;
      let bonus = 0;
      if (wordStart(str, j)) bonus += SCORE.wordStart;
      if (str[j] === query[i]) bonus += SCORE.caseExact;
      let b;
      let at = -1;
      if (i === 0) {
        b = 0; // a leading gap is free: word starts already favour prefixes
      } else {
        const adj = j >= 1 && prev[j - 1] !== NEG ? prev[j - 1] + SCORE.consecutive : NEG;
        const viaGap = run === NEG ? NEG : run + SCORE.gap * (j - 1);
        if (adj >= viaGap) { b = adj; at = j - 1; } else { b = viaGap; at = runAt; }
      }
      if (b === NEG) continue;
      cur[j] = b + bonus;
      back[j] = at;
    }
    best.push(cur);
    from.push(back);
    prev = cur;
  }
  return { best, from, m, n };
}

/** The end column of the best alignment, or -1. */
function bestEnd(t) {
  const last = t.best[t.m - 1];
  let at = -1;
  for (let j = 0; j < t.n; j++) if (last[j] !== -Infinity && (at < 0 || last[j] > last[at])) at = j;
  return at;
}

export function fuzzyScore(q, s) {
  if (String(q ?? '').slice(0, MAX_Q) === '') return 0;
  const t = align(q, s);
  if (!t) return null;
  const at = bestEnd(t);
  return at < 0 ? null : t.best[t.m - 1][at];
}

export function fuzzyRanges(q, s) {
  if (String(q ?? '').slice(0, MAX_Q) === '') return [];
  const t = align(q, s);
  if (!t) return null;
  let at = bestEnd(t);
  if (at < 0) return null;
  const pos = [];
  for (let i = t.m - 1; i >= 0 && at >= 0; i--) {
    pos.unshift(at);
    at = t.from[i][at];
  }
  const out = [];
  for (const p of pos) {
    const last = out[out.length - 1];
    if (last && last[1] === p) last[1] = p + 1;
    else out.push([p, p + 1]);
  }
  return out;
}

const PREFIXES = [
  ['host:', 'HOST'], ['h:', 'HOST'],
  ['lane:', 'LANE'], ['l:', 'LANE'],
  ['pkg:', 'PKG'], ['p:', 'PKG'],
  ['node:', 'NODE'], ['n:', 'NODE'],
  ['act:', 'ACT'], ['>', 'ACT'],
];

/** 'h: auth' -> {type:'HOST', text:'auth'}; no prefix -> {type:null, text}. Case-insensitive prefixes. */
export function parsePrefix(q) {
  const raw = String(q ?? '').trimStart();
  const low = raw.toLowerCase();
  for (const [p, type] of PREFIXES) {
    if (low.startsWith(p)) return { type, text: raw.slice(p.length).trim() };
  }
  return { type: null, text: raw.trim() };
}

/**
 * Rank palette items ({id, type, label, sub?}) for a query. A prefix limits
 * the type (ACT also takes VIEW rows: views are commands too). An empty text
 * keeps the given order with the recent ids first (most recent first).
 * Otherwise items are scored on their label, or on their sub-label at a
 * 10-point discount; ties go to recent ids, then to the given order. Capped.
 */
export function rankItems(items, q, { recent = [], cap = CAP } = {}) {
  const { type, text } = parsePrefix(q);
  const recency = new Map();
  (Array.isArray(recent) ? recent : []).forEach((id, i) => { if (!recency.has(id)) recency.set(id, i); });
  const rec = (it) => (recency.has(it.id) ? recency.get(it.id) : Infinity);
  const pool = (Array.isArray(items) ? items : []).filter((it) => it && (!type || it.type === type || (type === 'ACT' && it.type === 'VIEW')));
  if (!text) {
    return pool
      .map((it, i) => ({ it, i }))
      .sort((a, b) => rec(a.it) - rec(b.it) || a.i - b.i)
      .slice(0, cap)
      .map((x) => x.it);
  }
  const scored = [];
  pool.forEach((it, i) => {
    let sc = fuzzyScore(text, it.label);
    if (sc === null && it.sub) {
      const sub = fuzzyScore(text, it.sub);
      if (sub !== null) sc = sub - 10;
    }
    if (sc !== null) scored.push({ it, i, sc });
  });
  scored.sort((a, b) => b.sc - a.sc || rec(a.it) - rec(b.it) || a.i - b.i);
  return scored.slice(0, cap).map((x) => x.it);
}
