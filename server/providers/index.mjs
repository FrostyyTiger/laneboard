// The three provider interfaces, chosen by config.
//
// Everything site-specific in laneboard lives behind one of these, and every
// one of them has a `none` implementation that does nothing and says so. The
// point is not extensibility for its own sake: it is that a laneboard on a
// machine with no agent stack, nothing live next to it and no forge is the
// *default*, and still works.
//
// | interface | none | real |
// | --- | --- | --- |
// | slots | no slots; launch and retire refuse | `agent-stack` |
// | guard | nothing watched | `ports` |
// | ci | no PR chips, no queue | `gh` |
//
// To add one: write a module with the same exports next to its siblings, add
// it to the table below and to the `provider` enum in config.mjs. Nothing
// else changes. docs/providers.md has the interfaces in full.
import { config, PROVIDERS } from '../config.mjs';

import * as slotsNone from './slots/none.mjs';
import * as slotsAgentStack from './slots/agent-stack.mjs';
import * as guardNone from './guard/none.mjs';
import * as guardPorts from './guard/ports.mjs';
import * as ciNone from './ci/none.mjs';
import * as ciGh from './ci/gh.mjs';

const TABLE = {
  slots: { none: slotsNone, 'agent-stack': slotsAgentStack },
  guard: { none: guardNone, ports: guardPorts },
  ci: { none: ciNone, gh: ciGh },
};

/** The names each kind accepts. config.mjs carries the same list for its
 * validation, without importing this module; they must not drift. */
export const providerNames = Object.fromEntries(
  Object.entries(TABLE).map(([kind, impls]) => [kind, Object.keys(impls)])
);
for (const [kind, names] of Object.entries(providerNames)) {
  const declared = PROVIDERS[kind] ?? [];
  const missing = names.filter((n) => !declared.includes(n)).concat(declared.filter((n) => !names.includes(n)));
  if (missing.length) {
    throw new Error(`providers: config.mjs and the provider table disagree about ${kind}: ${missing.join(', ')}`);
  }
}

function pick(kind) {
  const chosen = config[kind]?.provider ?? 'none';
  // config.mjs refuses an unknown name at start, so this cannot normally miss.
  return TABLE[kind][chosen] ?? TABLE[kind].none;
}

export let slots = pick('slots');
export let guard = pick('guard');
export let ci = pick('ci');

/**
 * Swap a provider. Only the tests use this — a fake slot provider is how
 * launch and retire are tested without an agent stack anywhere near them.
 * Returns the previous one, so a test can put it back.
 */
export function _set(kind, impl) {
  const prev = { slots, guard, ci }[kind];
  if (kind === 'slots') slots = impl ?? pick('slots');
  else if (kind === 'guard') guard = impl ?? pick('guard');
  else if (kind === 'ci') ci = impl ?? pick('ci');
  else throw new Error(`no such provider kind: ${kind}`);
  return prev;
}
