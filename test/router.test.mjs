// Router v1 (fleet F8a, plan §1 2.5; §4 D4 extends it): the hash grammar, the
// legacy forms, and "a hash/URL parameter never dispatches an action" (S20).
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { elementsFromHtml, makeDocument, loadEsModules } from './helpers/fakedom.mjs';
import {
  parseHash, formatHash, emptyRoute, VIEWS, HIDDEN_VIEWS, DEFAULT_VIEW,
} from '../public/js/core/router.js';

const test = nodeTest;
const ROOT = path.resolve(import.meta.dirname, '..');
const LOCAL = { localId: 'builder-a' };

test('the view list: eight views plus the hidden diff, board by default', () => {
  assert.deepEqual(VIEWS, ['map', 'board', 'inbox', 'packages', 'morning', 'credit', 'box', 'audit']);
  assert.deepEqual(HIDDEN_VIEWS, ['diff']);
  assert.equal(DEFAULT_VIEW, 'board');
});

test('legacy #session=<name> lands on the board with the terminal open', () => {
  assert.deepEqual(parseHash('#session=foo', LOCAL), { view: 'board', b: null, s: null, q: null, sel: 'builder-a/foo', open: 'term' });
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

test('#/inbox?b=all&sel=builder-b%2Fx round-trips', () => {
  const h = '#/inbox?b=all&sel=builder-b%2Fx';
  const r = parseHash(h);
  assert.deepEqual(r, { view: 'inbox', b: 'all', s: null, q: null, sel: 'builder-b/x', open: null });
  assert.equal(formatHash(r), h);
});

test('every parameter round-trips', () => {
  const r = { view: 'board', b: 'builder-a', s: 'working,needs_input', q: 'fix the "auth" bug & more', sel: 'builder-a/a/b c', open: 'transcript' };
  assert.deepEqual(parseHash(formatHash(r)), r);
  assert.deepEqual(parseHash(formatHash(emptyRoute('diff'))), emptyRoute('diff'));
  assert.equal(formatHash(emptyRoute()), '#/board', 'null parameters are left out');
  assert.equal(formatHash({ view: 'nope', b: '' }), '#/board');
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
  assert.deepEqual(Object.keys(r).sort(), ['b', 'open', 'q', 's', 'sel', 'view']);
});

test('S20: router.js has no path to an action', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/core/router.js'), 'utf8');
  assert.doesNotMatch(src, /from '\.\/actions\.js'/);
  assert.doesNotMatch(src, /\b(?:act|hubAct|post|del|sendKeys|sendText|fetch)\s*\(/);
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
    history: { replaceState() {} },
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
  await loadEsModules(sandbox, {
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
  return { byId, fetches, go, send, socket: sockets[0] };
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

pageTest('a view the page has no section for yet lands on the board', async () => {
  const { byId, go, send, socket } = await mountPage();
  socket.emit('open', {});
  send({ type: 'snapshot', sessions: [], attention: [] });
  go('#/inbox');
  assert.equal(byId.get('view-board').hidden, false);
  go('#/box');
  assert.equal(byId.get('view-box').hidden, false);
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
