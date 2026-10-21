// The Board's ATC data block (fleet plan §4 2.7, task D9): the pure model
// (dataBlock and its helpers) and the card built from it in the fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument } from './helpers/fakedom.mjs';
import { declarations } from './helpers/css-guardrails.mjs';

import {
  CHECKS_MAX, DASH, LAYOUT, STATE_P, STATE_WORD, ageText, cardDetail, checkGlyphs, checksLabel, ctxLevel,
  dataBlock, prModel, renderCard,
} from '../public/js/views/board-card.js';
import boardView, { boardModeFor, boardScope } from '../public/js/views/board.js';
import { isView, views } from '../public/js/views/index.js';
import { store } from '../public/js/core/store.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const NOW = 1_800_000_000_000;

// ---------------------------------------------------------------- the model

test('ctx thresholds: p2 from 65 %, p1 from 85 % (the v2 gauge thresholds)', () => {
  assert.deepEqual([0, 64, 64.9, 65, 84, 85, 100].map(ctxLevel), [null, null, null, '2', '2', '1', '1']);
  assert.equal(ctxLevel(null), null);
  assert.equal(ctxLevel(undefined), null);
  assert.equal(ctxLevel(Number.NaN), null);
  const at = (usedPct) => dataBlock(null, { name: 'x', state: 'working', context: { usedPct } });
  assert.deepEqual([at(64), at(65), at(85)].map((d) => [d.ctx, d.ctxP]), [['64%', null], ['65%', '2'], ['85%', '1']]);
});

test('the state words are the plan\'s 4-character words, one per state, each with a lamp priority', () => {
  assert.deepEqual({ ...STATE_WORD }, {
    waiting_permission: 'PERM', waiting_question: 'QUES', working: 'WORK',
    done: 'DONE', idle: 'IDLE', shell: 'SHEL', dead: 'DEAD',
  });
  for (const [state, word] of Object.entries(STATE_WORD)) {
    assert.equal(word.length, 4, state);
    const d = dataBlock(null, { name: 'x', state });
    assert.equal(d.word, word);
    assert.equal(d.p, STATE_P[state]);
  }
  // Colour only for abnormal: working is grey (run), done is ok, the rest are off.
  assert.equal(STATE_P.waiting_permission, '1');
  assert.equal(STATE_P.waiting_question, '2');
  assert.equal(STATE_P.working, 'run');
  assert.equal(dataBlock(null, { name: 'x', state: 'brand-new' }).word, 'BRAN', 'an unknown state still fits the column');
});

test('checks: one glyph per job, worst first, at most 6, then +n', () => {
  assert.equal(CHECKS_MAX, 6);
  const g = checkGlyphs({ passed: 8, failed: 1, pending: 0, total: 9 });
  assert.deepEqual(g.map((c) => c.g), ['✗', '●', '●', '●', '●', '●', '+3']);
  assert.deepEqual(g.at(-1), { s: 'more', g: '+3', n: 3 });
  assert.deepEqual(checkGlyphs({ passed: 2, failed: 1, pending: 3 }).map((c) => c.g), ['✗', '◌', '◌', '◌', '●', '●'], 'exactly 6: no +n');
  assert.deepEqual(checkGlyphs({ passed: 1 }).map((c) => c.s), ['pass']);
  // Per package/job (§6): an array of {name, state}.
  const jobs = ['lint', 'test', 'web', 'api', 'docs', 'e2e', 'sec', 'img'].map((name, i) => ({ name, state: i === 5 ? 'failure' : 'success' }));
  const j = checkGlyphs(jobs);
  assert.equal(j.length, 7);
  assert.deepEqual(j[0], { s: 'fail', g: '✗', name: 'e2e' }, 'the failing job is first and named');
  assert.equal(j.at(-1).g, '+2');
  assert.deepEqual(checkGlyphs([{ state: 'in_progress' }, { state: 'queued' }, 'weird']).map((c) => c.g), ['◌', '◌', '○']);
  for (const nothing of [null, undefined, {}, [], 'x', 42]) assert.deepEqual(checkGlyphs(nothing), [], String(nothing));
  // Hostile counts do not allocate or loop: a huge number is one +n.
  const big = checkGlyphs({ passed: 1e9 });
  assert.equal(big.length, 7);
  assert.equal(big.at(-1).g, `+${1e9 - 6}`);
  assert.equal(checksLabel({ passed: 8, failed: 1 }), 'checks: 1 failed, 8 passed');
  assert.equal(checksLabel(null), 'no checks');
});

test('missing data renders —', () => {
  const d = dataBlock(null, { name: 'lonely' });
  assert.equal(DASH, '—');
  for (const k of ['code', 'stage', 'ctx', 'usd5h', 'age', 'model', 'word']) assert.equal(d[k], DASH, k);
  assert.equal(d.lane, 'lonely', 'a session with no lane shows its name in the lane column');
  assert.equal(d.pr, null);
  assert.deepEqual(d.checks, []);
  assert.deepEqual(d.flags, []);
  assert.equal(d.p, 'off', 'no state is never a colour');
  const none = dataBlock(null, null);
  assert.equal(none.lane, DASH);
  assert.equal(none.word, DASH);
  assert.equal(dataBlock(null, null, null).lane, DASH, 'null extras');
});

test('every field, when the data is there', () => {
  const lane = { id: 'auth-refactor', progress: { n: 3, m: 7 }, reviewReady: null };
  const s = {
    name: 'auth', state: 'waiting_permission', stateSince: NOW - 12 * 60_000,
    context: { usedPct: 64, size: 200000 }, cost: { usd5h: 1.82 }, claude: { model: 'opus' },
    dirty: 3, ahead: 2, behind: 0,
  };
  const pr = { number: 142, state: 'OPEN', isDraft: false, verdict: 'red', checks: { passed: 2, failed: 1, pending: 1 } };
  const d = dataBlock(lane, s, { code: 'B1', pr, now: NOW });
  assert.deepEqual(
    { code: d.code, lane: d.lane, name: d.name, word: d.word, p: d.p, stage: d.stage, ctx: d.ctx, usd5h: d.usd5h, age: d.age, model: d.model },
    { code: 'B1', lane: 'auth-refactor', name: 'auth', word: 'PERM', p: '1', stage: '3/7', ctx: '64%', usd5h: '$1.82', age: '12m', model: 'opus' },
  );
  assert.deepEqual(d.pr, { number: 142, state: 'open', icon: 'pr', text: '#142', title: 'open PR #142', url: null });
  assert.deepEqual(d.checks.map((c) => c.g), ['✗', '◌', '●', '●']);
  assert.deepEqual(d.git, { dirty: 3, ahead: 2, behind: 0 });
  // A lane's own 5 h burn wins over the session's.
  assert.equal(dataBlock(lane, s, { usd5h: 3.21 }).usd5h, '$3.21');
  // A launched plan with no finished stage is 0/M, not nothing.
  assert.equal(dataBlock({ id: 'x', progress: { n: null, m: 3 } }, null).stage, '0/3');
});

test('flags from stuck, paused, awaitingApproval and reviewReady, in that order', () => {
  const s = {
    name: 'x', state: 'working',
    stuck: { rule: 'tool-loop', reason: 'Edit x5 on one file', since: 1 },
    paused: { scope: 'session', kind: 'manual', by: 'u', at: 1 },
    awaitingApproval: 'appr-1',
  };
  const lane = { id: 'l', reviewReady: { ready: true, reasons: ['PR green', 'plan done'], since: 1 } };
  const d = dataBlock(lane, s);
  assert.deepEqual(d.flags.map((f) => [f.id, f.icon, f.p]), [
    ['stuck', 'stuck', '2'], ['paused', 'pause', null], ['approval', 'approval', '1'], ['review', 'review', null],
  ]);
  assert.equal(d.flags[0].title, 'stuck: Edit x5 on one file');
  assert.equal(d.flags[1].title, 'paused (session)');
  assert.equal(d.flags[3].title, 'ready for review: PR green · plan done');
  assert.equal(d.p, '1', 'an approval held for the session is p1 even while it works');
  // Off when the decorators clear them (`{stuck: null}`), and reviewReady must be ready.
  assert.deepEqual(dataBlock({ id: 'l', reviewReady: { ready: false } }, { name: 'x', state: 'working', stuck: null, paused: null, awaitingApproval: null }).flags, []);
  assert.deepEqual(dataBlock(null, { name: 'x', state: 'idle', stuck: true }).flags.map((f) => f.title), ['stuck'], 'a bare flag still shows');
});

test('a lane card takes its state, age and flags from its most urgent session', () => {
  const sessions = [
    { name: 'a', state: 'done', stateSince: NOW - 3600_000 },
    { name: 'b', state: 'waiting_question', stateSince: NOW - 120_000, context: { usedPct: 90 } },
    { name: 'c', state: 'working', paused: { scope: 'builder' } },
  ];
  const d = dataBlock({ id: 'lane-1' }, null, { sessions, now: NOW });
  assert.equal(d.word, 'QUES');
  assert.equal(d.p, '2');
  assert.equal(d.age, '2m');
  assert.equal(d.ctxP, '1');
  assert.deepEqual(d.flags.map((f) => f.id), ['paused'], 'flags are the union over the sessions');
  assert.equal(dataBlock({ id: 'empty' }, null, { sessions: [] }).word, DASH, 'nothing live: no state');
  assert.equal(dataBlock({ id: 'x' }, null, { sessions, stale: true }).p, 'stale', 'a stale builder hatches the lamp');
});

test('prModel: none, error, draft, merged, closed', () => {
  assert.equal(prModel(null), null);
  assert.equal(prModel({ none: true }), null);
  assert.deepEqual(prModel({ error: 'gh: 401' }), { number: null, state: 'unknown', icon: 'pr', text: 'PR ?', title: 'gh: 401', url: null });
  assert.deepEqual([
    { number: 1, state: 'OPEN', isDraft: true }, { number: 2, state: 'MERGED' }, { number: 3, state: 'CLOSED' }, { number: 4, state: 'OPEN' },
  ].map((p) => [prModel(p).state, prModel(p).icon]), [['draft', 'pr-draft'], ['merged', 'pr-merged'], ['closed', 'pr'], ['open', 'pr']]);
  assert.equal(prModel({ number: '12; x', state: 'OPEN' }).text, DASH, 'a non-integer number is not shown');
});

test('ageText: the ago() steps, — for nothing', () => {
  assert.deepEqual([NOW - 5000, NOW - 12 * 60_000, NOW - 3 * 3600_000, NOW - 2 * 86400_000, NOW + 5000].map((t) => ageText(t, NOW)),
    ['5s', '12m', '3h', '2d', '0s']);
  for (const t of [null, undefined, 0, -1, 'x']) assert.equal(ageText(t, NOW), DASH);
});

test('ageText: plain ASCII units that fit the 4ch age column (runs T16: "3π" was "3m" cut at the edge)', () => {
  assert.equal(ageText(NOW - 3 * 60_000, NOW), '3m');
  for (const ms of [0, 59_000, 60_000, 59 * 60_000, 3600_000, 23 * 3600_000, 86400_000, 99 * 86400_000]) {
    assert.match(ageText(NOW - ms, NOW), /^\d{1,2}[smhd]$/, `${ms} ms`);
  }
});

test('board.css: the state word, code and age never shrink; the title and the branch give way (runs T16)', () => {
  const { decls } = declarations(fs.readFileSync(path.join(ROOT, 'public/css/board.css'), 'utf8'));
  const get = (sel, prop, at = 0) => decls.find((d) => d.prelude === sel && d.prop === prop && d.at.length === at)?.value;
  for (const w of Object.values(STATE_WORD)) assert.equal(w.length, 4, `${w}: the state words are 4 characters`);
  assert.equal(get('.db-state', 'flex'), 'none');
  assert.equal(get('.db-state', 'min-width'), '7ch', 'lamp + 4-char word keep their 7ch');
  assert.equal(get('.db-age', 'flex'), 'none');
  assert.equal(get('.db-age', 'min-width'), '4ch');
  assert.equal(get('.db-f', 'flex'), 'none', 'fields keep their width by default');
  assert.match(get('.db-lane', 'flex'), /^0 1 18ch$/, 'the title is the one field that shrinks');
  assert.equal(get('.db-lane', 'text-overflow'), 'ellipsis');
  assert.equal(get('.db-lane', 'min-width'), '6ch');
  assert.match(get('.db .branch', 'flex'), /^0 (\d+) auto$/);
  assert.ok(Number(/^0 (\d+)/.exec(get('.db .branch', 'flex'))[1]) > 1, 'the branch shrinks before the title');
  assert.equal(get('.db .branch', 'text-overflow'), 'ellipsis');
  assert.equal(get('.db', 'container-type'), 'inline-size');
  // A narrow line drops minor fields whole; code, state, title, flags and age always stay.
  const hidden = decls.filter((d) => d.at.some((a) => a.startsWith('@container')) && d.prop === 'display' && d.value === 'none');
  assert.ok(hidden.length >= 3, 'some fields drop on a narrow line');
  for (const d of hidden) assert.doesNotMatch(d.prelude, /db-(state|code|lane|age|flags)\b/, d.prelude);
  // A nested row wraps its buttons under the line rather than squeezing it.
  assert.equal(get('.grid .card.card-row', 'flex-wrap'), 'wrap');
  assert.match(get('.grid .card.card-row > .db-row', 'flex'), /^1 1 \d+ch$/);
});

test('the layouts: two lines for a card, one for a row, fixed field order', () => {
  assert.deepEqual([...LAYOUT.line1], ['code', 'state', 'lane', 'stage', 'flags', 'age']);
  assert.deepEqual([...LAYOUT.line2], ['pr', 'checks', 'ctx', 'usd', 'model', 'git']);
  assert.deepEqual([...LAYOUT.row], ['code', 'state', 'lane', 'stage', 'pr', 'checks', 'ctx', 'usd', 'age', 'flags']);
});

// ---------------------------------------------------------------- the view

test('board.js has a default view export, and the registry picks it up instead of the legacy adapter', () => {
  assert.ok(isView(boardView));
  assert.equal(boardView.id, 'board');
  assert.equal(boardView.icon, 'board');
  assert.equal(boardView.short, 'BRD');
  const reg = views().get('board');
  assert.equal(reg, boardView);
  assert.notEqual(reg.legacy, true);
});

test('board mode and panel scope', () => {
  assert.equal(boardModeFor('rows'), 'rows');
  for (const x of ['cards', null, undefined, 'nonsense']) assert.equal(boardModeFor(x), 'cards');
  const builders = new Map([['builder-a', { id: 'builder-a', code: 'B1' }]]);
  assert.equal(boardScope({ b: null }, builders), 'all');
  assert.equal(boardScope({ b: 'all' }, builders), 'all');
  assert.equal(boardScope({ b: 'builder-a' }, builders), 'B1');
  assert.equal(typeof boardScope({ b: 'builder-zz' }, builders), 'string', 'an unknown builder still gets a scope');
  assert.equal(boardScope(undefined), 'all');
});

// ---------------------------------------------------------------- the card in the fake DOM

/** Every text under a node, title attributes included (what hover and AT can reach). */
function reachable(n) {
  let out = `${n._text ?? ''} ${n.title ?? ''} ${n.attrs?.['aria-label'] ?? ''}`;
  for (const c of n.children ?? []) out += ` ${reachable(c)}`;
  return out;
}
const find = (n, cls) => n.querySelectorAll(cls);

function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(); } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
}

const FULL = {
  key: 'builder-a/auth', name: 'auth', builder: 'builder-a', state: 'waiting_permission', stateSince: Date.now() - 60_000,
  dir: '/home/user/code/acme', branch: 'feat/auth', dirty: 2, ahead: 1, behind: 4,
  context: { usedPct: 71, size: 200000 },
  cost: { usd: 12.5, usdToday: 3.25 }, statuslineCostUsd: 12.4,
  claude: { model: 'opus', rssMb: 512, swapMb: 64 },
  activity: { tool: 'Edit', toolInput: 'server/auth.mjs', lastUserPrompt: 'fix the login', lastAssistant: 'Done, tests pass.' },
  lastMarker: { kind: 'progress', text: 'S3 done', source: 'marker', ts: 1 },
  previewLines: ['\u001b[31mline one', 'line two'],
  stuck: { rule: 'stalled', reason: 'no output 12 min' },
};

test('a card keeps every field: the data block, the activity line, the detail and the actions', () => withDom(() => {
  const card = renderCard(FULL);
  assert.equal(card.dataset.key, 'builder-a/auth');
  assert.ok(card.classList.contains('card') && card.classList.contains('s-waiting_permission'));
  const [l1] = find(card, 'db-1');
  const [l2] = find(card, 'db-2');
  assert.ok(l1 && l2, 'two lines');
  assert.deepEqual(l1.children.map((c) => c.className.split(' ')[1]), ['db-code', 'db-state', 'db-lane', 'db-stage', 'db-flags', 'db-age']);
  assert.deepEqual(l2.children.map((c) => c.className.split(' ')[1]), ['db-pr', 'db-checks', 'db-ctx', 'db-usd', 'db-model', 'db-git']);
  assert.equal(find(card, 'db-word')[0].textContent, 'PERM');
  assert.equal(find(card, 'db-ctx')[0].dataset.p, '2', 'ctx 71 % is p2');
  assert.equal(find(card, 'db-pr')[0].textContent, DASH, 'no PR on a lone session');
  assert.equal(find(card, 'flag-stuck').length, 1);
  const text = reachable(card);
  for (const want of [
    'auth', 'PERM', 'ctx 71%', 'of 200k', 'opus', '↑1', '↓4', '●2', '~/code/acme', '⌥feat/auth', '512MB', '+64M swap',
    'API-equivalent', '$12.50', 'Edit', 'server/auth.mjs', '“fix the login”', 'Done, tests pass.', 'line one', 'line two',
    'stuck: no output 12 min', 'Yes', 'No', 'open', 'pin', 'More actions',
  ]) assert.ok(text.includes(want), `the card lost ${want}`);
  // One activity line: the running tool wins over the marker (which moves to its title).
  assert.equal(find(card, 'tool-line').length, 1);
  assert.equal(find(card, 'marker-line').length, 0);
  // The L3 detail is present for the inspector stand-in (shown via .cursor).
  const [detail] = find(card, 'card-detail');
  assert.ok(detail);
  assert.equal(find(detail, 'preview').length, 1);
  assert.equal(find(detail, 'say-user').length, 1);
  // Actions are icons first, with the words in title/aria-label.
  const [actions] = find(card, 'card-actions');
  assert.deepEqual(actions.children.map((b) => b.textContent), ['Yes', 'No', 'open', 'pin', 'more']);
  for (const b of actions.children) assert.ok(b.attrs['aria-label'], 'every action has an accessible name');
  assert.ok(actions.children.at(-1).classList.contains('btn-more'));
}));

test('a row is one line of the same fields', () => withDom(() => {
  const row = renderCard({ ...FULL, activity: null, lastMarker: null }, { row: true });
  assert.ok(row.classList.contains('card-row'));
  assert.equal(find(row, 'db-1').length + find(row, 'db-2').length, 0);
  const [line] = find(row, 'db-row');
  assert.deepEqual(line.children.map((c) => c.className.split(' ')[1]), LAYOUT.row.map((f) => `db-${f}`));
}));

test('one builder: no code plate; several: the plate; a stale builder hatches the card by class, not inline style', () => withDom(() => {
  const saved = { builders: store.builders, kind: store.source.kind };
  try {
    store.builders = new Map([['builder-a', { id: 'builder-a', code: 'BA', status: 'live' }]]);
    assert.equal(find(renderCard(FULL), 'db-code')[0].children.length, 0, 'one builder: the code column is empty');
    store.builders = new Map([['builder-a', { id: 'builder-a', code: 'BA', status: 'down' }], ['builder-b', { id: 'builder-b', code: 'BB' }]]);
    store.source.kind = 'hub';
    const card = renderCard(FULL);
    assert.equal(find(card, 'plate')[0].textContent, 'BA');
    assert.ok(card.classList.contains('stale'));
    assert.equal(card.style.opacity, undefined, 'the dimming is board.css, never an inline opacity');
    assert.equal(find(card, 'db-state')[0].dataset.p, 'stale');
  } finally {
    store.builders = saved.builders;
    store.source.kind = saved.kind;
  }
}));

test('builder text stays text: nothing goes through innerHTML', () => withDom(() => {
  const evil = '<img src=x onerror=alert(1)>';
  const card = renderCard({
    ...FULL, name: evil, dir: evil, branch: evil, claude: { model: evil }, activity: { tool: evil, toolInput: evil, lastUserPrompt: evil, lastAssistant: evil },
    danger: { reason: evil }, stuck: { reason: evil }, previewLines: [evil],
  });
  const walk = (n) => { assert.equal(n.innerHTML, '', `${n.tagName} got innerHTML`); n.children.forEach(walk); };
  walk(card);
  assert.ok(card.textContent.includes(evil), 'the hostile text is shown literally');
  const detail = cardDetail({ name: 'x', state: 'idle' });
  assert.equal(detail.children.length, 0, 'an empty session has an empty detail');
}));

test('board.js and board-card.js never write markup or wholesale style', () => {
  for (const f of ['public/js/views/board.js', 'public/js/views/board-card.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML/, f);
    assert.doesNotMatch(src, /setAttribute\(\s*['"`]style/, f);
    assert.doesNotMatch(src, /style\.opacity/, `${f}: .stale is styled in board.css`);
  }
});

test('board.css styles the data block, the stale class and both modes', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/board.css'), 'utf8');
  assert.match(css, /\.card\.stale \{[^}]*var\(--tex-hatch\)[^}]*color: var\(--text-3\)/, 'stale cards are grey and hatched');
  assert.match(css, /\.db-lane \{[^}]*width: 18ch/, 'the lane column is 18ch');
  assert.match(css, /\.card-detail \{ display: none;/);
  assert.match(css, /\.card\.cursor \.card-detail \{ display: grid; \}/, 'the detail shows for the selected card');
  assert.match(css, /\.grid\[data-mode="rows"\]/);
  assert.match(css, /\.db-ctx\[data-p="2"\]::before \{ content: "▲"; \}/, 'colour always comes with a shape');
  assert.match(css, /padding-inline-end: var\(--insp-w\)/, 'the board keeps clear of the open inspector');
});
