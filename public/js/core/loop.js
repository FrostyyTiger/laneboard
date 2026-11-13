// The loop a run follows, drawn from its pattern (docs/run-loop.md). Each loop
// pattern foundry knows has one shape here, written from foundry's
// toolbox/patterns/<name>.md. A copy of that doc sits in test/fixtures/patterns/,
// and test/run-loop.test.mjs checks every station and edge against it: each one
// quotes the sentence it comes from. A pattern that is not here gets no drawing.
//
// Pure: no DOM. The run page draws it (views/run-loop.js); the server works out
// the row glyph with the same code (routes/engines.mjs).

const BUILD_UNTIL_GREEN_1 = Object.freeze({
  id: 'build-until-green@1',
  doc: 'toolbox/patterns/build-until-green.md',
  /** The pattern's defaults; the recipe sets only what differs. */
  params: Object.freeze({
    task_rounds: 4, escalate_after: 2, blame_rounds: 2, review_cycles: 2, review_task_cap: 3,
    checks: 'step, task, feature, goal', suite: Object.freeze({ every_tasks: 3, after_merge: true }), parallel: null, no_progress: 2,
  }),
  /** Dashed boxes: what repeats. */
  frames: Object.freeze([
    { id: 'feature', label: 'per feature' },
    { id: 'task', label: 'per task', in: 'feature' },
  ]),
  /**
   * The stations, in the order of the forward path. `back` stations sit on a way
   * back (red, dashed); `side` ones run beside the loop and never block it.
   * `term` is the bold word in the doc's "Roles, in order".
   */
  stations: Object.freeze([
    { id: 'plan', label: 'Plan', role: 'decomposer', term: 'decomposer', doc: '**decomposer** → the tree',
      text: 'The decomposer splits the goal into features and tasks: the tree. It comes with the recipe.' },
    { id: 'recipe', label: 'Recipe', gate: 'recipe', doc: 'already in the approved recipe',
      text: 'You approve the recipe and its tree. Nothing is built before that.' },
    { id: 'tests', label: 'Tests', role: 'test-writer', frame: 'feature', phase: 'tests', term: 'test writer',
      doc: "**test writer**: the feature's acceptance tests from its acceptance lines, before any build round",
      text: 'The test writer writes the feature\'s acceptance tests first. They must run, and fail.' },
    { id: 'build', label: 'Build', role: 'builder', frame: 'task', term: 'builder', doc: '**builder**, then the **task check**',
      text: 'The builder builds one task.' },
    { id: 'taskcheck', label: 'Task check', check: 'task', frame: 'task', term: 'task check', doc: 'then the **task check**',
      text: 'The task check runs. Green freezes the task; red goes to the fixer.' },
    { id: 'fixer', label: 'Fixer', role: 'fixer', frame: 'task', back: true, term: 'fixer', doc: 'Red → **fixer**, task check again',
      text: 'The fixer works on a red task check, then the check runs again. After `escalate_after` failed rounds the next one runs a tier up; after `task_rounds` the task is blocked.' },
    { id: 'doubt', label: 'Doubt', role: 'test-writer', frame: 'task', back: true, phase: 'doubt',
      doc: 'A fixer that doubts an acceptance test gets one **test writer** round',
      text: 'A fixer that doubts an acceptance test gets one test writer round, which keeps or changes the test. The same test doubted twice goes to a person.' },
    { id: 'featurecheck', label: 'Acceptance', check: 'feature', frame: 'feature', phase: 'check', term: 'feature check',
      doc: '**Feature check**: acceptance tests', text: 'The feature check: its acceptance tests. Red goes to blame.' },
    { id: 'blame', label: 'Blame', role: 'blame', frame: 'feature', back: true, phase: 'blame', term: 'blame', doc: 'Red → **blame**',
      text: 'Blame names the task that broke the acceptance tests. That task reopens and goes to the fixer.' },
    { id: 'review', label: 'Review', role: 'reviewer', frame: 'feature', phase: 'review', term: 'reviewer', doc: 'Acceptance tests green → **reviewer**',
      text: 'The reviewer reads the feature. Its blocker and major findings become tasks (at most `review_task_cap`); a review never ends a feature.' },
    { id: 'merge', label: 'Merge', frame: 'feature', phase: 'merge', doc: 'merge into the run branch',
      text: 'The feature merges into the run branch, and its acceptance tests run once more on the merged result.' },
    { id: 'suite', label: 'Suite job', check: 'suite', side: true, doc: 'the foreman queues a suite job',
      text: 'A background suite job, every `suite.every_tasks` frozen tasks and after each merge. It runs beside the loop and never blocks it.' },
    { id: 'goalcheck', label: 'Goal check', check: 'goal', term: 'goal check', doc: '**Goal check**: suite, CI, run review',
      text: 'The goal check: the suite, CI and a review of the whole run.' },
    { id: 'goalblame', label: 'Blame', role: 'blame', back: true, doc: "Red → blame over the run's frozen tasks",
      text: 'A red goal check: blame looks over the run\'s frozen tasks, the named one reopens and is fixed, then the goal check runs again.' },
    { id: 'pr', label: 'PR', gate: 'merge', doc: 'Green → PR + run report', text: 'Green: the PR and the run report.' },
    { id: 'end', label: 'End', doc: '## Stop conditions', text: 'The run ends with one stop reason.' },
  ]),
  /** [from, to, kind, label, doc quote]. kind: fwd (grey), back (red dashed), next (grey dashed), side (dotted). */
  edges: Object.freeze([
    ['plan', 'recipe', 'fwd', 'tree', '**decomposer** → the tree (already in the approved recipe'],
    ['recipe', 'tests', 'fwd', 'approved', 'Per feature, in the order the recipe gives'],
    ['tests', 'build', 'fwd', 'red tests', 'before any build round (D-015). They must fail.'],
    ['build', 'taskcheck', 'fwd', '', '**builder**, then the **task check**'],
    ['taskcheck', 'fixer', 'back', 'red', 'Red → **fixer**'],
    ['fixer', 'taskcheck', 'back', 'again', 'task check again, until green or `task_rounds` are used'],
    ['fixer', 'doubt', 'back', 'doubts a test', 'A fixer that doubts an acceptance test'],
    ['doubt', 'build', 'back', 'kept or changed', 'keeps or changes the test'],
    ['taskcheck', 'build', 'next', 'next task', 'Per task, one after another'],
    ['taskcheck', 'featurecheck', 'fwd', 'green · frozen', 'Green → the task is **frozen**'],
    ['taskcheck', 'suite', 'side', 'every 3 frozen', 'Every `suite.every_tasks` frozen tasks the foreman queues a suite job'],
    ['featurecheck', 'blame', 'back', 'red', 'Red → **blame**'],
    ['blame', 'fixer', 'back', 'reopens a task', 'the named task reopens → fixer'],
    ['featurecheck', 'review', 'fwd', 'green', 'Acceptance tests green → **reviewer**'],
    ['review', 'build', 'back', 'findings → tasks', 'findings (≤ `review_task_cap`) become tasks in the feature'],
    ['review', 'merge', 'fwd', 'no open task', 'Green and no open review task → merge into the run branch'],
    ['merge', 'suite', 'side', 'after merge', 'acceptance tests once more on the merged result, queue a suite job'],
    ['merge', 'goalcheck', 'fwd', 'all merged', '3. **Goal check**'],
    ['goalcheck', 'goalblame', 'back', 'red', "Red → blame over the run's frozen tasks"],
    ['goalblame', 'fixer', 'back', 'reopens a task', '→ fix → again'],
    ['goalcheck', 'pr', 'fwd', 'green', 'Green → PR + run report'],
    ['pr', 'end', 'fwd', 'done', 'goal check green, PR open'],
  ]),
  /** The stop reasons, from the doc's "Stop conditions" table. */
  stops: Object.freeze({
    done: 'goal check green, PR open',
    'checks-red': 'the goal check stays red after blame and fixes, or a blocked task leaves nothing else to build',
    'no-progress': '`no_progress` task rounds in a row without a pass',
    budget: "the recipe's budget",
    'window-7d': 'the 7 d window brake',
    errors: 'two rounds in a row without a session',
    'stopped-by-person': 'a person stopped it; it finishes the current round first',
  }),
  /** The Runs row glyph: seven dots, each a group of stations, with its word. */
  glyph: Object.freeze([
    ['Plan', ['plan']], ['Recipe', ['recipe']], ['Tests', ['tests', 'doubt']], ['Build', ['build', 'taskcheck', 'fixer']],
    ['Check', ['featurecheck', 'blame']], ['Review', ['review', 'merge']], ['PR', ['suite', 'goalcheck', 'goalblame', 'pr', 'end']],
  ]),
});

export const PATTERNS = Object.freeze({ [BUILD_UNTIL_GREEN_1.id]: BUILD_UNTIL_GREEN_1 });

/** The loop parameters a recipe may send (foundry's `recipe.loop`), each a small whole number. */
export const LOOP_PARAMS = Object.freeze(['task_rounds', 'escalate_after', 'blame_rounds', 'review_cycles', 'review_task_cap', 'no_progress']);

/**
 * The run's pattern: {pattern, from} or {pattern: null, why}. The recipe's own
 * `patterns` list wins. Without one, a `build` or `change` run is
 * build-until-green@1: foundry's only loop pattern, and it refuses any other.
 */
export function patternOf(run) {
  const named = Array.isArray(run?.recipe?.patterns) ? run.recipe.patterns.filter((p) => typeof p === 'string') : [];
  if (named.length) {
    const id = named.find((p) => PATTERNS[p]);
    return id ? { pattern: PATTERNS[id], from: 'recipe' } : { pattern: null, why: `laneboard does not know the pattern ${named.join(', ').slice(0, 80)}` };
  }
  const kind = run?.recipe?.kind;
  if (kind === 'build' || kind === 'change') return { pattern: PATTERNS['build-until-green@1'], from: 'kind' };
  const k = String(kind ?? '').slice(0, 24);
  return { pattern: null, why: k ? `${/^[aeiou]/.test(k) ? 'an' : 'a'} ${k} run follows its recipe's steps, not a loop` : 'the run names no recipe kind' };
}

/** The numbers the loop runs with: the recipe's, else the pattern's defaults. -> {name: {value, from}} */
export function paramsOf(run, pattern) {
  const sent = run?.recipe?.loop ?? {};
  const out = {};
  for (const k of LOOP_PARAMS) {
    const v = sent[k];
    out[k] = Number.isInteger(v) ? { value: v, from: 'recipe' } : { value: pattern.params[k], from: 'pattern' };
  }
  return out;
}

const ROLE_STATION = Object.freeze({ decomposer: 'plan', 'test-writer': 'tests', builder: 'build', fixer: 'fixer', blame: 'blame', reviewer: 'review' });
/** foundry's own phase words (x.phase on a node, src/build.ts) -> station. */
const FEATURE_PHASE = Object.freeze({ tests: 'tests', doubt: 'doubt', check: 'featurecheck', blame: 'blame', review: 'review', merge: 'merge' });
const GOAL_PHASE = Object.freeze({ check: 'goalcheck', ci: 'goalcheck', blame: 'goalblame', review: 'goalcheck' });
/** A recipe step id in a block reason, `blocked at G1.F1 (tests): …` -> station. */
const STEP_STATION = Object.freeze({ decompose: 'plan', tests: 'tests', build: 'build', fix: 'fixer', blame: 'blame', review: 'review', run_review: 'goalcheck', doubt: 'doubt' });
const LIVE = new Set(['running', 'at-gate', 'waiting-approval', 'paused', 'queued']);
const TEST_WRITER_CHECK = /^acceptance tests written/i;

/** Blocked: at a gate with nothing to decide (same rule as the Runs view). */
export function blockedRun(run) {
  if (run?.state !== 'at-gate') return false;
  if (Array.isArray(run.waiting) && run.waiting.length) return false;
  if (Array.isArray(run.gates) && run.gates.some((g) => g?.state === 'open')) return false;
  return true;
}

const levelOf = (byId, id) => byId.get(id)?.level ?? (typeof id === 'string' ? ['goal', 'feature', 'task'][Math.min(id.split('.').length - 1, 2)] : null);
const featureOf = (byId, id) => {
  if (typeof id !== 'string') return null;
  const n = byId.get(id);
  if (n?.level === 'feature') return id;
  if (n?.level === 'task') return n.parent ?? id.split('.').slice(0, 2).join('.');
  return levelOf(byId, id) === 'feature' ? id : levelOf(byId, id) === 'task' ? id.split('.').slice(0, 2).join('.') : null;
};

/** The station a round of `role` on `node` stands for. */
function roundStation(role, node, byId, tasksStarted) {
  const lvl = levelOf(byId, node);
  if (role === 'test-writer') return tasksStarted(featureOf(byId, node)) ? 'doubt' : 'tests';
  if (role === 'blame') return lvl === 'goal' ? 'goalblame' : 'blame';
  if (role === 'reviewer') return lvl === 'goal' ? 'goalcheck' : 'review';
  return ROLE_STATION[role] ?? null;
}

/** The station one event stands for, or null when it says nothing about the spot. */
function eventStation(e, byId, tasksStarted) {
  if (e.type === 'round.start' || e.type === 'round.end') return roundStation(e.role, e.node, byId, tasksStarted);
  if (e.type === 'check') {
    if (e.name === 'suite' || e.level === 'run') return null;
    if (e.level === 'task') return 'taskcheck';
    if (e.level === 'feature') return TEST_WRITER_CHECK.test(e.name ?? '') ? 'tests' : 'featurecheck';
    if (e.level === 'goal') return e.name === 'tree format' ? 'plan' : e.name === 'install' ? null : 'goalcheck';
    return null;
  }
  if (e.type === 'node.state' && e.level === 'task') return e.state === 'building' ? 'build' : e.state === 'checking' ? 'taskcheck' : null;
  if (e.type === 'node.state' && e.level === 'feature' && e.state === 'checking') return 'featurecheck';
  if (e.type === 'node.state' && e.level === 'feature' && e.state === 'passed') return 'merge';
  if (e.type === 'gate' || e.type === 'decision') return e.level === 'run' && (e.kind ?? 'recipe') === 'recipe' ? 'recipe' : null;
  return null;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Where the run is in its loop, from the run (tree, gates, state, reason) and
 * its events. -> {current, state, exact, focus: {feature, task}, stations:
 * {id: {mark, sub}}, openRound, stop}. mark: done | current | blocked | gate |
 * idle | stopped. `exact` is true when foundry sent the node's phase; else the
 * spot is worked out from the events (docs/run-loop.md, "Where it is").
 */
export function loopPosition(run, events = [], pattern = PATTERNS['build-until-green@1'], params = paramsOf(run, pattern)) {
  const tree = Array.isArray(run?.tree) ? run.tree : [];
  const byId = new Map(tree.map((n) => [n.id, n]));
  const ev = (Array.isArray(events) ? events : []).filter((e) => e && typeof e.seq === 'number').sort((a, b) => a.seq - b.seq);
  const started = new Set();
  for (const e of ev) if (e.type === 'round.start' && e.role === 'builder') started.add(featureOf(byId, e.node));
  for (const n of tree) if (n.level === 'task' && !['planned'].includes(n.state)) started.add(featureOf(byId, n.id));
  const tasksStarted = (f) => started.has(f);

  // Open rounds: a start without its end (same node and role), newest last.
  const open = [];
  for (const e of ev) {
    if (e.type === 'round.start') open.push(e);
    else if (e.type === 'round.end') {
      const i = open.findLastIndex((s) => s.node === e.node && s.role === e.role);
      if (i >= 0) open.splice(i, 1);
    }
  }
  const openRound = LIVE.has(run?.state) ? open.at(-1) ?? null : null;

  // The focus feature: the one the drawing follows.
  const features = tree.filter((n) => n.level === 'feature');
  const fromNode = featureOf(byId, run?.node);
  const reasonNode = /\b(G\d+\.F\d+(?:\.T\d+)?)\b/.exec(run?.reason ?? '')?.[1];
  const feature = fromNode ?? featureOf(byId, reasonNode) ?? features.find((f) => f.state === 'blocked')?.id
    ?? featureOf(byId, openRound?.node) ?? features.find((f) => !['passed', 'frozen'].includes(f.state))?.id ?? features.at(-1)?.id ?? null;
  const tasks = tree.filter((n) => n.level === 'task' && n.parent === feature);
  const task = (levelOf(byId, run?.node) === 'task' ? run.node : null)
    ?? tasks.find((t) => ['building', 'checking', 'reopened', 'blocked'].includes(t.state))?.id
    ?? tasks.find((t) => t.state !== 'frozen')?.id ?? null;
  const goal = tree.find((n) => n.level === 'goal');
  const allMerged = features.length > 0 && features.every((f) => f.state === 'passed' || f.state === 'frozen');

  // The spot.
  let current = null;
  let exact = false;
  const blocked = blockedRun(run);
  const fPhase = byId.get(feature)?.phase;
  const gPhase = goal?.phase;
  const openGate = (kind) => (run?.gates ?? []).some((g) => g?.state === 'open' && g.kind === kind);
  if (run?.state === 'done') current = 'end';
  else if (run?.state === 'waiting-approval') current = 'recipe';
  else if (allMerged && typeof gPhase === 'string' && GOAL_PHASE[gPhase]) { current = GOAL_PHASE[gPhase]; exact = true; }
  else if (typeof fPhase === 'string' && (FEATURE_PHASE[fPhase] || fPhase === 'tasks')) {
    exact = true;
    if (fPhase !== 'tasks') current = FEATURE_PHASE[fPhase];
    else {
      const t = byId.get(task);
      current = openRound?.role === 'fixer' ? 'fixer' : t?.state === 'checking' ? 'taskcheck' : 'build';
    }
  }
  if (!current && !openRound && openGate('merge')) current = 'pr';
  if (!current && !openRound && !features.length && openGate('recipe')) current = 'recipe';
  if (!current && blocked) {
    const step = /\(([a-z_]+)\)/.exec(run?.reason ?? '')?.[1];
    if (step && STEP_STATION[step]) current = STEP_STATION[step];
  }
  if (!current && openRound) current = roundStation(openRound.role, openRound.node, byId, tasksStarted);
  if (!current) for (let i = ev.length - 1; i >= 0 && !current; i -= 1) current = eventStation(ev[i], byId, tasksStarted);
  if (!current) current = 'plan';

  // Marks: the forward path before the spot is done; the spot is lit.
  const order = pattern.stations.filter((s) => !s.back && !s.side).map((s) => s.id);
  const anchor = { fixer: 'taskcheck', doubt: 'build', blame: 'featurecheck', goalblame: 'goalcheck', suite: 'merge' };
  const at = order.indexOf(anchor[current] ?? current);
  const stations = {};
  for (const s of pattern.stations) {
    const i = order.indexOf(s.id);
    stations[s.id] = { mark: i >= 0 && i < at ? 'done' : 'idle', sub: null, n: 0 };
  }
  const here = stations[current];
  if (run?.state === 'done') for (const id of order) stations[id].mark = 'done';
  else if (blocked) here.mark = 'blocked';
  else if (run?.state === 'stopped') here.mark = 'stopped';
  else here.mark = 'current';
  // A gate open beside the work (a new recipe revision, the merge) waits at its own station.
  if (openGate('recipe') || run?.state === 'waiting-approval') stations.recipe.mark = 'gate';
  if (openGate('merge')) stations.pr.mark = 'gate';

  // The numbers under the stations.
  const ends = (pred) => ev.filter((e) => e.type === 'round.end' && pred(e)).length;
  const under = (id, f) => typeof id === 'string' && (id === f || id.startsWith(`${f}.`));
  const nFeat = features.length;
  const nTask = tree.filter((n) => n.level === 'task').length;
  if (nFeat || nTask) {
    stations.plan.sub = nFeat > 1 ? plural(nFeat, 'feature') : plural(nTask, 'task');
    stations.plan.more = `${plural(nFeat, 'feature')}, ${plural(nTask, 'task')}`;
  }
  const recipeGate = (run?.gates ?? []).find((g) => g?.kind === 'recipe');
  if (recipeGate?.decided) stations.recipe.sub = `${recipeGate.decided.decision}${recipeGate.decided.by ? ` · ${String(recipeGate.decided.by).slice(0, 24)}` : ''}`;
  else if (stations.recipe.mark === 'gate') stations.recipe.sub = 'waits for you';
  if (feature) {
    // Test writer rounds after the feature's first build round are doubt rounds.
    const firstBuild = ev.find((e) => e.type === 'round.start' && e.role === 'builder' && under(e.node, feature))?.at ?? Infinity;
    const tw = ends((e) => e.role === 'test-writer' && e.node === feature && !(e.at > firstBuild));
    const rejected = ev.filter((e) => e.type === 'check' && e.node === feature && TEST_WRITER_CHECK.test(e.name ?? '') && e.pass === false).length;
    stations.tests.n = tw;
    stations.tests.sub = tw ? `${plural(tw, 'round')}${rejected ? `, ${rejected} red` : ''}` : null;
    stations.tests.more = `${feature}: ${plural(tw, 'test writer round')}, ${rejected} rejected by the check (twice in a row goes to a person)`;
    const frozen = tasks.filter((t) => t.state === 'frozen').length;
    if (tasks.length) stations.build.sub = `${frozen} of ${tasks.length} frozen`;
    if (task) stations.taskcheck.sub = task;
    const fixes = task ? ends((e) => e.role === 'fixer' && e.node === task) : 0;
    const builds = task ? ends((e) => e.role === 'builder' && e.node === task) : 0;
    const cap = params.task_rounds.value;
    const esc = params.escalate_after.value;
    stations.fixer.n = fixes;
    stations.fixer.sub = `${builds + fixes} of ${cap}${builds + fixes >= esc ? ' · tier up' : ' rounds'}`;
    stations.fixer.more = `${task}: ${builds + fixes} of ${cap} rounds (builder and fixer); from round ${esc + 1} one tier up; after ${cap} the task is blocked`;
    const doubts = ends((e) => e.role === 'test-writer' && e.node === feature && e.at > firstBuild);
    stations.doubt.n = doubts;
    stations.doubt.sub = doubts ? plural(doubts, 'round') : 'twice → a person';
    const blames = ends((e) => e.role === 'blame' && under(e.node, feature));
    stations.blame.n = blames;
    stations.blame.sub = blames ? plural(blames, 'round') : null;
    const reviews = ends((e) => e.role === 'reviewer' && e.node === feature);
    stations.review.n = reviews;
    stations.review.sub = `${reviews} of ${params.review_cycles.value}`;
    const merged = features.filter((f) => f.state === 'passed').length;
    if (nFeat) stations.merge.sub = `${merged} of ${plural(nFeat, 'feature')}`;
  }
  const suites = ev.filter((e) => e.type === 'check' && e.name === 'suite');
  stations.suite.n = suites.length;
  stations.suite.sub = suites.length ? `${plural(suites.length, 'job')} · last ${suites.at(-1).pass ? 'green' : 'red'}` : `every ${pattern.params.suite.every_tasks} frozen`;
  const gb = ends((e) => e.role === 'blame' && levelOf(byId, e.node) === 'goal');
  stations.goalblame.n = gb;
  if (gb) stations.goalblame.sub = plural(gb, 'round');
  const goalChecks = ev.filter((e) => e.type === 'check' && e.level === 'goal' && !['tree format', 'install'].includes(e.name));
  if (goalChecks.length) {
    stations.goalcheck.sub = goalChecks.slice(-2).map((c) => `${String(c.name).slice(0, 6)} ${c.pass ? '✓' : '✗'}`).join(' ');
    stations.goalcheck.more = goalChecks.slice(-6).map((c) => `${c.name} ${c.pass ? 'green' : 'red'}`).join(', ');
  }
  if (run?.pr?.state) stations.pr.sub = String(run.pr.state).slice(0, 16);
  const stop = typeof run?.stop === 'string' ? run.stop : null;
  if (stop) stations.end.sub = stop;

  const inTask = ['build', 'taskcheck', 'fixer', 'doubt'].includes(current);
  const inFeature = ['tests', 'featurecheck', 'blame', 'review', 'merge'].includes(current);
  return {
    current, state: run?.state ?? null, blocked, exact, stop,
    /** The node the spot is on: the task, the feature, or the goal. */
    node: (inTask ? task : inFeature ? feature : goal?.id) ?? null,
    focus: { feature, task, featureTitle: byId.get(feature)?.title ?? null },
    stations, openRound,
  };
}

/** The Runs row glyph: {dots: [{word, mark}], word, at}. at is the lit dot's index. */
export function glyphOf(pattern, pos) {
  const dots = pattern.glyph.map(([word, ids]) => {
    const marks = ids.map((id) => pos.stations[id]?.mark ?? 'idle');
    const mark = ['blocked', 'gate', 'current', 'stopped'].find((m) => marks.includes(m)) ?? (marks.includes('done') ? 'done' : 'idle');
    return { word, mark };
  });
  const at = pattern.glyph.findIndex(([, ids]) => ids.includes(pos.current));
  return { dots, at, word: at >= 0 ? pattern.glyph[at][0] : null };
}

/** Station label by id. */
export const stationOf = (pattern, id) => pattern.stations.find((s) => s.id === id) ?? null;
