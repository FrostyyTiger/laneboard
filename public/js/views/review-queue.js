// The Review group of the Inbox (fleet plan §10 2.12, task R13).
//
// renderReviewQueue(container, items, ctx) draws the rows of the pure queue
// (core/review-queue.js buildReviewQueue: ready lanes, longest wait first);
// mountReviewQueue(container, ctx) builds that queue from the fleet store and
// keeps it current. The Inbox (§8 C13) loads this module with a dynamic
// import() and calls one of the two for its REVIEW group.
//
// One row per item:
//   wait timer · builder plate · lane (repo / branch) · reason icons
//   PR chip + checks ✓p ✗f …n · diff stat · package chips · cost
//   actions: Diff (#/diff?sel=<fkey>), Inspect (sel=<fkey>, the inspector
//   with its PEEK tab), Pull (copyable commands, nothing runs), Archive
//   (merged PRs only, and only when the caller passes ctx.archive).
//
// Everything in an item is builder-supplied, untrusted text: it goes in
// through textContent, title and setAttribute only, never as markup. Pure at
// import time: no `document` until a render runs.
import { el } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { deriveCode } from '../core/keys.js';
import { money } from '../core/format.js';
import { buildReviewQueue, storeLookups, formatWait } from '../core/review-queue.js';
import { pullCommands } from '../core/review-format.js';
import { plate } from '../ui/components.js';

const DASH = '—';
/** An open wait older than this is drawn as overdue (matches review.overdueHours: 4). */
export const OVERDUE_MS = 4 * 3600 * 1000;
/** At most this many package chips, then `+n`. */
export const PKG_MAX = 4;

/** Reason id -> icon and words. */
export const REASON_META = Object.freeze({
  'done-marker': Object.freeze({ icon: 's-done', title: 'the agent printed DONE' }),
  'pr-green': Object.freeze({ icon: 'ci-pass', title: 'PR checks green' }),
  'stop-diff': Object.freeze({ icon: 'review', title: 'stopped with a diff' }),
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');

// ---------------------------------------------------------------- pure models

/** PR record -> {state, icon, text, title} or null. */
export function prChip(pr) {
  if (!pr || typeof pr !== 'object') return null;
  const st = str(pr.state).toUpperCase();
  const state = st === 'MERGED' ? 'merged' : st === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open';
  const number = Number.isInteger(pr.number) && pr.number > 0 ? pr.number : null;
  return {
    state,
    icon: state === 'merged' ? 'pr-merged' : state === 'draft' ? 'pr-draft' : 'pr',
    text: number != null ? `#${number}` : 'PR',
    title: `${state} PR${number != null ? ` #${number}` : ''}`,
  };
}

/** Checks counts -> [{s, g}] in the order pass, fail, pending ("✓3 ✗1 …2"); zero parts left out. */
export function checksParts(checks) {
  if (!checks || typeof checks !== 'object') return [];
  const out = [];
  const n = (v) => (isNum(v) && v > 0 ? Math.floor(v) : 0);
  if (n(checks.passed)) out.push({ s: 'pass', g: `✓${n(checks.passed)}` });
  if (n(checks.failed)) out.push({ s: 'fail', g: `✗${n(checks.failed)}` });
  if (n(checks.pending)) out.push({ s: 'run', g: `…${n(checks.pending)}` });
  return out;
}

/** "8 passed, 1 failed, 2 pending" or "no checks". */
export function checksTitle(checks) {
  if (!checks || typeof checks !== 'object') return 'no checks';
  const words = [['passed', 'passed'], ['failed', 'failed'], ['pending', 'pending']];
  const parts = words.filter(([k]) => isNum(checks[k]) && checks[k] > 0).map(([k, w]) => `${Math.floor(checks[k])} ${w}`);
  return parts.length ? `checks: ${parts.join(', ')}` : 'no checks';
}

/** {files, add, del} -> "+12 −3 · 4 files", or DASH. */
export function diffStatText(d) {
  if (!d || typeof d !== 'object') return DASH;
  const files = isNum(d.files) ? d.files : 0;
  return `+${isNum(d.add) ? d.add : 0} −${isNum(d.del) ? d.del : 0} · ${files} ${files === 1 ? 'file' : 'files'}`;
}

/** "owner/name" from a GitHub PR URL, or null. Validation is pullCommands' job too. */
export function ciRepoOf(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/pull\/\d{1,9}$/.exec(str(url));
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The copyable pull commands for one item (none when any part fails validation). */
export function pullFor(item) {
  if (!item) return [];
  const prNum = Number.isInteger(item.pr?.number) && item.pr.number > 0 ? item.pr.number : null;
  const ciRepo = prNum != null ? ciRepoOf(item.pr?.url) : null;
  return pullCommands({
    repo: item.repo,
    branch: item.branch,
    laneId: item.lane,
    pr: ciRepo ? prNum : null,
    ciRepo,
  });
}

/** The builder's short code: the store's own `.code`, else derived from the id. */
export function builderCodeOf(store, id) {
  const b = store?.builders instanceof Map ? store.builders.get(id) : null;
  return (b && typeof b.code === 'string' && b.code) || deriveCode(id ?? '');
}

/**
 * The wait to show at `now` for an item built at `builtAt`. An open wait
 * (no review sent this episode: waitMs equals builtAt - since) keeps ticking
 * from `since`; a closed one stays at its value.
 */
export function waitAt(item, builtAt, now) {
  if (!item || !isNum(item.waitMs)) return 0;
  if (!isNum(item.since) || !isNum(builtAt) || !isNum(now)) return item.waitMs;
  const open = Math.abs(Math.max(0, builtAt - item.since) - item.waitMs) < 1;
  return open ? Math.max(0, now - item.since) : item.waitMs;
}

/**
 * The actions of a row: [{id, label, icon, run}]. `run` only navigates (or
 * calls ctx.archive); nothing is sent to a builder from here.
 */
export function rowActions(item, ctx = {}) {
  const nav = typeof ctx.navigate === 'function' ? ctx.navigate : null;
  const out = [];
  if (nav) {
    out.push({ id: 'diff', label: 'Diff', icon: 'split', title: 'Open the diff review', run: () => nav({ view: 'diff', sel: item.fkey }) });
    out.push({ id: 'inspect', label: 'Peek', icon: 'inspector', title: 'Open the lane in the inspector', run: () => nav({ sel: item.fkey }) });
  }
  if (pullFor(item).length) out.push({ id: 'pull', label: 'Pull', icon: 'terminal', title: 'Commands to pull this branch locally', run: null });
  if (item.pr?.state === 'MERGED' && typeof ctx.archive === 'function') {
    out.push({ id: 'archive', label: 'Archive', icon: 'retire', title: 'Retire the merged lane', run: () => ctx.archive(item) });
  }
  return out;
}

// ---------------------------------------------------------------- DOM

function field(cls, text, title) {
  const n = el('span', `rq-f ${cls}`, text);
  if (title) n.title = title;
  return n;
}

function waitNode(ms, overdueMs) {
  const n = el('span', 'rq-f rq-wait');
  n.append(icon('clock', { size: 's' }), el('span', 'rq-wait-t', formatWait(ms)));
  const over = ms >= overdueMs;
  if (over) n.dataset.p = '2';
  n.title = over ? `waiting for review ${formatWait(ms)} (overdue)` : `waiting for review ${formatWait(ms)}`;
  return n;
}

function prNode(item) {
  const n = el('span', 'rq-f rq-pr');
  const chip = prChip(item.pr);
  if (chip) {
    n.dataset.state = chip.state;
    n.append(icon(chip.icon, { size: 's' }), el('span', 'rq-pr-n', chip.text));
    n.title = chip.title;
  } else {
    n.append(el('span', 'rq-pr-n', DASH));
    n.title = 'no PR';
  }
  const ck = el('span', 'rq-checks');
  for (const c of checksParts(item.checks)) ck.append(el('span', `ck ck-${c.s}`, c.g));
  ck.setAttribute('role', 'img');
  const label = checksTitle(item.checks);
  ck.setAttribute('aria-label', label);
  ck.title = label;
  n.append(ck);
  return n;
}

function packagesNode(list) {
  const n = el('span', 'rq-f rq-pkgs');
  const pk = Array.isArray(list) ? list : [];
  for (const p of pk.slice(0, PKG_MAX)) n.append(field('rq-pkg', p, `package ${p}`));
  if (pk.length > PKG_MAX) n.append(field('rq-pkg rq-more', `+${pk.length - PKG_MAX}`, pk.slice(PKG_MAX).join(', ')));
  if (!pk.length) n.textContent = DASH;
  n.title = pk.length ? `packages: ${pk.join(', ')}` : 'no packages';
  return n;
}

function reasonsNode(reasons) {
  const n = el('span', 'rq-f rq-reasons');
  for (const r of Array.isArray(reasons) ? reasons : []) {
    const meta = REASON_META[r];
    if (!meta) continue;
    const i = el('span', `rq-reason reason-${r}`);
    i.title = meta.title;
    i.append(icon(meta.icon, { size: 's', label: meta.title }));
    n.append(i);
  }
  return n;
}

function pullNode(item) {
  const box = el('div', 'rq-pull');
  box.hidden = true;
  for (const c of pullFor(item)) {
    const line = el('div', 'rq-pull-l');
    line.append(el('span', 'rq-pull-label', c.label), el('code', 'rq-pull-cmd', c.cmd));
    const copy = el('button', 'btn btn-s rq-copy', 'Copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', `Copy: ${c.label}`);
    copy.addEventListener('click', () => {
      try {
        const cb = globalThis.navigator?.clipboard;
        if (cb && typeof cb.writeText === 'function') cb.writeText(c.cmd).catch(() => {});
      } catch { /* clipboard is a convenience */ }
    });
    line.append(copy);
    box.append(line);
  }
  return box;
}

/** One `.rq-row` <li> for an item. Returns {item, row, waitText, setWait(ms)}. */
export function reviewRow(item, ctx = {}) {
  const overdueMs = isNum(ctx.overdueMs) ? ctx.overdueMs : OVERDUE_MS;
  const row = el('li', 'rq-row');
  row.dataset.fkey = item.fkey;
  if (isNum(item.hue)) row.style.setProperty('--lane-hue', String(item.hue));

  const main = el('div', 'rq-line');
  let wait = waitNode(item.waitMs, overdueMs);
  const code = builderCodeOf(ctx.store, item.builder);
  const codeEl = el('span', 'rq-f rq-code');
  codeEl.append(plate(code, { title: item.builder }));
  const where = [item.repo, item.branch].filter((v) => typeof v === 'string' && v).join(' / ');
  const lane = field('rq-lane', item.lane, where ? `${item.fkey} · ${where}` : item.fkey);
  main.append(wait, codeEl, lane, field('rq-branch', item.branch ?? DASH, item.branch ?? 'no branch'), reasonsNode(item.reasons));

  const facts = el('div', 'rq-line rq-facts');
  facts.append(
    prNode(item),
    field('rq-diff', diffStatText(item.diffStat), 'diff against the base'),
    packagesNode(item.packages),
    field('rq-cost', isNum(item.costUsd) ? money(item.costUsd) : DASH, 'API-equivalent cost of the lane'),
  );

  const acts = el('div', 'rq-acts');
  let pull = null;
  for (const a of rowActions(item, ctx)) {
    const b = el('button', `btn btn-s rq-act act-${a.id}`);
    b.type = 'button';
    b.dataset.act = a.id;
    b.append(icon(a.icon, { size: 's' }), el('span', 'rq-act-t', a.label));
    b.title = a.title;
    b.setAttribute('aria-label', `${a.label} ${item.lane}`);
    if (a.id === 'pull') {
      pull = pullNode(item);
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', () => {
        pull.hidden = !pull.hidden;
        b.setAttribute('aria-expanded', pull.hidden ? 'false' : 'true');
      });
    } else {
      b.addEventListener('click', () => a.run());
    }
    acts.append(b);
  }
  row.append(main, facts, acts);
  if (pull) row.append(pull);

  return {
    item,
    row,
    setWait(ms) {
      const next = waitNode(ms, overdueMs);
      wait.replaceWith(next);
      wait = next;
    },
    get waitText() { return wait.textContent; },
  };
}

/**
 * Render `items` (buildReviewQueue output) into `container`, replacing what
 * was there. ctx: {store, navigate, archive?, now?, overdueMs?}. Returns
 * {list, rows, tick(now)}: tick re-reads the clock for the open waits.
 */
export function renderReviewQueue(container, items, ctx = {}) {
  const list = Array.isArray(items) ? items.filter((i) => i && typeof i.fkey === 'string') : [];
  const builtAt = isNum(ctx.now) ? ctx.now : Date.now();
  const root = el('ol', 'rq-list');
  root.setAttribute('aria-label', `Review queue, ${list.length} ${list.length === 1 ? 'lane' : 'lanes'}`);
  const rows = list.map((item) => reviewRow(item, ctx));
  for (const r of rows) root.append(r.row);
  const out = list.length ? root : el('p', 'empty rq-empty', 'No lanes are waiting for review.');
  if (container) {
    if (typeof container.replaceChildren === 'function') container.replaceChildren(out);
    else { container.textContent = ''; container.append(out); }
  }
  return {
    list: out,
    rows,
    tick(now = Date.now()) {
      for (const r of rows) r.setWait(waitAt(r.item, builtAt, now));
    },
  };
}

/** The queue for a store (§1 client store: lanes, builders, sessions). */
export function queueFor(store, now = Date.now()) {
  const lanes = Array.isArray(store?.lanes) ? store.lanes
    : store?.lanes instanceof Map ? [...store.lanes.values()] : [];
  return buildReviewQueue(lanes, now, storeLookups(store));
}

/**
 * Mount the live group: render from ctx.store now, and again on update().
 * tick(now) refreshes the wait timers without a rebuild (the Inbox calls it
 * from its 1 Hz clock). Returns {update(nextCtx?), tick(now), unmount(), count}.
 */
export function mountReviewQueue(container, ctx = {}) {
  let cur = { ...ctx };
  let view = null;
  let n = 0;
  const paint = () => {
    const now = isNum(cur.now) ? cur.now : Date.now();
    const items = queueFor(cur.store, now);
    n = items.length;
    view = renderReviewQueue(container, items, { ...cur, now });
  };
  paint();
  return {
    update(next) {
      if (next && typeof next === 'object') cur = { ...cur, ...next };
      paint();
    },
    tick(now = Date.now()) { view?.tick(now); },
    unmount() {
      if (container) container.textContent = '';
      view = null;
    },
    get count() { return n; },
  };
}
