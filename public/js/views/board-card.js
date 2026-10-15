// One session card and its ⋯ menu. Moved from public/app.js (fleet F1).
import { el } from '../core/dom.js';
import { previewToNodes } from '../core/ansi.js';
import { STATE_LABEL, ago, money, shortDir } from '../core/format.js';
import { laneById, store } from '../core/store.js';
import { del, post } from '../core/net.js';
import { stateDot } from '../ui/widgets.js';
import { toast } from '../ui/shell.js';
import { togglePin } from '../ui/dock.js';
import { QUICK_KEYS, openSheet, sendQuick } from '../ui/sheet.js';
import { cardNodes, toggleLane } from './board.js';

export function renderCard(s, { row = false } = {}) {
  const card = el('div', `card s-${s.state}${row ? ' card-row' : ''}${s.danger ? ' danger' : ''}`);
  card.dataset.name = s.name;
  card.dataset.row = row ? '1' : '0';
  if (store.cursor === s.name) card.classList.add('cursor');
  if (store.pinned.has(s.name)) card.classList.add('pinned');

  // The lane stripe: 3 px down the left edge, one stable colour per worktree.
  // Pre-attentive — you see the grouping from across the 49" without reading
  // anything — and it survives the attention sort completely, because it
  // changes no order. A session with no repo gets NO stripe rather than a grey
  // one: absence reads faster than a null colour.
  // Inside a lane card the card's own stripe and chip would repeat its header.
  const lane = row ? null : laneById(s.lane);
  if (lane) {
    card.classList.add('has-lane');
    card.style.setProperty('--lane-hue', String(lane.hue));
  }

  const top = el('div', 'card-top');
  top.append(stateDot(s.state, s.stateSince));
  top.append(el('span', 'card-name', s.name));
  // The chip makes the stripe legible: the stripe says "these three are the
  // same thing", the chip says which thing.
  if (lane) {
    const chip = el('span', 'lane-chip', lane.id);
    chip.style.setProperty('--lane-hue', String(lane.hue));
    chip.title = `${lane.root}${lane.branch ? ` · ${lane.branch}` : ''}` +
      `${lane.sessions.length > 1 ? ` · ${lane.sessions.length} sessions` : ''}`;
    chip.onclick = (e) => { e.stopPropagation(); toggleLane(lane.id); };
    top.append(chip);
  }
  top.append(el('span', `pill s-${s.state}`, STATE_LABEL[s.state] || s.state));
  top.append(el('span', 'card-since', ago(s.stateSince)));
  card.append(top);

  // The guard's finding, above everything else on the card (v3).
  if (s.danger) {
    const dg = el('div', 'marker-line mk-danger');
    dg.append(el('span', 'mk-kind', 'danger'));
    dg.append(el('span', 'mk-text', s.danger.reason));
    card.append(dg);
  }

  const meta = el('div', 'card-meta');
  if (s.dir && !row) meta.append(el('span', 'dir', shortDir(s.dir)));
  if (s.branch && !row) meta.append(el('span', 'branch', `⌥${s.branch}`));
  // In a row the context bar folds into the meta line: one row, one height.
  if (row && s.context?.usedPct != null) {
    const c = el('span', `ctxn${s.context.usedPct >= 85 ? ' hot' : s.context.usedPct >= 65 ? ' warn' : ''}`, `ctx ${s.context.usedPct}%`);
    meta.append(c);
  }
  if (s.dirty) meta.append(el('span', 'dirty', `●${s.dirty}`));
  if (s.ahead) meta.append(el('span', 'ahead', `↑${s.ahead}`));
  if (s.behind) meta.append(el('span', 'ahead', `↓${s.behind}`));
  if (s.claude?.model) meta.append(el('span', 'model', s.claude.model));
  if (s.cost?.usd) {
    const c = el('span', 'cost', money(s.cost.usd));
    c.title = `API-equivalent, all time. Today ${money(s.cost.usdToday)}.` +
      (s.statuslineCostUsd ? ` Claude Code reports ${money(s.statuslineCostUsd)}.` : '');
    meta.append(c);
  }
  // RSS and swap moved here from the Machine view in v3.
  if (s.claude?.rssMb) {
    const mem = el('span', 'mem', `${s.claude.rssMb}MB`);
    mem.title = `resident memory${s.claude.swapMb ? `, ${s.claude.swapMb} MB swapped out` : ''}`;
    meta.append(mem);
    if (s.claude.swapMb) meta.append(el('span', 'dirty', `+${s.claude.swapMb}M swap`));
  }
  if (meta.childNodes.length) card.append(meta);

  if (!row && s.context?.usedPct != null) {
    const ctx = el('div', 'ctx');
    const lab = el('div', 'ctx-label');
    lab.append(el('span', null, 'context'));
    lab.append(el('span', null, `${s.context.usedPct}%${s.context.size ? ` of ${Math.round(s.context.size / 1000)}k` : ''}`));
    const track = el('div', 'gauge-track');
    const fill = el('div', 'gauge-fill');
    fill.style.width = `${s.context.usedPct}%`;
    if (s.context.usedPct >= 85) fill.classList.add('hot');
    else if (s.context.usedPct >= 65) fill.classList.add('warn');
    track.append(fill);
    ctx.append(lab, track);
    card.append(ctx);
  }

  // One line in this slot, never two. A running tool wins it — that is what
  // the session is doing *now*; the marker is what it last shouted, and while
  // a tool is running the marker has almost always been dealt with. When
  // nothing is running the marker takes the slot, so the card costs the same
  // height either way and a NEED-HUMAN is never invisible on an idle card.
  if (s.activity?.tool) {
    const t = el('div', 'tool-line');
    t.append(el('span', 'tname', s.activity.tool));
    if (s.activity.toolInput) t.append(el('span', 'targ', s.activity.toolInput));
    if (s.lastMarker) t.title = `last marker — ${s.lastMarker.kind}: ${s.lastMarker.text}`;
    card.append(t);
  } else if (s.lastMarker) {
    const mk = el('div', `marker-line mk-${s.lastMarker.kind}`);
    mk.append(el('span', 'mk-kind', s.lastMarker.kind));
    mk.append(el('span', 'mk-text', s.lastMarker.text));
    mk.title = `${s.lastMarker.source} · ${new Date(s.lastMarker.ts).toLocaleString('en-GB')}`;
    card.append(mk);
  }

  if (s.activity?.lastUserPrompt && (s.state === 'working' || s.state.startsWith('waiting'))) {
    card.append(el('div', 'say say-user', `“${s.activity.lastUserPrompt}”`));
  }
  if (s.activity?.lastAssistant) {
    card.append(el('div', 'say', s.activity.lastAssistant));
  }

  // Raw ANSI lines on the wire (fleet F6; the old server-rendered previewHtml
  // is gone): built here as text nodes and spans, never parsed as markup.
  if (Array.isArray(s.previewLines) && s.previewLines.length) {
    const pre = el('div', 'preview');
    pre.append(...previewToNodes(s.previewLines, document));
    card.append(pre);
  }

  const actions = el('div', 'card-actions');
  const open = el('button', 'btn', 'open');
  open.onclick = () => openSheet(s.name);
  actions.append(open);

  const pin = el('button', `btn${store.pinned.has(s.name) ? ' on' : ''}`, store.pinned.has(s.name) ? 'pinned' : 'pin');
  pin.onclick = () => togglePin(s.name);
  actions.append(pin);

  if (s.state === 'waiting_permission' || s.state === 'waiting_question') {
    const yes = el('button', 'btn ok', 'Yes');
    yes.onclick = () => sendQuick(s.name, QUICK_KEYS.yes, 'Yes');
    const no = el('button', 'btn primary', 'No');
    no.onclick = () => sendQuick(s.name, QUICK_KEYS.no, 'No');
    actions.append(yes, no);
  }

  const more = el('button', 'btn btn-more', '⋯');
  more.title = 'Send text, restart, kill';
  more.setAttribute('aria-label', 'More actions');
  more.onclick = (e) => { e.stopPropagation(); toggleMenu(card, s); };
  actions.append(more);

  card.append(actions);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    store.cursor = s.name;
    for (const n of cardNodes.values()) n.classList.remove('cursor');
    card.classList.add('cursor');
  });

  return card;
}

/** The ⋯ menu: the actions that are too destructive for a one-tap button. */
export function toggleMenu(card, s) {
  const existing = card.querySelector('.menu');
  closeMenus();
  if (existing) return;

  const menu = el('div', 'menu');
  const item = (label, cls, fn) => {
    const b = el('button', cls || null, label);
    b.onclick = (e) => { e.stopPropagation(); closeMenus(); fn(); };
    menu.append(b);
  };

  item('Send text…', null, async () => {
    const text = globalThis.prompt(`Send to ${s.name}:`);
    if (text?.trim()) {
      const r = await post(`/api/sessions/${encodeURIComponent(s.name)}/text`, { text: text.trim(), enter: true });
      if (r) toast(`Sent → ${s.name}`);
    }
  });
  item('Open terminal', null, () => openSheet(s.name));
  item(store.pinned.has(s.name) ? 'Unpin' : 'Pin to dock', null, () => togglePin(s.name));
  item('Restart (resume)', null, async () => {
    if (!globalThis.confirm(`Restart ${s.name}? It resumes the same conversation.`)) return;
    const r = await post(`/api/sessions/${encodeURIComponent(s.name)}/restart`);
    if (r) toast(`Restarting ${s.name}…`);
  });
  item('Kill session', 'danger', async () => {
    if (!globalThis.confirm(`Kill ${s.name}? This cannot be undone.`)) return;
    const r = await del(`/api/sessions/${encodeURIComponent(s.name)}`);
    if (r) toast(`Killed ${s.name}`);
  });

  card.append(menu);
}

export function closeMenus() {
  for (const m of document.querySelectorAll('.menu')) m.remove();
}
