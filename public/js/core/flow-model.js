// The Flow view's model (docs/flow.md): where a goal stands, box by box. Pure.
// A value the engine does not report is left out, never guessed.
//
// buildFlow({product, goal, run, row, events, items, waiting, now})
//   -> {lit, boxes: [{id, title, row, state: done|lit|ahead|waiting, lines, detail, note}]}
// `waiting`: a gate the goal has moved past that still has something open.

export const BOX_IDS = Object.freeze(['sources', 'claims', 'requirements', 'gate', 'goal', 'tester', 'tasks', 'builder', 'checks', 'pr']);
const TITLES = Object.freeze({
  sources: 'Sources', claims: 'Claims', requirements: 'Requirements', gate: 'Gate', goal: 'Goal',
  tester: 'Test writer', tasks: 'Tasks', builder: 'Builder', checks: 'Checks', pr: 'PR + report',
});
const FIRST_ROW = 5;

const count = (list, f) => list.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tally = (list) => {
  const m = new Map();
  for (const x of list) if (x) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([k, n]) => `${n} ${k}`).join(' · ');
};

export function ageWords(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
const since = (at, now) => (typeof at === 'number' ? ageWords(now - at) : null);

/** The run a goal shows: a live one first, then the newest. Null when it has none. */
export function pickRun(rows, product, goal) {
  const live = (r) => r.state !== 'done' && r.state !== 'stopped';
  const mine = (Array.isArray(rows) ? rows : []).filter((r) => r.product === product && r.goal === goal);
  return mine.sort((a, b) => (live(b) - live(a)) || ((b.updatedAt ?? 0) - (a.updatedAt ?? 0)))[0] ?? null;
}

/** What waits on this goal: its run's items, or an item naming one of its requirements. */
export function waitingFor(waiting, { product, run, requirements }) {
  const reqs = new Set((requirements ?? []).map((id) => `${product}:${id}`));
  return (Array.isArray(waiting) ? waiting : []).filter((it) => (run && it.run === run.id)
    || (it.product === product && (it.links ?? []).some((l) => reqs.has(l.ref)) && !it.run));
}

const tasksOf = (nodes) => nodes.filter((n) => n.level === 'task');

/** The box a goal is in (docs/plans/runs-first/flow.md, "Which box is lit"). */
export function litBox({ goal, run, waiting = [], requirements = [] }) {
  const nodes = run?.tree ?? [];
  if (run) {
    if (run.state === 'done' || waiting.some((w) => w.kind === 'merge' || w.kind === 'deploy')) return 'pr';
    if (run.state === 'waiting-approval') return 'gate';
    if (run.state === 'queued') return 'goal';
    const tasks = tasksOf(nodes);
    const current = nodes.find((n) => n.id === run.node);
    if (tasks.some((n) => n.state === 'checking') || current?.lastCheck?.pass === false) return 'checks';
    if (tasks.some((n) => n.state === 'building')) return 'builder';
    return tasks.length ? 'tasks' : 'tester';
  }
  if (goal?.readiness === 'ready') return 'goal';
  return requirements.some((r) => r.status === 'draft') ? 'gate' : 'requirements';
}

const NOT_STARTED = Object.freeze([{ text: 'Not started' }]);
const link = (text, href, external = false) => ({ text, href, external });

function sourcesBox(items, now) {
  const list = items.filter((i) => i.type === 'source');
  const newest = [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const lines = [{ text: plural(list.length, 'source') }];
  if (list.length) lines.push({ text: tally(list.map((s) => s.kind)) });
  if (newest) lines.push({ text: `newest ${newest.id}${since(newest.updatedAt, now) ? `, ${since(newest.updatedAt, now)} ago` : ''}` });
  return { lines, detail: list.map((s) => ({ text: `${s.id} · ${s.kind ?? 'source'}` })) };
}

function claimsBox(items) {
  const claims = items.filter((i) => i.type === 'claim');
  const questions = items.filter((i) => i.type === 'question' && i.status === 'open');
  const lines = [{ text: plural(claims.length, 'claim') }];
  const conf = tally(['high', 'medium', 'low'].flatMap((c) => claims.filter((x) => x.confidence === c).map(() => c)));
  if (conf) lines.push({ text: conf });
  const gone = count(claims, (c) => c.status === 'superseded');
  if (gone) lines.push({ text: `${gone} superseded` });
  lines.push({ text: `${plural(questions.length, 'open question')}, ${count(questions, (q) => q.blocks?.length)} blocking` });
  return { lines, detail: questions.map((q) => ({ text: `${q.id} ${q.question}` })) };
}

function requirementsBox(reqs, product) {
  const lines = [{ text: plural(reqs.length, 'requirement') }];
  if (reqs.length) lines.push({ text: tally(reqs.map((r) => r.status)) });
  const fixed = reqs.reduce((n, r) => n + (Array.isArray(r.sections?.fixed) ? r.sections.fixed.length : 0), 0);
  if (fixed) lines.push({ text: plural(fixed, 'fixed line') });
  return { lines, detail: reqs.map((r) => link(`${r.id} ${r.title} (${r.status})`, `#/knowledge?q=${encodeURIComponent(r.id)}&product=${encodeURIComponent(product)}`)) };
}

function gateBox(waiting, now) {
  if (!waiting.length) return { lines: [{ text: 'Nothing waits' }], detail: [] };
  const oldest = [...waiting].sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0))[0];
  return {
    lines: [link(`${waiting.length} waiting for a person`, '#/inbox'), { text: `oldest ${since(oldest.openedAt, now) ?? '?'}: ${oldest.title}` }],
    detail: waiting.map((w) => link(`${w.kind}: ${w.title}`, '#/inbox')),
  };
}

function goalBox(goal, run, now) {
  const lines = [{ text: goal?.readiness === 'ready' ? 'Ready' : `Not ready: ${plural(goal?.reasons?.length ?? 0, 'reason')}`, p: goal?.readiness === 'ready' ? null : '2' }];
  if (run) {
    lines.push({ text: `${run.id}: ${run.state}` });
    if (run.recipe?.revision != null) lines.push({ text: `recipe revision ${run.recipe.revision}` });
    if (since(run.startedAt, now)) lines.push({ text: `started ${since(run.startedAt, now)} ago` });
    if (typeof run.usage?.usd === 'number') lines.push({ text: `$${run.usage.usd.toFixed(2)} so far` });
  }
  return { lines, detail: (goal?.reasons ?? []).map((r) => ({ text: r.text })) };
}

function testerBox(nodes) {
  const features = nodes.filter((n) => n.level === 'feature');
  if (!features.length) return { lines: NOT_STARTED, detail: [] };
  const n = features.reduce((a, f) => a + (f.acceptanceTests?.length ?? 0), 0);
  return {
    lines: [{ text: plural(n, 'acceptance test') }, { text: `in ${plural(features.length, 'feature')}` }],
    detail: features.map((f) => ({ text: `${f.id} ${f.title}: ${f.acceptanceTests?.length ?? 0}` })),
  };
}

const TASK_WORD = Object.freeze({ planned: 'open', ready: 'open', building: 'running', checking: 'running' });

function tasksBox(nodes) {
  const tasks = tasksOf(nodes);
  if (!tasks.length) return { lines: NOT_STARTED, detail: [] };
  return {
    lines: [{ text: `${plural(count(nodes, (n) => n.level === 'feature'), 'feature')} · ${plural(tasks.length, 'task')}` }, { text: tally(tasks.map((t) => TASK_WORD[t.state] ?? t.state)) }],
    detail: tasks.map((t) => ({ text: `${t.id} ${t.title} (${t.state})` })),
  };
}

function builderBox(run, nodes, events, now) {
  const node = nodes.find((n) => n.id === run?.node);
  if (!node || !['building', 'checking', 'reopened'].includes(node.state)) return { lines: run?.tree?.length ? [{ text: 'Not building right now' }] : NOT_STARTED, detail: [] };
  const feature = nodes.find((n) => n.id === node.parent);
  const mine = events.filter((e) => e.node === node.id);
  const round = mine.filter((e) => e.type === 'round.start').at(-1);
  const step = mine.filter((e) => e.type === 'step').at(-1);
  const lines = [{ text: node.title, strong: true }];
  if (feature) lines.push({ text: `for ${feature.requirements?.[0] ? `${feature.requirements[0]} ` : ''}${feature.title}` });
  if (round) lines.push({ text: `round ${round.round ?? '?'}${round.role ? `, ${round.role}` : ''}, since ${since(round.at, now) ?? '?'} ago` });
  if (step) lines.push({ text: `last step: ${step.what ?? step.title ?? 'step'} ${step.ok === false ? '✗' : '✓'}`, p: step.ok === false ? '1' : null });
  if (node.lastCheck) lines.push(checkLine('last check', node.lastCheck));
  return { lines, detail: [] };
}

function checkLine(label, c) {
  const n = c.counts;
  return { text: `${label}: ${c.pass ? '✓' : '✗'} ${c.name && c.name !== label ? c.name : ''}${n ? ` ${n.passed} passed, ${n.failed} failed` : ''}`.trim(), p: c.pass ? null : '1' };
}

function checksBox(nodes, events, now) {
  const lines = [];
  const checked = tasksOf(nodes).filter((n) => n.lastCheck).sort((a, b) => (b.lastCheck.at ?? 0) - (a.lastCheck.at ?? 0));
  if (checked[0]) lines.push(checkLine('last task', checked[0].lastCheck));
  const features = nodes.filter((n) => n.level === 'feature' && n.lastCheck);
  if (features.length) lines.push({ text: `features: ${count(features, (f) => f.lastCheck.pass)} of ${features.length} green` });
  const suite = events.filter((e) => e.type === 'check' && e.name === 'suite').at(-1);
  if (suite) lines.push({ ...checkLine('suite', suite), text: `${checkLine('suite', suite).text}, ${since(suite.at, now) ?? '?'} ago` });
  return { lines: lines.length ? lines : NOT_STARTED, detail: [] };
}

function prBox(run, waiting) {
  const lines = [];
  if (run?.pr) lines.push(link(`#${run.pr.id} ${run.pr.state ?? ''}`.trim(), run.pr.url, true));
  const merge = waiting.find((w) => w.kind === 'merge');
  if (merge) {
    lines.push({ text: 'Waiting for merge', p: '2' });
    if (merge.content?.demos?.length) lines.push({ text: plural(merge.content.demos.length, 'demo') });
  }
  if (waiting.some((w) => w.kind === 'deploy')) lines.push({ text: 'Waiting for deploy', p: '2' });
  if (run?.report?.url) lines.push(link('Report', run.report.url, true));
  return { lines: lines.length ? lines : NOT_STARTED, detail: [] };
}

export function buildFlow({ product, goal, run = null, events = [], items = [], waiting = [], now = Date.now() }) {
  const nodes = run?.tree ?? [];
  const ids = new Set(goal?.requirements ?? []);
  const reqs = items.filter((i) => i.type === 'requirement' && ids.has(i.id));
  const held = waitingFor(waiting, { product, run, requirements: [...ids] });
  const lit = litBox({ goal, run, waiting: held, requirements: reqs });
  const litAt = BOX_IDS.indexOf(lit);
  const made = {
    sources: sourcesBox(items, now), claims: claimsBox(items), requirements: requirementsBox(reqs, product), gate: gateBox(held, now),
    goal: goalBox(goal, run, now), tester: testerBox(nodes), tasks: tasksBox(nodes), builder: builderBox(run, nodes, events, now),
    checks: checksBox(nodes, events, now), pr: prBox(run, held),
  };
  const boxes = BOX_IDS.map((id, i) => ({
    id, title: TITLES[id], row: i < FIRST_ROW ? 0 : 1, state: i === litAt ? 'lit' : i > litAt ? 'ahead' : id === 'gate' && held.length ? 'waiting' : 'done', ...made[id],
    note: i === litAt && (run?.state === 'at-gate' || run?.state === 'paused') ? `run ${run.state}` : null,
  }));
  return { lit, boxes };
}
