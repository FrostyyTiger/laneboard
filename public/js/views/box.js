// The Box view. Moved from public/app.js (fleet F1).
import { $, el } from '../core/dom.js';
import { store } from '../core/store.js';

// ---------------------------------------------------------------- box
//
// What this box is carrying. v3 Stage 1 is the shell: the vitals, drawn from
// the snapshot the board already has. The dev stack, CI queue and slots join
// it in later stages. It never acts.

function vitalTile(k, v, sub) {
  const d = el('div', 'vital');
  d.append(el('div', 'k', k));
  const vv = el('div', 'v', v);
  if (sub) vv.append(el('small', null, ` ${sub}`));
  d.append(vv);
  return d;
}

export function renderBox() {
  const box = $('box-body');
  if (!box || store.view !== 'box') return;
  box.textContent = '';
  const v = store.vitals;
  if (!v) { box.append(el('p', 'empty', 'Waiting for the first snapshot…')); return; }

  const vit = el('section', 'mblock');
  vit.append(el('h3', 'rail-h', 'This box'));
  const grid = el('div', 'vitals vitals-wide');
  grid.append(vitalTile('cpu', v.cpuPct == null ? '—' : `${v.cpuPct}%`, v.load ? `load ${v.load[0].toFixed(2)}` : ''));
  if (v.mem) grid.append(vitalTile('mem', `${(v.mem.usedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.totalMb / 1024).toFixed(0)}G`));
  if (v.mem) grid.append(vitalTile('swap', `${(v.mem.swapUsedMb / 1024).toFixed(1)}G`, `/ ${(v.mem.swapTotalMb / 1024).toFixed(0)}G`));
  if (v.disk) grid.append(vitalTile('disk', `${(v.disk.availMb / 1024).toFixed(0)}G`, 'free'));
  if (v.gpu) grid.append(vitalTile('gpu', `${v.gpu.utilPct}%`, `${(v.gpu.memUsedMb / 1024).toFixed(1)}G`));
  grid.append(vitalTile('claude', `${(v.claudeRssMb / 1024).toFixed(1)}G`, `${v.sessionCount} sessions`));
  grid.append(vitalTile('laneboard', `${v.laneboardRssMb}MB`, ''));
  vit.append(grid);
  box.append(vit);
  for (const b of boxBlocks()) box.append(b);
}

/** The guard, the CI queue and the slots: Box sections, and rail blocks on the 49". */
export function boxBlocks() {
  const b = store.box;
  if (!b) return [el('p', 'empty', 'Waiting for the collectors…')];
  const blocks = [guardBlock(b.guard), ciBlock(b.ci), slotsBlock(b.slots)].filter(Boolean);
  // With every provider off there is nothing to say here, and saying nothing
  // is better than three empty headings.
  return blocks.length ? blocks : [el('p', 'empty', 'No guard, no agent slots and no CI configured — see docs/config.md.')];
}

function guardBlock(g) {
  // No guard provider: no block at all, rather than an empty one that implies
  // something is being watched.
  if (!g || g.provider === 'none') return null;
  const sec = el('section', 'mblock');
  const h = el('h3', 'rail-h', 'Guard');
  h.append(el('span', `guard ${g.ok ? 'guard-ok' : 'guard-danger'}`, g.ok ? 'guard ok' : 'DANGER'));
  sec.append(h);
  const probes = g.health ?? [];
  // The guard's findings first: this block exists for them.
  for (const f of [...(g.preventive ?? []), ...(g.detective ?? [])]) {
    const line = el('div', 'marker-line mk-danger');
    line.append(el('span', 'mk-kind', 'danger'));
    line.append(el('span', 'mk-text', `${f.session || `pid ${f.pid}`}: ${f.reason}`));
    sec.append(line);
  }
  const rows = el('div', 'kv');
  const health = (label, x) => {
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', label));
    r.append(el('span', `kv-v ${x?.ok ? 'ok' : 'bad'}`, x?.ok ? `${x.status}` : (x?.status ? `${x.status}` : 'down')));
    rows.append(r);
  };
  for (const p of probes) health(p.name, p);
  for (const c of g.containers ?? []) {
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', c.name.replace(/-1$/, '')));
    r.append(el('span', `kv-v ${c.state === 'running' ? '' : 'dim'}`, c.status));
    rows.append(r);
  }
  sec.append(rows);
  return sec;
}

function ciBlock(ci) {
  if (!ci || ci.provider === 'none') return null;
  const sec = el('section', 'mblock');
  const q = ci?.queue;
  const h = el('h3', 'rail-h', 'CI queue');
  if (q) h.append(el('span', 'count', `${q.running} running · ${q.queued} queued`));
  sec.append(h);
  if (ci?.auth && ci.auth.ok === false) sec.append(el('p', 'empty', 'gh not logged in on this host — run `gh auth login`.'));
  if (!q) { if (ci?.auth?.ok !== false) sec.append(el('p', 'empty', 'Not checked yet.')); return sec; }
  const rows = el('div', 'kv');
  for (const r of q.runs.slice(0, 8)) {
    const row = el('div', 'kv-row');
    const verdict = r.status !== 'completed' ? r.status.replace('_', ' ') : (r.conclusion || 'done');
    row.append(el('span', 'kv-k', r.name));
    row.append(el('span', 'kv-b', r.branch || ''));
    row.append(el('span', `kv-v ${r.conclusion === 'success' ? 'ok' : r.conclusion === 'failure' ? 'bad' : r.status !== 'completed' ? 'run' : 'dim'}`, verdict));
    rows.append(row);
  }
  sec.append(rows);
  return sec;
}

function slotsBlock(slots) {
  // No slot provider: no slots, and no empty block implying there are some.
  if (!slots?.length) return null;
  const sec = el('section', 'mblock');
  sec.append(el('h3', 'rail-h', 'Agent slots'));
  const rows = el('div', 'kv');
  for (const x of slots ?? []) {
    if (!x.exists && !x.laneSlot) continue;
    const r = el('div', 'kv-row');
    r.append(el('span', 'kv-k', `slot ${x.slot} :${x.ports.pg}`));
    r.append(el('span', `kv-v ${x.orphan ? 'warn' : x.up ? 'ok' : 'dim'}`, x.owner || (x.up ? 'up' : 'free')));
    rows.append(r);
  }
  sec.append(rows);
  return sec;
}
