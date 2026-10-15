// Flag module: `awaitingApproval` on sessions and the snapshot key
// `approvals` (fleet plan §8 2.2).
//
// A session decorator sets `awaitingApproval: <approvalId>|null` from the
// held PermissionRequests of server/control/approvals.mjs, matched by the
// session's Claude sessionId. state.mjs's attentionScore reads the field and
// scores the session as `waiting_permission`; the state word is not changed.
//
// `snapshot().approvals` is approvals.pending(): plain-object clones with the
// approval preview kept. Everything in an approval (tool input, summary,
// preview lines) came from the agent and is untrusted text: this module never
// formats or escapes it, it passes strings through unchanged and the renderer
// uses textContent only.
import * as approvals from '../control/approvals.mjs';

// sessionId -> id of that session's oldest pending approval. Rebuilt lazily
// after approvals.onChange, so a snapshot with N sessions costs one pending()
// call, not N.
let bySession = null;
let unsubscribe = null;

function index() {
  if (bySession) return bySession;
  const m = new Map();
  // pending() is sorted oldest first: keep the first id per session.
  for (const a of approvals.pending()) {
    if (a.status !== 'pending' || typeof a.sessionId !== 'string' || !a.sessionId) continue;
    if (!m.has(a.sessionId)) m.set(a.sessionId, a.id);
  }
  bySession = m;
  return m;
}

function invalidate() {
  bySession = null;
}

/** The id of the oldest pending approval held for session `s`, or null. */
export function awaitingApprovalFor(s) {
  const sid = s?.claude?.sessionId ?? s?.sessionId ?? null;
  if (typeof sid !== 'string' || !sid) return null;
  return index().get(sid) ?? null;
}

/** Session decorator: owns `awaitingApproval` on every call. */
export function decorate(s) {
  return { awaitingApproval: awaitingApprovalFor(s) };
}

/** Snapshot key `approvals`: the pending approvals, oldest first. */
export function snapshotApprovals() {
  return approvals.pending();
}

export default {
  name: 'flag-approval',
  modes: ['builder'],
  register(ctx) {
    invalidate();
    unsubscribe?.();
    unsubscribe = approvals.onChange(invalidate);
    ctx.state.addDecorator('awaitingApproval', { session: decorate });
    ctx.state.addSnapshotKey('approvals', snapshotApprovals);
  },
  stop() {
    unsubscribe?.();
    unsubscribe = null;
    invalidate();
  },
};
