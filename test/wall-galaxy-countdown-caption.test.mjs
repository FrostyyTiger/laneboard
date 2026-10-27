// The caption names the countdown (Wall plan night 4 T53, README §7.C,
// research Q17): while a site is held the plate has one grey line for its
// soonest countdown (overdue first), after the trouble lines, in the held
// `m:ss`, the only thing on the Wall that ticks seconds; a planet's sheet the
// same for its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { soonestCountdown } from '../public/js/wall/countdown.js';
import { countdownCaption, createHud, galaxyCaption, plateFollows, sheetCaption, staleCaption } from '../public/js/wall/galaxy/hud.js';
import { CAPTION_TIMING, MAX_LINES, captionLines, createCaption } from '../public/js/wall/caption.js';
import { freshness } from '../public/js/wall/galaxy/fresh.js';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';

const NOW = 1_790_000_000_000;
const S = 1000, M = 60 * S;
const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');

const model = () => ({
  nodes: [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'hv1', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'db', parent: 'hv1', kind: 'room', label: 'db', status: 'ok', countdown: { at: NOW + 12 * M + 4 * S, label: 'dumps' } },
    { id: 'db-dumps', parent: 'db', kind: 'service', label: 'db-dumps', status: 'ok' },
    { id: 'nas', parent: 'hv1', kind: 'room', label: 'nas', status: 'ok', countdown: { at: NOW + 3 * 60 * M, label: 'offsite copy' } },
    { id: 'lab', parent: '__core', kind: 'site', label: 'lab', status: 'crit' },
    { id: 'lab-b', parent: 'lab', kind: 'builder', label: 'builder-b', status: 'crit', why: 'disk full', metrics: { cpu: 0.4, mem: 0.5 } },
    { id: 'lab-c', parent: 'lab', kind: 'builder', label: 'builder-c', status: 'warn', why: 'slow' },
    { id: 'lab-s', parent: 'lab', kind: 'room', label: 'store', status: 'ok', countdown: { at: NOW - 3 * M - 12 * S, label: 'lifecycle' } },
    { id: 'lab-t', parent: 'lab', kind: 'room', label: 'tape', status: 'ok', countdown: { at: NOW + 30 * S, label: 'rotate' } },
  ],
});
const node = (m, id) => m.nodes.find((n) => n.id === id);

test('soonestCountdown: overdue first (the longest overdue leads), else the soonest; null for none', () => {
  const at = (id, ms, label = id) => ({ id, countdown: { at: NOW + ms, label } });
  assert.equal(soonestCountdown([], NOW), null);
  assert.equal(soonestCountdown([{ id: 'a' }, { id: 'b', countdown: { at: 'soon' } }], NOW), null, 'a bad one is no countdown');
  assert.equal(soonestCountdown([at('far', 40 * M), at('near', 2 * M), at('mid', 9 * M)], NOW).node.id, 'near');
  const late = soonestCountdown([at('near', 5 * S), at('late', -10 * S), at('later', -4 * M)], NOW);
  assert.equal(late.node.id, 'later', 'overdue beats a soon one, the longest overdue first');
  assert.deepEqual({ at: late.at, label: late.label }, { at: NOW - 4 * M, label: 'later' });
  assert.equal(soonestCountdown([at('zero', 0), at('near', 1 * S)], NOW).node.id, 'zero', 'at zero it is due, so first');
  assert.equal(soonestCountdown([at('a', M), at('b', M)], NOW).node.id, 'a', 'a tie keeps the order given');
});

test('countdownCaption: a calm tour plate gets the soonest countdown in it as its one line, grey', () => {
  const m = model();
  const hv1 = node(m, 'hv1');
  const cap = countdownCaption(galaxyCaption(captionLines(hv1, m, 1, 2), 'site'), hv1, m, NOW);
  assert.deepEqual(cap.lines, [{ kind: 'countdown', step: 'line', label: 'dumps', name: 'DB', at: NOW + 12 * M + 4 * S, id: 'db' }]);
  assert.equal(cap.lines[0].status, undefined, 'no status, so no hue');
  assert.equal(cap.lines[0].tone, undefined);
  // Nothing in it carries one: the caption itself.
  const bare = { nodes: m.nodes.map(({ countdown, ...n }) => n) };
  const plain = galaxyCaption(captionLines(node(bare, 'hv1'), bare), 'site');
  assert.equal(countdownCaption(plain, node(bare, 'hv1'), bare, NOW), plain);
});

test('countdownCaption: after the trouble lines, before the rest; the overdue one named, never past MAX_LINES', () => {
  const m = model();
  const lab = node(m, 'lab');
  const cap = countdownCaption(sheetCaption(lab, m), lab, m, NOW);
  const kinds = cap.lines.map((l) => l.kind);
  assert.deepEqual(kinds.slice(0, 5), ['trouble', 'status', 'problem', 'problem', 'countdown']);
  assert.ok(kinds.indexOf('countdown') < kinds.indexOf('metrics') || !kinds.includes('metrics'), 'before the bars and facts');
  const row = cap.lines[4];
  assert.equal(row.id, 'lab-s', 'the overdue lifecycle, not the rotate due in 30 s');
  assert.equal(row.name, 'STORE');
  assert.equal(row.label, 'lifecycle');
  assert.ok(cap.lines.length <= MAX_LINES);
  // With the feed's grey line too: both stay, the trouble word still leads.
  const stale = staleCaption(cap, freshness(0, 40_000));
  assert.equal(stale.lines[0].kind, 'trouble');
  assert.ok(stale.lines.some((l) => l.kind === 'countdown'));
  assert.ok(stale.lines.length <= MAX_LINES);
});

test('countdownCaption: a planet\'s own countdown names no member and is no target (it is what was tapped)', () => {
  const m = model();
  const db = node(m, 'db');
  const cap = countdownCaption(sheetCaption(db, m), db, m, NOW);
  const row = cap.lines.find((l) => l.kind === 'countdown');
  assert.equal(row.name, '');
  assert.equal(row.id, undefined);
  const i = cap.lines.indexOf(row);
  assert.equal(cap.lines[i - 1].kind, 'status', 'after the status line');
  // A missing label says what it is anyway.
  m.nodes.find((n) => n.id === 'db').countdown = { at: NOW + M };
  assert.equal(countdownCaption(sheetCaption(db, m), db, m, NOW).lines.find((l) => l.kind === 'countdown').label, 'next');
});

test('plateFollows: a countdown that moved on is taken at once, even by a tour plate', () => {
  const m = model();
  const hv1 = node(m, 'hv1');
  const was = countdownCaption(galaxyCaption(captionLines(hv1, m, 1, 2), 'site'), hv1, m, NOW);
  assert.equal(plateFollows(was, countdownCaption(galaxyCaption(captionLines(hv1, m, 1, 2), 'site'), hv1, m, NOW + 5 * S)), false, 'the same run: the plate ticks it itself');
  node(m, 'db').countdown = { at: NOW + 27 * M, label: 'dumps' };
  assert.equal(plateFollows(was, countdownCaption(galaxyCaption(captionLines(hv1, m, 1, 2), 'site'), hv1, m, NOW + 13 * M)), true, 'the dump ran: the next one');
});

test('the hud: a parked site and a tapped planet carry the countdown line', () => {
  const calls = [];
  const caption = { show: (leg, cap) => calls.push(cap), hide: () => {}, cover: () => null };
  const frame = { update: () => {}, live: () => {}, cover: () => null };
  const hud = createHud({ caption, frame, now: () => NOW });
  hud.update(model());
  hud.park({ id: 'hv1', index: 1, count: 2 });
  assert.deepEqual(calls.at(-1).lines.map((l) => [l.kind, l.label]), [['countdown', 'dumps']]);
  hud.open({ id: 'nas' });
  const sheet = calls.at(-1);
  assert.equal(sheet.sheet, true);
  assert.equal(sheet.lines.find((l) => l.kind === 'countdown').label, 'offsite copy');
});

function withDoc(fn) {
  const prevDoc = globalThis.document;
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    return e;
  };
  globalThis.document = doc;
  try { return fn(); } finally { globalThis.document = prevDoc; }
}

const find = (e, pred, out = []) => { if (pred(e)) out.push(e); for (const c of e.children ?? []) find(c, pred, out); return out; };

test('caption: the countdown row in the held m:ss, ticking on its second, its phase on the row', () => withDoc(() => {
  const root = makeEl('div');
  root.clientWidth = 1368;
  root.clientHeight = 912;
  const waits = [];
  const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
  let t = NOW;
  const cap = createCaption(root, { timers, timing: CAPTION_TIMING, now: () => t });
  const m = model();
  const hv1 = node(m, 'hv1');
  cap.tick(t); // nothing on the plate: nothing to do
  node(m, 'db').countdown.at = NOW + 4 * S + 300;
  cap.show({ kind: 'site', id: 'hv1', arriveMs: 0 }, countdownCaption(galaxyCaption(captionLines(hv1, m, 1, 2), 'site'), hv1, m, NOW));
  waits.find((w) => w.ms === 0).fn();
  const row = find(root, (e) => e.dataset?.kind === 'countdown')[0];
  assert.ok(row, 'the row is on the plate');
  assert.equal(row.dataset.subject, 'db', 'a finger on it opens the member');
  const clock = find(row, (e) => e.className === 'wall-caption-count')[0];
  const words = () => find(row, (e) => e.className === 'wall-caption-val')[0].textContent;
  assert.equal(find(row, (e) => e.className === 'wall-caption-key')[0].textContent, 'dumps');
  assert.equal(clock.textContent, '0:05', 'held: m:ss, the last second rounds up');
  assert.equal(words(), 'DB · 0:05');
  assert.equal(row.dataset.phase, 'soon');
  // It ticks once a second, and only then writes.
  let writes = 0;
  let text = clock.textContent;
  Object.defineProperty(clock, 'textContent', { get: () => text, set: (v) => { writes += 1; text = v; } });
  for (let k = 0; k < 60; k++) cap.tick(NOW + k * 16); // a second of frames
  assert.equal(writes, 1, 'one write in the second, at the turn');
  assert.equal(clock.textContent, '0:04');
  cap.tick(NOW + 4 * S + 300);
  assert.equal(clock.textContent, '0:00');
  assert.equal(row.dataset.phase, 'now');
  cap.tick(NOW + 4 * S + 300 + 2 * M + 7 * S);
  assert.equal(clock.textContent, '+2:07', 'overdue counts on with a +');
  assert.equal(row.dataset.phase, 'late');
}));

test('wall.css: the countdown row is grey, tabular, a step up when soon or late, never a status hue', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'css/wall.css'), 'utf8');
  const rules = css.split('}').filter((r) => /data-kind="countdown"|wall-caption-count/.test(r));
  assert.ok(rules.length >= 3);
  for (const r of rules) assert.doesNotMatch(r, /--(crit|warn|info|ok)\b/, r);
  assert.match(css, /\.wall-caption-count \{[^}]*font-variant-numeric: tabular-nums/);
  assert.match(css, /\[data-kind="countdown"\]\[data-phase="late"\] \.wall-caption-count/);
});

test('galaxy/main.js ticks the plate\'s countdown each frame by the wall clock', () => {
  const js = fs.readFileSync(path.join(PUBLIC, 'js/wall/galaxy/main.js'), 'utf8');
  assert.match(js, /caption\.tick\(Date\.now\(\)\)/);
});
