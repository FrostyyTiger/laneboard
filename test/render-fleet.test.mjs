// The page on fleet keys (fleet F8b, plan §1 2.5 "UI"): N builders behind one
// source, cards and panes keyed by `<builderId>/<name>`, one status chip per
// builder, the fold-set migration and the `#/board?sel=<fkey>` deep link.
//
// Runs the real public/js/app.js against the fake DOM, like render.test.mjs.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { elementsFromHtml, makeDocument, loadEsModules } from './helpers/fakedom.mjs';

// vm.SourceTextModule needs --experimental-vm-modules (npm test sets it). A
// bare `node --test` re-runs this file with the flag, as its own test runner
// (NODE_TEST_CONTEXT unset), so the child's failures fail this test.
const HAS_VM_MODULES = typeof vm.SourceTextModule === 'function';
const test = HAS_VM_MODULES ? nodeTest : () => {};
if (!HAS_VM_MODULES) {
  nodeTest('render-fleet tests, re-run with --experimental-vm-modules', () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', '--test-reporter=tap', import.meta.filename], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^# fail 0$/m, `${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stdout, /^# pass 0$/m, 'the re-run ran no tests');
  });
}

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public');
const JS = path.join(PUB, 'js');

async function mount({ storage = {}, hash = '' } = {}) {
  const byId = elementsFromHtml(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'));
  const sockets = [];
  const winListeners = {};
  const replaced = [];
  const fetches = [];
  const document = makeDocument({ byId, root: byId.get('grid') });
  const sandbox = {
    document, console: { log() {}, warn() {}, error() {} },
    location: { protocol: 'http:', host: 'x', hash, pathname: '/' },
    history: { replaceState(_s, _t, url) { replaced.push(url); sandbox.location.hash = url; } },
    localStorage: {
      getItem: (k) => (Object.hasOwn(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
    },
    innerWidth: 1400, innerHeight: 900, isSecureContext: false,
    addEventListener(k, fn) { (winListeners[k] ||= []).push(fn); },
    removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    ResizeObserver: function ResizeObserver() { return { observe() {}, disconnect() {} }; },
    IntersectionObserver: function IntersectionObserver(cb) {
      return { observe(n) { cb([{ target: n, isIntersecting: true }]); }, unobserve() {}, disconnect() {} };
    },
    performance: { now: () => 0, mark() {}, measure() {} },
    matchMedia: () => ({ matches: false }),
    Notification: { permission: 'default' },
    navigator: { serviceWorker: undefined },
    fetch: (url, init) => {
      fetches.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ?? null });
      return Promise.reject(new Error('no network in this test'));
    },
    WebSocket: function WebSocket() {
      const l = {};
      const ws = {
        readyState: 1, sent: [],
        addEventListener: (k, fn) => { (l[k] ||= []).push(fn); },
        send: (d) => { ws.sent.push(JSON.parse(d)); },
        close: () => {},
        emit: (k, ev) => { for (const fn of l[k] || []) fn(ev); },
      };
      sockets.push(ws);
      return ws;
    },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const opened = [];
  const ns = await loadEsModules(sandbox, {
    entry: path.join(JS, 'app.js'),
    stubs: {
      [path.join(JS, 'ui', 'terminal.js')]: {
        openTerminal: (k) => { opened.push(k); }, closeTerminal: () => {}, fitAll: () => {},
        writeTo: () => false, isLive: () => false,
      },
    },
  });
  const socket = sockets[0];
  const fire = (kind) => { for (const fn of winListeners[kind] || []) fn({}); };
  const go = (h) => { sandbox.location.hash = h; fire('hashchange'); };
  const send = (msg) => socket.emit('message', { data: JSON.stringify(msg) });
  const store = ns('core/store.js').store;
  return { byId, socket, send, go, fire, sandbox, ns, store, storage, replaced, opened, fetches };
}

const hello = (id = 'builder-a', code = 'BA') => ({ type: 'hello', builder: { id, code }, mode: 'builder', version: '1', apiVersion: 1 });
const sess = (name, extra = {}) => ({ name, state: 'working', stateSince: Date.now(), ...extra });

/** Every session card/row under `root`, wherever it sits. */
function sessionCards(root) {
  const out = [];
  const walk = (n) => { for (const c of n.children) { if (c.dataset?.key) out.push(c); walk(c); } };
  walk(root);
  return out;
}
/** A value from the page's realm, as a plain one of this realm (deepEqual is realm-strict). */
const plain = (v) => JSON.parse(JSON.stringify(v));
const chips = (byId) => byId.get('builders').children;
const chipOf = (byId, id) => chips(byId).find((c) => c.dataset.builder === id);
function errorText(byId) {
  const box = byId.get('ui-error');
  return box.hidden ? '' : box.children.map((c) => c.textContent).join(' | ');
}

/** A hub page: the first frame is `fleet`, then one snapshot per builder. */
async function hubPage(rows) {
  const page = await mount();
  page.socket.emit('open', {});
  page.send({ type: 'fleet', hub: { version: '1', now: Date.now() }, builders: rows, aggregates: {} });
  return page;
}
const row = (id, code, state = 'up') => ({ id, code, state, ageMs: 0, controls: true, capabilities: [] });

// ---------------------------------------------------------------- builder mode

test('builder mode: cards carry dataset.key = <localId>/<name>, one live chip, no code plate', async () => {
  const { byId, socket, send, store } = await mount();
  socket.emit('open', {});
  send(hello());
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('web'), sess('api')], attention: [], generatedAt: Date.now() });

  assert.equal(errorText(byId), '');
  assert.equal(store.keyMode, 'fkey', 'the views read fleet keys, so the store indexes by them');
  const keys = sessionCards(byId.get('grid')).map((c) => c.dataset.key).sort();
  assert.deepEqual(keys, ['builder-a/api', 'builder-a/web']);
  assert.equal(sessionCards(byId.get('grid')).some((c) => 'name' in c.dataset), false, 'no card is keyed by local name');

  assert.equal(byId.get('builders').hidden, false);
  assert.equal(chips(byId).length, 1, 'builder mode shows exactly one chip');
  const chip = chipOf(byId, 'builder-a');
  assert.equal(chip.textContent, 'BA');
  assert.ok(chip.classList.contains('status-live'));
  assert.equal(chip.classList.contains('down'), false);
  assert.equal(byId.get('offline').hidden, true);
  const card = sessionCards(byId.get('grid'))[0];
  assert.equal(card.textContent.includes('BA'), false, 'one builder: no code plate on the card');
});

test('builder mode: the source closing raises the banner and turns the chip down', async () => {
  const { byId, socket, send } = await mount();
  socket.emit('open', {});
  send(hello());
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('web')], attention: [] });
  socket.emit('close', {});
  assert.equal(byId.get('offline').hidden, false, 'the source is closed: the banner shows');
  assert.equal(byId.get('conn').textContent, 'offline');
  assert.ok(chipOf(byId, 'builder-a').classList.contains('down'));
});

test('an old pin survives the upgrade: legacy names migrate to <localId>/<name>', async () => {
  const storage = { 'laneboard.pinned': JSON.stringify(['web', 'gone']) };
  const { byId, socket, send, store, opened } = await mount({ storage });
  socket.emit('open', {});
  send(hello());
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('web'), sess('api')], attention: [] });

  assert.deepEqual([...store.pinned].sort(), ['builder-a/gone', 'builder-a/web']);
  assert.deepEqual(JSON.parse(storage['laneboard.pinned']).sort(), ['builder-a/gone', 'builder-a/web'], 'the migrated pins are saved');
  const web = sessionCards(byId.get('grid')).find((c) => c.dataset.key === 'builder-a/web');
  assert.ok(web.classList.contains('pinned'), 'the pinned card shows its pin');
  const panes = byId.get('dock-body').children.filter((c) => c.dataset?.key);
  assert.deepEqual(panes.map((p) => p.dataset.key), ['builder-a/web'], 'the dock pane is keyed by fleet key');
  assert.ok(opened.includes('builder-a/web'), 'the terminal opens by fleet key');
  assert.equal(byId.get('dock-count').textContent, '1');
});

test('opening the sheet writes #/board?sel=<fkey>; closing removes sel', async () => {
  const { byId, socket, send, sandbox, ns, go, replaced } = await mount();
  socket.emit('open', {});
  send(hello());
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('web')], attention: [] });
  go('#board'); // the Map is home (fleet D4); this sheet is opened from the Board

  ns('ui/sheet.js').openSheet('builder-a/web');
  assert.equal(byId.get('sheet').hidden, false);
  assert.equal(byId.get('sheet-title').textContent, 'web');
  assert.equal(sandbox.location.hash, '#/board?sel=builder-a%2Fweb');
  ns('ui/sheet.js').closeSheet();
  assert.equal(byId.get('sheet').hidden, true);
  assert.equal(replaced.at(-1), '#/board', 'closing returns to the view, without sel');

  // The push notification's link opens the same sheet from another view.
  go('#morning');
  go('#/board?sel=builder-a%2Fweb');
  assert.equal(byId.get('sheet').hidden, false);
  assert.equal(byId.get('view-board').hidden, false);
  // A key of a builder this page does not have selects nothing.
  ns('ui/sheet.js').closeSheet();
  go('#/board?sel=builder-b%2Fweb');
  assert.equal(byId.get('sheet').hidden, true);
});

test('a deep link on a cold load opens the sheet after the first snapshot', async () => {
  const { byId, socket, send } = await mount({ hash: '#/board?sel=builder-a%2Fweb' });
  socket.emit('open', {});
  send(hello());
  assert.equal(byId.get('sheet').hidden, true);
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('web')], attention: [] });
  assert.equal(byId.get('sheet').hidden, false);
  assert.equal(byId.get('sheet-title').textContent, 'web');
});

test('attention and the keyboard cursor use fleet keys', async () => {
  const { byId, socket, send, store } = await mount();
  socket.emit('open', {});
  send(hello());
  send({
    type: 'snapshot', builder: 'builder-a', sessions: [sess('web', { state: 'waiting_permission' })],
    attention: [{ name: 'web', state: 'waiting_permission', since: Date.now() - 1000, score: 5 }],
  });
  const item = byId.get('attention-list').children[0].children[0];
  assert.equal(item.dataset.key, 'builder-a/web');
  item.onclick();
  assert.equal(store.cursor, 'builder-a/web');
});

test('the card menu sends through act(), addressed by the store entry', async () => {
  const { byId, socket, send, sandbox, fetches } = await mount();
  socket.emit('open', {});
  send(hello());
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('web')], attention: [] });
  sandbox.confirm = () => true;
  const card = sessionCards(byId.get('grid'))[0];
  const more = card.children.find((c) => c.classList.contains('card-actions')).children.find((b) => b.classList.contains('btn-more'));
  more.onclick({ stopPropagation() {} });
  const menu = card.children.find((c) => c.classList.contains('menu'));
  const restart = menu.children.find((b) => /Restart/.test(b.textContent));
  restart.onclick({ stopPropagation() {} });
  await new Promise((r) => setImmediate(r));
  const posts = fetches.filter((f) => f.method !== 'GET');
  assert.deepEqual(posts.map((f) => [f.method, f.url]), [['POST', '/api/sessions/web/restart']], 'the legacy route, by local name');
});

// ---------------------------------------------------------------- hub mode

test('a second builder snapshot renders beside the first; the same name does not collide', async () => {
  const { byId, send, store } = await hubPage([row('builder-a', 'BA'), row('builder-b', 'BB')]);
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('main'), sess('web')], attention: [] });
  send({ type: 'snapshot', builder: 'builder-b', sessions: [sess('main')], attention: [] });

  assert.equal(errorText(byId), '');
  assert.equal(store.source.kind, 'hub');
  const keys = sessionCards(byId.get('grid')).map((c) => c.dataset.key).sort();
  assert.deepEqual(keys, ['builder-a/main', 'builder-a/web', 'builder-b/main']);
  assert.deepEqual(chips(byId).map((c) => c.textContent), ['BA', 'BB']);
  const bMain = sessionCards(byId.get('grid')).find((c) => c.dataset.key === 'builder-b/main');
  assert.ok(bMain.textContent.includes('BB'), 'with several builders a card shows its builder code');

  // A delta removing builder-a's `main` leaves builder-b's alone.
  send({ type: 'delta', builder: 'builder-a', removed: ['main'] });
  const after = sessionCards(byId.get('grid')).map((c) => c.dataset.key).sort();
  assert.deepEqual(after, ['builder-a/web', 'builder-b/main']);
});

test('one builder down leaves the banner hidden, turns its chip down and dims its cards', async () => {
  const page = await hubPage([row('builder-a', 'BA'), row('builder-b', 'BB')]);
  const { byId, send } = page;
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('web')], attention: [] });
  send({ type: 'snapshot', builder: 'builder-b', sessions: [sess('api')], attention: [] });
  send({ type: 'fleet', hub: { version: '1' }, builders: [row('builder-a', 'BA'), row('builder-b', 'BB', 'down')], aggregates: {} });

  assert.equal(byId.get('offline').hidden, true, 'the global banner stays hidden');
  assert.equal(byId.get('conn').textContent, 'live', 'the source badge is the hub connection');
  assert.ok(chipOf(byId, 'builder-b').classList.contains('down'), 'the down builder\'s chip is down');
  assert.equal(chipOf(byId, 'builder-a').classList.contains('down'), false);
  const cards = sessionCards(byId.get('grid'));
  assert.ok(cards.find((c) => c.dataset.key === 'builder-b/api').classList.contains('stale'));
  assert.equal(cards.find((c) => c.dataset.key === 'builder-a/web').classList.contains('stale'), false);
});

test('lanes of two builders with the same id are two lane cards, filtered by lane key', async () => {
  const { byId, send, store } = await hubPage([row('builder-a', 'BA'), row('builder-b', 'BB')]);
  const lane = { id: 'feat', root: '/r', branch: 'feat', hue: 10, sessions: ['w'], idle: false };
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('w', { lane: 'feat' })], lanes: [lane], attention: [] });
  send({ type: 'snapshot', builder: 'builder-b', sessions: [sess('w', { lane: 'feat' })], lanes: [lane], attention: [] });
  const laneCards = byId.get('grid').children.filter((c) => c.dataset.lane);
  assert.deepEqual(laneCards.map((c) => c.dataset.laneKey).sort(), ['builder-a/feat', 'builder-b/feat']);

  const pills = byId.get('lane-rail').querySelectorAll('lane-pill');
  pills[0].onclick();
  assert.equal(store.laneFilter.size, 1);
  const [only] = [...store.laneFilter];
  for (const c of laneCards) assert.equal(c.hidden, c.dataset.laneKey !== only);
});

// ---------------------------------------------------------------- map

test('the map offers "Open terminal" for a lane whose session is a fleet key', async () => {
  const { socket, send, ns } = await mount();
  socket.emit('open', {});
  send(hello());
  send({ type: 'snapshot', builder: 'builder-a', sessions: [sess('web', { lane: 'feat' })], attention: [] });
  const { mapActions, mapEventFor } = ns('views/map.js');
  const acts = mapActions({ kind: 'lane', id: 'lane:builder-a/feat', session: 'builder-a/web' });
  assert.deepEqual(plain(acts.map((a) => a.label)), ['Open terminal']);
  assert.equal(mapActions({ kind: 'lane', session: 'builder-b/web' }).length, 0, 'an unknown builder offers nothing');
  assert.equal(mapActions({ kind: 'host' }).length, 0);

  const e = mapEventFor({ key: 'builder-a/web', session_name: 'web', type: 'PreToolUse' });
  assert.equal(e.node, 'lane:builder-a/feat', 'pulses land on the lane\'s fleet node id');
  assert.equal(e.silent, true);
  assert.equal(mapEventFor({ session_name: 'web' }), null, 'an event without a key is not routed by name');
});

test('the map fold set migrates lane:<x> to lane:<localId>/<x>', async () => {
  const { migrateFolds } = await import('../public/js/views/map-canvas.js');
  assert.deepEqual(
    migrateFolds(['lane:feat', 'lane:builder-a/web', 'host:box', 'site:x', 7, '', 'lane:feat'], 'builder-a'),
    ['lane:builder-a/feat', 'lane:builder-a/web', 'host:box', 'site:x'],
  );
  assert.deepEqual(migrateFolds(['lane:feat'], null), ['lane:feat'], 'no local id: nothing is rewritten');
  assert.deepEqual(migrateFolds(['lane:feat'], 'Bad Id'), ['lane:feat']);
  assert.deepEqual(migrateFolds('nope', 'builder-a'), []);
});

test('builderChips is pure and maps every status', async () => {
  const { ns } = await mount();
  const { builderChips } = ns('ui/shell.js');
  const { createStore, applyBuilders, setSourceKind } = ns('core/store.js');
  const s = createStore();
  setSourceKind(s, 'hub');
  applyBuilders(s, [row('b-two', null, 'stale'), row('a-one', 'A1'), row('c', 'CC', 'incompatible'), row('d', 'DD', 'misconfigured')]);
  const out = builderChips(s);
  assert.deepEqual(plain(out.map((c) => [c.id, c.code, c.status])), [
    ['a-one', 'A1', 'live'], ['b-two', 'BT', 'stale'], ['c', 'CC', 'stale'], ['d', 'DD', 'down'],
  ]);
  assert.match(out[3].title, /misconfigured/);
});

test('hostile builder text stays literal in the chip strip', async () => {
  const { byId } = await hubPage([{ ...row('builder-a', 'BA'), code: '<img src=x onerror=alert(1)>' }]);
  const chip = chipOf(byId, 'builder-a');
  assert.equal(chip.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(chip.children.length, 0, 'text, never markup');
  assert.equal(chip.innerHTML, '');
});
