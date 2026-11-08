// The `none` engine: no engine. No products, nothing waiting, no runs of its
// own (run.jsonl runs still come from the `jsonl` engine). Every member
// but `hello` answers `unsupported`; `hello` and `status` say there is no engine.
import { unsupportedMembers } from './adapter.mjs';

export const kind = 'none';

export function create({ id = 'none' } = {}) {
  return {
    ...unsupportedMembers(id),
    id,
    kind,
    capabilities: ['hello'],
    async hello() {
      return { ok: true, data: { contract: null, version: null, oldest: null, served: [], verbs: [] }, at: Date.now(), dropped: 0 };
    },
    status() {
      return { id, kind, state: 'off', reason: 'no engine configured', accepts: null, contract: null, version: null,
        lastGoodAt: null, lastFailAt: null, dropped: {} };
    },
  };
}
