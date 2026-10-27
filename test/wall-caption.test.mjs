// The Wall's caption (Wall plan T6, docs/plans/wall/README.md §3): what the
// plate says for a calm site, a site in trouble and a node without detail,
// and that its beats fit the tour's legs at both speeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captionLines, captionSchedule, captionTimingFor, CAPTION_TIMING, DEMO_CAPTION_TIMING,
  MAX_LINES, MAX_TEXT, STEPS, HERO_PLATE, heroSize, PLATE, plateHeight,
} from '../public/js/wall/caption.js';
import { readFileSync } from 'node:fs';
import { TIMING, DEMO_TIMING } from '../public/js/wall/tour.js';

/** Two sites as the large demo has them: hv1 calm, hv2 with a full pool. */
function model() {
  return {
    nodes: [
      { id: '__core', kind: 'core', status: 'ok' },
      {
        id: 'lab', parent: '__core', kind: 'site', label: 'hv1', status: 'ok', sub: 'demo hypervisor · 128 GB',
        metrics: { cpu: 0.34, mem: 0.62, disk: 0.48 }, detail: { Where: 'rack 1', Hardware: '2× 16-core · 128 GB' },
      },
      { id: 'room-a', parent: 'lab', kind: 'room', label: 'vm-a', status: 'ok', detail: { ID: 101, Uptime: '240h' } },
      { id: 'room-b', parent: 'lab', kind: 'room', label: 'vm-b', status: 'ok' },
      { id: 'svc-a', parent: 'room-a', kind: 'service', label: 'web', status: 'working' },
      { id: 'host-a', parent: 'lab', kind: 'host', label: 'nas', status: 'ok' },
      {
        id: 'hv2', parent: '__core', kind: 'site', label: 'hv2', status: 'ok',
        metrics: { cpu: 0.41, mem: 0.71 }, detail: { Hardware: '24-core · 192 GB · 1 GPU', Where: 'rack 2', Power: '310 W', Fans: 'quiet' },
      },
      { id: 'storage', parent: 'hv2', kind: 'room', label: 'storage', status: 'crit', why: 'pool 97% full' },
      { id: 'media', parent: 'hv2', kind: 'room', label: 'media', status: 'warn', why: 'transcode queue' },
      { id: 'gpu-box', parent: 'hv2', kind: 'room', label: 'gpu-box', status: 'ok' },
    ],
  };
}
const node = (m, id) => m.nodes.find((n) => n.id === id);

test('caption: a calm site says calm, in grey, with its metrics, facts and what it holds', () => {
  const m = model();
  const c = captionLines(node(m, 'lab'), m, 2, 5);
  assert.equal(c.kicker, 'TARGET 02 / 05 · SITE');
  assert.equal(c.name, 'HV1');
  assert.equal(c.status, 'ok');
  assert.deepEqual(c.lines.map((l) => l.kind), ['status', 'metrics', 'fact', 'fact', 'count']);
  assert.ok(!c.lines.some((l) => l.kind === 'trouble'), 'no trouble line when calm');
  assert.equal(c.lines[0].text, 'ok · all 4 calm');
  assert.deepEqual(c.lines[1].bars, [
    { label: 'cpu', value: 0.34, text: '34%' },
    { label: 'mem', value: 0.62, text: '62%' },
  ]);
  // hardware before where (the plan's order), whatever order the detail had
  assert.deepEqual(c.lines.filter((l) => l.kind === 'fact').map((l) => [l.label, l.text]), [
    ['hardware', '2× 16-core · 128 GB'], ['where', 'rack 1'],
  ]);
  assert.equal(c.lines.at(-1).text, '2 rooms · 1 host');
  assert.ok(c.lines.length >= 3 && c.lines.length <= MAX_LINES);
});

test('caption: a site in trouble leads with its worst problem, in its status colour and shape', () => {
  const m = model();
  const c = captionLines(node(m, 'hv2'), m, 1, 5);
  assert.equal(c.kicker, 'CRIT · TARGET 01 / 05 · SITE');
  assert.equal(c.status, 'crit');
  const [first] = c.lines;
  assert.deepEqual(
    { kind: first.kind, label: first.label, text: first.text, tone: first.tone, shape: first.shape, glyph: first.glyph },
    { kind: 'trouble', label: 'storage', text: 'pool 97% full', tone: 'crit', shape: 'square', glyph: '■' },
  );
  assert.equal(c.lines[1].text, '1 crit · 1 warn');
  // never more than six lines: the extra facts give way, the count stays last
  assert.equal(c.lines.length, MAX_LINES);
  assert.equal(c.lines.at(-1).kind, 'count');
  assert.equal(c.lines.at(-1).text, '3 rooms');
  assert.deepEqual(c.lines.filter((l) => l.kind === 'fact').map((l) => l.label), ['hardware']);

  // a warn alone shows the triangle in the warn tone; attention reads as warn too
  const w = model();
  node(w, 'storage').status = 'ok';
  const cw = captionLines(node(w, 'hv2'), w);
  assert.equal(cw.lines[0].glyph, '▲');
  assert.equal(cw.lines[0].tone, 'warn');
  node(w, 'media').status = 'attention';
  assert.equal(captionLines(node(w, 'hv2'), w).lines[0].tone, 'warn');

  // a node in trouble itself names its own status and why
  const own = captionLines(node(m, 'storage'), m, 3, 5);
  assert.equal(own.kicker, 'CRIT · TARGET 03 / 05 · ROOM');
  assert.equal(own.lines[0].label, 'crit');
  assert.equal(own.lines[0].text, 'pool 97% full');
});

test('caption: the kicker of a node in trouble leads with the worst status, its tone and shape (T26)', () => {
  const m = model();
  const crit = captionLines(node(m, 'hv2'), m, 1, 5);
  assert.equal(crit.kicker, 'CRIT · TARGET 01 / 05 · SITE');
  assert.deepEqual(crit.mark, { status: 'crit', tone: 'crit', shape: 'square', glyph: '■' });

  const a = model();
  node(a, 'storage').status = 'ok';
  node(a, 'media').status = 'attention';
  const att = captionLines(node(a, 'hv2'), a, 4, 5);
  assert.equal(att.kicker, 'ATTENTION · TARGET 04 / 05 · SITE');
  assert.deepEqual(att.mark, { status: 'attention', tone: 'warn', shape: 'tri', glyph: '▲' });
  // the kicker's mark is the trouble line's, so the plate never says two things
  assert.equal(att.mark.glyph, att.lines[0].glyph);

  const calm = captionLines(node(m, 'lab'), m, 2, 5);
  assert.equal(calm.kicker, 'TARGET 02 / 05 · SITE', 'a calm kicker stays plain');
  assert.equal(calm.mark, null);
  assert.equal(captionLines(node(m, 'room-b'), m).mark, null);
});

test('caption: a node without detail or metrics still gives a status line, nothing undefined', () => {
  const m = model();
  const c = captionLines(node(m, 'room-b'), m);
  assert.equal(c.kicker, 'ROOM', 'no target number without an index');
  assert.equal(c.name, 'VM-B');
  assert.deepEqual(c.lines.map((l) => l.kind), ['status']);
  assert.equal(c.lines[0].text, 'ok');
  for (const l of c.lines) assert.doesNotMatch(JSON.stringify(l), /undefined|null|NaN/);

  // a node the model does not hold, with odd data: status and sub only
  const stray = captionLines({ id: 'x', status: 'unknown', sub: 'no feed', metrics: { cpu: 'high', mem: -1 }, detail: [1, 2] }, m);
  assert.equal(stray.kicker, 'NODE');
  assert.equal(stray.name, 'X');
  assert.deepEqual(stray.lines, [{ kind: 'status', step: 'line', label: 'status', text: 'unknown · no feed' }]);
  assert.deepEqual(captionLines(null, null).lines.map((l) => l.kind), ['status']);
});

test('caption: long values are clipped so the plate keeps its width', () => {
  const m = model();
  node(m, 'storage').why = 'pool '.repeat(30);
  const t = captionLines(node(m, 'hv2'), m).lines[0].text;
  assert.ok(t.length <= MAX_TEXT, t);
  assert.ok(t.endsWith('…'));
  assert.equal(captionLines({ id: 'y', label: 'a'.repeat(80) }, m).name.length, MAX_TEXT);
});

test('caption: every beat fits the tour leg, and the plate is then still for the reading', () => {
  for (const [timing, tour, demo] of [[CAPTION_TIMING, TIMING, false], [DEMO_CAPTION_TIMING, DEMO_TIMING, true]]) {
    assert.equal(captionTimingFor(demo), timing);
    const leg = { arriveMs: tour.flyMs, ms: tour.flyMs + tour.holdMs };
    const s = captionSchedule(leg, 'OFFICE-PRINTER', MAX_LINES, timing);
    assert.ok(s.startMs >= 0 && s.startMs <= leg.arriveMs, 'starts by the arrival');
    assert.ok(s.nameAt > s.startMs && s.nameDoneAt > s.nameAt, 'plate, then the name');
    assert.ok(s.lineAt[0] >= s.nameDoneAt, 'lines after the name');
    assert.ok(s.lineAt.every((t, i) => i === 0 || t > s.lineAt[i - 1]), 'one line at a time');
    // research Q1: everything in by ~1.5-2 s after the plate
    assert.ok(s.doneAt - s.startMs <= 2000, `in by 2 s (${s.doneAt - s.startMs} ms)`);
    // still for the reading before the camera leaves: 3 s at normal speed, a beat in the demo
    assert.ok(leg.ms - s.doneAt >= (demo ? 500 : 3000), `still for ${leg.ms - s.doneAt} ms`);
  }
  // normal speed waits for the camera (Q1: arrive, then type)
  assert.equal(captionSchedule({ arriveMs: 2250 }, 'HV1', 3).startMs, 2250);
  assert.deepEqual(captionSchedule({}, '', 0, CAPTION_TIMING).lineAt, []);
});

// T20 (r14-operator #1): read from three metres. The trouble word is the
// biggest text on a trouble plate, the name under it, the facts small.
test('caption: a trouble site leads with the trouble word at the 3 m step, the name under it, facts small', () => {
  const m = model();
  const c = captionLines(node(m, 'hv2'), m, 1, 5);
  assert.equal(c.hero, true);
  const [lead, ...rest] = c.lines;
  assert.equal(lead.step, 'hero');
  assert.equal(lead.word, 'STORAGE', 'where the trouble is, in caps');
  assert.equal(lead.sub, 'pool 97% full', 'what it is, under the word');
  assert.deepEqual(rest.map((l) => [l.kind, l.step]), [
    ['status', 'trouble'], ['problem', 'trouble'], ['metrics', 'line'], ['fact', 'small'], ['count', 'small'],
  ]);
  // the steps: trouble word > name > why > line > key, and the word stays above the name when it shrinks
  assert.ok(STEPS.hero > STEPS.heroMin && STEPS.heroMin > STEPS.name, 'the word, even fitted, beats the name');
  assert.ok(STEPS.name > STEPS.why && STEPS.why > STEPS.line && STEPS.line > STEPS.key);

  // a node in its own trouble leads with what is wrong
  const own = captionLines(node(m, 'storage'), m).lines[0];
  assert.equal(own.word, 'POOL 97% FULL');
  assert.equal(own.sub, 'crit');
});

// T22 (r14-operator #5): the status is a severity count, and the plate names
// the worst three, the worst as the hero, the next two one per line.
test('caption: a site with 1 crit and several attention counts them and names the worst three', () => {
  const m = model();
  const hv2 = node(m, 'hv2');
  node(m, 'media').status = 'ok';
  m.nodes.push(
    { id: 'b1', parent: 'hv2', kind: 'builder', label: 'builder-a', status: 'ok' },
    { id: 'l1', parent: 'b1', kind: 'lane', label: 'feat-search', status: 'attention', why: 'waiting for approval' },
    { id: 's1', parent: 'l1', kind: 'session', label: 's1', status: 'attention', why: 'prompt' },
    { id: 'l2', parent: 'b1', kind: 'lane', label: 'fix-login', status: 'attention', why: 'stuck 12 min' },
    { id: 'l3', parent: 'b1', kind: 'lane', label: 'docs-map', status: 'attention' },
    { id: 'l4', parent: 'b1', kind: 'lane', label: 'deps', status: 'attention' },
    { id: 'l5', parent: 'b1', kind: 'lane', label: 'ci-cache', status: 'attention' },
  );
  // the crit last in model order still leads
  m.nodes.push(m.nodes.splice(m.nodes.indexOf(node(m, 'storage')), 1)[0]);
  const c = captionLines(hv2, m, 1, 5);
  const [lead, status, ...rest] = c.lines;
  assert.equal(lead.word, 'STORAGE', 'the worst is the hero');
  assert.equal(status.text, '1 crit · 5 attention', 'a lane and its waiting session are one problem');
  const named = rest.filter((l) => l.kind === 'problem');
  assert.deepEqual(named.map((l) => [l.label, l.text, l.glyph, l.tone, l.step]), [
    ['attention', 'FEAT-SEARCH · waiting for approval', '▲', 'warn', 'trouble'],
    ['attention', 'FIX-LOGIN · stuck 12 min', '▲', 'warn', 'trouble'],
  ]);
  assert.deepEqual(c.lines.slice(0, 4).map((l) => l.kind), ['trouble', 'status', 'problem', 'problem'], 'worst first, right under the count');
  assert.ok(c.lines.length <= MAX_LINES);
  assert.equal(c.lines.at(-1).kind, 'count');

  // a warn below a crit sorts after it, however the model orders them
  node(m, 'l2').status = 'warn';
  const w = captionLines(hv2, m);
  assert.equal(w.lines[1].text, '1 crit · 4 attention · 1 warn');
  assert.deepEqual(w.lines.filter((l) => l.kind === 'problem').map((l) => l.text.split(' · ')[0]), ['FEAT-SEARCH', 'DOCS-MAP']);

  // one problem: the count and the hero, no problem line
  const one = model();
  node(one, 'media').status = 'ok';
  const c1 = captionLines(node(one, 'hv2'), one);
  assert.equal(c1.lines[1].text, '1 crit');
  assert.ok(!c1.lines.some((l) => l.kind === 'problem'));
  // a calm site: no count, no problem line
  assert.ok(!captionLines(node(one, 'lab'), one).lines.some((l) => l.kind === 'problem'));
});

test('caption: a calm site keeps its order, the name first and every line at the line step', () => {
  const m = model();
  const c = captionLines(node(m, 'lab'), m, 2, 5);
  assert.equal(c.hero, false);
  assert.deepEqual(c.lines.map((l) => [l.kind, l.step]), [
    ['status', 'line'], ['metrics', 'line'], ['fact', 'line'], ['fact', 'line'], ['count', 'line'],
  ]);
});

test('caption: the trouble word is 14vmin where it fits, fitted to the plate where not, 9 at the least', () => {
  // the tablet (3:2) and a 16:9 screen, landscape
  for (const [w, h] of [[1368, 912], [1920, 1080]]) {
    assert.equal(heroSize('STORAGE', w, h), STEPS.hero, `short word at ${w}x${h}`);
    const long = heroSize('OFFICE-PRINTER', w, h);
    assert.ok(long < STEPS.hero && long >= STEPS.heroMin, `${long} at ${w}x${h}`);
    // the fitted word fits the plate's width: glyph plus letters inside maxVw less the padding
    const avail = (HERO_PLATE.maxVw * w) / Math.min(w, h) - HERO_PLATE.padVmin;
    assert.ok(long * (1.1 + 14 * 0.47) <= avail + 0.5, `${long} vmin fits ${avail} vmin`);
    assert.equal(heroSize('X'.repeat(40), w, h), STEPS.heroMin, 'never under the floor');
  }
  // wider screens give the word more room
  assert.ok(heroSize('OFFICE-PRINTER', 1920, 1080) > heroSize('OFFICE-PRINTER', 1368, 912));
  assert.equal(heroSize('STORAGE', 0, 0), STEPS.hero, 'no stage yet: the full step');
});

// T23 (r14-operator #6): no dead plate. The trouble word is in with the
// plate, only the name types, and the plate grows with its rows instead of
// opening at its full height with empty rows under the name.
test('caption: the plate grows with its rows, one row height and gap at a time', () => {
  const m = model();
  const calm = captionLines(node(m, 'lab'), m, 2, 5);
  const rows = calm.lines.filter((l) => l.step !== 'hero');
  const opened = plateHeight(calm, 0);
  // kicker and name, nothing under them
  const head = PLATE.padTop + PLATE.kicker + PLATE.nameAbove + STEPS.name * PLATE.nameLead + PLATE.nameBelow + PLATE.padBottom;
  assert.ok(Math.abs(opened - head) < 0.01, `${opened} vs ${head}`);
  assert.ok(Math.abs(plateHeight(calm, 1) - opened - PLATE.rows.line) < 0.01, 'the first row adds its height, no gap');
  assert.ok(Math.abs(plateHeight(calm, 2) - plateHeight(calm, 1) - PLATE.rows.line - PLATE.rowGap) < 0.01, 'the next adds a gap too');
  for (let i = 1; i <= rows.length; i++) assert.ok(plateHeight(calm, i) > plateHeight(calm, i - 1), `row ${i} grows it`);
  assert.equal(plateHeight(calm), plateHeight(calm, rows.length), 'all rows by default');
  assert.equal(plateHeight(calm, 99), plateHeight(calm, rows.length));
  assert.equal(plateHeight(calm, -3), opened);
  assert.ok(opened < plateHeight(calm) * 0.6, 'it opens well under its full height');
  assert.equal(plateHeight(null, 0), plateHeight({ lines: [] }, 3));
});

test('caption: a trouble plate opens with its word and why, the facts below a gap at the small step', () => {
  const m = model();
  const c = captionLines(node(m, 'hv2'), m, 1, 5);
  const lead = c.lines.find((l) => l.step === 'hero');
  const rows = c.lines.filter((l) => l.step !== 'hero');
  const calmHead = plateHeight({ lines: [] }, 0);
  // the word (at its fitted size) and its why are there from the first frame
  const word = PLATE.heroAbove + 12 * PLATE.heroLead + PLATE.subGap + PLATE.sub + Math.max(PLATE.heroBelow, PLATE.nameAbove) - PLATE.nameAbove;
  assert.ok(lead.sub, 'hv2 has a why under its word');
  assert.ok(Math.abs(plateHeight(c, 0, 12) - calmHead - word) < 0.01);
  assert.ok(plateHeight(c, 0, 14) > plateHeight(c, 0, 9), 'a bigger word, a taller plate');
  const noSub = { lines: [{ ...lead, sub: '' }] };
  assert.ok(Math.abs(plateHeight(c, 0, 12) - plateHeight(noSub, 0, 12) - PLATE.subGap - PLATE.sub) < 0.01);
  // the first small row after a line row brings the extra gap, the next does not
  const i = rows.findIndex((r) => r.step === 'small');
  assert.ok(i > 0 && rows[i - 1].step === 'line', 'hv2 has facts after its lines');
  const step = (k) => plateHeight(c, k + 1, 12) - plateHeight(c, k, 12);
  assert.ok(Math.abs(step(i) - PLATE.rowGap - PLATE.smallGap - PLATE.rows.small) < 0.01);
  if (rows[i + 1]?.step === 'small') assert.ok(Math.abs(step(i + 1) - PLATE.rowGap - PLATE.rows.small) < 0.01);
});

test('caption: wall.css sets the heights plateHeight adds up', () => {
  const css = readFileSync(new URL('../public/css/wall.css', import.meta.url), 'utf8');
  const rule = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    assert.ok(at >= 0, sel);
    return css.slice(at, css.indexOf('}', at));
  };
  assert.match(rule('.wall-caption-line'), new RegExp(`height: ${PLATE.rows.line}vmin`));
  assert.match(rule('.wall-caption-line[data-kind="metrics"]'), new RegExp(`height: ${PLATE.rows.line}vmin`));
  assert.match(rule('.wall-caption-line[data-step="small"]'), new RegExp(`height: ${PLATE.rows.small}vmin`));
  assert.match(rule('.wall-caption-line[data-step="trouble"]'), new RegExp(`height: ${PLATE.rows.trouble}vmin`));
  assert.match(rule('.wall-caption-name'), new RegExp(`height: calc\\(var\\(--cap-name\\) \\* ${PLATE.nameLead}\\)`));
  assert.match(rule('.wall-caption-hero-word'), new RegExp(`height: calc\\(var\\(--cap-hero\\) \\* ${PLATE.heroLead}\\)`));
  assert.match(rule('.wall-caption-hero-sub'), new RegExp(`height: ${PLATE.sub}vmin`));
  assert.match(rule('.wall-caption-kicker'), /height: var\(--cap-key\)/);
  assert.match(rule('.wall-caption'), /overflow: hidden/);
  assert.match(css, /\.wall-caption-lines > \.wall-caption-line\[hidden\] \{ display: none; \}/);
});

test('caption: in demo timing the name types during the last 0.5 s of the flight', () => {
  const s = captionSchedule({ arriveMs: DEMO_TIMING.flyMs }, 'HV2', 4, DEMO_CAPTION_TIMING);
  assert.ok(s.nameAt >= DEMO_TIMING.flyMs - 500 && s.nameAt < DEMO_TIMING.flyMs, `types from ${s.nameAt} ms`);
});

test('caption: the page sets the trouble kicker in its tone with its shape, a calm kicker grey with none (T26)', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createCaption } = await import('../public/js/wall/caption.js');
  const prevDoc = globalThis.document;
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    return e;
  };
  globalThis.document = doc;
  try {
    const waits = [];
    const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
    const root = makeEl('div');
    root.clientWidth = 1368;
    root.clientHeight = 912;
    const caption = createCaption(root, { timers, timing: CAPTION_TIMING });
    const kicker = caption.el.children[0];
    const [glyph, text] = kicker.children;
    const m = model();
    const leg = { kind: 'site', id: 'hv2', index: 1, count: 5, arriveMs: 0 };
    const play = (cap) => { waits.length = 0; caption.show(leg, cap); waits.find((w) => w.ms === 0).fn(); };

    play(captionLines(node(m, 'hv2'), m, 1, 5));
    assert.equal(kicker.dataset.tone, 'crit');
    assert.equal(glyph.hidden, false);
    assert.equal(glyph.textContent, '■');
    assert.equal(text.textContent, 'CRIT · TARGET 01 / 05 · SITE');

    play(captionLines(node(m, 'lab'), m, 2, 5));
    assert.equal(kicker.dataset.tone, undefined, 'a calm kicker keeps the grey');
    assert.equal(glyph.hidden, true);
    assert.equal(text.textContent, 'TARGET 02 / 05 · SITE');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('wall.css: the trouble kicker takes the status colours and keeps the kicker\'s height (T26)', () => {
  const css = readFileSync(new URL('../public/css/wall.css', import.meta.url), 'utf8');
  assert.match(css, /\.wall-caption-kicker\[data-tone="crit"\] \{ color: var\(--crit\); \}/);
  assert.match(css, /\.wall-caption-kicker\[data-tone="warn"\] \{ color: var\(--warn\); \}/);
  assert.match(css, /\.wall-caption-kicker \.wall-caption-glyph \{ font-size: 1em; \}/);
});

// T23 (r17-operator galaxy 9 + across): the trouble rows carry the why from
// 3 m, so they are set at the why's step; the crit plate's count is set as
// trouble (shape and hue per status), not a white `1 crit`; facts stay small.
test('caption: a trouble plate sets its count and named problems at the why step, each status in its hue (T23)', () => {
  assert.equal(PLATE.rows.trouble, STEPS.why, 'the rows at the hero sub\'s step');
  const one = model();
  node(one, 'media').status = 'ok';
  const c1 = captionLines(node(one, 'hv2'), one);
  const status = c1.lines.find((l) => l.kind === 'status');
  assert.equal(status.step, 'trouble');
  assert.equal(status.text, '1 crit');
  assert.deepEqual(status.parts, [{ status: 'crit', text: '1 crit', tone: 'crit', shape: 'square', glyph: '■' }]);
  assert.deepEqual(c1.lines.filter((l) => l.kind === 'fact' || l.kind === 'count').map((l) => l.step).filter((s) => s !== 'small'), [], 'hardware, where, holds stay small');

  const m = model();
  m.nodes.push({ id: 'l9', parent: 'hv2', kind: 'lane', label: 'feat-x', status: 'attention', why: 'asked a question' });
  const c = captionLines(node(m, 'hv2'), m);
  const parts = c.lines.find((l) => l.kind === 'status').parts;
  assert.deepEqual(parts.map((p) => [p.text, p.tone, p.glyph]).slice(0, 1), [['1 crit', 'crit', '■']]);
  assert.ok(parts.some((p) => p.status === 'attention' && p.tone === 'warn' && p.glyph === '▲'), 'attention in its own hue and shape');
  assert.ok(c.lines.filter((l) => l.kind === 'problem').every((l) => l.step === 'trouble'));

  // a calm site keeps a plain grey status at the line step
  const calm = captionLines(node(one, 'lab'), one).lines.find((l) => l.kind === 'status');
  assert.equal(calm.step, 'line');
  assert.equal(calm.parts, undefined);

  // the plate counts a trouble row at its height
  const rows = c1.lines.filter((l) => l.step !== 'hero');
  const i = rows.findIndex((r) => r.step === 'trouble');
  assert.equal(i, 0);
  assert.ok(Math.abs(plateHeight(c1, 1, 12) - plateHeight(c1, 0, 12) - PLATE.rows.trouble) < 0.01);

  const css = readFileSync(new URL('../public/css/wall.css', import.meta.url), 'utf8');
  const rule = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    assert.ok(at >= 0, sel);
    return css.slice(at, css.indexOf('}', at));
  };
  assert.match(rule('.wall-caption-line[data-step="trouble"] .wall-caption-val'), new RegExp(`font-size: ${STEPS.why}vmin`));
  assert.match(rule('.wall-caption-part'), /color: var\(--crit\)/);
  assert.match(css, /\.wall-caption-part\[data-tone="warn"\] \{ color: var\(--warn\); \}/);
});

test('caption: the page sets the count\'s parts each with its shape and tone (T23)', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createCaption } = await import('../public/js/wall/caption.js');
  const prevDoc = globalThis.document;
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    return e;
  };
  globalThis.document = doc;
  try {
    const root = makeEl('div');
    root.clientWidth = 1368;
    root.clientHeight = 912;
    const waits = [];
    const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
    const cap = createCaption(root, { timers, timing: CAPTION_TIMING });
    const m = model();
    m.nodes.push({ id: 'l9', parent: 'hv2', kind: 'lane', label: 'feat-x', status: 'attention', why: 'asked a question' });
    cap.show({ kind: 'site', id: 'hv2', arriveMs: 0 }, captionLines(node(m, 'hv2'), m));
    waits.find((w) => w.ms === 0).fn();
    const find = (e, pred, out = []) => { if (pred(e)) out.push(e); for (const c of e.children ?? []) find(c, pred, out); return out; };
    const status = find(root, (e) => e.dataset?.kind === 'status')[0];
    assert.equal(status.dataset.step, 'trouble');
    const parts = find(status, (e) => e.className === 'wall-caption-part');
    assert.deepEqual(parts.map((p) => p.dataset.tone).slice(0, 1), ['crit']);
    assert.ok(parts.some((p) => p.dataset.tone === 'warn'));
    assert.equal(parts[0].children[0].textContent, '■');
    assert.equal(parts[0].children[1].textContent, '1 crit');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('caption: refresh sets a newer model\'s words on the plate up at once, no typing (night 3 T24)', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createCaption } = await import('../public/js/wall/caption.js');
  const prevDoc = globalThis.document;
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    return e;
  };
  globalThis.document = doc;
  try {
    const root = makeEl('div');
    root.clientWidth = 1368;
    root.clientHeight = 912;
    let waits = [];
    const timers = {
      setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; },
      clearTimeout: () => {},
    };
    const cap = createCaption(root, { timers, timing: CAPTION_TIMING });
    const m = model();
    const before = captionLines(node(m, 'hv2'), m);
    // Not up yet: nothing done, the caller shows it.
    assert.equal(cap.refresh(before), false);
    cap.show({ kind: 'site', id: 'hv2', arriveMs: 0 }, before);
    // Play the build and the fade-in, nothing else (the name is still typing).
    for (const w of waits.filter((x) => x.ms === 0)) w.fn();
    waits = [];
    m.nodes.push({ id: 'l9', parent: 'hv2', kind: 'lane', label: 'feat-x', status: 'attention', why: 'asked a question' });
    const after = captionLines(node(m, 'hv2'), m);
    assert.equal(cap.refresh(after), true);
    assert.equal(waits.length, 0, 'no beat scheduled: no typing, no stagger');
    const find = (e, pred, out = []) => { if (pred(e)) out.push(e); for (const c of e.children ?? []) find(c, pred, out); return out; };
    assert.equal(find(root, (e) => e.className === 'wall-caption-typed')[0].textContent, after.name);
    assert.equal(find(root, (e) => e.className === 'wall-caption-cursor')[0].hidden, true);
    const rows = find(root, (e) => e.className === 'wall-caption-line');
    assert.equal(rows.length, after.lines.filter((l) => l.step !== 'hero').length);
    assert.ok(rows.every((r) => !r.hidden && r.style.opacity === '1'), 'every row in at once');
    assert.ok(find(root, (e) => e.className === 'wall-caption-part').some((p) => p.dataset.tone === 'warn'), 'the new count');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('caption: a sheet comes in whole with the plate, nothing typed, no cursor, no stagger (night 3 T25)', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createCaption } = await import('../public/js/wall/caption.js');
  const prevDoc = globalThis.document;
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    return e;
  };
  globalThis.document = doc;
  try {
    const root = makeEl('div');
    root.clientWidth = 1368;
    root.clientHeight = 912;
    const waits = [];
    const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
    const cap = createCaption(root, { timers, timing: CAPTION_TIMING });
    const m = model();
    const sheet = { ...captionLines(node(m, 'hv2'), m), kicker: 'SITE · HV2', sheet: true };
    cap.show({ kind: 'site', id: 'hv2', arriveMs: 2500, sheet: true }, sheet);
    assert.deepEqual(waits.map((w) => w.ms), [0, 2500], 'the build, then the plate with the camera: no letter, cursor or row beats');
    for (const w of waits) w.fn();
    const find = (e, pred, out = []) => { if (pred(e)) out.push(e); for (const c of e.children ?? []) find(c, pred, out); return out; };
    assert.equal(find(root, (e) => e.className === 'wall-caption-typed')[0].textContent, sheet.name);
    assert.equal(find(root, (e) => e.className === 'wall-caption-rest')[0].textContent, '');
    assert.equal(find(root, (e) => e.className === 'wall-caption-cursor')[0].hidden, true, 'no typing cursor');
    const rows = find(root, (e) => e.className === 'wall-caption-line');
    assert.equal(rows.length, sheet.lines.filter((l) => l.step !== 'hero').length);
    assert.ok(rows.every((r) => !r.hidden && r.style.opacity === '1'), 'every row in with the plate');
    const plate = find(root, (e) => e.className === 'wall-caption')[0];
    assert.equal(plate.style.height, `${plateHeight(sheet, Infinity, heroSize(sheet.lines[0].word, 1368, 912))}vmin`, 'at its full height');
    // The tour's plate still types.
    waits.length = 0;
    cap.show({ kind: 'site', id: 'hv2', arriveMs: 0 }, captionLines(node(m, 'hv2'), m));
    assert.ok(waits.length > 10, 'letters and rows each their beat');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('caption targets (Wall night 4 T1): the hero and each shown problem row with its subject, none while hidden', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createCaption } = await import('../public/js/wall/caption.js');
  const { sheetCaption } = await import('../public/js/wall/galaxy/hud.js');
  const prevDoc = globalThis.document;
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    return e;
  };
  globalThis.document = doc;
  try {
    const waits = [];
    const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
    const root = makeEl('div');
    root.clientWidth = 1368;
    root.clientHeight = 912;
    const caption = createCaption(root, { timers, timing: CAPTION_TIMING });
    const m = { nodes: [
      { id: '__core', kind: 'core', status: 'ok' },
      { id: 'hv2', kind: 'site', status: 'ok', parent: '__core' },
      { id: 'hv2-a', kind: 'room', status: 'crit', why: 'disk full', parent: 'hv2' },
      { id: 'hv2-b', kind: 'room', status: 'warn', why: 'slow', parent: 'hv2' },
    ] };
    const site = m.nodes[1];
    assert.deepEqual(captionLines(site, m).lines.filter((l) => l.id).map((l) => [l.kind, l.id]), [['trouble', 'hv2-a'], ['problem', 'hv2-b']]);
    assert.deepEqual(caption.targets(), [], 'nothing before the plate shows');
    caption.show({ kind: 'site', id: 'hv2', arriveMs: 0 }, sheetCaption(site, m));
    for (const w of waits.splice(0)) w.fn();
    const rows = caption.el.children[3].children;
    assert.deepEqual([...rows].map((li) => li.dataset.subject ?? null), [null, 'hv2-b', null], 'the status and count rows name nothing');
    assert.deepEqual(caption.targets().map((t) => t.id), ['hv2-a', 'hv2-b']);
    for (const t of caption.targets()) assert.deepEqual(Object.keys(t.box), ['left', 'top', 'right', 'bottom']);
    caption.hide();
    assert.deepEqual(caption.targets(), [], 'a fading plate opens nothing (its box still covers)');
  } finally {
    globalThis.document = prevDoc;
  }
});
