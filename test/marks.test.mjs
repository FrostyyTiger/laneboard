// runs night 4 T23 (r17-designer across 2, 5, Board 1-2, Map): one state, one
// mark in every view. Each state is drawn the same way by the Inbox rows, the
// Board's NEEDS YOU list and cards, the phone bar, the rail and the Map:
// permission/approval/question = amber ▲ ('2'), blocked/down/danger = red ■
// ('1'), working = grey ● ('run'), idle = grey ○ ('off').
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STATE_MARK, itemP, markP } from '../public/js/core/marks.js';
import { P_SHAPE, normP } from '../public/js/ui/components.js';
import { buildInbox } from '../public/js/core/inbox-model.js';
import { dataBlock } from '../public/js/views/board-card.js';
import { attentionP } from '../public/js/ui/rail.js';
import { peekModel, sheetRows } from '../public/js/ui/sheet.js';
import { rollsUp, statusStyle } from '../public/js/views/map/overlays.js';
import { laneNodes } from '../server/map.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const css = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = 1_800_000_000_000;

/** The one table: state -> lamp priority -> shape. */
const WANT = {
  waiting_permission: ['2', '▲'], approval: ['2', '▲'], waiting_question: ['2', '▲'],
  need: ['2', '▲'], stuck: ['2', '▲'],
  blocked: ['1', '■'], down: ['1', '■'], danger: ['1', '■'],
  working: ['run', '●'], idle: ['off', '○'],
};

test('T23: the mark table names one priority and one shape per state', () => {
  for (const [st, [p, shape]] of Object.entries(WANT)) {
    assert.equal(markP(st), p, st);
    assert.equal(P_SHAPE[p], shape, `${st} draws ${shape}`);
  }
  assert.equal(markP('<script>'), 'off', 'unknown is grey');
  assert.equal(markP('toString'), 'off', 'own keys only');
  assert.ok(Object.isFrozen(STATE_MARK));
  // The lamp normaliser reads the same table for session states.
  for (const st of ['waiting_permission', 'waiting_question', 'working', 'idle', 'blocked', 'danger']) assert.equal(normP(st), markP(st), st);
  assert.equal(itemP({ state: 'working', awaitingApproval: 'a' }), '2');
  assert.equal(itemP({ state: 'working', stuck: { reason: 'x' } }), '2');
  assert.equal(itemP({ state: 'waiting_permission', danger: { reason: 'rm' } }), '1');
  assert.equal(itemP(null), 'off');
});

const SESSIONS = [
  { name: 'perm', state: 'waiting_permission' },
  { name: 'ques', state: 'waiting_question' },
  { name: 'work', state: 'working' },
  { name: 'idle', state: 'idle' },
  { name: 'dngr', state: 'working', danger: { reason: 'rm -rf' } },
];

test('T23: Board cards and the NEEDS YOU list draw each state with its mark', () => {
  const want = { perm: '2', ques: '2', work: 'run', idle: 'off', dngr: '1' };
  for (const s of SESSIONS) {
    assert.equal(dataBlock(null, s).p, want[s.name], `card ${s.name}`);
    assert.equal(attentionP(s), want[s.name], `NEEDS YOU ${s.name}`);
  }
  assert.equal(dataBlock(null, { name: 'a', state: 'working', awaitingApproval: 'x' }).p, '2', 'a card holding an approval');
  // The card's flag icons are grey: the lamp is the only trouble mark.
  const flags = dataBlock(null, { name: 'a', state: 'working', awaitingApproval: 'x', stuck: { reason: 'r' } }).flags;
  assert.deepEqual(flags.map((f) => f.p), [null, null]);
});

function fleetStore() {
  const sessions = new Map(SESSIONS.map((s) => [`builder-a/${s.name}`, { builder: 'builder-a', key: `builder-a/${s.name}`, stateSince: NOW, ...s }]));
  sessions.set('builder-a/blkd', {
    builder: 'builder-a', key: 'builder-a/blkd', name: 'blkd', state: 'idle', lastMarker: { kind: 'blocked', text: 'no key', ts: 1 },
  });
  sessions.set('builder-a/nd', {
    builder: 'builder-a', key: 'builder-a/nd', name: 'nd', state: 'idle', lastMarker: { kind: 'need', text: 'pick one', ts: 2 },
  });
  sessions.set('builder-a/apr', { builder: 'builder-a', key: 'builder-a/apr', name: 'apr', state: 'working', awaitingApproval: 'ap1' });
  const approvals = new Map([['ap1', {
    builder: 'builder-a', id: 'ap1', session: 'apr', tool: 'Bash', summary: 'npm run build', status: 'pending', createdAt: NOW,
  }]]);
  const attention = SESSIONS.filter((s) => s.state.startsWith('waiting') || s.danger)
    .map((s) => ({ builder: 'builder-a', key: `builder-a/${s.name}`, name: s.name, state: s.state, danger: s.danger?.reason, since: NOW }));
  return {
    builders: new Map([['builder-a', { id: 'builder-a', code: 'BA', status: 'live', sessions, approvals, lanes: [] }]]),
    attention, lanes: [], packages: null, alarms: [],
  };
}

test('T23: Inbox rows use the same marks: an approval is ▲, blocked and danger are ■', () => {
  const m = buildInbox(fleetStore(), { now: NOW });
  const rows = m.groups.flatMap((g) => g.rows);
  const p = (name) => rows.find((r) => r.name === name)?.p;
  assert.equal(rows.find((r) => r.kind === 'approval').p, '2', 'the approval npm run build: amber ▲');
  assert.equal(p('perm'), '2');
  assert.equal(p('ques'), '2');
  assert.equal(p('dngr'), '1');
  assert.equal(p('blkd'), '1', 'a blocked marker: red ■');
  assert.equal(p('nd'), '2', 'a need marker: amber ▲');
});

test('T23: the phone bar counts and rows use the same marks', () => {
  const s = fleetStore();
  const pk = peekModel(s);
  assert.equal(pk.p1, 1, 'broken: the danger lane');
  assert.equal(pk.p2, 3, 'want you: the permission, the question and the held approval');
  const list = sheetRows(s, 'list');
  const p = (name) => list.find((r) => r.name.endsWith(name))?.p;
  assert.deepEqual(['perm', 'ques', 'work', 'idle', 'dngr', 'apr'].map(p), ['2', '2', 'run', 'off', '1', '2']);
  const mapTab = sheetRows(s, 'map');
  assert.deepEqual(mapTab.map((r) => r.p), ['2', '2', '1']);
});

test('T23: Map nodes: a permission is the warn ▲, a blocked lane and the guard the crit ■', () => {
  const snap = {
    sessions: [
      { name: 'perm', state: 'waiting_permission' },
      { name: 'blkd', state: 'idle', lastMarker: { kind: 'blocked', text: 'no key', ts: 1 } },
      { name: 'gone', state: 'idle', lastMarker: { kind: 'blocked', text: 'old', ts: 1, dismissed_at: 2 } },
      { name: 'nd', state: 'working', lastMarker: { kind: 'need', text: 'pick', ts: 1 } },
      { name: 'dngr', state: 'working', danger: { reason: 'rm' } },
      { name: 'work', state: 'working' },
    ],
    lanes: ['perm', 'blkd', 'gone', 'nd', 'dngr', 'work'].map((id) => ({ id, branch: id, sessions: [id] })),
  };
  const nodes = laneNodes(snap, { parent: 'agents', now: NOW, builderId: 'builder-a' });
  const st = (id) => nodes.find((n) => n.id === `lane:builder-a/${id}`)?.status;
  assert.deepEqual(['perm', 'blkd', 'gone', 'nd', 'dngr', 'work'].map(st), ['attention', 'crit', 'idle', 'attention', 'crit', 'working']);
  assert.match(nodes.find((n) => n.id === 'lane:builder-a/blkd').why, /^blocked: no key/);
  const shape = (status) => statusStyle({ kind: 'lane', status }).shape;
  assert.equal(shape('attention'), 'tri');
  assert.equal(shape('crit'), 'square');
  assert.equal(statusStyle({ kind: 'lane', status: 'crit' }).tone, 'crit');
});

test('T23: the Map centre shows its own state, never a rolled-up amber disc', () => {
  assert.equal(rollsUp({ kind: 'core' }), false);
  assert.equal(rollsUp({ kind: 'core' }, true), false, 'not even folded');
  assert.equal(rollsUp({ kind: 'host' }), true);
  assert.equal(rollsUp({ kind: 'site' }), true);
  assert.equal(rollsUp({ kind: 'lane' }, true), true, 'a folded node rolls up');
  assert.equal(rollsUp({ kind: 'lane' }), false);
  const render = css('public/js/views/map/render.js');
  assert.doesNotMatch(render, /glyph\('disc', [^;]*st\.abnormal \? col/, 'the core disc is never painted in a trouble hue');
});

test('T23: the sheets: no fill on the danger pill, grey card flags, a permission card in the amber line, lamps that never fade', () => {
  const box = css('public/css/views/box.css');
  const rule = box.match(/\.mk-danger \.mk-kind \{([^}]*)\}/)[1];
  assert.match(rule, /background: none/);
  assert.match(rule, /color: var\(--p1\)/);
  assert.match(box, /\.mk-danger \.mk-kind::before \{ content: "■ "; \}/);
  const lanes = css('public/css/lanes.css');
  assert.match(lanes, /\.mk-need \.mk-kind \{ color: var\(--p2\); background: none; \}/);
  assert.match(lanes, /\.mk-blocked \.mk-kind \{ color: var\(--p1\); background: none; \}/);
  const board = css('public/css/board.css');
  assert.doesNotMatch(board, /\.db-flag\[data-p/, 'flag icons take no status hue');
  assert.match(board, /\.card\.s-waiting_permission \{ border-color: var\(--p2-line\); \}/);
  // The NEEDS YOU items of a permission lane are amber like their lamp, not red.
  const rail = css('public/css/rail.css');
  assert.doesNotMatch(rail, /s-waiting_permission[^{]*\{[^}]*(--p1|--crit)/, 'no red on a permission item');
  assert.match(css('public/css/components.css'), /\.lamp\[data-unack\] \{ animation: none; \}/, 'a red ■ never blinks to maroon');
});
