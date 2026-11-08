// Text and links written by a loop or an engine, made safe to show. Shared by
// the Runs view and the engine run page. Pure.
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const TEXT_MAX = 200;
const URL_MAX = 2000;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Untrusted -> a display string (or null): control characters replaced, length clamped. */
export function rnClean(v, max = TEXT_MAX) {
  if (isNum(v)) v = String(v);
  if (typeof v !== 'string' || v === '') return null;
  const s = (typeof v.toWellFormed === 'function' ? v.toWellFormed() : v).replace(CONTROL, '�');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A link from a loop -> an absolute http(s) URL, or null (never `javascript:` and friends). */
export function safeHref(v) {
  // eslint-disable-next-line no-control-regex
  if (typeof v !== 'string' || v === '' || v.length > URL_MAX || /[\u0000- \u007f-\u009f]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
