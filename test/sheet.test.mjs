// The phone shell (fleet D6b, plan §4 2.4 "Phone <700"): the pure snap model
// snapFor(y, vy, h), the strip/peek/row models, the L4 mode of openSheet, and
// a fake-DOM render that keeps builder text out of markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument, makeEl, texts } from './helpers/fakedom.mjs';
import {
  FLICK_PX_MS, FULL_GAP_PX, L4_MODES, MORE_VIEWS, PEEK_PX, SHEET_TABS, SNAPS,
  builderP, litTab, normTab, peekModel, pickTab, renderPhone, routeTab, renderStrip, sheetRow, sheetRows,
  snapFor, snapTops, stepSnap, stripModel, openSheet, closeSheet, setSnap, currentSnap,
} from '../public/js/ui/sheet.js';
import { store } from '../public/js/core/store.js';
import { builderLamp as railLamp } from '../public/js/ui/rail.js';
import { laneMix } from '../public/js/ui/components.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// --- fixtures -------------------------------------------------------------------

function builder(id, sessions, extra = {}) {
  const m = new Map();
  for (const s of sessions) m.set(`${id}/${s.name}`, { builder: id, key: `${id}/${s.name}`, ...s });
  return { id, code: extra.code ?? id.slice(-2).toUpperCase(), status: extra.status ?? 'live', sessions: m };
}

function fleet() {
  const a = builder('builder-a', [
    { name: 'auth', state: 'waiting_permission', stateSince: 100 },
    { name: 'web', state: 'working', stateSince: 300 },
    { name: 'docs', state: 'idle', stateSince: 50 },
  ], { code: 'B1' });
  const b = builder('builder-b', [
    { name: 'api', state: 'waiting_question', stateSince: 200 },
    { name: 'ci', state: 'done', stateSince: 400 },
  ], { code: 'B2' });
  const c = builder('builder-c', [{ name: 'x', state: 'working' }], { code: 'B3', status: 'down' });
  return {
    builders: new Map([[a.id, a], [b.id, b], [c.id, c]]),
    attention: [
      { builder: 'builder-a', key: 'builder-a/auth', name: 'auth', state: 'waiting_permission', since: 100, score: 9 },
      { builder: 'builder-b', key: 'builder-b/api', name: 'api', state: 'waiting_question', since: 200, score: 5 },
    ],
    alarms: [
      { id: 'a1', kind: 'stuck', priority: 'P2', builder: 'builder-a', target: 'web', text: 'no output 20m', since: 10, acked: false },
      { id: 'a2', kind: 'builder-down', priority: 'P1', builder: 'builder-c', target: '*', text: 'link lost', since: 20, acked: true },
    ],
  };
}

// --- snapTops / snapFor ------------------------------------------------------------

test('the snap points: peek 96px, half the screen, full 80px from the top', () => {
  assert.deepEqual(SNAPS, ['peek', 'half', 'full']);
  assert.equal(PEEK_PX, 96);
  assert.equal(FULL_GAP_PX, 80);
  assert.equal(FLICK_PX_MS, 0.5);
  assert.deepEqual(snapTops(800), { peek: 704, half: 400, full: 80 });
  assert.deepEqual(snapTops(800, { safeTop: 20, safeBottom: 34 }), { peek: 670, half: 400, full: 100 });
});

test('snapTops keeps full <= half <= peek on a tiny or bogus viewport', () => {
  for (const h of [0, 50, 120, 170, -5, NaN, 'x', undefined]) {
    const t = snapTops(h);
    assert.ok(t.full <= t.half && t.half <= t.peek, `${h}: ${JSON.stringify(t)}`);
    assert.ok(t.full >= 0);
  }
});

test('a slow release snaps to the nearest point', () => {
  const h = 800; // peek 704, half 400, full 80
  assert.equal(snapFor(704, 0, h), 'peek');
  assert.equal(snapFor(600, 0, h), 'peek');
  assert.equal(snapFor(540, 0, h), 'half');
  assert.equal(snapFor(400, 0.2, h), 'half');
  assert.equal(snapFor(260, -0.3, h), 'half');
  assert.equal(snapFor(220, -0.3, h), 'full');
  assert.equal(snapFor(10, 0, h), 'full');
  assert.equal(snapFor(900, 0, h), 'peek');
});

test('a flick over 0.5 px/ms goes to the next point in its direction', () => {
  const h = 800;
  // Upward (negative vy): the next point above the edge.
  assert.equal(snapFor(690, -0.8, h), 'half');
  assert.equal(snapFor(420, -0.8, h), 'half');
  assert.equal(snapFor(399, -0.8, h), 'full');
  assert.equal(snapFor(80, -2, h), 'full');
  // Downward: the next point below the edge, even when nearer another one.
  assert.equal(snapFor(100, 0.8, h), 'half');
  assert.equal(snapFor(401, 0.8, h), 'peek');
  assert.equal(snapFor(704, 3, h), 'peek');
  // Exactly the threshold is not a flick.
  assert.equal(snapFor(100, 0.5, h), 'full');
  assert.equal(snapFor(600, -0.5, h), 'peek');
});

test('snapFor never returns anything but a snap name', () => {
  for (const [y, vy, h] of [[NaN, NaN, NaN], [null, 'x', 0], [1e9, -1e9, 10], [-50, 0, 600]]) {
    assert.ok(SNAPS.includes(snapFor(y, vy, h)), `${y},${vy},${h}`);
  }
});

test('the keyboard steps one snap at a time and clamps', () => {
  assert.equal(stepSnap('peek', 1), 'half');
  assert.equal(stepSnap('half', 1), 'full');
  assert.equal(stepSnap('full', 1), 'full');
  assert.equal(stepSnap('full', -1), 'half');
  assert.equal(stepSnap('peek', -1), 'peek');
  assert.equal(stepSnap('bogus', 1), 'half');
  assert.equal(stepSnap('half', 0), 'half');
});

// --- models ---------------------------------------------------------------------------

test('tabs: MAP, LIST, INBOX; the ⋯ menu holds the other nav views', () => {
  assert.deepEqual(SHEET_TABS, ['map', 'list', 'inbox']);
  assert.equal(normTab('list'), 'list');
  assert.equal(normTab('<script>'), 'map');
  assert.equal(normTab(null), 'map');
  for (const v of MORE_VIEWS) assert.ok(!SHEET_TABS.includes(v));
  assert.ok(MORE_VIEWS.includes('board') && MORE_VIEWS.includes('audit'));
});

test('builderP: the shared builder mark (worst lane or alarm), p1 when the link is down, stale when stale', () => {
  const f = fleet();
  assert.equal(builderP(f.builders.get('builder-a')), '1');
  assert.equal(builderP(f.builders.get('builder-b')), '2');
  assert.equal(builderP(f.builders.get('builder-c')), '1', 'down is p1, as the rail row');
  assert.equal(builderP(builder('s', [{ name: 'x', state: 'working' }], { status: 'stale' })), 'stale');
  assert.equal(builderP(builder('e', [])), 'ok');
  assert.equal(builderP(builder('w', [{ name: 'x', state: 'working' }])), 'run');
  assert.equal(builderP(builder('e', []), [{ builder: 'e', priority: 'P1', acked: false }]), '1', 'an alarm counts too');
  assert.equal(builderP(null), 'off');
});

test('T43: one builder with a PERM and a QUES lane gets the same mark on the rail row and the phone chip', () => {
  const b = builder('builder-a', [
    { name: 'feat-search', state: 'waiting_permission' },
    { name: 'fix-login', state: 'waiting_question' },
  ], { code: 'BA' });
  for (const al of [[], [{ id: 'q', kind: 'needs-input', priority: 'P2', builder: 'builder-a', acked: false }]]) {
    const s = { builders: new Map([[b.id, b]]), attention: [], alarms: al };
    const chip = stripModel(s, {})[1];
    const row = railLamp(b, al, laneMix([...b.sessions.values()]));
    assert.equal(chip.p, '1', 'worst lane state wins: the permission lane');
    assert.equal(row.p, chip.p);
    assert.equal(chip.label, row.label);
  }
});

test('stripModel: ALL first, then each builder by id, on follows b=', () => {
  const f = fleet();
  const all = stripModel(f, { b: null });
  assert.deepEqual(all.map((c) => c.id), ['all', 'builder-a', 'builder-b', 'builder-c']);
  assert.deepEqual(all.map((c) => c.code), ['ALL', 'B1', 'B2', 'B3']);
  assert.deepEqual(all.map((c) => c.on), [true, false, false, false]);
  assert.equal(all[0].p, '1', 'ALL carries the worst live lamp');
  assert.equal(all[3].p, '1', 'down is p1, as the rail row');
  const one = stripModel(f, { b: 'builder-b' });
  assert.deepEqual(one.map((c) => c.on), [false, false, true, false]);
  assert.deepEqual(stripModel({ builders: new Map() }, {}).map((c) => c.id), ['all']);
});

test('peekModel: counts in scope and the latest event', () => {
  const f = fleet();
  const pk = peekModel(f);
  assert.equal(pk.p1, 1);
  assert.equal(pk.p2, 1);
  assert.equal(pk.run, 2);
  assert.equal(pk.total, 6);
  assert.equal(pk.latest.key, 'builder-a/auth');
  assert.equal(pk.latest.p, '1');
  assert.match(pk.latest.text, /^B1\/auth /);
  const b = peekModel(f, 'builder-b');
  assert.equal(b.total, 2);
  assert.equal(b.latest.key, 'builder-b/api');
  // No needs-you: the most recently changed session.
  const quiet = peekModel({ ...f, attention: [] }, 'builder-b');
  assert.equal(quiet.latest.key, 'builder-b/ci');
  assert.equal(peekModel({ builders: new Map(), attention: [] }).latest, null);
});

test('sheetRows: MAP needs-you, LIST every session worst first, INBOX alarms', () => {
  const f = fleet();
  const map = sheetRows(f, 'map');
  assert.deepEqual(map.map((r) => r.sel), ['builder-a/auth', 'builder-b/api']);
  const list = sheetRows(f, 'list');
  assert.equal(list.length, 6);
  assert.deepEqual(list.slice(0, 2).map((r) => r.sel), ['builder-a/auth', 'builder-b/api']);
  assert.deepEqual(sheetRows(f, 'list', 'builder-a').map((r) => r.sel), ['builder-a/auth', 'builder-a/web', 'builder-a/docs']);
  const inbox = sheetRows(f, 'inbox');
  assert.equal(inbox.length, 2);
  assert.equal(inbox[0].sel, 'builder-a/web');
  assert.equal(inbox[0].p, '2');
  assert.equal(inbox[0].unack, true);
  assert.equal(inbox[1].sel, null, 'a fleet-wide alarm selects nothing');
  assert.equal(inbox[1].p, '1');
  assert.deepEqual(sheetRows(f, 'inbox', 'builder-b'), []);
  assert.deepEqual(sheetRows(f, 'nonsense').map((r) => r.sel), map.map((r) => r.sel));
});

test('one builder: rows show the bare name, no code prefix', () => {
  const a = builder('builder-a', [{ name: 'auth', state: 'working' }]);
  const rows = sheetRows({ builders: new Map([[a.id, a]]), attention: [], alarms: [] }, 'list');
  assert.equal(rows[0].name, 'auth');
});

// --- fake DOM ---------------------------------------------------------------------------

/** Run fn with a fake page (document, location, ...) on globalThis. */
async function withPage(byIdList, { width = 400, hash = '#/' } = {}, fn) {
  const byId = new Map(byIdList.map((id) => [id, makeEl('div')]));
  const saved = {};
  const set = (k, v) => { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
  const storage = {};
  set('document', makeDocument({ byId }));
  set('location', { hash, protocol: 'http:', host: 'x', pathname: '/' });
  set('history', { replaceState(_s, _t, url) { globalThis.location.hash = url; } });
  set('localStorage', { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = String(v); } });
  set('innerWidth', width);
  set('innerHeight', 800);
  set('setTimeout', () => 0);
  set('clearTimeout', () => {});
  try {
    return await fn(byId);
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
}

const EVIL = '<img src=x onerror=alert(1)>';

test('the strip and rows carry builder text as text, never as markup', async () => {
  await withPage([], {}, () => {
    const box = makeEl('div');
    renderStrip(box, [{ id: 'all', code: 'ALL', p: '1', on: true, title: 'Every builder' }, { id: 'builder-a', code: EVIL, p: 'stale', on: false, title: `builder-a · ${EVIL}` }]);
    assert.equal(box.children.length, 2);
    assert.equal(box.children[0].attrs['aria-pressed'], 'true');
    assert.equal(box.children[1].dataset.b, 'builder-a');
    assert.ok(texts(box).includes(EVIL));
    const row = sheetRow({ sel: 'builder-a/auth', p: '1', unack: true, name: EVIL, sub: EVIL, since: null });
    assert.equal(row.tagName, 'BUTTON');
    assert.ok(texts(row).includes(EVIL));
    for (const n of [box, row]) {
      const walk = (x) => { assert.equal(x.innerHTML, '', 'no innerHTML'); x.children.forEach(walk); };
      walk(n);
    }
    assert.equal(sheetRow({ sel: null, p: 'off', name: 'x', sub: '', since: null }).tagName, 'DIV');
  });
});

test('renderPhone fills #shell-strip and #shell-sheet on a phone, hides the sheet on desktop', async () => {
  const saved = { builders: store.builders, attention: store.attention, alarms: store.alarms };
  const f = fleet();
  store.builders = f.builders;
  store.attention = f.attention;
  store.alarms = f.alarms;
  try {
    await withPage(['shell-strip', 'shell-sheet'], { width: 400 }, (byId) => {
      const sheet = byId.get('shell-sheet');
      sheet.hidden = true;
      renderPhone();
      assert.equal(sheet.hidden, false);
      assert.equal(byId.get('shell-strip').children.length, 4);
      assert.equal(sheet.dataset.snap, currentSnap());
      const [head, peek, body] = sheet.children;
      const [handle, seg] = head.children;
      assert.equal(handle.attrs.role, 'slider');
      assert.equal(handle.attrs['aria-valuetext'], currentSnap());
      assert.equal(seg.attrs.role, 'tablist');
      assert.deepEqual(seg.children.map((t) => t.textContent), ['MAP', 'LIST', 'INBOX']);
      assert.equal(seg.children.filter((t) => t.attrs['aria-selected'] === 'true').length, 1);
      assert.equal(peek.dataset.sel, 'builder-a/auth');
      assert.ok(body.children.some((r) => r.dataset.sel === 'builder-b/api'));
      setSnap('full');
      assert.equal(sheet.dataset.snap, 'full');
      assert.equal(handle.attrs['aria-valuenow'], '2');
      setSnap('nope');
      assert.equal(sheet.dataset.snap, 'peek');
    });
    await withPage(['shell-strip', 'shell-sheet'], { width: 1400 }, (byId) => {
      renderPhone();
      assert.equal(byId.get('shell-sheet').hidden, true);
    });
  } finally {
    Object.assign(store, saved);
  }
});

test('routeTab / litTab: Board and Runs fall under LIST, a view with no segment lights none, a pick wins', () => {
  assert.equal(routeTab('map'), 'map');
  assert.equal(routeTab('board'), 'list');
  assert.equal(routeTab('runs'), 'list');
  assert.equal(routeTab('inbox'), 'inbox');
  for (const v of ['morning', 'packages', 'credit', 'box', 'audit', 'constructor', undefined]) assert.equal(routeTab(v), null, String(v));
  assert.equal(litTab('inbox'), 'inbox');
  assert.equal(litTab('morning'), null);
  assert.equal(litTab('inbox', 'map'), 'map');
  assert.equal(litTab('runs', 'bogus'), 'list');
});

test('renderPhone lights the one segment of the current route (r10-designer across 3)', async () => {
  const saved = { builders: store.builders, attention: store.attention, alarms: store.alarms };
  const f = fleet();
  store.builders = f.builders;
  store.attention = f.attention;
  store.alarms = f.alarms;
  const lit = (sheet) => sheet.children[0].children[1].children.filter((t) => t.attrs['aria-selected'] === 'true').map((t) => t.textContent);
  try {
    await withPage(['shell-strip', 'shell-sheet'], { width: 390 }, (byId) => {
      const sheet = byId.get('shell-sheet');
      const want = { '#/': ['MAP'], '#/board': ['LIST'], '#/runs': ['LIST'], '#/runs?run=acme-search': ['LIST'], '#/inbox': ['INBOX'], '#/morning': [], '#/audit': [] };
      for (const [hash, tabs] of Object.entries(want)) {
        location.hash = hash;
        renderPhone();
        assert.deepEqual(lit(sheet), tabs, hash);
      }
      // The content follows the route too: the Inbox shows the alarms.
      location.hash = '#/inbox';
      renderPhone();
      assert.ok(sheet.children[2].children.some((n) => n.textContent === 'Open INBOX'));
      // A tap lights the picked segment on this view; the next view lights its own again.
      pickTab('map');
      assert.deepEqual(lit(sheet), ['MAP']);
      location.hash = '#/inbox?sel=builder-a/web';
      renderPhone();
      assert.deepEqual(lit(sheet), ['MAP'], 'a selection on the same view keeps the pick');
      location.hash = '#/board';
      renderPhone();
      assert.deepEqual(lit(sheet), ['LIST']);
    });
  } finally {
    Object.assign(store, saved);
  }
});

test('openSheet: L4 mode centre or sheet; a re-open without a mode keeps it', async () => {
  const savedSessions = store.sessions;
  store.sessions = new Map([['builder-a/web', { key: 'builder-a/web', name: 'web', state: 'working', builder: 'builder-a' }]]);
  try {
    await withPage(['sheet', 'sheet-title', 'sheet-state', 'sheet-body'], { width: 1400, hash: '#/board' }, (byId) => {
      byId.get('sheet').hidden = true;
      assert.deepEqual(L4_MODES, ['sheet', 'centre']);
      openSheet('builder-a/web');
      assert.equal(byId.get('sheet').dataset.mode, 'sheet', 'the default stays the full-screen sheet');
      assert.equal(byId.get('sheet').hidden, false);
      openSheet('builder-a/web', { mode: 'centre' });
      assert.equal(byId.get('sheet').dataset.mode, 'centre');
      openSheet('builder-a/web');
      assert.equal(byId.get('sheet').dataset.mode, 'centre', 'the route re-open keeps the mode');
      closeSheet();
      assert.equal(byId.get('sheet').hidden, true);
      openSheet('builder-a/web', { mode: 'bogus' });
      assert.equal(byId.get('sheet').dataset.mode, 'sheet');
      closeSheet();
    });
  } finally {
    store.sessions = savedSessions;
    store.openSession = null;
  }
});

// --- phone.css ------------------------------------------------------------------------------

test('phone.css: 44px touch targets, transform-only snaps, linked by the page', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/phone.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/css\/phone\.css">/);
  for (const sel of ['.ps-handle', '.ps-more']) {
    const rule = new RegExp(`\\${sel} \\{[^}]*width: 44px;[^}]*height: 44px;`);
    assert.match(css, rule, `${sel} is 44x44`);
  }
  assert.match(css, /\.ps-peek, \.ps-row \{[^}]*min-height: var\(--row-touch\)/);
  assert.match(css, /\.strip-chip::after \{[^}]*inset: -4px 0;/, '36px chip, 44px hit area');
  assert.match(css, /\.shell-sheet\[data-snap="half"\] \{ transform: translateY\(calc\(100% - 50dvh\)\); \}/);
  assert.match(css, /translateY\(calc\(100% - var\(--sheet-peek\)/, 'the peek comes from the tokens.css token');
  assert.match(css, /\.sheet\[data-mode="centre"\]/);
  assert.doesNotMatch(css, /transition:[^;]*\b(height|top|bottom)\b/, 'the sheet moves by transform only');
});

// Seen at 390 (shots r8-T3 page-end): the last row of a view stayed under the sheet's peek,
// because misc.css reserved 68 px for a peek of about 95 px.
test('a phone view reserves at least the sheet peek at its bottom, from the one token (T23)', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'public/css/tokens.css'), 'utf8');
  const peek = Number(tokens.match(/--sheet-peek: (\d+)px;/)?.[1]);
  assert.ok(peek >= 95, `the peek token covers the measured peek (${peek})`);
  const phone = fs.readFileSync(path.join(ROOT, 'public/css/phone.css'), 'utf8');
  assert.doesNotMatch(phone, /--sheet-peek:/, 'phone.css does not shadow the token');
  const misc = fs.readFileSync(path.join(ROOT, 'public/css/misc.css'), 'utf8');
  const block = misc.slice(misc.indexOf('@media (max-width: 699px)'));
  const rule = block.match(/\.layout, \.view \{ padding-bottom: ([^;]+);/);
  assert.ok(rule, 'the phone rule exists');
  assert.match(rule[1], /^calc\(var\(--sheet-peek\) \+ var\(--gap\)/, 'the peek plus a gap');
  assert.doesNotMatch(misc, /padding-bottom: \d+px/, 'no hardcoded reserve left');
  const insp = fs.readFileSync(path.join(ROOT, 'public/css/inspector.css'), 'utf8');
  assert.match(insp, /\.shell-insp \{ width: 100%; padding-bottom: var\(--sheet-peek\); \}/);
});
