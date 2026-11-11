// The agent's proposals on the page (docs/cockpit-tools.md, propose): the room
// asks this screen with `propose.open`; the page reads the item or run fresh
// from the board, shows the same card as the board's own button, with the
// agent's why, and on the person's yes sends it through the board's dispatcher
// as them (docs/decisions.md). The answer goes back as `propose.answer`.
//
//   const p = createProposals({ page, send });   // send(msg): the room link's
//   p.apply(msg)                                 // propose.open / propose.end
import { askEngineText, runDecision } from '../views/engine-actions.js';
import { decisionPlans, loadWaiting } from '../views/inbox-waiting.js';
import { runControls } from '../views/runs-engine.js';
import { confirmAction } from '../ui/confirm.js';

const WORDS = { approve: 'approve', reject: 'reject', pick: 'pick', answer: 'answer', pause: 'pause', resume: 'resume', stop: 'stop' };

/**
 * The board's own plan for what the agent proposed, with the card's extra
 * lines; null when the item or run no longer takes it. Pure.
 */
export function proposalPlan(msg, { item = null, run = null } = {}) {
  let plan = null;
  if (msg.item) {
    if (!item) return null;
    plan = decisionPlans(item, msg.engine).find((p) => p.word === WORDS[msg.decision]
      && (msg.decision !== 'pick' || p.args?.choice === msg.choice)) ?? null;
  } else if (msg.run) {
    if (!run) return null;
    plan = runControls(`${msg.engine}/${msg.run}`, run).find((p) => p.word === WORDS[msg.decision]) ?? null;
  }
  if (!plan) return null;
  return { ...plan, lines: ['Asked by the agent', ...plan.lines, `Why, in the agent's words: ${String(msg.why).slice(0, 1000)}`] };
}

async function loadProposedRun(engine, id, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(`/api/engine/${encodeURIComponent(engine)}/run/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!r.ok) return null;
    const b = await r.json();
    return b?.data?.run ?? null;
  } catch {
    return null;
  }
}

export function createProposals({ page = 'app', send, io = {} } = {}) {
  let current = null; // {id, root, ended}

  function answer(id, answerWord, { ok = false, code = null, text = null } = {}) {
    send({ type: 'propose.answer', proposalId: id, answer: answerWord, ok, code, text: text ? String(text).slice(0, 300) : null });
  }

  async function open(msg) {
    const id = msg.proposalId;
    if (page !== 'app') return answer(id, 'failed', { text: 'This screen cannot send decisions; open laneboard itself.' });
    if (current) return answer(id, 'failed', { text: 'Another proposal is open on this screen.' });
    const root = document.createElement('div');
    root.dataset.proposal = id;
    document.body.append(root);
    const mine = { id, root, ended: false };
    current = mine;
    try {
      let item = null;
      let run = null;
      if (msg.item) {
        const w = await (io.loadWaiting ?? loadWaiting)();
        item = w?.items.find((it) => it.engine === msg.engine && it.id === msg.item) ?? null;
      } else {
        run = await (io.loadRun ?? loadProposedRun)(msg.engine, msg.run);
      }
      const plan = proposalPlan(msg, { item, run });
      if (mine.ended) return;
      if (!plan) return answer(id, 'failed', { text: msg.item ? 'It no longer waits, or no longer takes this decision.' : 'The run no longer takes this decision.' });
      const out = await runDecision(plan, {
        alwaysCard: true,
        ask: (o) => (io.ask ?? confirmAction)({ ...o, root }),
        askText: (title) => (io.askText ?? askEngineText)(title, msg.text ?? '', root),
        ...(io.send ? { send: io.send } : {}),
        ...(io.say ? { say: io.say } : {}),
      });
      if (mine.ended) return;
      if (!out) return answer(id, 'no');
      answer(id, 'sent', { ok: out.kind === 'ok', text: out.text });
    } finally {
      mine.ended = true;
      root.remove();
      if (current === mine) current = null;
    }
  }

  function end(msg) {
    if (!current || current.id !== msg.proposalId) return;
    current.ended = true;
    for (const d of current.root.querySelectorAll('dialog')) if (d.open) d.close();
  }

  return {
    apply: (msg) => {
      if (msg.type === 'propose.open') open(msg).catch(() => answer(msg.proposalId, 'failed', { text: 'The page failed to show it.' }));
      else if (msg.type === 'propose.end') end(msg);
    },
  };
}
