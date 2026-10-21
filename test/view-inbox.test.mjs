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
