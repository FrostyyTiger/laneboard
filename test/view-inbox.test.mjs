// The Inbox view drawn on the fake DOM (runs night 4 T16, r10-designer Inbox
// 1-4): an empty group is one muted line with the same wording, below the
// filled groups; run needs sit next to NEEDS YOU, run PRs after REVIEW; the
// focused row is a ring, never a fill or the corner brackets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';
import { declarations } from './helpers/css-guardrails.mjs';

globalThis.document = makeDocument({ byId: new Map() });

const NOW = Date.now();
const RUNS = [{
  run: 'acme-search', goal: 'g', state: 'running', startedAt: NOW - 3600_000, updatedAt: NOW - 60_000,
  needs: [{ i: 0, kind: 'decision', text: 'keep the old export?', link: null, n: 1, ts: NOW - 1000, open: true, acked: false }],
  prs: [{ url: 'https://example.invalid/acme/acme-api/pull/42', title: 'Paged search', ts: NOW - 2000 }],
}];
globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({ runs: RUNS }) });

const V = (await import('../public/js/views/inbox.js')).default;
const { emptyLine, GROUP_TITLES } = await import('../public/js/core/inbox-model.js');

const all = (n, pred, out = []) => {
  for (const c of n.children ?? []) { if (pred(c)) out.push(c); all(c, pred, out); }
  return out;
};
const settle = () => new Promise((r) => setTimeout(r, 20));

test('T16: filled groups first in the new order, each empty one a single "<Title> · none" line', async () => {
  const el = makeEl('div');
  V.mount(el, { route: { view: 'inbox' } });
  try {
    await settle();
    const secs = all(el, (n) => n.tagName === 'SECTION' && n.classList.contains('inbox-group'));
    const ids = secs.map((s) => s.dataset.group);
    assert.deepEqual(ids, ['runs', 'runprs', 'approvals', 'needs', 'review', 'paused', 'stale']);
    for (const s of secs.slice(2)) {
      assert.ok(Object.hasOwn(s.dataset, 'empty'), `${s.dataset.group} is marked empty`);
      assert.equal(s.children.length, 1, `${s.dataset.group}: one line, no header, no rule`);
      assert.ok(s.children[0].classList.contains('inbox-empty'));
      assert.equal(s.textContent, emptyLine(GROUP_TITLES[s.dataset.group]));
    }
    assert.equal(secs[4].textContent, 'Review · none');
    assert.doesNotMatch(el.textContent, /Nothing here|No lanes are waiting/);
    // the filled groups keep their header and rows; the first row has focus
    assert.equal(secs[0].children[0].tagName, 'H3');
    const rows = all(el, (n) => n.classList?.contains('inbox-row'));
    assert.deepEqual(rows.map((r) => r.dataset.group), ['runs', 'runprs']);
    assert.equal(rows[0].getAttribute('aria-selected'), 'true');
    assert.ok(!rows[0].classList.contains('sel'), 'no corner brackets on the focused row');
  } finally {
    V.unmount();
  }
});

test('T16: the model draws the stale group grey (no ▲) and run PRs after review', async () => {
  const { buildInbox, GROUPS } = await import('../public/js/core/inbox-model.js');
  assert.ok(GROUPS.indexOf('runs') === GROUPS.indexOf('needs') + 1, 'run needs right after NEEDS YOU');
  assert.ok(GROUPS.indexOf('runprs') === GROUPS.indexOf('review') + 1, 'run PRs right after REVIEW');
  const b = {
    id: 'builder-a', online: true, lanes: [],
    sessions: new Map([['web', { name: 'web', state: 'working', stuck: { rule: 'repeat', reason: 'same tool call 14x in 6m', since: NOW - 60_000 } }]]),
  };
  const s = { builders: new Map([['builder-a', b]]), attention: [], lanes: [], packages: null };
  const m = buildInbox(s, { now: NOW });
  const stale = m.groups.find((g) => g.id === 'stale');
  assert.ok(stale.rows.length >= 1, 'the stuck session is listed');
  for (const r of stale.rows) assert.equal(r.p, 'off', `${r.id}: grey, no amber`);
  assert.equal(m.groups[0].id, 'stale', 'the one filled group comes first');
});

test('T16: the focused inbox row is a 2 px accent ring with no fill', () => {
  const dir = path.join(import.meta.dirname, '..', 'public', 'css');
  const sheets = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.css'));
  const decls = sheets.flatMap((f) => declarations(fs.readFileSync(path.join(dir, f), 'utf8')).decls);
  const sel = '.inbox-row[aria-selected="true"]';
  const of = decls.filter((d) => d.prelude.split(',').map((x) => x.trim()).includes(sel));
  assert.ok(of.length, 'a rule for the focused row');
  assert.ok(!of.some((d) => /^background/.test(d.prop)), 'no fill on the focused row, in any theme');
  assert.match(of.find((d) => d.prop === 'outline')?.value ?? '', /^2px solid var\(--accent\)$/);
});

test('T27: the approval\'s tool chip (BASH) is an outlined quiet plate in both themes (night 5 T31), never a fill; the header builder chip is never filled', async () => {
  const { store } = await import('../public/js/core/store.js');
  const saved = store.builders;
  store.builders = new Map([['builder-a', {
    id: 'builder-a', status: 'live', sessions: new Map(), lanes: new Map(),
    approvals: new Map([['a1', { id: 'a1', builder: 'builder-a', session: 'search-ui', tool: 'Bash', summary: 'npm run build', status: 'pending' }]]),
  }]]);
  const el = makeEl('div');
  V.mount(el, { route: { view: 'inbox' } });
  try {
    await settle();
    const row = all(el, (n) => n.classList?.contains('inbox-row') && n.dataset.group === 'approvals')[0];
    assert.ok(row, 'the approval row is drawn');
    const plates = all(row, (n) => n.classList?.contains('plate'));
    const tool = plates.find((p) => p.textContent === 'Bash');
    assert.ok(tool, 'the tool chip');
    assert.ok(tool.classList.contains('plate--quiet'), `tool chip class: ${tool.className}`);
    assert.ok(!plates.some((p) => p.classList.contains('plate--solid')), 'no solid plate in an Inbox row');
  } finally {
    V.unmount();
    store.builders = saved;
  }
  const kit = fs.readFileSync(path.join(import.meta.dirname, '..', 'public/css/components.css'), 'utf8');
  const quiet = declarations(kit).decls.filter((d) => d.prelude === '.plate--quiet');
  assert.equal(quiet.find((d) => d.prop === 'background')?.value, 'transparent', 'no fill in either theme');
  assert.equal(quiet.find((d) => d.prop === 'border-color')?.value, 'var(--line)');
  assert.equal(quiet.find((d) => d.prop === 'color')?.value, 'var(--text-2)');
  // No theme rule puts a fill back on it (light included).
  const css = fs.readdirSync(path.join(import.meta.dirname, '..', 'public/css'), { recursive: true })
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(import.meta.dirname, '..', 'public/css', f), 'utf8')).join('\n');
  const fills = declarations(css).decls.filter((d) => /plate--quiet/.test(d.prelude) && /^background/.test(d.prop) && d.value !== 'transparent');
  assert.deepEqual(fills.map((d) => `${d.prelude} { ${d.prop}: ${d.value} }`), [], 'a fill on the quiet plate');

  // The header builder chip: outlined, its mark carries the state.
  const shell = fs.readFileSync(path.join(import.meta.dirname, '..', 'public/css/shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const chipRules = [...shell.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sel]) => sel.split(',').some((x) => /\.(builder-chip|conn)\b/.test(x) && !/::?before/.test(x)));
  assert.ok(chipRules.length >= 2, 'shell.css styles the chip');
  for (const [, sel, body] of chipRules) assert.doesNotMatch(body, /background/, `${sel.trim()} fills the chip`);
  assert.match(shell, /\.builder-chip\.status-stale::before \{[^}]*background: transparent;[^}]*border: var\(--bw\) solid var\(--off\)/,
    'offline is a hollow grey ○');
  assert.match(shell, /\.conn\.down::before \{ border-radius: 0; background: var\(--p1\); \}/, 'red ■ only when down');
});

test('T16 (night 5): a RUN PRS row is the title alone, its link `open ↗` keeps only the ↗ on a phone', async () => {
  const el = makeEl('div');
  V.mount(el, { route: { view: 'inbox' } });
  try {
    await settle();
    const row = all(el, (n) => n.classList?.contains('inbox-row') && n.dataset.group === 'runprs')[0];
    assert.ok(row, 'the run PR row is drawn');
    assert.doesNotMatch(row.textContent, /pr:/);
    const sum = all(row, (n) => n.classList?.contains('inbox-sum'))[0];
    assert.equal(sum.textContent, 'Paged search');
    const link = all(row, (n) => n.classList?.contains('inbox-link'))[0];
    assert.equal(link.href, 'https://example.invalid/acme/acme-api/pull/42');
    assert.equal(link.textContent, 'open ↗');
    assert.equal(link.getAttribute('aria-label'), 'open');
    assert.equal(all(link, (n) => n.classList?.contains('inbox-link-w'))[0].textContent, 'open ');
  } finally {
    V.unmount();
  }
  const css = fs.readFileSync(path.join(import.meta.dirname, '..', 'public/css/views/fleet-views.css'), 'utf8');
  const hide = declarations(css).decls.filter((d) => d.prelude === '.inbox-row[data-group="runprs"] .inbox-link-w');
  assert.equal(hide.length, 1, 'one rule hides the word');
  assert.equal(hide[0].prop, 'display');
  assert.equal(hide[0].value, 'none');
  assert.ok(hide[0].at.some((a) => /max-width: 700px/.test(a)), 'only on a phone');
});

// review 27-designer Across 3 (runs n5 T27)
test('T27: an Inbox question row reads QUES after the shape, then the question; `question` only without text', async () => {
  const { store } = await import('../public/js/core/store.js');
  const saved = { builders: store.builders, attention: store.attention };
  store.builders = new Map([['builder-a', {
    id: 'builder-a', online: true, lanes: [], approvals: [],
    sessions: new Map([
      ['ask', { name: 'ask', state: 'waiting_question', activity: { lastAssistant: 'Keep the old export?' } }],
      ['mute', { name: 'mute', state: 'waiting_question' }],
    ]),
  }]]);
  store.attention = ['ask', 'mute'].map((name, i) => ({ builder: 'builder-a', name, state: 'waiting_question', score: 90 - i, since: 1 }));
  const el = makeEl('div');
  V.mount(el, { route: { view: 'inbox' } });
  try {
    await settle();
    const rows = all(el, (n) => n.classList?.contains('inbox-row') && n.dataset.group === 'needs');
    assert.equal(rows.length, 2);
    const [ask, mute] = rows.map((r) => r.children[0].children);
    assert.ok(ask[0].classList.contains('lamp'), 'the shape first');
    assert.ok(ask[1].classList.contains('inbox-wd'), 'then the word');
    assert.equal(ask[1].textContent, 'QUES');
    assert.equal(ask[1].dataset.p, '2', 'amber like the mark');
    const sum = (cells) => cells.find((c) => c.classList.contains('inbox-sum'));
    assert.equal(sum(ask).textContent, 'Keep the old export?');
    assert.ok(!sum(ask).classList.contains('inbox-sum--fallback'));
    assert.doesNotMatch(rows[0].textContent, /question/);
    assert.equal(mute[1].textContent, 'QUES');
    assert.equal(sum(mute).textContent, 'question');
    assert.ok(sum(mute).classList.contains('inbox-sum--fallback'), 'the fallback word is muted');
  } finally {
    V.unmount();
    Object.assign(store, saved);
  }
});

test('T27: the fallback text is --text-3 and the word is coloured by its mark', () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'css', 'views', 'fleet-views.css'), 'utf8');
  const decls = declarations(css).decls;
  const of = (sel, prop) => decls.find((d) => d.prelude.trim() === sel && d.prop === prop)?.value;
  assert.equal(of('.inbox-sum--fallback', 'color'), 'var(--text-3)');
  assert.equal(of('.inbox-wd[data-p="2"]', 'color'), 'var(--p2)');
  assert.equal(of('.inbox-wd', 'font-family'), 'var(--font-mono)');
});
