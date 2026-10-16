// The Packages view (fleet §6 2.12, P12): a dense table of every package of
// every repo, grouped by repo, glyph columns, filter pkChips (router `s`/`q`),
// and an inspector for a row (jobs, lanes, PRs, conflicts, plans) or a repo
// (hotspots, merge-order hint, stale branches).
//
// DOM only; the filters, sort, glyphs and inspector content come from the pure
// views/packages-model.js. Data: store.packages (the `{type:'packages'}` ws
// message, both modes), and one read-only GET /api/packages at mount until
// the first message arrives. Display-only: nothing here sends an action; the
// stale-branch commands are shown as text to copy, never run.
//
// Every builder-derived string (repo, package, branch, file, job and lane
// names, reasons) goes in through textContent, title or dataset: no markup.
import { el } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { hueFromId } from '../core/format.js';
import { deriveCode, BUILDER_ID_RX } from '../core/keys.js';
import { lamp, panel, setPanel, rowMove } from '../ui/components.js';
import {
  pkChips, pkConflictsCell, pkCounts, pkGroups, pkInspectorModel, pkJobCells, pkLampGlyph, pkLanesCell, pkLastChangeCell,
  pkLoad, pkMainGlyph, pkNormalize, pkPlansCell, pkPrsCell, pkRepoInspector, pkRowKey, pkToggleChip,
} from './packages-model.js';

/** The scope shown in the panel title: the builder filter, or ALL. */
export function packagesScope(route) {
  const b = route?.b;
  return typeof b === 'string' && b && b !== 'all' ? b : 'all';
}

export const COLUMNS = Object.freeze([
  { key: 'lamp', label: '', title: 'Status lamp' },
  { key: 'pkg', label: 'PACKAGE', title: 'Package' },
  { key: 'main', label: 'MAIN', title: 'CI on main: status, sha, age, +untested commits' },
  { key: 'jobs', label: 'JOBS', title: 'Mapped main jobs: one cell each; ∅ not run, hatched partial' },
  { key: 'lanes', label: 'LN', title: 'Lanes touching the package', num: true },
  { key: 'prs', label: 'PR', title: 'Open PRs (total/red)', num: true },
  { key: 'conf', label: 'CONF', title: 'Conflicts: ▲ textual, ◆ overlap' },
  { key: 'last', label: 'LAST', title: 'Last change on main', num: true },
  { key: 'c7', label: '7D', title: 'Commits in the last 7 days', num: true },
  { key: 'plans', label: 'PLANS', title: 'Plans open/partial/done', num: true },
]);

let st = null;

const routeOf = (ctx) => (ctx && ctx.route && typeof ctx.route === 'object' ? ctx.route : null);

function pkData() {
  return pkNormalize(st?.store?.packages) ?? st?.fetched ?? null;
}

function pkCode(id) {
  const b = st?.store?.builders?.get?.(id);
  if (b && typeof b.code === 'string' && b.code) return b.code;
  return BUILDER_ID_RX.test(id) ? deriveCode(id) : '';
}

function pkHue(fkey) {
  const lanes = Array.isArray(st?.store?.lanes) ? st.store.lanes : [];
  const i = fkey.indexOf('/');
  const name = i > 0 ? fkey.slice(i + 1) : fkey;
  const lane = lanes.find((l) => l && (l.key === fkey || (l.builder && `${l.builder}/${l.id}` === fkey)));
  return Number.isFinite(lane?.hue) ? lane.hue : hueFromId(name);
}

function pkLabelled(node, label) {
  node.title = label;
  node.setAttribute('aria-label', label);
  return node;
}

function pkGlyph(cls, text, label) {
  return pkLabelled(el('span', cls, text), label);
}

// ---------------------------------------------------------------- chips

function pkRenderChips(data) {
  const box = st.chips;
  box.textContent = '';
  if (!data) return;
  for (const c of pkChips(data, st.route)) {
    const b = el('button', `chip pk-chip pk-chip--${c.kind}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', c.on ? 'true' : 'false');
    b.dataset.chip = c.id;
    b.append(el('span', 'chip-t', c.label), el('span', 'pk-chip-n', String(c.n)));
    pkLabelled(b, `${c.title} (${c.n})`);
    b.addEventListener('click', () => {
      if (typeof st?.navigate === 'function') st.navigate(pkToggleChip(st.route, c.id));
    });
    box.append(b);
  }
}

// ---------------------------------------------------------------- table

function pkCell(cls) {
  return el('td', cls);
}

function pkRowNode(row, now) {
  const tr = el('tr', 'pk-row');
  const key = pkRowKey(row);
  tr.dataset.key = key;
  const on = st.sel?.kind === 'row' && st.sel.key === key;
  tr.tabIndex = on || (!st.sel && !st.rowNodes.size) ? 0 : -1;
  if (on) tr.setAttribute('aria-selected', 'true');
  st.rowNodes.set(key, tr);

  const lg = pkLampGlyph(row);
  const tdL = pkCell('pk-lamp');
  tdL.append(lamp(lg.p, { label: lg.label }));
  tr.append(tdL);

  const tdP = pkCell('pk-name');
  tdP.textContent = String(row.package ?? '');
  tdP.title = `${row.repo ?? ''} · ${row.package ?? ''}`;
  tr.append(tdP);

  const mg = pkMainGlyph(row.main, now);
  const tdM = pkCell(`pk-main pk-main--${mg.status}`);
  tdM.append(pkGlyph('pk-g', mg.text || '—', mg.label));
  tr.append(tdM);

  const tdJ = pkCell('pk-jobs');
  const strip = el('span', 'pk-strip');
  const cells = pkJobCells(row.main);
  for (const j of cells) strip.append(pkGlyph(`pk-job pk-job--${j.cls}`, j.glyph, j.label));
  pkLabelled(strip, cells.length ? `${cells.length} mapped jobs` : 'no mapped jobs');
  tdJ.append(strip);
  tr.append(tdJ);

  const lc = pkLanesCell(row);
  const tdLn = pkCell('pk-lanes num');
  if (lc.n) {
    const wrap = pkLabelled(el('span', 'pk-lanes-g'), lc.label);
    wrap.append(el('span', 'pk-n', String(lc.n)));
    for (const l of lc.lanes.slice(0, 6)) {
      const dot = el('span', 'row-stripe pk-dot');
      dot.style.setProperty('--lane-hue', String(pkHue(l.fkey)));
      wrap.append(dot);
    }
    tdLn.append(wrap);
  } else tdLn.append(pkGlyph('pk-dim', '·', lc.label));
  tr.append(tdLn);

  const pc = pkPrsCell(row);
  const tdPr = pkCell(`pk-prs num${pc.red ? ' pk-red' : ''}`);
  tdPr.append(pkGlyph('pk-g', pc.text || '·', pc.label));
  tr.append(tdPr);

  const cc = pkConflictsCell(row);
  const tdC = pkCell(`pk-conf${cc.p ? ` pk-conf--p${cc.p}` : ''}`);
  tdC.append(pkGlyph('pk-g', cc.text || '·', cc.label));
  tr.append(tdC);

  const lch = pkLastChangeCell(row, now);
  const tdLc = pkCell('pk-last num');
  tdLc.append(pkGlyph('pk-g', lch.text || '·', lch.label));
  tr.append(tdLc);

  const td7 = pkCell('pk-c7 num');
  td7.textContent = row.commits7d ? String(row.commits7d) : '·';
  td7.title = `${Number(row.commits7d) || 0} commits in 7 days`;
  tr.append(td7);

  const pl = pkPlansCell(row);
  const tdPl = pkCell('pk-plans num');
  tdPl.append(pkGlyph('pk-g', pl.text || '·', pl.label));
  tr.append(tdPl);

  tr.addEventListener('click', () => pkSelect({ kind: 'row', key }));
  tr.addEventListener('keydown', (e) => pkRowKeydown(e, key));
  return tr;
}

function pkRepoRow(g) {
  const h = g.header;
  const tr = el('tr', 'pk-repo');
  const th = el('th', 'pk-repo-h');
  th.colSpan = COLUMNS.length;
  th.scope = 'rowgroup';
  const line = el('div', 'pk-repo-line');
  line.append(lamp(h.ci.p, { label: h.ci.label }));
  line.append(el('span', 'pk-repo-name', h.name));
  if (h.slug && h.slug !== h.name) line.append(el('span', 'pk-repo-slug', h.slug));
  if (h.builders.length) line.append(pkGlyph('pk-repo-via', h.builders.map(pkCode).filter(Boolean).join(' '), `collected by ${h.builders.join(', ')}`));
  if (h.stale) line.append(pkGlyph('pk-repo-stale', `◆ ${h.stale} stale`, `${h.stale} stale branches`));
  const p = h.plans;
  if (p.open || p.partial || p.done) {
    line.append(pkGlyph('pk-repo-plans', `${p.open}/${p.partial}/${p.done}`, `plans: ${p.open} open, ${p.partial} partial, ${p.done} done${p.deferred ? `, ${p.deferred} deferred` : ''}`));
  }
  if (h.warnings.length) line.append(pkGlyph('pk-repo-warn', `▲ ${h.warnings.length}`, h.warnings.join('; ')));
  line.append(el('span', 'pk-repo-n', `[${g.rows.length}]`));
  const btn = el('button', 'btn pk-order');
  btn.type = 'button';
  btn.append(icon('review', { size: 's' }), el('span', null, h.order ? `ORDER ${h.order}` : 'REPO'));
  pkLabelled(btn, `Merge order, hotspots and stale branches for ${h.name}`);
  btn.addEventListener('click', (e) => {
    e.stopPropagation?.();
    pkSelect({ kind: 'repo', key: h.name });
  });
  line.append(btn);
  th.append(line);
  tr.append(th);
  return tr;
}

function pkRenderTable(data) {
  const wrap = st.tableWrap;
  wrap.textContent = '';
  st.order = [];
  st.rowNodes = new Map();
  if (!data) {
    wrap.append(el('p', 'empty', st.loading ? 'Loading packages…' : 'No packages data yet: the collector has not reported.'));
    return;
  }
  const now = Date.now();
  const gs = pkGroups(data, st.route);
  if (!gs.length) {
    wrap.append(el('p', 'empty', data.rows.length ? 'No package matches these filters.' : 'No repos configured or detected.'));
    return;
  }
  const table = el('table', 'dt pk-table');
  table.setAttribute('aria-label', 'Packages by repo');
  const thead = el('thead');
  const hr = el('tr');
  for (const c of COLUMNS) {
    const th = el('th', c.num ? 'num' : null, c.label);
    th.scope = 'col';
    pkLabelled(th, c.title);
    hr.append(th);
  }
  thead.append(hr);
  table.append(thead);
  for (const g of gs) {
    const tb = el('tbody', 'pk-group');
    tb.append(pkRepoRow(g));
    for (const row of g.rows) {
      tb.append(pkRowNode(row, now));
      st.order.push(pkRowKey(row));
    }
    table.append(tb);
  }
  wrap.append(table);
}

// ---------------------------------------------------------------- inspector

function pkSection(title, n) {
  const s = el('section', 'pk-sec');
  const h = el('h3', 'pk-sec-t', title);
  if (Number.isFinite(n)) h.append(el('span', 'pk-sec-n', ` [${n}]`));
  s.append(h);
  return s;
}

function pkLine(cls, ...parts) {
  const d = el('div', `pk-line${cls ? ` ${cls}` : ''}`);
  for (const p of parts) if (p != null) d.append(typeof p === 'string' ? el('span', null, p) : p);
  return d;
}

function pkInspHead(lampP, lampLabel, title, sub) {
  const head = el('div', 'pk-insp-h');
  head.append(lamp(lampP, { label: lampLabel }));
  const t = el('div', 'pk-insp-t');
  t.append(el('div', 'pk-insp-name', title), el('div', 'pk-insp-sub', sub));
  head.append(t);
  const close = el('button', 'btn pk-close');
  close.type = 'button';
  close.append(icon('close', { size: 's' }));
  pkLabelled(close, 'Close the inspector');
  close.addEventListener('click', () => pkSelect(null));
  head.append(close);
  return head;
}

function pkRowInspector(row, data) {
  const m = pkInspectorModel(row, data, { now: Date.now(), codeOf: pkCode });
  const box = el('div', 'pk-insp-b');
  box.append(pkInspHead(m.lamp.p, m.lamp.label, m.title, m.slug || m.repo));
  if (m.reasons.length) {
    const s = pkSection('WHY');
    for (const r of m.reasons) s.append(pkLine('pk-reason', r));
    box.append(s);
  }

  const sm = pkSection('MAIN');
  sm.append(pkLine(`pk-main--${m.main.status}`, pkGlyph('pk-g', m.main.text || '—', m.main.label), el('span', 'pk-dim', m.main.label)));
  sm.append(pkLine('pk-dim', m.tested));
  box.append(sm);

  const sj = pkSection('JOBS', m.jobs.length);
  if (!m.jobs.length) sj.append(pkLine('pk-dim', 'No jobs mapped to this package.'));
  for (const j of m.jobs) {
    const v = j.verdict === 'ok' && j.partial ? 'partial' : j.verdict || 'queued';
    const d = pkLine(`pk-job-line pk-v--${v.replace(/[^a-z-]/g, '')}`,
      el('span', 'pk-v', v), el('span', 'pk-job-name', j.name), el('span', 'pk-dim', j.workflow));
    if (j.prOnly) d.append(pkGlyph('pk-tag', 'PR-only', 'Runs on pull requests only; its verdict comes from the PRs'));
    if (j.via) d.append(pkGlyph('pk-tag', j.via, `mapped by ${j.via}`));
    if (j.disputed) d.append(pkGlyph('pk-tag pk-red', '▲ disputed', `builders disagree: ${j.disputed.join(', ')}`));
    sj.append(d);
    if (j.skipped.length) sj.append(pkLine('pk-sub pk-dim', `skipped: ${j.skipped.join(', ')}`));
  }
  box.append(sj);

  const sl = pkSection('LANES', m.lanes.length);
  if (!m.lanes.length) sl.append(pkLine('pk-dim', 'No lane touches this package.'));
  for (const l of m.lanes) {
    const dot = el('span', 'row-stripe pk-dot');
    dot.style.setProperty('--lane-hue', String(pkHue(l.fkey)));
    sl.append(pkLine('pk-lane', dot, el('span', 'plate', l.code || l.builder), el('span', 'pk-lane-name', l.name),
      l.branch ? el('span', 'pk-dim', l.branch) : null));
    for (const f of l.files) sl.append(pkLine('pk-sub pk-file', f));
    if (l.more) sl.append(pkLine('pk-sub pk-dim', `+${l.more} more files`));
  }
  box.append(sl);

  if (m.prs.length) {
    const sp = pkSection('PRS', m.prs.length);
    for (const p of m.prs) {
      sp.append(pkLine(p.failed.length ? 'pk-red' : null, el('span', 'pk-pr-n', p.n == null ? '#?' : `#${p.n}`),
        el('span', 'pk-dim', p.fkey), el('span', 'pk-v', p.verdict || 'none')));
      if (p.failed.length) sp.append(pkLine('pk-sub', `failed here: ${p.failed.join(', ')}`));
    }
    box.append(sp);
  }

  if (m.conflicts.length) {
    const sc = pkSection('CONFLICTS', m.conflicts.length);
    for (const c of m.conflicts) {
      sc.append(pkLine(c.kind === 'textual' ? 'pk-conf--p2' : 'pk-conf--p3',
        el('span', 'pk-g', c.kind === 'textual' ? '▲' : '◆'), el('span', null, `${c.a} × ${c.b}`), el('span', 'pk-dim', c.kind)));
      for (const f of c.files) sc.append(pkLine('pk-sub pk-file', f));
    }
    box.append(sc);
  }

  if (m.plans.length) {
    const sp = pkSection('PLANS', m.plans.length);
    for (const p of m.plans) sp.append(pkLine(null, el('span', 'pk-v', p.state), pkGlyph('pk-file', p.path, p.word ? `status: ${p.word}` : p.path)));
    box.append(sp);
  }

  if (m.other) {
    const so = pkSection('UNMAPPED FILES', m.other.length);
    for (const f of m.other.slice(0, 100)) so.append(pkLine('pk-file', f));
    box.append(so);
  } else if (m.paths.length) {
    const sp = pkSection('PATHS');
    sp.append(pkLine('pk-file', m.paths.join('  ')));
    box.append(sp);
  }
  return box;
}

function pkRepoInspectorNode(name, data) {
  const m = pkRepoInspector(name, data, { now: Date.now() });
  if (!m) return null;
  const box = el('div', 'pk-insp-b');
  box.append(pkInspHead(m.header.ci.p, m.header.ci.label, m.header.name, m.header.slug || 'repo'));

  const so = pkSection('MERGE ORDER', m.order.length);
  so.append(pkLine('pk-dim', 'A hint only: nothing here merges.'));
  if (!m.order.length) so.append(pkLine('pk-dim', 'No candidates (review-ready, done, or a green/pending PR).'));
  for (const o of m.order) {
    so.append(pkLine('pk-order-line', el('span', 'pk-rank', `${o.rank}.`), el('span', 'pk-lane-name', o.fkey)));
    if (o.reasons.length) so.append(pkLine('pk-sub pk-dim', o.reasons.join(', ')));
  }
  for (const w of m.warnings) so.append(pkLine('pk-conf--p2', el('span', 'pk-g', '▲'), el('span', null, w)));
  box.append(so);

  const sh = pkSection('HOTSPOTS', m.hotspots.length);
  if (!m.hotspots.length) sh.append(pkLine('pk-dim', 'No file is touched by two lanes.'));
  for (const h of m.hotspots) {
    sh.append(pkLine(h.conflicts ? 'pk-conf--p2' : null, el('span', 'pk-file', h.file),
      pkGlyph('pk-dim', `${h.lanes.length}L${h.conflicts ? ` ▲${h.conflicts}` : ''}`, `${h.lanes.join(', ')}${h.conflicts ? `; ${h.conflicts} conflicts` : ''}`)));
  }
  box.append(sh);

  const ss = pkSection('STALE BRANCHES', m.stale.length);
  if (!m.stale.length) ss.append(pkLine('pk-dim', 'None.'));
  for (const s of m.stale) {
    ss.append(pkLine(null, el('span', 'pk-g', '◆'), el('span', 'pk-lane-name', s.branch), el('span', 'pk-dim', s.age),
      el('span', 'pk-tag', s.suggestion)));
    if (s.reasons.length) ss.append(pkLine('pk-sub pk-dim', s.reasons.join(', ')));
    if (s.command) {
      const code = el('code', 'pk-cmd', s.command);
      code.title = 'Copy and run it yourself; laneboard never runs it';
      ss.append(pkLine('pk-sub', code));
    }
  }
  box.append(ss);
  return box;
}

function pkRenderInspector(data) {
  const aside = st.insp;
  aside.textContent = '';
  let node = null;
  if (data && st.sel?.kind === 'row') {
    const row = data.rows.find((r) => pkRowKey(r) === st.sel.key);
    if (row) node = pkRowInspector(row, data);
  } else if (data && st.sel?.kind === 'repo') {
    node = pkRepoInspectorNode(st.sel.key, data);
  }
  aside.hidden = !node;
  st.body.classList.toggle('pk--insp', Boolean(node));
  if (node) aside.append(node);
}

// ---------------------------------------------------------------- wiring

function pkRender() {
  if (!st) return;
  const data = pkData();
  st.drawn = data;
  st.drawnQ = `${st.route?.s ?? ''}\u0000${st.route?.q ?? ''}\u0000${st.route?.b ?? ''}`;
  setPanel(st.panel.root, { scope: packagesScope(st.route), n: data ? pkCounts(data, st.route).shown : null });
  pkRenderChips(data);
  pkRenderTable(data);
  pkRenderInspector(data);
}

function pkSelect(sel, { focus = false } = {}) {
  if (!st) return;
  st.sel = sel;
  pkRender();
  if (focus && sel?.kind === 'row') st.rowNodes.get(sel.key)?.focus?.();
}

function pkRowKeydown(e, key) {
  const i = st.order.indexOf(key);
  const to = rowMove(e.key, i, st.order.length);
  if (to !== null) {
    e.preventDefault?.();
    pkSelect({ kind: 'row', key: st.order[to] }, { focus: true });
    return;
  }
  if (e.key === 'Enter') { e.preventDefault?.(); pkSelect({ kind: 'row', key }, { focus: true }); }
  else if (e.key === 'Escape' && st.sel) {
    e.preventDefault?.();
    e.stopPropagation?.();
    pkSelect(null);
    st?.rowNodes.get(key)?.focus?.();
  }
}

export default {
  id: 'packages',
  icon: 'packages',
  title: 'Packages',
  mount: (el0, ctx = {}) => {
    if (!el0) return;
    el0.textContent = '';
    const p = panel({ name: 'PACKAGES', scope: packagesScope(routeOf(ctx)) });
    const chipsBox = el('div', 'pk-chips');
    chipsBox.setAttribute('role', 'toolbar');
    chipsBox.setAttribute('aria-label', 'Package filters');
    const body = el('div', 'pk');
    const tableWrap = el('div', 'dt-wrap pk-wrap');
    const insp = el('aside', 'pk-insp');
    insp.setAttribute('aria-label', 'Package inspector');
    insp.hidden = true;
    body.append(tableWrap, insp);
    p.body.append(chipsBox, body);
    el0.append(p.root);
    st = {
      el: el0, panel: p, chips: chipsBox, body, tableWrap, insp,
      store: ctx.store ?? null, route: routeOf(ctx) ?? {}, navigate: ctx.navigate ?? null,
      fetched: null, loading: false, sel: null, order: [], rowNodes: new Map(), drawn: undefined, drawnQ: null,
    };
    if (!pkData()) {
      st.loading = true;
      const mine = st;
      pkLoad().then((d) => {
        if (st !== mine) return;
        mine.loading = false;
        if (d) mine.fetched = d;
        pkRender();
      });
    }
    pkRender();
  },
  unmount: () => {
    if (st) st.el.textContent = '';
    st = null;
  },
  update: (store, ctx = {}) => {
    if (!st) return;
    if (store) st.store = store;
    const r = routeOf(ctx);
    if (r) st.route = r;
    if (typeof ctx.navigate === 'function') st.navigate = ctx.navigate;
    const q = `${st.route?.s ?? ''}\u0000${st.route?.q ?? ''}\u0000${st.route?.b ?? ''}`;
    // Called on every store change: repaint only when the packages data or
    // the filters changed.
    if (pkData() === st.drawn && q === st.drawnQ) return;
    pkRender();
  },
};
