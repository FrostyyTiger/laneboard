// The tool allowlist's matching (spec protocols.md §11.11, D240, Q-O23 a).
// REVIEW-REQUIRED (fenced.txt's last block: the agent's allowlist): the room's
// own check of a `kind: bridge` agent (fence 3 of §11.11) rests on these two.
//
//   toolAllowed(name, list)     a tool name is matched by an entry: equal, or
//                               the entry ends in `*` and the name starts with
//                               the part before it
//   entryCovered(entry, list)   an entry of the agent's own `ready.allowlist`
//                               is equal to an entry of `list` or covered by
//                               one of its `*` entries (a `*` entry of the
//                               agent's is covered only by a `*` entry whose
//                               prefix is a prefix of its own)

const isStr = (v) => typeof v === 'string' && v !== '';

export function toolAllowed(name, list) {
  if (!isStr(name) || !Array.isArray(list)) return false;
  return list.some((e) => isStr(e) && (e.endsWith('*') ? name.startsWith(e.slice(0, -1)) : name === e));
}

export function entryCovered(entry, list) {
  if (!isStr(entry) || !Array.isArray(list)) return false;
  if (list.includes(entry)) return true;
  const own = entry.endsWith('*') ? entry.slice(0, -1) : entry;
  return list.some((e) => isStr(e) && e.endsWith('*') && own.startsWith(e.slice(0, -1)));
}
