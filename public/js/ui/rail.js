// The rail: attention, vitals, rate limits, the 49" box blocks. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';
import { ago, resetsIn } from '../core/format.js';
import { store } from '../core/store.js';
import { compactGauge, gauge, stateDot } from './widgets.js';
import { focusSession } from '../views/board.js';
import { boxBlocks } from '../views/box.js';

/** On the 49" the Box is rail blocks, not a tab (the CSS hides the tab there). */
export function renderRailBox() {
  const host = $('rail-box');
  if (!host) return;
  const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 2000px)').matches;
  host.hidden = !wide;
  if (!wide || !store.boxDirty) return;
  host.textContent = '';
  for (const b of boxBlocks()) host.append(b);
}

export function renderAttention() {
  const list = $('attention-list');
  const strip = $('attention-strip');
  list.textContent = '';
  strip.textContent = '';
  const items = store.attention.slice(0, 12);
  $('attention-count').textContent = String(store.attention.length);
  $('attention-empty').hidden = items.length > 0;

  items.forEach((a, i) => {
    const li = document.createElement('li');
    const b = el('button', `attention-item s-${a.danger ? 'danger' : a.state}`);
    if (a.danger) b.title = a.danger;
    b.append(el('span', 'idx', String(i + 1)));
    b.append(stateDot(a.state, a.since));
    b.append(el('span', 'nm', a.name));
    b.append(el('span', 'ago', ago(a.since)));
    b.dataset.key = a.key;
    b.onclick = () => focusSession(a.key);
    li.append(b);
    list.append(li);

    const chip = el('button', `chip s-${a.danger ? 'danger' : a.state}`);
    chip.append(stateDot(a.state, a.since));
    chip.append(el('span', 'nm', a.name));
    chip.append(el('span', 'ago', ago(a.since)));
    chip.dataset.key = a.key;
    chip.onclick = () => focusSession(a.key);
    strip.append(chip);
  });
}

export function renderVitals() {
  const v = store.vitals;
  const box = $('vitals');
  box.textContent = '';
  if (!v) return;
  const add = (k, val, sub) => {
    const d = el('div', 'vital');
    d.append(el('div', 'k', k));
    const vv = el('div', 'v', val);
    if (sub) { const s = el('small', null, ` ${sub}`); vv.append(s); }
    d.append(vv);
    box.append(d);
  };
  add('cpu', v.cpuPct == null ? '—' : `${v.cpuPct}%`, v.load ? `load ${v.load[0].toFixed(2)}` : '');
  if (v.mem) add('mem', `${(v.mem.usedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.totalMb / 1024).toFixed(0)}G`);
  if (v.mem) add('swap', `${(v.mem.swapUsedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.swapTotalMb / 1024).toFixed(0)}G`);
  if (v.disk) add('disk', `${(v.disk.availMb / 1024).toFixed(0)}G`, 'free');
  add('claude', `${(v.claudeRssMb / 1024).toFixed(1)}G`, `${v.sessionCount} sessions`);
  if (v.gpu) add('gpu', `${v.gpu.utilPct}%`, `${(v.gpu.memUsedMb / 1024).toFixed(1)}G`);
  add('laneboard', `${v.laneboardRssMb}MB`, '');
}

/** Rate limits come from whichever session's statusline fired most recently. */
export function freshestRateLimits() {
  let best = null;
  for (const s of store.sessions.values()) {
    if (!s.rateLimits?.fiveHour) continue;
    if (!best || (s.claude?.startedAt ?? 0) > (best.claude?.startedAt ?? 0)) best = s;
  }
  return best?.rateLimits ?? null;
}

export function renderRateLimits() {
  const box = $('rate-limits');
  const top = $('topbar-gauges');
  box.textContent = '';
  top.textContent = '';
  const rl = freshestRateLimits();
  if (!rl) { box.append(el('p', 'empty', 'No statusline data yet.')); return; }
  for (const [key, label] of [['fiveHour', '5 h window'], ['sevenDay', '7 d window']]) {
    const g = rl[key];
    if (!g) continue;
    const short = key === 'fiveHour' ? '5h' : '7d';
    box.append(gauge(`${label} · ${resetsIn(g.resetsAt)}`, g.usedPct));
    // Both forms are always in the DOM; CSS picks one per breakpoint.
    top.append(gauge(short, g.usedPct, resetsIn(g.resetsAt)));
    top.append(compactGauge(short, g.usedPct, resetsIn(g.resetsAt)));
  }
}
