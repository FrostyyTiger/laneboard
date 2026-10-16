// The Packages view (fleet §6 2.12, P12): the pure model (filters, sort,
// grouping, glyphs, inspector content) over a real merge() result, and the
// view mounted on the fake DOM (renders, chips navigate, a row opens the
// inspector, hostile names stay text).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { merge } from '../server/hub/packages.mjs';
import * as M from '../public/js/views/packages-model.js';
import { makeDocument, texts } from './helpers/fakedom.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-10-14T12:00:00Z');
const HEAD = 'a'.repeat(40);
const S1 = '1'.repeat(40);
const S2 = '2'.repeat(40);
const S3 = '3'.repeat(40);
const HOSTILE = '<img src=x onerror=alert(1)>';

function job(name, over = {}) {
  return { id: name, name, status: 'completed', conclusion: 'success', verdict: 'ok', partial: false, skippedNames: [], ...over };
}

function acme() {
  return {
    name: 'acme', slug: 'acme/acme', mainRef: 'origin/main', head: { sha: HEAD, at: NOW - 2 * 3600_000 },
    packages: [
      { name: 'web', paths: ['web/**'], source: 'config' },
      { name: 'api', paths: ['api/', '!api/vendor/**'], source: 'config' },
      { name: 'docs', paths: ['docs/**'], source: 'auto' },
      { name: 'cli', paths: ['cli/**'], source: 'auto' },
    ],
    workflows: [{ file: 'ci.yml', name: 'CI', jobs: [
      { id: 'web-check', name: 'web-check', prOnly: false }, { id: 'api-test', name: 'api-test', prOnly: false },
      { id: 'docs-build', name: 'docs-build', prOnly: false }, { id: 'web-e2e', name: 'web-e2e', prOnly: true },
    ] }],
    jobMap: {
      'ci.yml#web-check': { packages: ['web'], via: 'name', prOnly: false },
      'ci.yml#web-e2e': { packages: ['web'], via: 'name', prOnly: true },
      'ci.yml#api-test': { packages: ['api'], via: 'name', prOnly: false },
      'ci.yml#docs-build': { packages: ['docs'], via: 'paths', prOnly: false },
    },
    ci: { provider: 'gh', auth: true, at: NOW - 60_000, rate: { remaining: 4900, low: false }, runs: [{
      id: 101, attempt: 1, workflow: 'CI', file: 'ci.yml', sha: HEAD, event: 'push', status: 'completed',
      conclusion: 'failure', createdAt: NOW - 3600_000, updatedAt: NOW - 3000_000,
      jobs: [
        job('web-check', { conclusion: 'failure', verdict: 'fail' }),
        job('web-e2e'),
        job('api-test', { partial: true, skippedNames: ['Run integration'] }),
        job('docs-build', { conclusion: 'skipped', verdict: 'not-run' }),
      ],
    }] },
    lastTested: { web: { sha: HEAD, at: NOW - 3600_000, runId: 101 }, api: { sha: HEAD, at: NOW - 3600_000, runId: 101 } },
    untested: { docs: 3 },
    branches: [
      { repo: 'acme', branch: 'lane-one', sha: S1, local: true, pushed: true, laneId: 'lane-one', mergeBase: HEAD,
        ahead: 2, behind: 0, lastCommitAt: NOW - 600_000, files: ['web/a.js', 'web/b.js', 'tools/x.sh'], packages: ['web'],
        size: { files: 3, ins: 10, del: 2 } },
      { repo: 'acme', branch: 'lane-two', sha: S2, local: true, pushed: true, laneId: 'lane-two', mergeBase: HEAD,
        ahead: 1, behind: 0, lastCommitAt: NOW - 900_000, files: ['web/a.js', 'api/m.py', 'api/vendor/z.py'], packages: ['web', 'api'],
        size: { files: 3, ins: 4, del: 1 } },
      { repo: 'acme', branch: 'old-thing', sha: S3, local: false, pushed: true, laneId: null, mergeBase: HEAD,
        ahead: 1, behind: 80, lastCommitAt: NOW - 30 * 86400_000, files: ['cli/c.js'], packages: ['cli'],
        size: { files: 1, ins: 1, del: 1 } },
    ],
    conflicts: [{ a: { branch: 'lane-one', sha: S1 }, b: { branch: 'lane-two', sha: S2 }, kind: 'textual', files: ['web/a.js'], at: NOW }],
    deps: [],
    commits: { web: { n7d: 12, lastAt: NOW - 7200_000, lastSha: HEAD }, api: { n7d: 1, lastAt: NOW - 86400_000 * 2, lastSha: HEAD } },
    plans: { counts: { open: 1, partial: 1, done: 1 }, files: [
      { path: 'docs/plans/web-redo.md', state: 'open', word: 'Draft', pkg: 'web' },
      { path: 'docs/plans/api-split.md', state: 'done', word: 'Done', pkg: 'api' },
    ] },
    warnings: [],
  };
}

function beta() {
  return {
    name: HOSTILE, slug: null, head: { sha: S3, at: NOW - 86400_000 },
    packages: [{ name: `pkg${HOSTILE}`, paths: ['**'], source: 'auto' }],
    workflows: [], jobMap: {}, ci: { provider: 'gh', auth: false, runs: [] },
    branches: [], conflicts: [], commits: {}, plans: { counts: {}, files: [] },
  };
}

function fixture() {
  return merge([{
    builder: 'builder-a',
    data: {
      repos: { acme: acme(), beta: beta() },
      lanes: [
        { id: 'lane-one', branch: 'lane-one', sessions: ['s1'], idle: false },
        { id: 'lane-two', branch: 'lane-two', sessions: ['s2'], idle: false, markers: [{ kind: 'done' }] },
      ],
      prs: {
        'lane-one': { number: 7, state: 'OPEN', verdict: 'red', checks: { failedNames: ['web-check'] } },
        'lane-two': { number: 8, state: 'OPEN', verdict: 'red', failedJobs: [{ workflow: 'CI', job: 'api-test' }] },
      },
    },
  }], { now: NOW });
}

const row = (data, pkg) => data.rows.find((r) => r.package === pkg);

// ---------------------------------------------------------------- the fixture itself

test('the fixture is a real merge() result with the shapes the view reads', () => {
  const d = fixture();
  assert.ok(Array.isArray(d.rows) && d.rows.length >= 5);
  assert.equal(row(d, 'web').lamp, 'crit');
  assert.equal(row(d, 'api').lamp, 'warn', 'a red PR with a failed job mapped here');
  assert.equal(row(d, 'docs').main.status, 'not-run');
  assert.deepEqual(row(d, 'web').lanes, ['builder-a/lane-one', 'builder-a/lane-two']);
  assert.ok(d.stale.some((s) => s.branch === 'old-thing'));
});

// ---------------------------------------------------------------- filters

test('parseFilters: flags from s (unknown dropped), repo: tokens and text from q', () => {
  const f = M.pkParseFilters({ s: 'crit,bogus,touched', q: 'repo:acme Web  repo:x' });
  assert.deepEqual([...f.flags], ['crit', 'touched']);
  assert.deepEqual([...f.repos], ['acme', 'x']);
  assert.deepEqual(f.text, ['web']);
  const empty = M.pkParseFilters(null);
  assert.equal(empty.flags.size + empty.repos.size + empty.text.length, 0);
});

test('filters: crit/warn are OR, the other chips narrow', () => {
  const d = fixture();
  const names = (route) => M.pkGroups(d, route).flatMap((g) => g.rows.map((r) => r.package));
  assert.deepEqual(names({ s: 'crit' }), ['web']);
  assert.deepEqual(names({ s: 'crit,warn' }).sort(), ['api', 'web']);
  assert.deepEqual(names({ s: 'not-run' }), ['docs']);
  assert.ok(names({ s: 'touched' }).every((p) => ['web', 'api', '_other'].includes(p)));
  assert.ok(names({ s: 'touched' }).includes('api'));
  assert.ok(names({ s: 'conflicts' }).includes('web'));
  assert.ok(!names({ s: 'conflicts' }).includes('docs'));
  assert.deepEqual(names({ s: 'crit,touched' }), ['web'], 'AND across kinds');
  assert.ok(names({ s: 'stale' }).length > 0 && names({ s: 'stale' }).every((p) => p !== `pkg${HOSTILE}`), 'stale = rows in repos with stale branches');
  assert.deepEqual(names({ q: `repo:${'acme'}` }).includes(`pkg${HOSTILE}`), false);
  assert.deepEqual(names({ q: 'doc' }), ['docs'], 'free text matches the package name');
  assert.deepEqual(M.pkGroups(d, { q: 'nothing-matches' }), []);
});

test('sort: lamp severity, then repo, then package with _other last', () => {
  const rows = [
    { repo: 'b', package: 'z', lamp: 'ok' }, { repo: 'a', package: '_other', lamp: 'low' },
    { repo: 'a', package: 'y', lamp: 'low' }, { repo: 'a', package: 'x', lamp: 'crit' },
    { repo: 'a', package: 'w', lamp: 'bogus' }, null,
  ];
  assert.deepEqual(M.pkSortRows(rows).map((r) => r.package), ['x', 'y', '_other', 'z', 'w']);
  assert.equal(M.pkLampRank('crit'), 0);
  assert.equal(M.pkLampRank('nope'), M.LAMPS.length);
});

test('groups: by repo, worst group first, every repo kept when unfiltered', () => {
  const d = fixture();
  const g = M.pkGroups(d, {});
  assert.deepEqual(g.map((x) => x.repo), ['acme', HOSTILE]);
  assert.equal(g[0].rows[0].package, 'web');
  assert.equal(g[0].header.stale, 1);
  assert.deepEqual(g[0].header.plans, { open: 1, partial: 1, done: 1, deferred: 0, unknown: 0 });
  assert.equal(g[1].header.ci.p, '3', 'auth missing is a ◆');
  assert.match(g[1].header.ci.label, /auth/);
  // a repo without rows still has a header when nothing filters
  const d2 = { ...d, rows: d.rows.filter((r) => r.repo === 'acme') };
  assert.deepEqual(M.pkGroups(d2, {}).map((x) => x.repo).sort(), ['acme', HOSTILE].sort());
  assert.deepEqual(M.pkGroups(d2, { s: 'crit' }).map((x) => x.repo), ['acme']);
  assert.deepEqual(M.pkCounts(d, { s: 'crit' }), { total: d.rows.length, shown: 1 });
});

test('chips: one per flag then one per repo, with counts, and toggling builds the route patch', () => {
  const d = fixture();
  const c = M.pkChips(d, { s: 'crit', q: 'repo:acme' });
  assert.deepEqual(c.slice(0, 6).map((x) => x.id), M.FLAGS);
  assert.equal(c.find((x) => x.id === 'crit').on, true);
  assert.equal(c.find((x) => x.id === 'crit').n, 1);
  assert.equal(c.find((x) => x.id === 'repo:acme').on, true);
  assert.ok(c.find((x) => x.id === `repo:${HOSTILE}`));
  assert.deepEqual(M.pkToggleChip({ s: 'crit' }, 'warn'), { s: 'crit,warn', q: null });
  assert.deepEqual(M.pkToggleChip({ s: 'crit,warn' }, 'crit'), { s: 'warn', q: null });
  assert.deepEqual(M.pkToggleChip({ s: 'warn' }, 'warn'), { s: null, q: null });
  assert.deepEqual(M.pkToggleChip({ q: 'web' }, 'repo:acme'), { s: null, q: 'repo:acme web' });
  assert.deepEqual(M.pkToggleChip({ q: 'repo:acme web' }, 'repo:acme'), { s: null, q: 'web' });
  assert.deepEqual(M.pkToggleChip({ s: 'crit', q: 'x' }, 'bogus'), { s: 'crit', q: 'x' });
  // the s the patch builds fits the router's state grammar
  const s = M.pkToggleChip({ s: 'crit,warn,not-run,touched,conflicts' }, 'stale').s;
  assert.match(s, /^[a-z0-9_-]{1,24}(?:,[a-z0-9_-]{1,24}){0,15}$/);
});

// ---------------------------------------------------------------- glyphs

test('glyphs: lamp, main, jobs strip, lanes, PRs, conflicts, plans, last change', () => {
  const d = fixture();
  const web = row(d, 'web');
  const lg = M.pkLampGlyph(web);
  assert.deepEqual([lg.p, lg.shape], ['1', '■']);
  assert.match(lg.label, /^critical; main red: web-check/);
  assert.equal(M.pkLampGlyph({ lamp: 'weird' }).p, 'off');

  const mg = M.pkMainGlyph(web.main, NOW);
  assert.equal(mg.status, 'fail');
  assert.equal(mg.text, `■ ${HEAD.slice(0, 7)} 2h`);
  const docs = M.pkMainGlyph(row(d, 'docs').main, NOW);
  assert.equal(docs.shape, '◆');
  assert.match(docs.text, / \+3$/);
  assert.match(docs.label, /3 commits since last tested run/);
  assert.equal(M.pkMainGlyph({ status: 'nonsense' }, NOW).status, 'unknown');
  assert.equal(M.pkMainGlyph(null, NOW).text, '?');

  assert.deepEqual(M.pkJobCells(web.main).map((j) => j.cls), ['fail'], 'PR-only jobs are not in the strip');
  assert.deepEqual(M.pkJobCells(row(d, 'api').main).map((j) => j.cls), ['partial']);
  const nr = M.pkJobCells(row(d, 'docs').main);
  assert.deepEqual(nr.map((j) => [j.cls, j.glyph]), [['notrun', '∅']]);
  assert.match(nr[0].label, /CI · docs-build: not-run/);

  const lc = M.pkLanesCell(web);
  assert.equal(lc.n, 2);
  assert.deepEqual(lc.lanes[0], { fkey: 'builder-a/lane-one', builder: 'builder-a', name: 'lane-one' });

  const pc = M.pkPrsCell(web);
  assert.deepEqual([pc.n, pc.red, pc.text], [2, 1, '2/1'], 'lane-two is red, but not for a web job');
  assert.equal(M.pkPrsCell({ prs: [] }).text, '');

  const cc = M.pkConflictsCell(web);
  assert.deepEqual([cc.textual, cc.text, cc.p], [1, '▲1', '2']);
  assert.deepEqual(M.pkConflictsCell({ conflicts: { textual: 0, overlap: 2 } }).text, '◆2');
  assert.equal(M.pkConflictsCell({}).p, null);

  assert.equal(M.pkPlansCell(web).text, '1/0/0');
  assert.equal(M.pkPlansCell({}).text, '');
  assert.equal(M.pkLastChangeCell(web, NOW).text, '2h');
  assert.equal(M.pkLastChangeCell({}, NOW).text, '');
});

test('age and abbrevSha', () => {
  assert.equal(M.pkAge(NOW - 5000, NOW), '5s');
  assert.equal(M.pkAge(new Date(NOW - 3 * 60_000).toISOString(), NOW), '3m');
  assert.equal(M.pkAge(NOW - 3 * 86400_000, NOW), '3d');
  assert.equal(M.pkAge(null, NOW), '');
  assert.equal(M.pkAge('garbage', NOW), '');
  assert.equal(M.pkSha(HEAD), 'aaaaaaa');
  assert.equal(M.pkSha(42), '');
});

test('inPackage: literal prefix up to the first wildcard, ! excludes, last match wins', () => {
  assert.equal(M.pkInPackage('web/a.js', ['web/**']), true);
  assert.equal(M.pkInPackage('webby/a.js', ['web']), false);
  assert.equal(M.pkInPackage('web/a.js', ['web']), true);
  assert.equal(M.pkInPackage('api/vendor/z.py', ['api/', '!api/vendor/**']), false);
  assert.equal(M.pkInPackage('api/m.py', ['api/', '!api/vendor/**']), true);
  assert.equal(M.pkInPackage('x', [null, '', 5]), false);
  assert.equal(M.pkInPackage(null, ['**']), false);
});

// ---------------------------------------------------------------- inspector

test('inspector: jobs with verdicts and skipped steps, lanes with files in the package, PRs, conflicts, plans', () => {
  const d = fixture();
  const m = M.pkInspectorModel(row(d, 'api'), d, { now: NOW, codeOf: (id) => (id === 'builder-a' ? 'BA' : '') });
  assert.equal(m.title, 'api');
  assert.equal(m.slug, 'acme/acme');
  assert.deepEqual(m.jobs.map((j) => [j.name, j.verdict, j.partial]), [['api-test', 'ok', true]]);
  assert.deepEqual(m.jobs[0].skipped, ['Run integration']);
  assert.equal(m.tested, 'last tested aaaaaaa 1h · 0 untested commits');
  assert.deepEqual(m.lanes.map((l) => [l.fkey, l.code, l.files]), [['builder-a/lane-two', 'BA', ['api/m.py']]]);
  assert.deepEqual(m.plans, [{ path: 'docs/plans/api-split.md', state: 'done', word: 'Done' }]);
  assert.equal(m.other, null);

  const w = M.pkInspectorModel(row(d, 'web'), d, { now: NOW });
  assert.deepEqual(w.jobs.map((j) => [j.name, j.prOnly]).sort(), [['web-check', false], ['web-e2e', true]]);
  assert.deepEqual(w.prs, [
    { n: 7, fkey: 'builder-a/lane-one', verdict: 'red', failed: ['web-check'] },
    { n: 8, fkey: 'builder-a/lane-two', verdict: 'red', failed: [] },
  ]);
  assert.equal(w.conflicts.length, 1);
  assert.equal(w.conflicts[0].kind, 'textual');
  assert.deepEqual(w.conflicts[0].files, ['web/a.js']);
  assert.deepEqual(w.lanes.find((l) => l.name === 'lane-one').files, ['web/a.js', 'web/b.js']);

  const docs = M.pkInspectorModel(row(d, 'docs'), d, { now: NOW });
  assert.equal(docs.tested, 'never tested in the window');

  const other = row(d, '_other');
  assert.ok(other, 'tools/x.sh is outside every package');
  const om = M.pkInspectorModel(other, d, { now: NOW });
  assert.deepEqual(om.other, ['api/vendor/z.py', 'tools/x.sh'], 'the api exclusion lands in _other');
  assert.deepEqual(om.lanes.map((l) => l.files), [['tools/x.sh'], ['api/vendor/z.py']]);

  assert.equal(M.pkInspectorModel(null, d), null);
});

test('repo inspector: merge order by rank, hotspots, stale branches with a copyable command', () => {
  const d = fixture();
  const m = M.pkRepoInspector('acme', d, { now: NOW });
  assert.ok(m.hotspots.some((h) => h.file === 'web/a.js' && h.lanes.length === 2));
  assert.deepEqual(m.order.map((o) => o.rank), [...m.order.map((o) => o.rank)].sort((a, b) => a - b));
  assert.ok(m.order.some((o) => o.fkey === 'builder-a/lane-two'), 'the done lane is a candidate');
  const st = m.stale.find((s) => s.branch === 'old-thing');
  assert.equal(st.suggestion, 'delete-branch');
  assert.match(st.command, /^git push origin --delete old-thing$/);
  assert.equal(st.age, '30d');
  assert.equal(M.pkRepoInspector('nope', d), null);
});

// ---------------------------------------------------------------- data

test('normalizeData and pkLoad (read-only GET, null on any failure)', async () => {
  assert.equal(M.pkNormalize(null), null);
  assert.equal(M.pkNormalize({ rows: 'x' }), null);
  const d = fixture();
  assert.equal(M.pkNormalize(d), d);
  const calls = [];
  const ok = async (url, init) => { calls.push([url, init?.method ?? 'GET']); return { ok: true, json: async () => d }; };
  assert.equal(await M.pkLoad(ok), d);
  assert.deepEqual(calls, [['/api/packages', 'GET']]);
  assert.equal(await M.pkLoad(async () => ({ ok: false, json: async () => d })), null);
  assert.equal(await M.pkLoad(async () => { throw new Error('offline'); }), null);
  assert.equal(await M.pkLoad(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } })), null);
  assert.equal(await M.pkLoad('nope'), null);
});

// ---------------------------------------------------------------- the view on the fake DOM

function walk(n, fn) {
  fn(n);
  for (const c of n.children ?? []) walk(c, fn);
}
function find(n, pred) {
  const out = [];
  walk(n, (x) => { if (pred(x)) out.push(x); });
  return out;
}
const byClass = (n, c) => find(n, (x) => x.classList?.contains(c));

/** The view module with addEventListener recording listeners, on a fake document. */
async function mountView(storeData, route = {}) {
  const doc = makeDocument();
  const prevDoc = globalThis.document;
  const prevFetch = globalThis.fetch;
  globalThis.document = doc;
  const fetches = [];
  globalThis.fetch = async (url, init) => { fetches.push([String(url), init?.method ?? 'GET']); return { ok: true, json: async () => fixture() }; };
  const orig = doc.createElement;
  doc.createElement = (t) => {
    const e = orig(t);
    e.listeners = {};
    e.addEventListener = (k, fn) => { (e.listeners[k] ||= []).push(fn); };
    return e;
  };
  const { default: view } = await import('../public/js/views/packages.js');
  const host = doc.createElement('section');
  const navs = [];
  const store = { packages: storeData, lanes: [{ key: 'builder-a/lane-one', builder: 'builder-a', id: 'lane-one', hue: 120 }], builders: new Map([['builder-a', { id: 'builder-a', code: 'B1' }]]) };
  view.mount(host, { store, route, navigate: (p) => navs.push(p) });
  const restore = () => { globalThis.document = prevDoc; globalThis.fetch = prevFetch; };
  return { view, host, store, navs, fetches, restore };
}

const fire = (n, k, ev = {}) => { for (const fn of n.listeners?.[k] ?? []) fn({ preventDefault() {}, stopPropagation() {}, ...ev }); };

test('view: default export shape; renders the fixture as a panel with grouped rows and glyphs', async () => {
  const { view, host, restore, fetches } = await mountView(fixture());
  try {
    assert.equal(view.id, 'packages');
    for (const k of ['mount', 'unmount', 'update']) assert.equal(typeof view[k], 'function');
    assert.ok(host.children[0].classList.contains('panel'), 'the view renders into a .panel');
    assert.deepEqual(fetches, [], 'store data present: no GET');
    const repos = byClass(host, 'pk-repo');
    assert.equal(repos.length, 2);
    const rows = byClass(host, 'pk-row');
    assert.equal(rows.length, fixture().rows.length);
    assert.equal(rows[0].dataset.key, M.pkRowKey(row(fixture(), 'web')));
    assert.ok(byClass(host, 'pk-job--fail').length >= 1);
    assert.ok(byClass(host, 'pk-job--notrun').length >= 1);
    assert.ok(byClass(host, 'pk-dot').length >= 2, 'lane hue dots');
    assert.ok(byClass(host, 'pk-chip').length >= 8);
    // hostile names are plain text, never markup
    const all = texts(host).join('\n');
    assert.ok(all.includes(HOSTILE));
    walk(host, (n) => assert.equal(n.innerHTML ?? '', '', 'nothing writes innerHTML'));
  } finally { restore(); view.unmount(); }
});

test('view: a chip navigates the route patch; update with a new route filters', async () => {
  const d = fixture();
  const { view, host, navs, store, restore } = await mountView(d);
  try {
    const crit = byClass(host, 'pk-chip').find((b) => b.dataset.chip === 'crit');
    fire(crit, 'click');
    assert.deepEqual(navs, [{ s: 'crit', q: null }]);
    view.update(store, { route: { s: 'crit' } });
    assert.equal(byClass(host, 'pk-row').length, 1);
    assert.equal(byClass(host, 'pk-chip').find((b) => b.dataset.chip === 'crit').getAttribute('aria-pressed'), 'true');
    // same data and route: no repaint (the same nodes stay)
    const before = byClass(host, 'pk-row')[0];
    view.update(store, {});
    assert.equal(byClass(host, 'pk-row')[0], before);
    // a packages message replaces the data: repaint
    store.packages = { ...d, rows: [] };
    view.update(store, {});
    assert.equal(byClass(host, 'pk-row').length, 0);
  } finally { restore(); view.unmount(); }
});

test('view: clicking a row opens the inspector; the repo button opens the repo inspector; close hides it', async () => {
  const { view, host, restore } = await mountView(fixture());
  try {
    const insp = byClass(host, 'pk-insp')[0];
    assert.equal(insp.hidden, true);
    const web = byClass(host, 'pk-row').find((r) => r.dataset.key === M.pkRowKey(row(fixture(), 'web')));
    fire(web, 'click');
    assert.equal(insp.hidden, false);
    const t = texts(insp).join('\n');
    assert.match(t, /web-check/);
    assert.match(t, /lane-one/);
    assert.match(t, /#7/);
    assert.match(t, /B1/, 'builder code from the store');
    // keyboard: j moves to the next row
    const sel = byClass(host, 'pk-row').find((r) => r.getAttribute('aria-selected') === 'true');
    fire(sel, 'keydown', { key: 'j' });
    assert.notEqual(byClass(host, 'pk-row').find((r) => r.getAttribute('aria-selected') === 'true').dataset.key, sel.dataset.key);
    const order = byClass(host, 'pk-order')[0];
    fire(order, 'click');
    assert.match(texts(byClass(host, 'pk-insp')[0]).join('\n'), /MERGE ORDER[\s\S]*git push origin --delete old-thing/);
    fire(byClass(host, 'pk-close')[0], 'click');
    assert.equal(byClass(host, 'pk-insp')[0].hidden, true);
  } finally { restore(); view.unmount(); }
});

test('view: no store data -> one GET /api/packages, then renders; unmount empties the section', async () => {
  const { view, host, fetches, restore } = await mountView(null);
  try {
    assert.deepEqual(fetches, [['/api/packages', 'GET']]);
    assert.match(texts(host).join(' '), /Loading packages/);
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(byClass(host, 'pk-row').length > 0);
    view.unmount();
    assert.equal(host.children.length, 0);
  } finally { restore(); }
});

test('static: no markup sinks or request/action calls in the view; the sheet is linked', () => {
  const view = fs.readFileSync(path.join(ROOT, 'public/js/views/packages.js'), 'utf8');
  const model = fs.readFileSync(path.join(ROOT, 'public/js/views/packages-model.js'), 'utf8');
  for (const src of [view, model]) {
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.doesNotMatch(src, /actions\.js/);
  }
  assert.doesNotMatch(view, /\b(?:act|hubAct|post|del|sendKeys|sendText|fetch)\s*\(/);
  assert.doesNotMatch(model, /method:\s*['"](?:POST|PUT|DELETE|PATCH)/i);
  assert.match(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'), /href="\/css\/views\/packages\.css"/);
});
