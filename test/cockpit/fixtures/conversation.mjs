// Seeded turns for the cockpit's acceptance tests (spec c1-talk.md §6: "N seeded
// turns are `done` turns written before boot by test/cockpit/fixtures/conversation.mjs
// through boot({stateFiles}), dated in the last hour"; protocols.md §11.7.1).
//
//   boot({ ..., stateFiles: conversationFiles({ turns: seededTurns(3) }) })
//
// A module of exports only: `node --test` runs it like every .mjs under test/
// and it passes doing nothing.
import { isoAt } from '../../../server/cockpit/iso.mjs';

/** The words of the seeded turns, oldest first; more than these repeat with a number. */
const WORDS = [
  ['what is stuck', '■ One run is stuck: builder-a since 03:12.'],
  ['and the docs run?', 'acme-docs finished at 04:10; its PR is green.'],
  ['how did the night go?', 'Two of three runs finished. acme-billing is stuck on the same task.'],
];

export const SEEDED_CONVERSATION = 'c-0007';
export const SEEDED_SESSION = '0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91';

/** `n` done turns, t-0001…, ten minutes apart, the last 5 minutes before `now`, each 8 s long. */
export function seededTurns(n, { now = Date.now() } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [prompt, reply] = WORDS[i % WORDS.length];
    const k = Math.floor(i / WORDS.length);
    const at = now - 5 * 60_000 - (n - 1 - i) * 10 * 60_000;
    const turnId = `t-${String(i + 1).padStart(4, '0')}`;
    out.push({
      turnId, clientId: `p-${String(i + 1).padStart(8, '0')}`, source: 'typed', lang: null, about: null,
      prompt: k ? `${prompt} (${k + 1})` : prompt, at: isoAt(at), state: 'done',
      items: [{ kind: 'text', blockIndex: 0, text: reply }],
      end: { state: 'done', at: isoAt(at + 8000) },
    });
  }
  return out;
}

/**
 * The room's files for a conversation (`session.json`, `conversation.jsonl`), as
 * `boot({stateFiles})` takes them. No turns: the conversation exists and is empty.
 */
export function conversationFiles({ turns = [], conversation = SEEDED_CONVERSATION, session = SEEDED_SESSION, now = Date.now() } = {}) {
  const startedAt = isoAt(Math.min(now - 3600_000, ...turns.map((t) => Date.parse(t.at))));
  const lines = [
    { kind: 'conversation', conversation, startedAt, reason: 'owner' },
    ...turns.map((turn) => ({ kind: 'turn', turn })),
  ];
  return {
    'cockpit/session.json': JSON.stringify({ conversation, session, startedAt }),
    'cockpit/conversation.jsonl': lines.map((l) => `${JSON.stringify(l)}\n`).join(''),
  };
}
