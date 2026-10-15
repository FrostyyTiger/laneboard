// renderAll and the UI error box. Moved from public/app.js (fleet F1).
import { $ } from '../core/dom.js';
import { store } from '../core/store.js';
import { renderTopbar } from './shell.js';
import { renderAttention, renderRailBox, renderRateLimits, renderVitals } from './rail.js';
import { renderDock } from './dock.js';
import { renderGrid, renderLanes } from '../views/board.js';
import { renderBox } from '../views/box.js';

// ---------------------------------------------------------------- rendering

/**
 * Each section is isolated: a throw in one must not blank the whole dashboard.
 * A deleted renderGrid once took the entire page down silently, so failures are
 * also surfaced instead of only reaching the console.
 */
/** Rolling render timings, so the 16 ms budget can be checked in the console. */
export const renderStats = { count: 0, total: 0, worst: 0, last: 0 };
globalThis.laneboardRenderStats = () => ({
  ...renderStats,
  average: renderStats.count ? renderStats.total / renderStats.count : 0,
});

export function renderAll(changedNames) {
  const t0 = performance.now();
  performance.mark('laneboard:render:start');
  const sections = [
    ['lanes', renderLanes],
    ['grid', () => renderGrid(changedNames)],
    ['attention', renderAttention],
    ['vitals', renderVitals],
    ['rate limits', renderRateLimits],
    ['dock', renderDock],
    ['box', renderBox],
    ['rail box', renderRailBox],
    ['topbar', renderTopbar],
  ];
  for (const [name, fn] of sections) {
    try {
      fn();
    } catch (err) {
      reportUiError(`${name}: ${err.message}`, err);
    }
  }
  store.boxDirty = false;

  performance.mark('laneboard:render:end');
  try { performance.measure('laneboard:render', 'laneboard:render:start', 'laneboard:render:end'); } catch { /* marks cleared */ }
  const ms = performance.now() - t0;
  renderStats.count++;
  renderStats.total += ms;
  renderStats.last = ms;
  if (ms > renderStats.worst) renderStats.worst = ms;
  // The budget is 16 ms; a delta that misses it drops a frame on the 49".
  if (ms > 16) console.warn(`[laneboard] render took ${ms.toFixed(1)}ms (budget 16ms)`);
  reportRenderStats();
}

/**
 * Send the render timings back once a minute.
 * The budget can only be measured in a real browser — a headless harness has a
 * far cheaper DOM and would flatter the number — and asking a human to read
 * numbers out of a console is how measurements get skipped. So the page
 * reports its own, and the handoff can quote something real.
 */
let statsSentAt = 0;
export function reportRenderStats() {
  if (renderStats.count < 5) return;
  const now = Date.now();
  if (now - statsSentAt < 60000) return;
  statsSentAt = now;
  const body = {
    count: renderStats.count,
    averageMs: Math.round((renderStats.total / renderStats.count) * 100) / 100,
    worstMs: Math.round(renderStats.worst * 100) / 100,
    lastMs: Math.round(renderStats.last * 100) / 100,
    sessions: store.sessions.size,
    terminals: [...store.pinned].filter((n) => store.sessions.has(n)).length + (store.openSession ? 1 : 0),
    viewport: `${innerWidth}x${innerHeight}`,
    dpr: globalThis.devicePixelRatio || 1,
    ua: navigator.userAgent?.slice(0, 120) || '',
  };
  fetch('/api/client-metrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-laneboard': '1' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => { /* metrics must never disturb the page */ });
}

const reportedErrors = new Set();

/** Show a UI failure on the page — a silent one cost a whole stage. */
export function reportUiError(what, err) {
  console.error('[laneboard]', what, err);
  if (reportedErrors.has(what)) return;
  reportedErrors.add(what);
  const box = $('ui-error');
  if (!box) return;
  box.hidden = false;
  const line = document.createElement('div');
  line.textContent = what;
  box.append(line);
}
