// Redaction (spec c1-talk.md §5.3, security.md §5; D127, D211). REVIEW-REQUIRED:
// security-relevant, listed in fenced.txt's last block.
//
// The room runs every tool input and every piece of reply text through this
// module before it leaves the room's process for anything a screen can read
// or a file the room keeps (a frame, the snapshot, conversation.jsonl, the
// spoken line). It hides secrets from a desk screen; it is not what stops the
// agent sending one out (that is the allowlist, c1-talk.md §5.2).
//
//   createRedactor({secrets}) → { input(obj), text(s), stream() }
//     .input(obj)   §5.3 rules 1-6 on every string value; JSON keys unchanged,
//                   a secret-like key's whole value becomes "[redacted]"
//     .text(s)      rules 1, 2, 3, 5, 6 (security.md §5: not 4)
//     .stream()     one per text block: push(delta) → what may leave now,
//                   end() → the held rest (security.md §5 "While streaming")
//   roomSecrets({mcpToken, env, names, sttTokenFile, readFile}) → string[]

import fs from 'node:fs';

export const REDACTED = '[redacted]';
/** security.md §5: a held tail longer than this is checked and sent as it stands. */
export const HOLD_MAX = 200;
/** B70: a secret value shorter than this is not matched by rule 1 (it would eat ordinary text). */
export const SECRET_MIN = 4;

// Rule 2 (D127): a PEM private key block, to its -----END line or the string's end.
const PEM = /-----BEGIN [^\n]*?PRIVATE KEY-----[\s\S]*?(?:-----END [^\n]*?PRIVATE KEY-----|$)/gi;
// Rule 3 (D127): an auth scheme word and its credential; the word is kept.
// Tool input: case-insensitive as §5.3's table says. Reply text (B71, T45):
// `bearer`/`basic` in any case; `Token`/`TOKEN` capitalised or upper-case only,
// and `token` in any case right after `Authorization:` (any case) (D211's S-SEC-02:
// "The token in …" is prose and stays).
const SCHEME_INPUT = /\b(Bearer|Basic|Token)([ \t]+)(?!\[redacted\])([^\s]+)/gi;
const SCHEME_TEXT = /(?<=\b(?i:authorization):[ \t]*)((?i:token))([ \t]+)(?!\[redacted\])([^\s]+)|\b((?i:bearer|basic)|Token|TOKEN)([ \t]+)(?!\[redacted\])([^\s]+)/g;
// Rule 4 (D127): a secret-like name (§5.3's seven parts).
const SECRET_NAME = /pass|secret|token|key|auth|credential|sig/i;
// Rule 4 inside a string: `name=value`, `name: value`, `--name=value`, and
// `--name value`; a quote around the name or the value is allowed (B72).
// Only a secret-like name matches, so a plain `https:` never swallows the rest.
const NAME = String.raw`[A-Za-z0-9_.-]*(?:pass|secret|token|key|auth|credential|sig)[A-Za-z0-9_.-]*`;
const NAME_SEP_VALUE = new RegExp(String.raw`(?<![A-Za-z0-9_.-])(${NAME})(["']?)([ \t]*[=:][ \t]*)(["']?)([^\s&"',]+)`, 'gi');
const FLAG_VALUE = new RegExp(String.raw`(?<![A-Za-z0-9_-])--(${NAME})([ \t]+)(["']?)([^\s&"',-][^\s&"',]*)`, 'gi');
// Rule 5 (D127): known token prefixes, case-sensitive, not inside a longer word.
const PREFIXES = /(?<![A-Za-z0-9_])(?:sk-[A-Za-z0-9_-]{20,}|(?:ghp_|gho_|ghs_|github_pat_|glpat-|xoxb-|xoxp-)[A-Za-z0-9_-]+|AKIA[A-Z0-9]{16}(?![A-Za-z0-9]))/g;
// Rule 6 (D127): 32 or more of A-Z a-z 0-9 + / = _ - with an upper, a lower and a digit.
const LONG_RUN = /[A-Za-z0-9+/=_-]{32,}/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rule 1: the exact values of the room's secrets, longest first. */
function ruleSecrets(secrets) {
  const list = [...new Set(secrets.filter((s) => typeof s === 'string' && s.trim().length >= SECRET_MIN))]
    .sort((a, b) => b.length - a.length);
  if (list.length === 0) return (s) => s;
  const re = new RegExp(list.map(escapeRe).join('|'), 'g');
  return (s) => s.replace(re, REDACTED);
}

const rulePem = (s) => s.replace(PEM, REDACTED);
const ruleScheme = (re) => (s) => s.replace(re, (...m) => {
  // The scheme word and its gap are the first two groups that matched (SCHEME_TEXT has two branches).
  const [word, gap] = m.slice(1).filter((g) => typeof g === 'string');
  return `${word}${gap}${REDACTED}`;
});

/** Rule 4 inside a string: the value after a secret-like name. */
function keepValue(value) {
  // §5.3: unless it is already [redacted] or is rule 3's word.
  return value.startsWith(REDACTED) || /^(bearer|basic|token)$/i.test(value);
}
function ruleNameValue(s) {
  return s
    .replace(NAME_SEP_VALUE, (all, name, q1, sep, q2, value) => (
      !keepValue(value) ? `${name}${q1}${sep}${q2}${REDACTED}` : all))
    .replace(FLAG_VALUE, (all, name, gap, q, value) => (
      !keepValue(value) ? `--${name}${gap}${q}${REDACTED}` : all));
}

const rulePrefixes = (s) => s.replace(PREFIXES, REDACTED);
const ruleLongRun = (s) => s.replace(LONG_RUN, (run) => (/[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run) ? REDACTED : run));

export function createRedactor({ secrets = [] } = {}) {
  const r1 = ruleSecrets(secrets);
  const r3input = ruleScheme(SCHEME_INPUT);
  const r3text = ruleScheme(SCHEME_TEXT);

  /** §5.3, in the table's order, on one string of a tool's input. */
  const inputString = (s) => ruleLongRun(rulePrefixes(ruleNameValue(r3input(rulePem(r1(s))))));
  /** security.md §5 (D211): rules 1, 2, 3, 5 and 6 on reply text. */
  const text = (s) => ruleLongRun(rulePrefixes(r3text(rulePem(r1(String(s))))));

  /** Every string value redacted; keys kept; a secret-like key's value whole (rule 4). */
  function input(v, depth = 0) {
    if (typeof v === 'string') return inputString(v);
    if (v === null || typeof v !== 'object') return v;
    if (depth > 20) return REDACTED;
    if (Array.isArray(v)) return v.map((x) => input(x, depth + 1));
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_NAME.test(k) ? REDACTED : input(x, depth + 1);
    return o;
  }

  /**
   * One text block's deltas (security.md §5 "While streaming"): the tail after
   * the last white space waits for the next delta; a line starting -----BEGIN
   * waits for its -----END line; the block's end (`end()`) lets the rest go.
   */
  function stream() {
    let held = '';
    function push(delta) {
      let s = held + String(delta);
      let out = '';
      for (;;) {
        // B74: a -----BEGIN anywhere (not only at a line's start) waits.
        const at = s.indexOf('-----BEGIN');
        if (at < 0) break;
        const endRe = /-----END [^\n]*?-----/g;
        endRe.lastIndex = at;
        const end = endRe.exec(s);
        if (!end) {
          // Held from the BEGIN on, as long as it takes (rule 2); what comes
          // before it may go but for its last word.
          const head = s.slice(0, at);
          const cutAt = holdFrom(head);
          held = s.slice(cutAt);
          return out + text(head.slice(0, cutAt));
        }
        const stop = end.index + end[0].length;
        out += text(s.slice(0, stop));
        s = s.slice(stop);
      }
      const cutAt = holdFrom(s);
      out += text(s.slice(0, cutAt));
      held = s.slice(cutAt);
      if (held.length > HOLD_MAX) {
        out += text(held);
        held = '';
      }
      return out;
    }
    function end() {
      const rest = held;
      held = '';
      return rest ? text(rest) : '';
    }
    return { push, end, get held() { return held; } };
  }

  return { input, text, stream };
}

/**
 * Where the tail to hold starts: after the last white space; a rule 3 word
 * right before it waits too, or its credential would leave without it (B73).
 */
function holdFrom(s) {
  const m = /\s(?=\S*$)/.exec(s);
  if (!m) return 0;
  const at = m.index + 1;
  // The words of SCHEME_TEXT (T45): `bearer`/`basic` any case, `Token`/`TOKEN`, and
  // `Authorization:` with or without its `token`, whose credential is still to come.
  const word = HOLD_WORD.exec(s.slice(0, at));
  return word ? (word.indices[1] ?? word.indices[2])[0] : at;
}
const HOLD_WORD = /(?:^|\s)((?i:bearer|basic)|Token|TOKEN)[ \t]+$|\b((?i:authorization):(?:[ \t]*(?i:token))?)[ \t]+$/d;

/**
 * Rule 1's list (D127): `LANEBOARD_MCP_TOKEN`, the speech token
 * (`cockpit.stt.tokenFile`, read if it is there) and the values of
 * `cockpit.agent.env`'s names in the room's environment.
 */
export function roomSecrets({ mcpToken = null, env = {}, names = [], sttTokenFile = null, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const out = [];
  if (mcpToken) out.push(String(mcpToken));
  for (const n of names) if (typeof env[n] === 'string' && env[n] !== '') out.push(env[n]);
  if (sttTokenFile) {
    try {
      const t = readFile(sttTokenFile).trim();
      if (t) out.push(t);
    } catch { /* no file: nothing to match */ }
  }
  return out;
}
