// The node card's actions (Wall plan night 5 T19, README §7 Night 5, the card's items 3-4): per type, at most four in
// a row and `…`; navigation works, a link opens an existing app view (or is absent: never a dead
// button), a fleet action and Pin are `later` outline buttons that say so on a tap; no card button
// calls the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CARD_ACTS, CARD_SAYS, cardActions, createCard, describe } from '../public/js/wall/galaxy/card.js';
import { galaxyLayout, OPEN_MS } from '../public/js/wall/galaxy/layout.js';
import { FLIGHT } from '../public/js/wall/galaxy/camera.js';
import { BA, LARGE, listening, page } from './helpers/galaxy-page.mjs';

const W = 1368, H = 912;
const WORLD = (() => {
  const g = galaxyLayout(LARGE);
  return { byId: new Map(g.sites.map((x) => [x.id, x])) };
})();
const say = (id, site) => describe({ id, site }, WORLD);
const ids = (a) => [a.row.map((x) => x.id), a.more.map((x) => x.id)];
const all = (e) => [e, ...e.children.flatMap(all)];
const fakeDoc = { createElement: (t) => listening(t) };

test('cardActions: each type lists its buttons in the plan\'s order, four in the row and the rest behind …', () => {
  // A site: Open, What's below, Board (every builder on it: the whole Board), Pin; no Proxmox address in the model.
  assert.deepEqual(ids(say('lab', 'lab').actions), [['open', 'below', 'board', 'pin'], []]);
  // A room: no Logs view (absent), Board (the builder it hosts), What's below, Pin; `…` Fly to (no Terminal, no Proxmox).
  assert.deepEqual(ids(say('room-a', 'lab').actions), [['board', 'below', 'pin', 'fly'], []]);
  // A builder with a run: Run log, What's below, Board, Pin; Pause later behind ….
  assert.deepEqual(ids(say('builder:builder-b', 'lab').actions), [['runlog', 'below', 'board', 'pin'], ['pause']]);
  // A service moon: no Logs, no Board (no builder under it), Pin, Fly to, Restart later.
  assert.deepEqual(ids(say('storage-nfs', 'hv2').actions), [['pin', 'fly', 'restart'], []]);
  // A lane moon in trouble: Log, its diff in the PR slot, Pin, Fly to; Pause, Ack, Snooze later behind ….
  assert.deepEqual(ids(say('lane:builder-a/feat-search', 'lab').actions), [['log', 'diff', 'pin', 'fly'], ['pause', 'ack', 'snooze']]);
  // A crit room: no builder, so no Board; its alert's Ack and Snooze.
  assert.deepEqual(ids(say('storage', 'hv2').actions), [['below', 'pin', 'fly', 'ack'], ['snooze']]);
  assert.equal(CARD_ACTS.row, 4);
  assert.deepEqual(cardActions(null), { row: [], more: [] });
});

test('cardActions: every button on every node of the large demo has a handler or an existing app view; later ones say so', () => {
  const nodes = new Map(LARGE.map((n) => [n.id, n]));
  const builders = new Set(LARGE.map((n) => n.builder).filter(Boolean));
  const runs = new Set(LARGE.filter((n) => n.kind === 'run').map((n) => n.run));
  const fkeys = new Set(LARGE.map((n) => n.fkey).filter(Boolean));
  let n = 0;
  for (const site of WORLD.byId.values()) {
    for (const id of [site.id, ...site.members.map((m) => m.id)]) {
      const d = say(id, site.id);
      const acts = [...d.actions.row, ...d.actions.more];
      assert.ok(d.actions.row.length <= CARD_ACTS.row, `${id}: at most four in the row`);
      assert.equal(new Set(acts.map((a) => a.id)).size, acts.length, `${id}: no button twice`);
      for (const a of acts) {
        n += 1;
        assert.ok(['go', 'link', 'later'].includes(a.act), `${id} ${a.id}`);
        if (a.act === 'go') {
          assert.ok(['open', 'below', 'fly'].includes(a.id), `${id} ${a.id}: a page action`);
          if (a.id === 'open') assert.equal(id, site.id, 'Open is a site\'s');
          if (a.id === 'below') assert.ok(d.below.length > 0, `${id}: What's below only with something below`);
        } else if (a.act === 'link') {
          const m = /^\/#\/(board|runs|diff)(?:\?(.*))?$/.exec(a.href);
          assert.ok(m, `${id} ${a.id}: a same-origin app view (${a.href})`);
          const q = Object.fromEntries((m[2] ?? '').split('&').filter(Boolean).map((p) => p.split('=').map(decodeURIComponent)));
          if (q.b) assert.ok(builders.has(q.b), `${id}: its builder exists`);
          if (q.run) assert.ok(runs.has(q.run), `${id}: its run exists`);
          if (q.sel) assert.ok(fkeys.has(q.sel), `${id}: its lane or session exists`);
          if (q.open) assert.equal(q.open, 'transcript');
          if (m[1] === 'diff') assert.ok(q.sel, 'a diff names its lane');
        } else {
          assert.match(a.says, /comes later, with the cockpit\./, `${id} ${a.id} says so`);
          assert.ok(['pin', 'pause', 'restart', 'ack', 'snooze'].includes(a.id), `${id}: only Pin and the fleet actions are later`);
        }
        assert.ok(!['logs', 'terminal', 'proxmox'].includes(a.id), 'no view or address for these: absent');
      }
      assert.ok(nodes.has(id) || site.id === id);
    }
  }
  assert.ok(n > 100, `checked ${n} buttons`);
  // Nothing heavier ever appears: no restart of a room or a host.
  for (const id of ['room-a', 'storage', 'lab', 'hv2']) {
    const site = id === 'storage' || id === 'hv2' ? 'hv2' : 'lab';
    const d = say(id, site);
    assert.ok(![...d.actions.row, ...d.actions.more].some((a) => a.id === 'restart'), `${id}: no restart`);
  }
});

test('the card: links are links in a new tab, later buttons are aria-disabled, say so on a tap and do nothing else; … opens the rest', () => {
  const acted = [];
  const card = createCard(listening('main'), {
    screenOf: () => ({ x: 300, y: 300, r: 10 }), size: () => ({ W, H }), doc: fakeDoc, onAct: (act, id) => acted.push([act, id]),
  });
  card.open(say('lane:builder-a/feat-search', 'lab'));
  card.draw();
  const els = all(card.el);
  const rows = els.filter((e) => e.className === 'galaxy-card-acts');
  assert.equal(rows.length, 2, 'the row and the rest');
  const [row, extra] = rows;
  assert.deepEqual(row.children.map((e) => e.dataset.act), ['log', 'diff', 'pin', 'fly', 'more']);
  const log = row.children[0];
  assert.deepEqual([log.tagName, log.getAttribute('href'), log.getAttribute('target'), log.getAttribute('rel')],
    ['A', '/#/board?b=builder-a&sel=builder-a%2Ffeat-search&open=transcript', '_blank', 'noopener']);
  // A later button: not `disabled` (it would take no tap), aria-disabled, its `later` tag; a tap says why.
  const pin = row.children[2];
  assert.deepEqual([pin.tagName, pin.getAttribute('aria-disabled'), Boolean(pin.disabled), pin.getAttribute('aria-label')], ['BUTTON', 'true', false, 'Pin, later']);
  assert.equal(pin.children.find((e) => e.className === 'galaxy-card-later')?.textContent, 'later');
  const note = els.find((e) => e.className === 'galaxy-card-note');
  assert.equal(note.hidden, true);
  assert.equal(note.getAttribute('role'), 'status');
  const ev = pin.dispatch('click');
  assert.equal(ev.stopped, true, 'the press stays on the card');
  assert.deepEqual([note.hidden, note.textContent], [false, 'Pinning comes later, with the cockpit.']);
  assert.deepEqual(acted, [['pin', 'lane:builder-a/feat-search']]);
  // `…`: the rest, a 48 px button with a name; pressed again it folds.
  const dots = row.children.at(-1);
  assert.deepEqual([dots.tagName, dots.textContent, dots.getAttribute('aria-label'), dots.getAttribute('aria-expanded'), extra.hidden], ['BUTTON', '…', 'More actions', 'false', true]);
  dots.dispatch('click');
  assert.deepEqual([dots.getAttribute('aria-expanded'), extra.hidden], ['true', false]);
  assert.deepEqual(extra.children.map((e) => [e.dataset.act, e.getAttribute('aria-disabled')]), [['pause', 'true'], ['ack', 'true'], ['snooze', 'true']]);
  extra.children[0].dispatch('click');
  assert.match(note.textContent, /^Pausing a lane comes later, with the cockpit\. The Wall changes nothing in the fleet\.$/);
  dots.dispatch('click');
  assert.equal(extra.hidden, true);
  // Every button and link has a name; a navigation button passes its act to the page.
  for (const e of els.filter((x) => x.className === 'galaxy-card-act')) assert.ok(e.textContent || e.getAttribute('aria-label'));
  row.children[3].dispatch('click');
  assert.deepEqual(acted.at(-1), ['fly', 'lane:builder-a/feat-search']);
  // Opened on another node the note is gone.
  card.open(say('builder:builder-b', 'lab'));
  assert.equal(all(card.el).find((e) => e.className === 'galaxy-card-note').hidden, true);
  assert.ok(!all(card.el).some((e) => e.innerHTML), 'no innerHTML');

  const css = fs.readFileSync(new URL('../public/css/wall.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.galaxy-card-act {'), css.indexOf('}', css.indexOf('.galaxy-card-act {')));
  assert.match(rule, /min-width: 48px;/);
  assert.match(rule, /min-height: 48px;/);
  assert.match(rule, /touch-action: manipulation;/);
  assert.match(css, /\.galaxy-card-act:active \{/, 'a visible pressed state');
  assert.match(css, /\.galaxy-card-act\[data-later\] \{[^}]*dashed/, 'later is an outline, dashed');
});

test('the card: What\'s below shows every child, not six and +N', () => {
  const site = { id: 's', kind: 'site', label: 'hv9', status: 'ok' };
  const room = { id: 'r', parent: 's', kind: 'room', label: 'vm-z', status: 'ok' };
  const svcs = Array.from({ length: 9 }, (_, i) => ({ id: `r-${i}`, parent: 'r', kind: 'service', label: `svc-${i}`, status: 'ok' }));
  const world = { byId: new Map([['s', { id: 's', node: site, members: [room, ...svcs].map((n) => ({ id: n.id, node: n })) }]]) };
  const d = describe({ id: 'r', site: 's' }, world);
  assert.deepEqual([d.below.length, d.belowMore, d.belowRest.length], [CARD_SAYS.below, 3, 3]);
  const acted = [];
  const card = createCard(listening('main'), { screenOf: () => ({ x: 300, y: 300, r: 10 }), size: () => ({ W, H }), doc: fakeDoc, onAct: (a) => acted.push(a) });
  card.open(d);
  card.draw();
  const chips = () => all(card.el).filter((e) => e.className === 'galaxy-card-chip').map((e) => e.dataset.id);
  assert.equal(chips().length, 6);
  all(card.el).find((e) => e.dataset?.act === 'below').dispatch('click');
  assert.deepEqual(chips(), svcs.map((s) => s.id), 'every child, in order');
  assert.ok(!all(card.el).some((e) => e.className === 'galaxy-card-chip-more'), 'no +N left');
  assert.deepEqual(acted, ['below']);
});

test('the page: Fly to frames the picked planet again after a turn; no card button calls the network', () => {
  const calls = [];
  const saved = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket };
  globalThis.fetch = (...a) => { calls.push(['fetch', a]); return Promise.resolve(); };
  globalThis.XMLHttpRequest = function XHR() { calls.push(['xhr']); };
  globalThis.WebSocket = function WS() { calls.push(['ws']); };
  try {
    const p = page();
    p.toBuilder();
    p.drag(20, { x: 700, y: 450 }, 160, 40);
    p.run(2500);
    assert.ok(p.cam.want().turned, 'turned round lab\'s star');
    const acts = () => all(p.card.el).filter((e) => e.className === 'galaxy-card-act');
    // builder-a's card: What's below, Board, Pin, Pause; nothing behind ….
    assert.deepEqual(acts().map((e) => e.dataset.act), ['below', 'board', 'pin', 'pause']);
    // Every button on it, then Fly to on its lane moon's card.
    for (const e of acts()) e.dispatch('click');
    assert.equal(p.card.selected(), BA, 'none of them leaves the card');
    const chip = all(p.card.el).find((e) => e.className === 'galaxy-card-chip' && e.dataset.id === 'lane:builder-a/feat-search');
    chip.dispatch('click');
    p.tick(16);
    p.run(FLIGHT.ms + OPEN_MS);
    p.drag(22, { x: 700, y: 450 }, -160, 30);
    p.run(FLIGHT.ms + 3000); // the turn's coast is over: no move of its own
    assert.ok(p.cam.want().turned, 'turned again');
    const m1 = p.moves.length;
    const fly = acts().find((e) => e.dataset.act === 'fly');
    for (const e of acts()) if (e !== fly) e.dispatch('click');
    assert.equal(p.moves.length, m1, 'only Fly to moves the camera');
    fly.dispatch('click');
    p.tick(16);
    assert.ok(p.moves.length > m1, 'Fly to moves it');
    const w = p.cam.want();
    assert.deepEqual([w.kind, w.id, w.member, w.turned ?? null], ['site', 'lab', 'lane:builder-a/feat-search', null], 'framed again, not turned');
    assert.equal(p.card.selected(), 'lane:builder-a/feat-search', 'its card stays');
    p.run(FLIGHT.ms);
  } finally {
    Object.assign(globalThis, saved);
  }
  assert.deepEqual(calls, [], 'no network call from any card button');
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/card.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/, 'card.js has no way to the network');
});

test('galaxy/main.js passes the card\'s actions to cardAct: a touch, Open a site, Fly to its node', () => {
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(js, /onAct: \(act, id\) => cardAct\(act, id\),/);
  const act = js.slice(js.indexOf('const cardAct = '), js.indexOf('\n  };', js.indexOf('const cardAct = ')));
  assert.match(act, /touch\?\.poke\(\);/);
  assert.match(act, /act === 'open' && galaxy\.world\?\.byId\.has\(id\)\) openSite\(id\);/);
  assert.match(act, /finger\.focus\(place\.site, TIMING\.zoom, \{ member: id \}\);/);
  const helper = fs.readFileSync(new URL('./helpers/galaxy-page.mjs', import.meta.url), 'utf8');
  assert.match(helper, /act === 'open' && galaxy\.world\?\.byId\.has\(id\)\) openSite\(id\);/, 'the page helper as main.js');
});
