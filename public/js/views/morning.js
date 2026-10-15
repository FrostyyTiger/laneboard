// The Morning view. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';
import { STATE_LABEL, ago, compactCount, money, resetsIn } from '../core/format.js';
import { localBuilderId, store } from '../core/store.js';
import { BUILDER_ID_RX, fkey } from '../core/keys.js';
import { act } from '../core/actions.js';
import { setView } from '../core/router.js';
import { block, gauge, laneStripe, prChip } from '../ui/widgets.js';
import { toast } from '../ui/shell.js';
import { openSheet } from '../ui/sheet.js';

// ---------------------------------------------------------------- morning
//
// The view is fetched rather than derived from the socket: it needs database
// history (cost snapshots, markers over a window) that the live snapshot does
// not carry, and it is read once in the morning rather than watched all day.

/**
 * The fleet key of something the Morning payload names by local id. The
 * payload comes from this page's own builder (GET /api/morning) unless an
 * entry carries its builder.
 */
export function morningKey(entry, local) {
  if (local === undefined || local === null || local === '') return null;
  const b = typeof entry?.builder === 'string' && BUILDER_ID_RX.test(entry.builder) ? entry.builder : localBuilderId(store);
  try { return fkey(b, String(local)); } catch { return null; }
}

export const morning = { window: 'tonight', data: null, loading: false, at: 0 };

export async function loadMorning(force = false) {
  if (morning.loading) return;
  if (!force && morning.data && Date.now() - morning.at < 20000) return;
  morning.loading = true;
  try {
    const r = await fetch(`/api/morning?window=${encodeURIComponent(morning.window)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    morning.data = await r.json();
    morning.at = Date.now();
  } catch (err) {
    morning.data = { error: err.message };
  } finally {
    morning.loading = false;
    renderMorning();
  }
}

export function renderMorning() {
  const box = $('morning-body');
  if (!box) return;
  for (const btn of $('morning-window').children || []) {
    btn.classList.toggle('on', btn.dataset.window === morning.window);
  }
  box.textContent = '';
  const d = morning.data;
  if (!d) { box.append(el('p', 'empty', 'Loading…')); return; }
  if (d.error) { box.append(el('p', 'empty', `Could not load: ${d.error}`)); return; }
  $('morning-since').textContent = `since ${new Date(d.since).toLocaleString('en-GB', { hour12: false })}`;

  // --- needs you ---------------------------------------------------------
  const needs = block('Needs you', d.needsYou.length);
  if (!d.needsYou.length) needs.append(el('p', 'empty', 'Nothing is waiting.'));
  for (const n of d.needsYou) {
    const row = el('div', `mrow need-${n.kind}`);
    row.append(laneStripe(n.hue));
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    top.append(el('span', 'mrow-kind', n.kind));
    top.append(el('span', 'mrow-name', n.name || '—'));
    if (n.lane) top.append(el('span', 'mrow-lane', n.lane));
    top.append(el('span', 'mrow-age', ago(n.at)));
    main.append(top);
    // Full text, wrapped, never truncated: this is the one place the whole
    // sentence a lane wrote is worth reading.
    if (n.text) main.append(el('div', 'mrow-text', n.text));
    row.append(main);
    const acts = el('div', 'mrow-acts');
    const k = n.name ? morningKey(n, n.name) : null;
    if (k && store.sessions.has(k)) {
      const open = el('button', 'btn', 'Open');
      open.onclick = () => { setView('board'); openSheet(k); };
      acts.append(open);
    }
    if (n.source === 'marker') {
      const dis = el('button', 'btn', 'Dismiss');
      dis.onclick = async () => {
        dis.disabled = true;
        const r = await act(morningKey(n, n.markerId) ?? String(n.markerId), 'dismiss-marker');
        if (r?.ok === true) { toast('Dismissed'); loadMorning(true); } else {
          toast(r?.ok === 'unknown' ? 'Sent, outcome unknown' : `Failed: ${r?.error ?? 'no answer'}`);
          dis.disabled = false;
        }
      };
      acts.append(dis);
    }
    row.append(acts);
    needs.append(row);
  }
  box.append(needs);

  // --- finished ----------------------------------------------------------
  const fin = block('Finished', d.finished.length);
  if (!d.finished.length) fin.append(el('p', 'empty', 'No lane moved in this window.'));
  for (const f of d.finished) {
    const row = el('div', 'mrow');
    row.append(laneStripe(f.hue));
    const main = el('div', 'mrow-main');
    const top = el('div', 'mrow-top');
    top.append(el('span', 'mrow-name', f.lane));
    if (f.progress?.n != null) top.append(el('span', 'mrow-stage', `${f.progress.n} of ${f.progress.m}`));
    if (f.branch) top.append(el('span', 'mrow-branch', `⌥${f.branch}`));
    if (!f.isMain && f.merged === true) top.append(el('span', 'lane-merged', 'merged'));
    if (!f.isMain && f.merged === false) top.append(el('span', 'lane-unmerged', 'unmerged'));
    if (f.pr) top.append(prChip(f.pr));
    if (f.lastCommitAt) top.append(el('span', 'mrow-age', `commit ${ago(f.lastCommitAt)}`));
    main.append(top);
    const states = f.sessions.map((s) => `${s.name} · ${STATE_LABEL[s.state] || s.state}`).join('   ');
    main.append(el('div', 'mrow-sub', states || 'no session running'));
    for (const m of f.doneMarkers) main.append(el('div', 'mrow-text mrow-done', m.text));
    row.append(main);
    fin.append(row);
  }
  box.append(fin);

  // --- what it cost ------------------------------------------------------
  const cost = block('What it cost', null);
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  for (const [h, cls] of [['lane', ''], ['spend', 'num'], ['tokens', 'num'], ['sessions', '']]) {
    hr.append(el('th', cls, h));
  }
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const l of d.cost.lanes) {
    if (!(l.usd > 0.0005)) continue;
    const tr = el('tr');
    const td = el('td');
    td.append(laneStripe(l.hue));
    td.append(el('span', null, l.lane || '(no lane)'));
    tr.append(td);
    tr.append(el('td', 'num', money(l.usd)));
    tr.append(el('td', 'num', compactCount(l.tokens)));
    tr.append(el('td', 'dim', l.sessions.slice(0, 4).join(', ')));
    tbody.append(tr);
  }
  table.append(tbody);
  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, 'total'));
  fr.append(el('td', 'num', money(d.cost.totalUsd)));
  fr.append(el('td', 'num', compactCount(d.cost.totalTokens)));
  fr.append(el('td', 'dim', d.cost.label));
  tfoot.append(fr);
  table.append(tfoot);
  cost.append(table);

  const rl = d.rateLimits;
  if (rl) {
    const g = el('div', 'gauges morning-gauges');
    if (rl.fiveHour) g.append(gauge(`5 h window · ${resetsIn(rl.fiveHour.resetsAt)}`, rl.fiveHour.usedPct));
    if (rl.sevenDay) g.append(gauge(`7 d window · ${resetsIn(rl.sevenDay.resetsAt)}`, rl.sevenDay.usedPct));
    cost.append(g);
  }
  box.append(cost);
}
