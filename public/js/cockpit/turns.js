// A turn in the pane (cockpit spec c1-talk.md §3, §5.1; D227): the label rows,
// the prompt block and the reply, built from a turn as the room's snapshot
// carries it (protocols.md §2.2). Text only, never markup: every string the
// room sends goes in as textContent (no innerHTML).
//
// What T15 draws: the prompt and the reply's text blocks as plain lines. The
// renderer of md.js (tables, code, marks) comes with T19, tool lines with T20,
// streaming (text.delta, the cursor) with T18; each replaces its part here.
import { hhmm } from '../core/cockpit-time.js';

const el = (doc, tag, cls, attrs = {}) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const timeOf = (iso) => {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? hhmm(ms) : null;
};

/** The label row `YOU · 07:02` / `AGENT · 07:02` (c1-talk.md §3, D227). */
export function labelRow(doc, who, iso) {
  const row = el(doc, 'div', 'ck-label', { 'data-turn-label': '' });
  const t = timeOf(iso);
  row.textContent = t ? `${who} · ${t}` : who;
  return row;
}

/**
 * When the reply's label row says it was: the turn's first item (a call's
 * start or the end), else the turn's own time (build B110).
 */
function replyAt(turn) {
  for (const it of turn.items ?? []) if (it?.startedAt) return it.startedAt;
  return turn.end?.at ?? turn.at;
}

/** One turn: `[data-turn-id]` holding its prompt block and everything under it (T91). */
export function turnNode(doc, turn) {
  const box = el(doc, 'section', 'ck-turn', { 'data-turn-id': String(turn.turnId ?? '') });
  if (typeof turn.prompt === 'string') {
    box.append(labelRow(doc, 'YOU', turn.at));
    const p = el(doc, 'div', 'ck-prompt');
    p.textContent = turn.prompt;
    box.append(p);
  }
  const texts = (turn.items ?? [])
    .filter((it) => it?.kind === 'text' && typeof it.text === 'string')
    .sort((a, b) => (a.blockIndex ?? 0) - (b.blockIndex ?? 0));
  if (texts.length) {
    box.append(labelRow(doc, 'AGENT', replyAt(turn)));
    const reply = el(doc, 'div', 'ck-reply', { 'data-reply': '' });
    for (const it of texts) {
      const b = el(doc, 'p', 'ck-block');
      b.textContent = it.text;
      reply.append(b);
    }
    box.append(reply);
  }
  return box;
}
