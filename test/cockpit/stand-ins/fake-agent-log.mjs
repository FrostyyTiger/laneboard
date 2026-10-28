// Reads the fake agent's log, `$FAKE_AGENT_DIR/received.jsonl` (cockpit spec
// `stand-ins.md` §2.6). Every function reads the file fresh, so a test asserts
// on what the fake has done up to now.
//
//   const log = fakeAgentLog(dir);
//   log.prompts()                 the `prompt` lines (the "received-turns log"), resends included
//   log.order('prompt', 'turn-end')  the kinds in file order, filtered
import fs from 'node:fs';
import path from 'node:path';

/** Every line of the log, parsed; [] before the fake wrote anything. */
export function readFakeAgentLog(dir) {
  let text;
  try { text = fs.readFileSync(path.join(dir, 'received.jsonl'), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function fakeAgentLog(dir) {
  const of = (kind) => () => readFakeAgentLog(dir).filter((l) => l.kind === kind);
  return {
    lines: () => readFakeAgentLog(dir),
    prompts: of('prompt'),
    interrupts: of('interrupt'),
    toolResults: (tool) => readFakeAgentLog(dir).filter((l) => l.kind === 'tool-result' && (tool == null || l.tool === tool)),
    turnEnds: of('turn-end'),
    signals: of('signal'),
    starts: of('start'),
    loginChecks: of('login-check'),
    /** With no kinds: every kind but `stdin` (each is followed by its decoded line). */
    order: (...kinds) => readFakeAgentLog(dir)
      .map((l) => l.kind)
      .filter((k) => (kinds.length ? kinds.includes(k) : k !== 'stdin')),
  };
}
