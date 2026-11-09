// A person's decisions on a run engine: button -> what is decided, shown back ->
// the action (docs/decisions.md). The server decides whether it is allowed; the
// card is only so that you see what you are about to do.
import { el } from '../core/dom.js';
import { actEngine, uuid } from '../core/actions.js';
import { confirmAction } from '../ui/confirm.js';
import { toast } from '../ui/toast.js';
import { store } from '../core/store.js';

/** On a server that cannot tell itself from a program on it (docs/decisions.md). */
export const POSE_WARNING = 'Warning: a program on this machine could pose as you.';

/** Ids of sends whose outcome is unknown: pressing again re-sends the same id, so the engine applies it once. */
const unknownSends = new Map();
const sendKey = (p, args) => JSON.stringify([p.action, p.target, args]);

/** The sentence for a result, and whether the id must be kept for a retry. Pure. */
export function decisionOutcome(word, r) {
  if (r?.ok === true) return { kind: 'ok', text: r.result?.replayed ? `${word}: it had already gone through` : `${word}: done` };
  if (r?.ok === 'unknown' || r?.code === 'timeout') return { kind: 'err', retry: true, text: `No answer in time, so ${word} may have gone through. Press it again: it is safe, it applies once.` };
  switch (r?.code) {
    case 'remote-only': return { kind: 'err', text: `${word} cannot be sent from this machine itself. Open laneboard through your normal sign-in.` };
    case 'peer-check-off': return { kind: 'err', text: 'Decisions are off until fleet.ingressPeerUid is set on this server. See docs/decisions.md.' };
    case 'stale-revision': return { kind: 'err', text: 'It changed since you read it. Nothing was decided. Look at it again.' };
    case 'already-decided': return { kind: 'err', text: 'This was already decided.' };
    case 'engine-down': return { kind: 'err', text: `The engine is not answering. ${word} was not sent.` };
    default: return { kind: 'err', text: String(r?.error ?? `${word} failed`).slice(0, 300) };
  }
}

/** A small form for a reason or an answer. Resolves the text, or null on cancel. */
function askEngineText(title) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'cfm';
    const form = document.createElement('form');
    const area = document.createElement('textarea');
    area.rows = 5;
    area.maxLength = 4000;
    area.setAttribute('aria-label', title);
    const row = el('div', 'cfm-b');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.type = 'button';
    const ok = el('button', 'btn btn--primary', 'Continue');
    ok.type = 'submit';
    row.append(cancel, ok);
    form.append(el('h2', 'cfm-t', title), area, row);
    dlg.append(form);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    cancel.addEventListener('click', () => done(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = area.value.trim(); if (v) done(v); });
    document.body.append(dlg);
    dlg.showModal();
    area.focus();
  });
}

/**
 * One decision, start to end. `io` is for tests. Resolves the outcome, or null
 * when the person cancelled.
 */
export async function runDecision(plan, io = {}) {
  const ask = io.ask ?? confirmAction;
  const askText = io.askText ?? askEngineText;
  const send = io.send ?? actEngine;
  const say = io.say ?? toast;
  const newId = io.newId ?? uuid;
  const args = { ...plan.args };
  const lines = [...plan.lines];
  if (plan.askText) {
    const text = await askText(plan.askText.title);
    if (!text) return null;
    args[plan.askText.key] = text;
    lines.push(plan.showBack ? `Your answer: ${text}` : `Reason: ${text}`);
  }
  // A confirm-tier action shows a card with one button, no typing (the plan's Q8).
  const needsCard = plan.tier === 'confirm' || plan.tier === 'ask' || plan.showBack;
  if (needsCard) {
    if ((io.peerCheck ?? store.peerCheck) === 'unavailable') lines.push(POSE_WARNING);
    const a = await ask({ action: plan.word, targets: [plan.target], tier: 'ask', consequence: lines });
    if (!a?.ok) return null;
  }
  if (plan.tier === 'confirm') args.confirm = plan.target;
  const key = sendKey(plan, args);
  const id = unknownSends.get(key) ?? newId();
  const out = decisionOutcome(plan.word, await send(plan.action, plan.target, args, { id }));
  if (out.retry) unknownSends.set(key, id);
  else unknownSends.delete(key);
  say(out.text, { kind: out.kind });
  return out;
}

export function decisionButton(plan, onDone) {
  const b = el('button', 'btn btn--s wt-btn', plan.label);
  b.type = 'button';
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try {
      const out = await runDecision(plan);
      if (out?.kind === 'ok') onDone?.();
    } finally { b.disabled = false; }
  });
  return b;
}
