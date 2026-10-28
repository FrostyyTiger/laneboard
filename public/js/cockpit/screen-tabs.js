// The pages of one screen (cockpit spec c1-talk.md §7 "Rate", §12 "The rate is
// per screen", S-C1-43; build B234): every page and tab of one browser holds
// that screen's token, so a prompt the room refuses as `too-many` (E9) is that
// screen's, and its other pages draw the same block. The room sends
// `prompt.refused` to the sender only and without the text (protocols.md §3.1),
// so the sending page tells its sister pages itself, over a BroadcastChannel
// (same origin only; nothing leaves the browser).
//
//   const tabs = createScreenTabs({win, onRefused})  // onRefused({clientId, text, at, code})
//   tabs.refused({clientId, text, at, code})         // tell the other pages
//   tabs.close()
//   refusedNote(data) → {clientId, text, at, code} | null   // what another page sent, checked
//
// No BroadcastChannel (an old browser, a test without one): every call is a no-op.

/** The channel's name: one per origin, so one per board. */
export const SCREEN_CHANNEL = 'laneboard-cockpit-screen';
/** c1-talk.md §7 "Length": a prompt is at most 8 000 characters. */
const MAX_TEXT = 8_000;
const CLIENT_ID = /^p-[0-9a-f]{8}$/;

/** A refusal note from another page, as this page will draw it; anything else is null. */
export function refusedNote(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type !== 'prompt.refused' || data.code !== 'too-many') return null;
  if (typeof data.clientId !== 'string' || !CLIENT_ID.test(data.clientId)) return null;
  if (typeof data.text !== 'string' || data.text.trim() === '' || data.text.length > MAX_TEXT) return null;
  if (!Number.isFinite(data.at)) return null;
  return { clientId: data.clientId, text: data.text, at: data.at, code: data.code };
}

/** Nothing to tell: no BroadcastChannel here, or a page that has no sisters (unsupported). */
export const NO_TABS = Object.freeze({ refused: () => {}, close: () => {} });

export function createScreenTabs(opts = {}) {
  const win = opts.win ?? globalThis;
  const onRefused = opts.onRefused ?? (() => {});
  const Channel = win?.BroadcastChannel;
  if (typeof Channel !== 'function') return NO_TABS;
  const ch = new Channel(SCREEN_CHANNEL);
  ch.onmessage = (e) => {
    const note = refusedNote(e?.data);
    if (note) onRefused(note);
  };
  return {
    refused: (msg) => {
      const note = refusedNote({ ...msg, type: 'prompt.refused' });
      if (note) ch.postMessage({ type: 'prompt.refused', ...note });
    },
    close: () => ch.close(),
  };
}
