// Router v1 (fleet F8a, plan §1 2.5; §4 D4 extends it): the hash grammar, the
// legacy forms, defaults dropped, the Map as home, navigate/onRoute, the view
// registry, and "a hash/URL parameter never dispatches an action" (S20).
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { elementsFromHtml, makeDocument, loadEsModules } from './helpers/fakedom.mjs';
import {
  parseHash, formatHash, emptyRoute, patchRoute, VIEWS, HIDDEN_VIEWS, DEFAULT_VIEW, VIEW_KEYS,
} from '../public/js/core/router.js';
import {
  VIEW_META, activateView, activeView, getView, isView, legacyView, updateActive, viewErrors, views,
} from '../public/js/views/index.js';

const test = nodeTest;
const ROOT = path.resolve(import.meta.dirname, '..');
const LOCAL = { localId: 'builder-a' };

test('the view list: eight views plus the hidden diff, the map by default', () => {
  assert.deepEqual(VIEWS, ['map', 'board', 'inbox', 'packages', 'morning', 'credit', 'box', 'audit', 'runs']);
  assert.deepEqual(HIDDEN_VIEWS, ['diff']);
  assert.equal(DEFAULT_VIEW, 'map');
});

test('the view chord registers a route for every nav view (plan §4 2.6)', () => {
  assert.deepEqual({ ...VIEW_KEYS }, { m: 'map', b: 'board', i: 'inbox', p: 'packages', x: 'box', a: 'audit', c: 'credit', o: 'morning', r: 'runs' });
  assert.deepEqual(Object.values(VIEW_KEYS).sort(), [...VIEWS].sort(), 'one chord per nav view, none for diff');
});

test('#/ and an empty hash land on the map', () => {
  for (const h of ['', '#', '#/', '#/?b=all', '#/map']) assert.equal(parseHash(h).view, 'map', h);
  assert.deepEqual(parseHash('#/?b=builder-a&q=x'), { ...emptyRoute('map'), b: 'builder-a', q: 'x' });
});

test('formatHash drops the defaults: the map view and b=all', () => {
  assert.equal(formatHash(emptyRoute('map')), '#/');
  assert.equal(formatHash({ view: 'map', b: 'all' }), '#/');
  assert.equal(formatHash({ view: 'map', b: 'builder-a' }), '#/?b=builder-a');
  assert.equal(formatHash({ view: 'board', b: 'all', s: 'stuck' }), '#/board?s=stuck');
  // Stable key order whatever order the object has.
  assert.equal(
    formatHash({ open: 'term', sel: 'builder-a/x', q: 'auth', s: 'stuck', b: 'builder-a', view: 'board' }),
    '#/board?b=builder-a&s=stuck&q=auth&sel=builder-a%2Fx&open=term',
  );
  assert.deepEqual(parseHash('#/board?b=builder-a&s=stuck&q=auth&sel=builder-a%2Fauth&open=term'),
    { view: 'board', b: 'builder-a', s: 'stuck', q: 'auth', sel: 'builder-a/auth', open: 'term', run: null });
});

test('legacy bare #morning and #board keep working', () => {
  assert.deepEqual(parseHash('#morning'), emptyRoute('morning'));
  assert.deepEqual(parseHash('#board'), emptyRoute('board'));
  assert.equal(formatHash(parseHash('#morning')), '#/morning');
  assert.equal(formatHash(parseHash('#map')), '#/');
});

test('patchRoute: merges routing keys only; a view switch drops sel and open', () => {
  const r = { view: 'board', b: 'builder-a', s: 'stuck', q: null, sel: 'builder-a/x', open: 'term', run: null };
  assert.deepEqual(patchRoute(r, { view: 'map' }), { view: 'map', b: 'builder-a', s: 'stuck', q: null, sel: null, open: null, run: null });
  assert.deepEqual(patchRoute(r, { view: 'inbox', sel: 'builder-a/y' }).sel, 'builder-a/y');
  assert.deepEqual(patchRoute(r, { s: null }), { ...r, s: null });
  assert.deepEqual(patchRoute(r, { view: 'board' }), r, 'the same view keeps the selection');
  const hostile = patchRoute(r, { action: 'kill', target: '*', args: {}, __proto__: { x: 1 } });
  assert.deepEqual(Object.keys(hostile).sort(), ['b', 'open', 'q', 'run', 's', 'sel', 'view'], 'nothing but routing keys');
  assert.deepEqual(patchRoute(null, {}), emptyRoute('map'));
});

test('legacy #session=<name> lands on the board with the terminal open', () => {
  assert.deepEqual(parseHash('#session=foo', LOCAL), { view: 'board', b: null, s: null, q: null, sel: 'builder-a/foo', open: 'term', run: null });
  assert.equal(parseHash('#session=my%20sess', LOCAL).sel, 'builder-a/my sess');
  assert.equal(parseHash('#session=foo').sel, null, 'no local id, no selection');
  assert.equal(parseHash('#session=a%2Fb', LOCAL).sel, null, 'a legacy name never has a slash');
  assert.equal(parseHash('#session=%E0%A4%A', LOCAL).sel, null, 'bad escapes are dropped');
  assert.equal(parseHash('#session=%E0%A4%A', LOCAL).view, 'board');
});

test('legacy bare views map to the view', () => {
  for (const v of [...VIEWS, ...HIDDEN_VIEWS]) assert.deepEqual(parseHash(`#${v}`), emptyRoute(v));
  assert.equal(parseHash('#map').view, 'map');
  assert.equal(parseHash('#morning').view, 'morning');
  assert.equal(parseHash('map').view, 'map', 'the leading # is optional');
});

test('unknown or empty input gives DEFAULT_VIEW', () => {
  for (const h of ['', '#', '#/', '#nonsense', '#machine', '#/nonsense?b=all', null, undefined, '#/__proto__']) {
    assert.equal(parseHash(h).view, DEFAULT_VIEW, String(h));
  }
  assert.equal(parseHash('#/nonsense?b=all').b, 'all', 'parameters survive an unknown view');
});

test('#/inbox?b=all&sel=builder-b%2Fx round-trips (b=all is the default and drops)', () => {
  const h = '#/inbox?b=all&sel=builder-b%2Fx';
  const r = parseHash(h);
  assert.deepEqual(r, { view: 'inbox', b: 'all', s: null, q: null, sel: 'builder-b/x', open: null, run: null });
  assert.equal(formatHash(r), '#/inbox?sel=builder-b%2Fx');
  assert.deepEqual(parseHash(formatHash(r)), { ...r, b: null });
});

test('every parameter round-trips', () => {
  const r = { view: 'board', b: 'builder-a', s: 'working,needs_input', q: 'fix the "auth" bug & more', sel: 'builder-a/a/b c', open: 'transcript', run: null };
  assert.deepEqual(parseHash(formatHash(r)), r);
  assert.deepEqual(parseHash(formatHash(emptyRoute('diff'))), emptyRoute('diff'));
  assert.equal(formatHash(emptyRoute()), '#/', 'null parameters are left out');
  assert.equal(formatHash(emptyRoute('board')), '#/board');
  assert.equal(formatHash({ view: 'nope', b: '' }), '#/');
  assert.equal(parseHash('#/board?q=a+b').q, 'a b');
});

test('values that do not fit their parameter are dropped', () => {
  const r = parseHash('#/board?b=Bad%20Id&s=%3Cx%3E&sel=not-a-key&open=kill&q=%00x');
  assert.deepEqual(r, emptyRoute('board'));
  assert.equal(parseHash('#/board?sel=builder-a%2Fx%0A').sel, null, 'control characters are refused');
  assert.equal(parseHash(`#/board?sel=builder-a%2F${'x'.repeat(400)}`).sel, null, 'over-long keys are refused');
  assert.equal(parseHash(`#/board?q=${'y'.repeat(500)}`).q.length, 200, 'the query is clipped');
  assert.equal(parseHash('#/board?b=one&b=two').b, 'one', 'the first of a repeated key wins');
  assert.equal(parseHash('#/board?__proto__=x&sel=builder-a%2Fx').sel, 'builder-a/x');
  for (const open of ['term', 'transcript']) assert.equal(parseHash(`#/board?open=${open}`).open, open);
});

test('the route object has only the routing keys: there is nothing to dispatch', () => {
  const r = parseHash('#/board?sel=builder-a%2Fx&action=kill&target=x&args=%7B%7D&confirm=x');
  assert.deepEqual(Object.keys(r).sort(), ['b', 'open', 'q', 'run', 's', 'sel', 'view']);
});

test('#/runs?run=<id> opens a run page: the protocol run id pattern, bad values dropped', () => {
  assert.deepEqual(parseHash('#/runs?run=readiness'), { ...emptyRoute('runs'), run: 'readiness' });
  assert.equal(formatHash({ view: 'runs', run: 'runs-n1.v2_a' }), '#/runs?run=runs-n1.v2_a');
  assert.deepEqual(parseHash(formatHash({ ...emptyRoute('runs'), run: 'A.b-c_9' })), { ...emptyRoute('runs'), run: 'A.b-c_9' });
  assert.equal(formatHash({ view: 'runs', q: 'x', run: 'r1' }), '#/runs?q=x&run=r1', 'run comes last in the key order');
  for (const bad of ['', '.hidden', '-x', '_x', 'a%2Fb', 'a%20b', '..', 'a%0A', '%3Cimg%3E', 'x'.repeat(65), 'r%E0%A4%A']) {
    assert.equal(parseHash(`#/runs?run=${bad}`).run, null, bad);
  }
  assert.equal(parseHash(`#/runs?run=${'x'.repeat(64)}`).run, 'x'.repeat(64), '64 characters is the cap');
  assert.equal(parseHash('#/runs?run=one&run=two').run, 'one', 'the first of a repeated key wins');
  const r = { ...emptyRoute('runs'), run: 'readiness' };
  assert.equal(patchRoute(r, { view: 'board' }).run, null, 'a view switch drops the run');
  assert.equal(patchRoute(r, { q: 'x' }).run, 'readiness', 'the same view keeps it');
  assert.equal(patchRoute(r, { run: null }).run, null, 'back to the list');
});

test('S20: router.js, the registry and the stubs have no path to an action', () => {
  // views/diff.js is a real view now (R11): test/view-diff.test.mjs pins its one act() to the send sheet's button.
  // views/inbox.js is a real view now (C13): test/inbox-model.test.mjs pins its act() calls to keys and buttons.
  for (const f of ['core/router.js', 'views/index.js', 'views/packages.js', 'views/audit.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
    assert.doesNotMatch(src, /actions\.js'/, f);
    assert.doesNotMatch(src, /\b(?:act|hubAct|post|del|sendKeys|sendText|fetch)\s*\(/, f);
  }
});

// --- the view registry ---------------------------------------------------------

test('every routable view is registered with the view shape', () => {
  for (const id of [...VIEWS, ...HIDDEN_VIEWS]) {
    const v = getView(id);
    assert.ok(isView(v), `${id} has {id, mount, unmount, update}`);
    assert.equal(v.id, id);
    assert.ok(VIEW_META[id]?.icon && VIEW_META[id]?.title && VIEW_META[id]?.short, `${id} has nav metadata`);
    assert.ok(VIEW_META[id].short.length <= 4, `${id}: labels are at most 4 characters`);
  }
  assert.equal(getView('nonsense'), null);
  assert.equal(views().size, 10);
  for (const id of ['inbox', 'packages', 'audit', 'runs', 'diff']) assert.equal(getView(id).legacy, undefined, `${id} is a real default export`);
  for (const id of ['board', 'map', 'morning', 'credit', 'box']) {
    // Until their owners add a default export, the F1-moved views use the adapter.
    const v = getView(id);
    if (v.legacy) assert.equal(v.unmount(), undefined);
  }
});

test('isView and legacyView', () => {
  assert.equal(isView(null), false);
  assert.equal(isView({ id: 'x', mount() {}, unmount() {} }), false, 'update is required');
  let shown = 0;
  const v = legacyView('morning', () => { shown++; });
  assert.ok(isView(v));
  assert.equal(v.title, 'Morning');
  v.mount(); v.mount();
  assert.equal(shown, 2, 'the old show function runs on every mount');
});

test('activateView: mount on switch, unmount the old one, update on the same view; a throw never escapes', async () => {
  const { makeEl, document } = await import('./helpers/fakedom.mjs');
  const saved = globalThis.document;
  globalThis.document = document;
  try {
    const inbox = makeEl('section');
    const audit = makeEl('section');
    assert.equal(activateView('inbox', inbox, { route: emptyRoute('inbox') }), 'inbox');
    assert.equal(activeView(), 'inbox');
    const p = inbox.children[0];
    assert.ok(p.classList.contains('panel'), 'the stub renders an empty .panel');
    assert.match(p.textContent, /INBOX/);
    assert.equal(activateView('inbox', inbox, {}), 'inbox', 'the same view only updates');
    assert.equal(inbox.children[0], p, 'and is not re-rendered');
    activateView('audit', audit, { route: { ...emptyRoute('audit'), b: 'builder-a' } });
    assert.equal(inbox.children.length, 0, 'the inbox unmounted');
    assert.match(audit.textContent, /AUDIT/);
    const { auditScope } = await import('../public/js/views/audit.js');
    assert.equal(auditScope({ b: 'builder-a' }), 'builder-a', 'the builder filter is the panel scope');
    assert.equal(auditScope({ b: 'all' }), 'all');
    assert.equal(auditScope(null), 'all');
    assert.equal(activateView('nonsense', makeEl(), {}), null);
    assert.equal(activeView(), 'audit', 'an unknown id changes nothing');

    // A throwing view is contained and recorded.
    const diff = getView('diff');
    const real = diff.mount;
    diff.mount = () => { throw new Error('boom'); };
    const log = console.error;
    console.error = () => {};
    try {
      assert.equal(activateView('diff', makeEl(), {}), 'diff');
      updateActive({});
    } finally {
      diff.mount = real;
      console.error = log;
    }
    assert.ok(viewErrors().some((e) => e.id === 'diff' && e.what === 'mount' && e.message === 'boom'));
  } finally {
    globalThis.document = saved;
  }
});

// --- S20 in the running page: hashes select, they never send -----------------

const HAS_VM_MODULES = typeof vm.SourceTextModule === 'function';
const pageTest = HAS_VM_MODULES ? nodeTest : () => {};
if (!HAS_VM_MODULES) {
  nodeTest('page router tests, re-run with --experimental-vm-modules', () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // else the child reports to this runner and exits 0
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', import.meta.filename], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  });
}

async function mountPage() {
  const PUB = path.join(ROOT, 'public');
  const byId = elementsFromHtml(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'));
  const sockets = [];
  const fetches = [];
  const winListeners = {};
  const sandbox = {
    document: makeDocument({ byId, root: byId.get('grid') }),
    console: { log() {}, warn() {}, error() {} },
    location: { protocol: 'http:', host: 'x', hash: '', pathname: '/' },
    history: { replaceState(_s, _t, url) { sandbox.location.hash = url; } },
    localStorage: { getItem: () => null, setItem() {} },
    innerWidth: 1600, innerHeight: 900, isSecureContext: false,
    addEventListener(k, fn) { (winListeners[k] ||= []).push(fn); },
    removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    ResizeObserver: function ResizeObserver() { return { observe() {}, disconnect() {} }; },
    performance: { now: () => 0, mark() {}, measure() {} },
    matchMedia: () => ({ matches: false }),
    Notification: { permission: 'default' },
    navigator: { serviceWorker: undefined },
    fetch: (url, init) => {
      fetches.push({ url: String(url), method: init?.method ?? 'GET' });
      return Promise.reject(new Error('no network in this test'));
    },
    WebSocket: function WebSocket() {
      const l = {};
      const ws = {
        readyState: 1, sent: [],
        addEventListener: (k, fn) => { (l[k] ||= []).push(fn); },
        send: (d) => { ws.sent.push(d); },
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
  const JS = path.join(PUB, 'js');
  const ns = await loadEsModules(sandbox, {
    entry: path.join(JS, 'app.js'),
    stubs: {
      [path.join(JS, 'ui', 'terminal.js')]: {
        openTerminal: () => {}, closeTerminal: () => {}, fitAll: () => {}, writeTo: () => false, isLive: () => false,
      },
    },
  });
  const fire = (kind) => { for (const fn of winListeners[kind] || []) fn({}); };
  const go = (hash) => { sandbox.location.hash = hash; fire('hashchange'); };
  const send = (msg) => sockets[0].emit('message', { data: JSON.stringify(msg) });
  return { byId, fetches, go, fire, send, ns, sandbox, socket: sockets[0] };
}

pageTest('S20: no hash or URL parameter ever triggers act() or any mutating request', async () => {
  const { byId, fetches, go, send, socket } = await mountPage();
  socket.emit('open', {});
  send({ type: 'hello', builder: { id: 'builder-a', code: 'BA' }, mode: 'builder', version: '1', apiVersion: 1 });
  send({ type: 'snapshot', builder: 'builder-a', sessions: [{ name: 'x', state: 'working' }], attention: [], generatedAt: Date.now() });

  const hostile = [
    '#/board?sel=builder-a%2Fx&open=term&action=kill&target=x&confirm=x',
    '#/board?sel=builder-a%2Fx&action=send-text&text=rm%20-rf',
    '#session=x',
    '#/inbox?sel=builder-a%2Fx&open=transcript&approve=1',
    '#/credit?b=all&q=kill',
    '#/diff?sel=builder-a%2Fx&action=retire',
    '#/audit?action=ack-alarm&target=*',
    '#kill',
    '#/board?sel=builder-b%2Fx&open=term',
  ];
  for (const h of hostile) go(h);
  const mutating = fetches.filter((f) => f.method !== 'GET' || /actions/.test(f.url));
  assert.deepEqual(mutating, [], `routes must only select: ${JSON.stringify(mutating)}`);
  assert.equal(byId.get('sheet').hidden, false, 'a selection still opens the sheet');
  assert.equal(byId.get('sheet-title').textContent, 'x');
});

pageTest('a v1 deep link #/board?sel=<fkey> opens the sheet on the board', async () => {
  const { byId, go, send, socket } = await mountPage();
  socket.emit('open', {});
  send({ type: 'hello', builder: { id: 'builder-a', code: 'BA' } });
  send({ type: 'snapshot', builder: 'builder-a', sessions: [{ name: 'x', state: 'working' }], attention: [] });
  go('#morning');
  assert.equal(byId.get('view-morning').hidden, false);
  go('#/board?sel=builder-a%2Fx');
  assert.equal(byId.get('view-board').hidden, false);
  assert.equal(byId.get('sheet').hidden, false);
  assert.equal(byId.get('sheet-title').textContent, 'x');
});

pageTest('#/ lands on the map; every view has a section and mounts through the registry', async () => {
  const { byId, go, send, socket } = await mountPage();
  socket.emit('open', {});
  send({ type: 'snapshot', sessions: [], attention: [] });
  assert.equal(byId.get('view-map').hidden, false, 'a cold load with no hash is the map');
  go('#board');
  go('#/');
  assert.equal(byId.get('view-map').hidden, false);
  assert.equal(byId.get('view-board').hidden, true);
  for (const v of ['inbox', 'packages', 'audit', 'diff']) {
    go(`#/${v}`);
    assert.equal(byId.get(`view-${v}`).hidden, false, `${v} shows`);
    assert.ok(byId.get(`view-${v}`).children[0]?.classList.contains('panel'), `${v} rendered its stub panel`);
  }
  go('#/box');
  assert.equal(byId.get('view-box').hidden, false);
  assert.equal(byId.get('view-diff').children.length, 0, 'leaving a view unmounts it');
  go('#morning');
  assert.equal(byId.get('view-morning').hidden, false, 'a legacy hash still routes');
  // The nav marks the shown view.
  const on = byId.get('views').children.filter((b) => b.classList.contains('on')).map((b) => b.dataset.view);
  assert.deepEqual(on, ['morning']);
});

pageTest('the scope chips follow the route; removing one navigates it away', async () => {
  const { byId, go, fire, send, socket, sandbox, ns } = await mountPage();
  socket.emit('open', {});
  send({ type: 'hello', builder: { id: 'builder-a', code: 'BA' } });
  send({ type: 'snapshot', builder: 'builder-a', sessions: [], attention: [] });
  go('#/');
  const scope = byId.get('scope');
  assert.equal(scope.children.length, 1);
  assert.equal(scope.children[0].textContent, 'ALL', 'no filter: the ALL plate');
  go('#/board?b=builder-a&s=stuck&q=auth');
  const params = scope.children.map((c) => c.dataset.param);
  assert.deepEqual(params, ['b', 's', 'q']);
  assert.match(scope.children[0].textContent, /BA/, 'the builder chip shows its code');
  assert.match(byId.get('legend').textContent, /MOVE/, 'the legend leads with the view keys');
  assert.match(byId.get('clock-utc').textContent, /^\d\d:\d\d:\d\dZ$/);
  // navigate() is what a chip's x runs: a push drops the parameter.
  const { navigate, onRoute } = ns('core/router.js');
  const seen = [];
  onRoute((r) => seen.push(r.view));
  assert.equal(navigate({ s: null }), '#/board?b=builder-a&q=auth');
  assert.equal(sandbox.location.hash, '#/board?b=builder-a&q=auth');
  fire('hashchange');
  assert.deepEqual(scope.children.map((c) => c.dataset.param), ['b', 'q']);
  // replace: rewrites the entry and applies it at once.
  navigate({ view: 'inbox', q: null }, { replace: true });
  assert.equal(sandbox.location.hash, '#/inbox?b=builder-a');
  assert.equal(byId.get('view-inbox').hidden, false);
  assert.deepEqual(seen, ['board', 'inbox']);
});

pageTest('the page source: hello first, then fleet keys in the visible message', async () => {
  const { send, socket } = await mountPage();
  socket.emit('open', {});
  send({ type: 'hello', builder: { id: 'builder-a', code: 'BA' } });
  send({ type: 'snapshot', builder: 'builder-a', sessions: [{ name: 'x', state: 'working' }], attention: [] });
  socket.emit('open', {});
  const last = JSON.parse(socket.sent.at(-1));
  assert.equal(last.type, 'visible');
  assert.ok(Array.isArray(last.keys), 'keys, not legacy names, once hello named the builder');
  assert.ok(last.keys.every((k) => k.startsWith('builder-a/')), JSON.stringify(last.keys));
});
