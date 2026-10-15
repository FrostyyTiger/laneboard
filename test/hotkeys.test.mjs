// The hotkey table and resolver (fleet plan §4 2.6, task D8): every row of
// the table resolves, view-scoped bindings win while their view is active,
// chords time out, terminal focus swallows everything except ⌘K, inputs are
// ignored. Pure: resolve() takes plain objects; no DOM is touched.
import test from 'node:test';
import assert from 'node:assert/strict';

const hk = await import('../public/js/ui/hotkeys.js');
const { resolve, KEYMAP, CHORD_MS, CHORD_PREFIX } = hk;
const { VIEW_KEYS } = await import('../public/js/core/router.js');
const commands = await import('../public/js/core/commands.js');

const T0 = 1_000_000;
const k = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
/** Resolve a key sequence ('g m' is a chord) in `view`. */
function press(seq, ctx = {}) {
  const keys = seq === ' ' ? [' '] : seq.split(' ');
  let chord = null;
  let at = null;
  let out = null;
  for (const [i, key] of keys.entries()) {
    out = resolve(k(key), { view: 'board', now: T0 + i, chord, chordAt: at, ...ctx });
    if (out?.startsWith(CHORD_PREFIX)) { chord = out.slice(CHORD_PREFIX.length); at = T0 + i; } else { chord = null; at = null; }
  }
  return out;
}

// [keys, view, command]: the §4 2.6 table, row by row.
const TABLE = [
  ['g m', 'board', 'view.map'],
  ['g b', 'map', 'view.board'],
  ['g i', 'map', 'view.inbox'],
  ['g p', 'map', 'view.packages'],
  ['g x', 'map', 'view.box'],
  ['g a', 'map', 'view.audit'],
  ['g c', 'map', 'view.credit'],
  ['g o', 'map', 'view.morning'],
  ['[', 'board', 'builder.prev'],
  [']', 'board', 'builder.next'],
  ['0', 'board', 'builder.all'],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), 'board', `builder.${n}`]),
  ['j', 'board', 'cursor.next'],
  ['k', 'board', 'cursor.prev'],
  ['j', 'map', 'cursor.next'],
  ['k', 'map', 'cursor.prev'],
  ['Enter', 'board', 'drill.down'],
  ['u', 'board', 'drill.up'],
  ['Backspace', 'board', 'drill.up'],
  ['/', 'map', 'find'],
  ['/', 'board', 'find'],
  ['f', 'map', 'map.fit'],
  ['c', 'map', 'map.fold'],
  ['o', 'map', 'map.overlay.next'],
  ['O', 'map', 'map.overlay.prev'],
  ['a', 'inbox', 'inbox.approve'],
  ['d', 'inbox', 'inbox.deny'],
  ['r', 'inbox', 'inbox.release'],
  ['p', 'inbox', 'inbox.pause'],
  ['c', 'diff', 'diff.comment'],
  ['p', 'board', 'lane.pin'],
  ['a', 'board', 'alarm.ack'],
  ['A', 'board', 'alarm.ack-all'],
  [':', 'board', 'palette.act'],
  ['\\', 'map', 'split.toggle'],
  ['`', 'board', 'tape.toggle'],
  ['?', 'board', 'help'],
  ['Escape', 'board', 'layer.close'],
  ['n', 'board', 'attention.next'],
  ['N', 'board', 'attention.prev'],
];

test('every row of the §4 2.6 table resolves', () => {
  for (const [keys, view, id] of TABLE) {
    assert.equal(press(keys, { view }), id, `${keys} in ${view}`);
  }
  assert.equal(resolve(k('k', { metaKey: true }), { view: 'board' }), 'palette.open', '⌘K');
  assert.equal(resolve(k('K', { metaKey: true, shiftKey: true }), { view: 'board' }), 'palette.open', '⌘⇧K too');
  assert.equal(resolve(k('k', { ctrlKey: true }), { view: 'board' }), 'palette.open', 'Ctrl-K outside a terminal');
});

test('every KEYMAP row is exercised by the table above, and every key/view pair is unique', () => {
  const ids = new Set(TABLE.map((r) => r[2]).concat('palette.open'));
  for (const r of KEYMAP) assert.ok(ids.has(r.id), `${r.id} has a table row`);
  const seen = new Set();
  for (const r of KEYMAP) {
    for (const key of r.keys) {
      const sig = `${key}@${r.view ?? '*'}`;
      assert.ok(!seen.has(sig), `${sig} is bound twice`);
      seen.add(sig);
    }
  }
});

test('the view chord is the router\'s VIEW_KEYS table', () => {
  const chords = Object.fromEntries(KEYMAP.filter((r) => r.keys[0].startsWith('g ')).map((r) => [r.keys[0].slice(2), r.id.replace(/^view\./, '')]));
  assert.deepEqual(chords, { ...VIEW_KEYS });
});

test('view-scoped bindings win while their view is active, and only then', () => {
  assert.equal(press('a', { view: 'inbox' }), 'inbox.approve');
  assert.equal(press('a', { view: 'map' }), 'alarm.ack');
  assert.equal(press('p', { view: 'inbox' }), 'inbox.pause');
  assert.equal(press('p', { view: 'board' }), 'lane.pin');
  assert.equal(press('c', { view: 'map' }), 'map.fold');
  assert.equal(press('c', { view: 'diff' }), 'diff.comment');
  assert.equal(press('c', { view: 'board' }), null, 'c means nothing on the board');
  assert.equal(press('f', { view: 'board' }), null, 'f is map-scoped');
  assert.equal(press('o', { view: 'inbox' }), null, 'o is map-scoped');
  assert.equal(press('d', { view: 'board' }), null, 'd is inbox-scoped');
  // The chord still beats the inbox's `a`: `g a` is the audit view everywhere.
  assert.equal(press('g a', { view: 'inbox' }), 'view.audit');
  // A row whose view is active wins regardless of its place in the table.
  const map = [
    { keys: ['x'], id: 'global.x', view: null },
    { keys: ['x'], id: 'box.x', view: 'box' },
  ];
  assert.equal(resolve(k('x'), { view: 'box', keymap: map }), 'box.x');
  assert.equal(resolve(k('x'), { view: 'map', keymap: map }), 'global.x');
});

test('chords time out after CHORD_MS', () => {
  assert.equal(CHORD_MS, 1000);
  assert.equal(resolve(k('g'), { view: 'board', now: T0 }), 'chord:g');
  assert.equal(resolve(k('m'), { view: 'board', chord: 'g', chordAt: T0, now: T0 + 999 }), 'view.map');
  assert.equal(resolve(k('m'), { view: 'board', chord: 'g', chordAt: T0, now: T0 + 1000 }), null, 'a late m is just m');
  assert.equal(resolve(k('b'), { view: 'board', chord: 'g', chordAt: T0, now: T0 + 5000 }), null);
  // An expired chord lets the key count on its own.
  assert.equal(resolve(k('j'), { view: 'board', chord: 'g', chordAt: T0, now: T0 + 1500 }), 'cursor.next');
  // A key that completes no chord counts on its own too (a stray g swallows nothing).
  assert.equal(resolve(k('j'), { view: 'board', chord: 'g', chordAt: T0, now: T0 + 10 }), 'cursor.next');
  assert.equal(resolve(k('g'), { view: 'board', chord: 'g', chordAt: T0, now: T0 + 10 }), 'chord:g', 'g g restarts the chord');
});

test('terminal focus swallows every key except ⌘K', () => {
  const ctx = { view: 'board', inTerminal: true, now: T0 };
  for (const [keys] of TABLE) {
    for (const key of keys.split(' ')) assert.equal(resolve(k(key), ctx), null, `${key} goes to the terminal`);
  }
  assert.equal(resolve(k('k', { ctrlKey: true }), ctx), null, 'Ctrl-K is readline kill-line');
  assert.equal(resolve(k('Escape'), ctx), null, 'Esc interrupts Claude Code');
  assert.equal(resolve(k('c', { ctrlKey: true }), ctx), null);
  assert.equal(resolve(k('k', { metaKey: true }), ctx), 'palette.open', '⌘K still opens the palette');
  // A pending chord does not reach into the terminal either.
  assert.equal(resolve(k('m'), { ...ctx, chord: 'g', chordAt: T0 }), null);
});

test('keyBelongsToTerminal finds xterm, the term host and the sheet body', () => {
  const at = (sel) => ({ closest: (q) => (q.split(',').map((s) => s.trim()).includes(sel) ? {} : null) });
  assert.equal(hk.keyBelongsToTerminal(at('.xterm')), true);
  assert.equal(hk.keyBelongsToTerminal(at('.sheet-body')), true);
  assert.equal(hk.keyBelongsToTerminal(at('.xterm-helper-textarea')), true);
  assert.equal(hk.keyBelongsToTerminal({ closest: () => null }), false);
  assert.equal(hk.keyBelongsToTerminal(null), false);
  assert.equal(hk.keyBelongsToTerminal(globalThis), false);
});

test('inputs, open dialogs and other modifiers are ignored', () => {
  for (const key of ['j', 'g', 'Escape', '/', 'a', '1', '?', ':']) {
    assert.equal(resolve(k(key), { view: 'board', inInput: true }), null, `${key} types into the input`);
    assert.equal(resolve(k(key), { view: 'board', dialogOpen: true }), null, `${key} belongs to the dialog`);
  }
  assert.equal(resolve(k('k', { ctrlKey: true }), { view: 'board', inInput: true }), 'palette.open');
  assert.equal(resolve(k('k', { metaKey: true }), { view: 'board', dialogOpen: true }), 'palette.open', '⌘K toggles the palette');
  for (const mods of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    assert.equal(resolve(k('j', mods), { view: 'board' }), null, JSON.stringify(mods));
  }
  assert.equal(resolve(k('k', { metaKey: true, ctrlKey: true }), { view: 'board' }), null);
  assert.equal(resolve({}, {}), null);
  assert.equal(resolve(null, {}), null);
});

test('a focused list or button keeps its own keys', () => {
  assert.equal(resolve(k('j'), { view: 'audit', inList: true }), null);
  assert.equal(resolve(k('Enter'), { view: 'audit', inList: true }), null);
  assert.equal(resolve(k('g'), { view: 'audit', inList: true }), 'chord:g', 'chords still work from a table');
  assert.equal(resolve(k('Enter'), { view: 'board', inControl: true }), null, 'Enter clicks the button');
  assert.equal(resolve(k('j'), { view: 'board', inControl: true }), 'cursor.next');
});

test('the commands this module owns are registered for every non-view-owned row', () => {
  hk.registerCommands();
  hk.registerCommands(); // idempotent
  const external = new Set(['inbox.approve', 'inbox.deny', 'inbox.release', 'inbox.pause', 'diff.comment']);
  for (const r of KEYMAP) {
    if (external.has(r.id)) continue;
    assert.ok(commands.get(r.id), `${r.id} is registered`);
  }
  // View commands are typed VIEW for the palette; map commands only show on the map.
  assert.equal(commands.get('view.map').type, 'VIEW');
  const onBoard = commands.list({ view: 'board' }).map((c) => c.id);
  assert.ok(!onBoard.includes('map.fit'));
  assert.ok(commands.list({ view: 'map' }).some((c) => c.id === 'map.fit'));
  // Session actions sit behind a dialog tier.
  assert.equal(commands.get('act.kill').tier, 'confirm');
  assert.equal(commands.get('act.interrupt').tier, 'ask', 'a destructive click is lifted to ask');
});

test('the help model lists every row; key labels are readable', () => {
  const rows = hk.helpModel().flatMap((g) => g.rows);
  assert.equal(rows.length, KEYMAP.length);
  assert.ok(rows.some((r) => r.keys === '⌘K / Ctrl-K'));
  assert.ok(rows.some((r) => r.keys === 'u / ⌫'));
  assert.equal(hk.keyLabel('Escape'), 'Esc');
  assert.equal(hk.keysFor('view.map'), 'g m');
  assert.equal(hk.keysFor('inbox.approve', 'inbox'), 'a');
  assert.equal(hk.keysFor('nope'), '');
});

test('builder cycling: [ ] wrap through all and the builders, in rail order', () => {
  const ids = ['builder-a', 'builder-b'];
  assert.equal(hk.stepBuilder(ids, 'all', 1), 'builder-a');
  assert.equal(hk.stepBuilder(ids, 'builder-b', 1), 'all');
  assert.equal(hk.stepBuilder(ids, 'all', -1), 'builder-b');
  assert.equal(hk.stepBuilder(ids, null, 1), 'builder-a');
  assert.equal(hk.stepBuilder(ids, 'gone', -1), 'builder-b');
  assert.equal(hk.stepBuilder([], 'all', 1), 'all');
});

test('n / N walk the alarm lanes worst first; a acks the focused alarm', () => {
  const alarms = [
    { id: 'a1', kind: 'ci-red', priority: 'P3', builder: 'builder-a', target: 'docs', since: 1, acked: false },
    { id: 'a2', kind: 'permission', priority: 'P1', builder: 'builder-b', target: 'auth', since: 5, acked: false },
    { id: 'a3', kind: 'stuck', priority: 'P2', builder: 'builder-a', target: 'api', since: 2, acked: true },
    { id: 'a4', kind: 'question', priority: 'P1', builder: 'builder-a', target: 'auth', since: 3, acked: false },
    { id: 'a5', kind: 'health-warn', priority: 'P2', builder: 'builder-a', since: 3, acked: false },
  ];
  const keys = hk.attentionKeys(alarms);
  assert.deepEqual(keys, ['builder-a/auth', 'builder-b/auth', 'builder-a/docs']);
  assert.equal(hk.stepKey(keys, null, 1), 'builder-a/auth');
  assert.equal(hk.stepKey(keys, null, -1), 'builder-a/docs');
  assert.equal(hk.stepKey(keys, 'builder-a/docs', 1), 'builder-a/auth');
  assert.equal(hk.stepKey(keys, 'builder-a/auth', -1), 'builder-a/docs');
  assert.equal(hk.stepKey([], null, 1), null);
  // No alarm names a lane: the attention list's keys.
  assert.deepEqual(hk.attentionKeys([], [{ key: 'builder-a/x' }, { key: 'builder-a/x' }, { key: '' }]), ['builder-a/x']);
  assert.equal(hk.alarmKey({ builder: 'builder-a', target: '' }), null);
  assert.equal(hk.alarmKey({ builder: 'Bad Id', target: 'x' }), null);

  assert.equal(hk.focusedAlarm(alarms, { focus: 'builder-a/docs' }).id, 'a1');
  assert.equal(hk.focusedAlarm(alarms, { focus: 'a2' }).id, 'a2');
  assert.equal(hk.focusedAlarm(alarms, {}).id, 'a4', 'else the worst unacked');
  assert.equal(hk.focusedAlarm(alarms, { focus: 'builder-a/api' }).id, 'a4', 'an acked alarm is not acked again');
  assert.equal(hk.focusedAlarm(alarms, { b: 'builder-b' }).id, 'a2', 'scope limits the fallback');
  assert.equal(hk.focusedAlarm([], {}), null);
});

test('split toggles lb.split between 1 and 0', () => {
  assert.equal(hk.toggledSplit(null), '1');
  assert.equal(hk.toggledSplit('1'), '0');
  assert.equal(hk.toggledSplit('0'), '1');
});

test('the command registry: when gates, errors are contained, ids are validated', () => {
  const r = commands.createRegistry();
  const seen = [];
  const off = r.register({ id: 'x.run', title: 'X', run: (ctx) => { seen.push(ctx.v); return 7; }, when: (ctx) => ctx.v !== 'no' });
  r.register({ id: 'x.boom', run: () => { throw new Error('boom'); } });
  r.register({ id: 'x.badwhen', run: () => 1, when: () => { throw new Error('w'); } });
  assert.deepEqual(r.run('x.run', { v: 'yes' }), { ok: true, value: 7 });
  assert.deepEqual(r.run('x.run', { v: 'no' }), { ok: false, reason: 'unavailable' });
  assert.equal(r.run('x.boom', {}).reason, 'error');
  assert.equal(r.run('x.badwhen', {}).reason, 'unavailable');
  assert.equal(r.run('nope', {}).reason, 'unknown');
  assert.deepEqual(r.list({ v: 'yes' }).map((c) => c.id), ['x.run', 'x.boom']);
  assert.equal(r.get('x.boom').title, 'x.boom', 'title falls back to the id');
  assert.throws(() => r.register({ id: 'Bad Id', run: () => {} }), TypeError);
  assert.throws(() => r.register({ id: 'x.norun' }), TypeError);
  assert.throws(() => r.register({ id: 'x.tier', run: () => {}, tier: 'yolo' }), TypeError);
  off();
  assert.equal(r.get('x.run'), null);
  assert.deepEqual(seen, ['yes']);
});

test('the palette and the help overlay render in a fake DOM with text only', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const doc = makeDocument();
  const mk = doc.createElement;
  doc.createElement = (t) => {
    const el = mk(t);
    el.hasAttribute = (n) => Object.hasOwn(el.attrs, n);
    el.removeAttribute = (n) => { delete el.attrs[n]; };
    return el;
  };
  const saved = { document: globalThis.document, localStorage: globalThis.localStorage };
  const mem = new Map();
  globalThis.document = doc;
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  try {
    const pal = await import('../public/js/ui/palette.js');
    const { createStore } = await import('../public/js/core/store.js');
    const s = createStore();
    const evil = '<img src=x onerror=alert(1)>';
    s.builders.set('builder-a', { id: 'builder-a', code: 'B1', status: 'live', sessions: new Map() });
    s.lanes = [{ id: evil, builder: 'builder-a', key: `builder-a/${evil}` }];
    s.alarms = [{ id: 'x1', priority: 'P1', builder: 'builder-a', target: evil, acked: false }];
    hk.registerCommands();
    assert.equal(pal.openPalette({ ctx: { store: s, view: 'board', route: { sel: null } } }), true);
    assert.equal(pal.isPaletteOpen(), true);
    const dlg = doc.body.children.find((c) => c.className === 'pal');
    assert.ok(dlg, 'a <dialog class="pal"> in the body');
    const [input, list] = dlg.children;
    assert.equal(input.attrs.role, 'combobox');
    assert.equal(input.attrs['aria-controls'], 'pal-list');
    assert.equal(list.attrs.role, 'listbox');
    const rows = list.children;
    assert.ok(rows.length >= 2, 'alarm lane + views');
    assert.equal(rows[0].attrs.role, 'option');
    assert.equal(rows[0].attrs['aria-selected'], 'true', 'the first row is active');
    assert.equal(input.attrs['aria-activedescendant'], rows[0].id);
    // The alarm lane comes first on an empty query, and its hostile name is plain text.
    const label = rows[0].children.find((c) => c.className === 'pal-l');
    assert.equal(label._text, evil);
    assert.equal(label.children.length, 0);
    for (const r of rows) assert.equal(r.innerHTML, '', 'no markup is ever parsed');
    // `:` presets `>`: only ACT/VIEW rows.
    pal.openPalette({ preset: '>', ctx: { store: s, view: 'board', route: { sel: null } } });
    assert.equal(input.value, '>');
    const plates = list.children.map((r) => r.children.find((c) => c.classList.contains('pal-type'))?.textContent);
    assert.ok(plates.length && plates.every((t) => t === 'ACT' || t === 'VIEW'), plates.join(','));
    pal.closePalette();
    assert.equal(pal.isPaletteOpen(), false);

    assert.equal(hk.openHelp(), true);
    const help = doc.body.children.find((c) => c.className === 'pal pal-help');
    assert.ok(help, 'the ? overlay');
    const kbds = [];
    const walk = (n) => { for (const c of n.children) { if (c.tagName === 'KBD') kbds.push(c.textContent); walk(c); } };
    walk(help);
    assert.equal(kbds.length, KEYMAP.length, 'one entry per KEYMAP row');
    void makeEl;
  } finally {
    globalThis.document = saved.document;
    globalThis.localStorage = saved.localStorage;
  }
});
