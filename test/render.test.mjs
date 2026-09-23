// Runs the real public/app.js against a minimal DOM and a captured snapshot,
// and asserts it actually produces cards.
//
// The static check in frontend.test.mjs proves the functions exist; this proves
// they RUN. Between them they close the hole that let Stage 9 ship a dashboard
// which threw "renderGrid is not defined" on every snapshot and drew nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public');
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/snapshot.json'), 'utf8'));

function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parent: null,
    style: { cssText: '', setProperty() {} },
    dataset: {},
    hidden: false,
    _text: '',
    innerHTML: '',
    title: '',
    disabled: false,
    value: '',
    onclick: null,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => x && this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) {
        if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (on) this._s.add(c);
        else this._s.delete(c);
      },
      contains(c) { return this._s.has(c); },
    },
    // Faithful to the DOM: textContent aggregates descendants, and setting it
    // clears the children. Getting this wrong hid a real regression once.
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join('');
    },
    set textContent(v) {
      this.children.length = 0;
      this._text = String(v ?? '');
    },
    get className() { return [...this.classList._s].join(' '); },
    set className(v) { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get firstChild() { return this.children[0] ?? null; },
    get childNodes() { return this.children; },
    get nextSibling() {
      const sibs = this.parent?.children ?? [];
      return sibs[sibs.indexOf(this) + 1] ?? null;
    },
    // Faithful to the DOM: inserting a node that already has a parent MOVES
    // it. v3 moves session cards in and out of lane cards; a harness that
    // left the old copy behind would count every moved card twice.
    append(...kids) {
      for (const k of kids) {
        if (typeof k === 'string') { this._text += k; continue; }
        const old = k.parent?.children;
        if (old && old.includes(k)) old.splice(old.indexOf(k), 1);
        k.parent = this;
        this.children.push(k);
      }
    },
    insertBefore(node, ref) {
      if (node === ref) return node;
      const old = node.parent?.children;
      if (old && old.includes(node)) old.splice(old.indexOf(node), 1);
      node.parent = this;
      const i = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(i < 0 ? this.children.length : i, 0, node);
      return node;
    },
    replaceWith(next) {
      const sibs = this.parent?.children ?? [];
      const i = sibs.indexOf(this);
      if (i >= 0) { sibs[i] = next; next.parent = this.parent; }
    },
    remove() {
      const sibs = this.parent?.children ?? [];
      const i = sibs.indexOf(this);
      if (i >= 0) sibs.splice(i, 1);
    },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 }),
    scrollIntoView() {}, focus() {},
    attrs: {},
    // Not a no-op: the charts are built as SVG nodes whose class arrives via
    // setAttribute, and a no-op here made "did it draw two charts?" silently
    // answer no while the page was in fact fine.
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name === 'class') this.className = String(value);
    },
    getAttribute(name) { return this.attrs[name] ?? null; },
    querySelector() { return null; },
    querySelectorAll(sel) {
      const want = String(sel).replace(/^\./, '');
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (c.classList.contains(want)) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    closest() { return null; },
    matches() { return false; },
  };
  return el;
}

/** Build the sandbox, evaluate app.js in it, and hand back the pieces. */
function mount({ responses: primed = [], wide = false } = {}) {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const byId = new Map();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) byId.set(m[1], makeEl());

  // Buttons declared in the markup inside an id'd container — the view strip,
  // the phone tabs, the window pickers. The harness builds elements from ids
  // alone, so without this a container the page only ever READS from (to mark
  // one child active) looks empty and the check silently passes on nothing.
  // Deliberately shallow: these containers hold buttons and nothing else.
  for (const m of html.matchAll(/<(nav|div)[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const parent = byId.get(m[2]);
    if (!parent) continue;
    for (const b of m[3].matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
      const child = makeEl('button');
      for (const a of b[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)) child.dataset[a[1]] = a[2];
      const cls = /\sclass="([^"]*)"/.exec(b[1]);
      if (cls) child.className = cls[1];
      child.textContent = b[2].trim();
      parent.append(child);
    }
  }
  // Honour the real `hidden` attributes, so "did app.js reveal this?" is real.
  for (const m of html.matchAll(/<[^>]*\sid="([^"]+)"[^>]*\shidden[^>]*>/g)) {
    const el = byId.get(m[1]);
    if (el) el.hidden = true;
  }

  const sockets = [];
  /** URL fragment -> JSON body, primed by mount({ responses }). */
  const responses = [];
  // Window-level listeners are recorded rather than dropped, so a test can fire
  // a hashchange and exercise the view router the way a browser would.
  const winListeners = {};
  const document = {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (t) => makeEl(t),
    // The charts are hand-written SVG (hard rule 3: no chart library), so the
    // harness has to be able to make namespaced elements too.
    createElementNS: (_ns, t) => makeEl(t),
    createTextNode: (t) => { const n = makeEl('#text'); n.textContent = String(t); return n; },
    querySelectorAll: (sel) => byId.get('grid').querySelectorAll(sel),
    head: makeEl(), body: makeEl(), addEventListener() {},
  };
  const sandbox = {
    document, console: { log() {}, warn() {}, error() {} },
    location: { protocol: 'http:', host: 'x', hash: '', pathname: '/' },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    innerWidth: 3800, innerHeight: 1100, isSecureContext: false,
    addEventListener(k, fn) { (winListeners[k] ||= []).push(fn); },
    removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class {
      constructor(cb) { this._cb = cb; }
      observe(el) { this._cb([{ target: el, isIntersecting: true }]); }
      unobserve() {}
      disconnect() {}
    },
    performance: { now: () => 0, mark() {}, measure() {} },
    // The 49" layout query; everything else in the harness is width-blind.
    matchMedia: (q) => ({ matches: wide && /min-width: 2000px/.test(q) }),
    Notification: { permission: 'default' },
    navigator: { serviceWorker: undefined },
    // Primed per URL by a test; anything else stays a rejection, so an
    // accidental network call in the page still shows up as a failure.
    fetch: (url) => {
      for (const [pattern, body] of responses) {
        if (String(url).includes(pattern)) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
        }
      }
      return Promise.reject(new Error(`no route in the harness for ${url}`));
    },
    WebSocket: class {
      constructor() { this.readyState = 1; this._l = {}; sockets.push(this); }
      addEventListener(k, fn) { (this._l[k] ||= []).push(fn); }
      send() {} close() {}
      emit(k, ev) { for (const fn of this._l[k] || []) fn(ev); }
    },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // Strip the terminal.js import so the file runs as a classic script and no
  // socket is opened for a terminal.
  const src = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8').replace(
    /^import .*from '\/terminal\.js';$/m,
    'const openTerminal=()=>{},closeTerminal=()=>{},fitAll=()=>{},writeTo=()=>false,isLive=()=>false;'
  );
  vm.runInContext(src, sandbox, { filename: 'app.js' });

  assert.equal(sockets.length, 1, 'app.js should open exactly one dashboard socket');
  const fire = (kind, ev = {}) => { for (const fn of winListeners[kind] || []) fn(ev); };
  responses.push(...primed);
  const go = (hash) => { sandbox.location.hash = hash; fire('hashchange'); };
  return { byId, socket: sockets[0], sandbox, fire, go };
}

/** Read a public/ file — the static assertions need the source, not the DOM. */
function read2(f) { return fs.readFileSync(path.join(PUB, f), 'utf8'); }

function send(socket, msg) {
  socket.emit('message', { data: JSON.stringify(msg) });
}

function errorText(byId) {
  const box = byId.get('ui-error');
  return box.hidden ? '' : box.children.map((c) => c.textContent).join(' | ');
}

test('a snapshot renders one card per session with no UI errors', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });

  assert.equal(errorText(byId), '', 'the page reported a render error');
  assert.equal(
    byId.get('grid').children.length,
    snapshot.sessions.length,
    'every session should get a card'
  );
  assert.equal(byId.get('grid-empty').hidden, true, 'the "waiting" placeholder should be hidden');
});

test('a card carries the information a human needs at a glance', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });

  const first = byId.get('grid').children[0];
  const blob = first.textContent;
  const texts = [];
  const walk = (n) => { if (n._text) texts.push(n._text); n.children.forEach(walk); };
  walk(first);

  const session = [...snapshot.sessions].sort((a, b) => {
    const rank = { waiting_permission: 0, waiting_question: 1, working: 2, done: 3, idle: 4, shell: 5, dead: 6 };
    return (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || a.name.localeCompare(b.name);
  })[0];

  assert.ok(blob.includes(session.name), 'the card should show the session name');
  assert.ok(texts.some((t) => /open/.test(t)), 'the card should have an open button');
  assert.ok(texts.some((t) => /pin/.test(t)), 'the card should have a pin button');
});

test('the rail renders attention, vitals and rate limits', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });

  assert.equal(errorText(byId), '');
  assert.equal(byId.get('attention-list').children.length, snapshot.attention.length);
  assert.ok(byId.get('vitals').children.length >= 5, 'vitals tiles should render');
  assert.ok(byId.get('rate-limits').children.length >= 1, 'rate-limit gauges should render');
  assert.match(byId.get('stat-cost').textContent, /today/);
});

test('a delta updates only the sessions it names', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  const before = byId.get('grid').children.length;

  const target = snapshot.sessions[0];
  send(socket, {
    type: 'delta',
    sessions: [{ ...target, state: 'working' }],
    attention: snapshot.attention,
    generatedAt: Date.now(),
  });

  assert.equal(errorText(byId), '');
  assert.equal(byId.get('grid').children.length, before, 'a delta must not change the card count');
});

test('a removal takes the card away', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  const before = byId.get('grid').children.length;

  send(socket, { type: 'delta', removed: [snapshot.sessions[0].name], attention: [], generatedAt: Date.now() });

  assert.equal(errorText(byId), '');
  assert.equal(byId.get('grid').children.length, before - 1);
});

test('an empty snapshot shows the placeholder instead of a blank page', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', sessions: [], attention: [], vitals: null, generatedAt: Date.now() });

  assert.equal(errorText(byId), '');
  assert.equal(byId.get('grid').children.length, 0);
  assert.equal(byId.get('grid-empty').hidden, false);
});

test('one broken section does not blank the rest of the page', () => {
  // The lesson from the Stage 9 regression: renderAll isolates its sections.
  const { byId, socket } = mount();
  socket.emit('open', {});
  // vitals: null makes renderVitals bail early, but a malformed one would throw.
  send(socket, {
    type: 'snapshot',
    sessions: snapshot.sessions,
    attention: snapshot.attention,
    vitals: { cpuPct: null, mem: 'not an object', load: 'nope', disk: 5, gpu: 7 },
    generatedAt: Date.now(),
  });

  assert.equal(
    byId.get('grid').children.length,
    snapshot.sessions.length,
    'the cards must still render even if vitals throws'
  );
});

test('the connection badge follows the socket', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  assert.equal(byId.get('conn').textContent, 'live');
  assert.equal(byId.get('offline').hidden, true);
});

// --- agent chips --------------------------------------------------------------

/** Every text node under a card, flattened. */
function cardText(card) {
  const texts = [];
  const walk = (n) => { if (n._text) texts.push(n._text); n.children.forEach(walk); };
  walk(card);
  return texts.join(' | ');
}

test('a session card carries no agent chip', () => {
  // Claude is the only agent; chipping every card would spend density
  // without adding signal.
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });

  const card = byId.get('grid').children[0];
  assert.equal(card.className.includes('agent'), false);
});

// --- views (Stage 0) --------------------------------------------------------

const VIEWS = ['board', 'morning', 'credit', 'box'];

test('the board is the default view and the others start hidden', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });

  assert.equal(byId.get('view-board').hidden, false);
  for (const v of VIEWS.slice(1)) {
    assert.equal(byId.get(`view-${v}`).hidden, true, `${v} should start hidden`);
  }
});

test('a hash route shows exactly one view', () => {
  const { byId, socket, go } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });

  for (const target of VIEWS) {
    go(`#${target}`);
    for (const v of VIEWS) {
      assert.equal(
        byId.get(`view-${v}`).hidden, v !== target,
        `on #${target}, view-${v} should be ${v === target ? 'shown' : 'hidden'}`
      );
    }
  }
});

test('an unknown hash falls back to the board rather than a blank page', () => {
  const { byId, socket, go } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#nonsense');
  assert.equal(byId.get('view-board').hidden, false);
});

test('the #session= deep link still opens the sheet, on the board', () => {
  // This is the URL a push notification opens. It must survive the router.
  const { byId, socket, go } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#morning');
  assert.equal(byId.get('view-morning').hidden, false);

  const name = snapshot.sessions[0].name;
  go(`#session=${encodeURIComponent(name)}`);

  assert.equal(byId.get('sheet').hidden, false, 'the terminal sheet should open');
  assert.equal(byId.get('sheet-title').textContent, name);
  assert.equal(byId.get('view-board').hidden, false, 'a deep link lands on the board');
  assert.equal(errorText(byId), '');
});

test('switching views never blanks the grid', () => {
  const { byId, socket, go } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  const before = byId.get('grid').children.length;
  go('#credit');
  go('#board');
  assert.equal(byId.get('grid').children.length, before);
  assert.equal(errorText(byId), '');
});

// --- lanes (Stage 1) --------------------------------------------------------

/** The snapshot fixture, with three sessions moved into two lanes. */
function withLanes() {
  const s = structuredClone(snapshot);
  const names = s.sessions.map((x) => x.name);
  s.sessions[0].lane = 'horizon-v1';
  s.sessions[1].lane = 'horizon-v1';
  s.sessions[2].lane = 'bauplan';
  s.lanes = [
    { id: 'horizon-v1', root: '/home/user/code/other-horizon-v1', branch: 'feat/horizon-v1', hue: 112,
      sessions: [names[0], names[1]], merged: false, isMain: false, lastCommitAt: Date.now() - 3600e3, idle: false },
    { id: 'bauplan', root: '/home/user/code/example-repo-bauplan', branch: 'feat/bauplan', hue: 272,
      sessions: [names[2]], merged: false, isMain: false, lastCommitAt: Date.now() - 600e3, idle: false },
    { id: 'character-v1', root: '/home/user/code/other-character-v1', branch: 'feat/character-v1', hue: 358,
      sessions: [], merged: true, isMain: false, lastCommitAt: Date.now() - 259 * 3600e3, idle: true },
  ];
  return s;
}

test('the lane rail lists active lanes and idle worktrees separately', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...withLanes() });

  assert.equal(errorText(byId), '');
  const rail = byId.get('lane-rail');
  assert.equal(rail.hidden, false);
  const text = rail.textContent;
  assert.match(text, /horizon-v1/);
  assert.match(text, /bauplan/);
  // The idle lane carries the two facts that tell "finished" from "abandoned".
  assert.match(text, /character-v1/);
  assert.match(text, /merged/);
});

/** Every session card on the board, inside lane cards or not. */
function sessionCards(grid) {
  const out = [];
  const walk = (n) => { for (const c of n.children) { if (c.dataset?.name) out.push(c); else walk(c); } };
  walk(grid);
  return out;
}

test('an idle lane gets no card — it is not a session', () => {
  // lanes plan hard rule 6. A worktree with nothing running in it and no
  // launch record has no state, no attention score and no place in the grid.
  const { byId, socket } = mount();
  socket.emit('open', {});
  const s = withLanes();
  send(socket, { type: 'snapshot', ...s });

  const grid = byId.get('grid');
  assert.equal(grid.children.some((c) => c.dataset.lane === 'character-v1'), false,
    'the idle lane must not appear as a card');
  assert.equal(sessionCards(grid).length, s.sessions.length);
});

test('a lane is one card, striped, with its sessions inside as rows (v3)', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  const s = withLanes();
  send(socket, { type: 'snapshot', ...s });
  assert.equal(errorText(byId), '');

  const grid = byId.get('grid');
  const laneCards = grid.children.filter((c) => c.dataset.lane);
  assert.deepEqual(laneCards.map((c) => c.dataset.lane).sort(), ['bauplan', 'horizon-v1']);
  for (const c of laneCards) {
    assert.ok(c.classList.contains('has-lane'), `${c.dataset.lane} carries the stripe`);
    assert.match(c.textContent, new RegExp(c.dataset.lane), 'the header names the lane');
  }
  const horizon = laneCards.find((c) => c.dataset.lane === 'horizon-v1');
  const rows = sessionCards(horizon);
  assert.deepEqual(rows.map((r) => r.dataset.name).sort(), s.lanes[0].sessions.slice().sort());
  assert.ok(rows.every((r) => r.classList.contains('card-row')), 'sessions inside a lane card are rows');
  // A session with no lane keeps its own v2 card, with no stripe.
  const lone = grid.children.filter((c) => c.dataset.name);
  assert.equal(lone.length, s.sessions.filter((x) => !x.lane).length);
  assert.ok(lone.every((c) => !c.classList.contains('has-lane')));
  // Nothing is dropped: every session is on the board exactly once.
  assert.equal(sessionCards(grid).length, s.sessions.length);
});

test('a freshly launched lane shows 0/M, not nothing', () => {
  // v3: a lane whose plan has 3 stages and none finished yet.
  const { byId, socket } = mount();
  socket.emit('open', {});
  const s = withLanes();
  s.lanes[1].progress = { n: null, m: 3, source: null, at: null };
  send(socket, { type: 'snapshot', ...s });
  assert.equal(errorText(byId), '');
  assert.match(byId.get('lane-rail').textContent, /bauplan.*0\/3/s);
});

test('a session with no repo gets no stripe rather than a grey one', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  const s = structuredClone(snapshot);
  for (const x of s.sessions) x.lane = null;
  s.lanes = [];
  send(socket, { type: 'snapshot', ...s });

  assert.equal(byId.get('lane-rail').hidden, true, 'no lanes, no rail');
  for (const card of byId.get('grid').children) {
    assert.equal(card.classList.contains('has-lane'), false);
  }
});

test('filtering to a lane hides the others and keeps the very same card nodes', () => {
  // Clearing the filter must restore the board with the SAME cards, not
  // re-created ones: a rebuilt card loses its open menu and its observer.
  const { byId, socket } = mount();
  socket.emit('open', {});
  const s = withLanes();
  send(socket, { type: 'snapshot', ...s });

  const grid = byId.get('grid');
  const before = grid.children.slice();
  const beforeRows = sessionCards(grid);
  const pill = byId.get('lane-rail').querySelectorAll('lane-pill').find((p) => p.textContent.includes('horizon-v1'));
  assert.ok(pill, 'the horizon-v1 pill should exist');
  pill.onclick();

  for (const card of grid.children) {
    const want = card.dataset.lane === 'horizon-v1';
    assert.equal(card.hidden, !want, `${card.dataset.lane || card.dataset.name} visibility`);
  }
  assert.equal(grid.children.length, before.length, 'no card was removed');

  const clear = byId.get('lane-rail').querySelectorAll('lane-clear')[0];
  assert.ok(clear, 'a clear-filter control should appear while a filter is on');
  clear.onclick();
  const after = grid.children;
  assert.equal(after.length, before.length);
  // Identity is compared with a boolean on purpose. assert.equal on two of
  // these nodes would, on failure, ask util.inspect to serialise two cyclic
  // fake-DOM trees to build its message — which does not finish. A failing
  // assertion must report, not hang the suite.
  for (let i = 0; i < after.length; i++) {
    assert.ok(after[i] === before[i], `card ${i} was rebuilt by the filter`);
    assert.equal(after[i].hidden, false);
  }
  const afterRows = sessionCards(grid);
  for (let i = 0; i < afterRows.length; i++) assert.ok(afterRows[i] === beforeRows[i], `row ${i} was rebuilt`);
});

test('a lane filter that matches nothing says so instead of looking broken', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  const s = withLanes();
  send(socket, { type: 'snapshot', ...s });

  const idle = byId.get('lane-rail').querySelectorAll('lane-pill');
  // Filter to a lane, then remove its sessions with a delta.
  idle.find((p) => p.textContent.includes('bauplan')).onclick();
  send(socket, { type: 'delta', removed: [s.lanes[1].sessions[0]], attention: [], generatedAt: Date.now() });

  assert.equal(byId.get('grid-empty').hidden, false);
  assert.match(byId.get('grid-empty').textContent, /selected lanes/);
  assert.equal(errorText(byId), '');
});

// --- morning (Stage 3) -------------------------------------------------------

const NOW = Date.now();
const morningPayload = {
  window: 'tonight',
  label: 'tonight',
  since: NOW - 13 * 3600e3,
  now: NOW,
  needsYou: [
    { source: 'marker', id: 'marker:7', markerId: 7, name: 'horizon-v1', lane: 'horizon-v1',
      hue: 112, state: 'done', at: NOW - 600e3, kind: 'need',
      text: 'NEED-HUMAN: the ring budget doubles the draw calls — is that acceptable?' },
    { source: 'attention', id: 'attention:bauplan', name: 'bauplan', lane: 'bauplan', hue: 272,
      state: 'waiting_permission', at: NOW - 900e3, kind: 'waiting_permission', text: 'Bash: npm ci' },
  ],
  finished: [
    { lane: 'mesher-v1', hue: 67, branch: 'feat/mesher-v1', merged: true, isMain: false, idle: false,
      progress: { n: 4, m: 4, source: 'status', at: null }, lastCommitAt: NOW - 6 * 3600e3, newCommit: true,
      doneMarkers: [{ id: 3, ts: NOW - 5 * 3600e3, text: 'PACKAGE-DONE: the mesher ships', session: 'mesher-v1' }],
      sessions: [{ name: 'mesher-v1', state: 'done', since: NOW - 3600e3 }] },
    { lane: 'horizon-v1', hue: 112, branch: 'feat/horizon-v1', merged: false, isMain: false, idle: false,
      progress: { n: 3, m: 8, source: 'commit', at: NOW - 900e3 }, lastCommitAt: NOW - 900e3, newCommit: true,
      doneMarkers: [], sessions: [{ name: 'horizon-v1', state: 'working', since: NOW - 60e3 }] },
  ],
  cost: {
    lanes: [
      { lane: 'bauplan', hue: 272, usd: 252.11, tokens: 439600000, sessions: ['bauplan'] },
      { lane: null, hue: null, usd: 5.88, tokens: 6600000, sessions: ['machine-cleanup'] },
    ],
    totalUsd: 257.99, totalTokens: 446200000, label: 'API-equivalent',
  },
  rateLimits: {
    fiveHour: { usedPct: 74, resetsAt: NOW + 2 * 3600e3 },
    sevenDay: { usedPct: 15, resetsAt: NOW + 40 * 3600e3 },
  },
};

const settle = () => new Promise((r) => setImmediate(r));

test('the morning view renders its three blocks from the API', async () => {
  const { byId, socket, go } = mount({ responses: [['/api/morning', morningPayload]] });
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });

  go('#morning');
  await settle();

  assert.equal(errorText(byId), '');
  const text = byId.get('morning-body').textContent;
  assert.match(text, /Needs you/);
  assert.match(text, /Finished/);
  assert.match(text, /What it cost/);
});

test('a marker in Needs-you keeps its full text, never truncated to one line', () => {
  // The Morning view is the one place the whole sentence is worth reading.
  const full = morningPayload.needsYou[0].text;
  assert.ok(full.length > 60, 'the fixture should be longer than a card would show');
});

test('the morning view shows the whole marker sentence and both blocks of data', async () => {
  const { byId, socket, go } = mount({ responses: [['/api/morning', morningPayload]] });
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#morning');
  await settle();

  const text = byId.get('morning-body').textContent;
  assert.ok(text.includes(morningPayload.needsYou[0].text), 'the full marker text must survive');
  assert.match(text, /PACKAGE-DONE: the mesher ships/, 'done markers belong in Finished');
  assert.match(text, /3 of 8/, 'the stage of stages');
  assert.match(text, /merged/, 'the merged verdict');
  assert.match(text, /API-equivalent/, 'the label the money always carries');
  // The spend is asserted on the cell rather than on the flattened text: this
  // harness concatenates adjacent cells with no separator, so "$252" and
  // "439.6M" arrive as "$252439.6M" and a loose regex would prove nothing.
  // money() drops the cents above $100 — the board's existing formatter, kept
  // rather than given a table-specific variant (hard rule 9).
  const cells = byId.get('morning-body').querySelectorAll('num').map((c) => c.textContent);
  assert.ok(cells.includes('$252'), `spend cell missing, got ${JSON.stringify(cells)}`);
  assert.ok(cells.includes('439.6M'), 'the token count is its own cell');
});

test('the window picker marks exactly one window active', async () => {
  const { byId, socket, go } = mount({ responses: [['/api/morning', morningPayload]] });
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#morning');
  await settle();

  const on = (byId.get('morning-window').children || []).filter((b) => b.classList.contains('on'));
  assert.equal(on.length, 1);
  assert.equal(on[0].dataset.window, 'tonight');
});

test('a failed morning fetch says so instead of rendering a blank view', async () => {
  const { byId, socket, go } = mount(); // no route primed -> the fetch rejects
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#morning');
  await settle();

  assert.equal(errorText(byId), '', 'a failed fetch is not a UI crash');
  assert.match(byId.get('morning-body').textContent, /Could not load/);
});

// --- credit (Stage 4) --------------------------------------------------------

const creditPayload = {
  now: NOW,
  charts: {
    sevenDay: {
      title: '7-day window', since: NOW - 7 * 24 * 3600e3, now: NOW,
      points: [{ t: NOW - 6 * 24 * 3600e3, v: 4 }, { t: NOW - 3600e3, v: 15 }],
      resets: [NOW - 2 * 24 * 3600e3],
    },
    fiveHour: {
      title: '5-hour window', since: NOW - 24 * 3600e3, now: NOW,
      points: [{ t: NOW - 3 * 3600e3, v: 40 }, { t: NOW - 60e3, v: 75 }],
      resets: [],
    },
  },
  lanes: [
    { lane: 'bauplan', hue: 272, tonight: 253.03, day: 253.03, week: 253.03, allTime: 253.03,
      tokens: { input: 1900, output: 734400, cacheRead: 439200000, cacheWrite: 1500000 } },
    { lane: '(ended sessions)', hue: null, tonight: 0, day: 0, week: 619.4, allTime: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  ],
  totals: { tonight: 634.69, day: 642.77, week: 1430.84, allTime: 1196.63 },
  rateLimits: {
    fiveHour: { usedPct: 75, resetsAt: NOW + 3600e3 },
    sevenDay: { usedPct: 15, resetsAt: NOW + 40 * 3600e3 },
  },
  sampler: { rows: 12, lastSampleAt: NOW - 40e3, lastSampleAgeMs: 40e3 },
  label: 'API-equivalent',
};

test('the credit view draws both charts and the lane table', async () => {
  const { byId, socket, go } = mount({ responses: [['/api/credit', creditPayload]] });
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#credit');
  await settle();

  assert.equal(errorText(byId), '');
  const body = byId.get('credit-body');
  const svgs = body.querySelectorAll('chart');
  assert.equal(svgs.length, 2, 'a chart per rate-limit window');
  const text = body.textContent;
  assert.match(text, /7-day window/);
  assert.match(text, /5-hour window/);
  assert.match(text, /bauplan/);
  assert.match(text, /API-equivalent/);
});

test('the chart is inline SVG with no library and no animation', () => {
  // Hard rule 3: charts are hand-written. Hard rule: nothing animates but the
  // working dot.
  const app = read2('app.js');
  assert.match(app, /createElementNS/, 'the chart is built as real SVG nodes');
  assert.ok(!/import .*chart|d3|chart\.js/i.test(app), 'no chart library may appear');
  const css = read2('styles.css');
  const chartRules = css.slice(css.indexOf('.chart-head'), css.indexOf('.dtable th.sorted'));
  assert.ok(!/animation|@keyframes|transition/.test(chartRules), 'charts must not animate');
});

test('an ended-session row shows a dash, not a zero, for all time', () => {
  // A zero would read as "this lane is free". The session is gone; there is
  // nothing to total.
  const row = creditPayload.lanes[1];
  assert.equal(row.allTime, null);
});

test('the ended-session row really renders as a dash', async () => {
  const { byId, socket, go } = mount({ responses: [['/api/credit', creditPayload]] });
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#credit');
  await settle();

  const cells = byId.get('credit-body').querySelectorAll('num').map((c) => c.textContent);
  assert.ok(cells.includes('—'), `expected a dash cell, got ${JSON.stringify(cells)}`);
});

test('the sampler health is on screen, so a dead sampler is visible', async () => {
  const { byId, socket, go } = mount({ responses: [['/api/credit', creditPayload]] });
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#credit');
  await settle();
  assert.match(byId.get('credit-sampler').textContent, /12 samples/);
});

// --- v3: the Box view, and where the old views land ---------------------------

test('the box view shows the vitals from the snapshot, with no fetch of its own', () => {
  const { byId, socket, go } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  go('#box');
  assert.equal(byId.get('view-box').hidden, false);
  const text = byId.get('box-body').textContent;
  assert.match(text, /cpu/);
  assert.match(text, /laneboard/);
  assert.equal(errorText(byId), '');
});

test('a stale #machine or #files lands on the board', () => {
  const { byId, socket, go } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot });
  for (const old of ['#machine', '#files']) {
    go('#credit');
    go(old);
    assert.equal(byId.get('view-board').hidden, false, `${old} should land on the board`);
  }
  assert.equal(errorText(byId), '');
});

// --- stage 7: the restyle ----------------------------------------------------

/** A snapshot with `n` sessions, cloned from the fixture. */
function bigSnapshot(n) {
  const base = snapshot.sessions[0];
  const sessions = [];
  const lanes = [];
  for (let i = 0; i < n; i++) {
    const lane = `lane-${i % 6}`;
    sessions.push({ ...base, name: `session-${String(i).padStart(2, '0')}`, lane });
    if (!lanes.some((l) => l.id === lane)) {
      lanes.push({ id: lane, root: `/h/${lane}`, branch: 'main', hue: (i * 57) % 360,
        sessions: [], merged: false, isMain: false, lastCommitAt: NOW, idle: false, progress: null });
    }
  }
  for (const l of lanes) l.sessions = sessions.filter((s) => s.lane === l.id).map((s) => s.name);
  return { ...snapshot, sessions, lanes };
}

test('twenty cards render, with their lanes, and nothing is dropped', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...bigSnapshot(20) });

  assert.equal(errorText(byId), '');
  assert.equal(sessionCards(byId.get('grid')).length, 20, 'every one of 20 sessions is on the board');
  assert.equal(byId.get('grid').children.filter((c) => c.dataset.lane).length, 6, 'one card per lane');
  assert.ok(byId.get('lane-rail').textContent.includes('lane-0'));
});

test('the render path does not degrade superlinearly with card count', () => {
  // The real 16 ms budget can only be measured in a browser — this harness has
  // a far cheaper DOM and would flatter the number, which the v1 handoff says
  // too. What CAN be caught here is the thing the budget actually protects
  // against: an accidental O(n^2) in renderGrid, where every card touches every
  // other. Ten times the cards must not cost anywhere near a hundred times.
  const time = (n) => {
    const { socket } = mount();
    socket.emit('open', {});
    const snap = bigSnapshot(n);
    const t0 = process.hrtime.bigint();
    send(socket, { type: 'snapshot', ...snap });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  time(5); // warm the JIT so the first measured run is not the slow one
  const small = Math.max(time(5), 0.05);
  const large = time(50);
  assert.ok(large / small < 40, `50 cards cost ${(large / small).toFixed(1)}x of 5 — looks superlinear`);
});

// --- v3 stage 7: lane cards, the Box, the launch sheet -----------------------------

/** A snapshot with launched lanes: `lanes` = [{ id, pr, sessions: n, slotUp }] */
function v3Snapshot(lanes, { extraSessions = 0 } = {}) {
  const base = snapshot.sessions[0];
  const sessions = [];
  const laneObjs = [];
  const launched = [];
  const prs = {};
  const slots = [];
  lanes.forEach((l, i) => {
    const names = [];
    for (let k = 0; k < (l.sessions ?? 1); k++) {
      const name = `${l.id}${k ? `-${k}` : ''}`;
      names.push(name);
      sessions.push({ ...base, name, lane: l.id, state: l.state ?? 'working', danger: l.danger ?? null, lastMarker: l.marker ?? null });
    }
    laneObjs.push({ id: l.id, root: `/home/user/code/example-repo-${l.id}`, branch: `feat/${l.id}`, hue: (i * 97) % 360,
      sessions: names, merged: false, isMain: false, lastCommitAt: Date.now() - 600e3, idle: names.length === 0,
      progress: { n: 1, m: 4, source: 'commit', at: null, current: { n: 2, title: 'The second stage' } } });
    launched.push({ id: l.id, repo: 'example-repo', root: `/home/user/code/example-repo-${l.id}`, branch: `feat/${l.id}`,
      plan: `docs/plans/${l.id}.md`, slot: 2 + i, model: 'opus', permissionMode: 'auto', session: l.id, createdAt: 1, retiredAt: null });
    prs[l.id] = l.pr ?? { none: true };
    slots.push({ slot: 2 + i, exists: true, up: l.slotUp !== false, lane: l.id, owner: `lane ${l.id}`, orphan: false, laneSlot: true,
      ports: { pg: 15532 + 100 * i, redis: 16479, s3: 19100 }, containers: [] });
  });
  for (let k = 0; k < extraSessions; k++) sessions.push({ ...base, name: `lone-${k}`, lane: null, state: 'done', danger: null });
  return {
    ...snapshot,
    sessions,
    lanes: laneObjs,
    attention: [],
    box: {
      launched, prs, slots,
      readiness: Object.fromEntries(lanes.filter((l) => l.readiness).map((l) => [l.id, l.readiness])),
      jobs: [], burn5h: { [lanes[0]?.id]: 3.21 },
      ci: { queue: { runs: [{ name: 'lint-and-test', branch: 'feat/a', status: 'in_progress', conclusion: null }], queued: 0, running: 1 }, auth: { ok: true } },
      devstack: {
        health: { api: { ok: true, status: 200 }, web: { ok: true, status: 200 } },
        containers: [{ name: 'example-stack-api-1', state: 'running', status: 'Up 5 hours' }],
        lastDeploy: { at: Date.now() - 60e3, message: 'Finished' },
        guard: { ok: true, preventive: [], detective: [], ssOk: true },
      },
    },
  };
}

const PR = {
  draft: { number: 11, url: 'https://github.com/x/y/pull/11', state: 'OPEN', isDraft: true, verdict: 'pending', checks: { passed: 2, failed: 0, pending: 3, total: 5, failedNames: [] } },
  red: { number: 12, url: 'https://github.com/x/y/pull/12', state: 'OPEN', isDraft: false, verdict: 'red', checks: { passed: 8, failed: 1, pending: 0, total: 9, failedNames: ['lint-and-test'] } },
  green: { number: 13, url: 'https://github.com/x/y/pull/13', state: 'OPEN', isDraft: false, verdict: 'green', checks: { passed: 9, failed: 0, pending: 0, total: 9, failedNames: [] } },
  merged: { number: 14, url: 'https://github.com/x/y/pull/14', state: 'MERGED', isDraft: false, verdict: 'green', checks: { passed: 9, failed: 0, pending: 0, total: 9, failedNames: [] } },
};

function laneCard(byId, id) {
  return byId.get('grid').children.find((c) => c.dataset.lane === id);
}

test('a lane card in every PR state: none, draft+pending, red, green, merged', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...v3Snapshot([
    { id: 'no-pr' }, { id: 'drafty', pr: PR.draft }, { id: 'reddy', pr: PR.red }, { id: 'greeny', pr: PR.green }, { id: 'mergy', pr: PR.merged },
  ]) });
  assert.equal(errorText(byId), '');
  const expect = {
    'no-pr': /no PR/,
    drafty: /draft #11 · ◌ 3\/5/,
    reddy: /open #12 · ✗ 1\/9/,
    greeny: /open #13 · ✓ 9\/9/,
    mergy: /merged #14/,
  };
  for (const [id, re] of Object.entries(expect)) {
    const card = laneCard(byId, id);
    assert.ok(card, `${id} has a lane card`);
    assert.match(card.textContent, re, `${id}: PR chip`);
    // Everything the header promises is there.
    assert.match(card.textContent, /1\/4/, `${id}: plan progress`);
    assert.match(card.textContent, /S2 The second stage/, `${id}: current stage title`);
    assert.match(card.textContent, new RegExp(`⌥feat/${id}`), `${id}: branch`);
    assert.match(card.textContent, /slot \d :15\d32/, `${id}: slot chip`);
    assert.match(card.textContent, /opus/, `${id}: model`);
  }
  const red = laneCard(byId, 'reddy').querySelectorAll('chip-pr')[0];
  assert.ok(red.classList.contains('ck-red'));
  assert.match(red.title, /lint-and-test/, 'the failing check is named');
  assert.match(laneCard(byId, 'no-pr').textContent, /\$3\.21\/5h/, 'the lane\'s 5 h burn');
});

test('lane cards sort by the most urgent session inside; lone sessions sort among them', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  const snap = v3Snapshot([{ id: 'calm', state: 'done' }, { id: 'asking', state: 'waiting_permission' }], { extraSessions: 1 });
  snap.sessions.find((x) => x.name === 'lone-0').state = 'working';
  send(socket, { type: 'snapshot', ...snap });
  const order = byId.get('grid').children.map((c) => c.dataset.lane || c.dataset.name);
  assert.deepEqual(order, ['asking', 'lone-0', 'calm']);
});

test('danger goes first, even ahead of a permission prompt', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  const snap = v3Snapshot([{ id: 'asking', state: 'waiting_permission' },
    { id: 'risky', state: 'done', danger: { reason: 'DATABASE_ADMIN_URL points at :5432, the dev stack' } }]);
  snap.attention = [
    { name: 'risky', state: 'done', score: 1000, since: 1, danger: 'DATABASE_ADMIN_URL points at :5432, the dev stack' },
    { name: 'asking', state: 'waiting_permission', score: 100, since: 2, danger: null },
  ];
  send(socket, { type: 'snapshot', ...snap });
  assert.equal(byId.get('grid').children[0].dataset.lane, 'risky');
  assert.ok(byId.get('grid').children[0].classList.contains('danger'));
  assert.match(byId.get('grid').children[0].textContent, /:5432/);
  const first = byId.get('attention-list').children[0].children[0];
  assert.ok(first.classList.contains('s-danger'), 'the attention list marks it');
});

test('a lane with nothing live shows its retire readiness, and never a retire button', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...v3Snapshot([
    { id: 'finished', sessions: 0, pr: PR.merged, readiness: { ready: true, reasons: ['no live session', 'worktree clean', 'PR merged'], blockers: [] } },
    { id: 'stuck', sessions: 0, readiness: { ready: false, reasons: [], blockers: ['worktree dirty: 2 files'] } },
  ]) });
  assert.match(laneCard(byId, 'finished').textContent, /ready to retire.*PR merged/);
  assert.match(laneCard(byId, 'stuck').textContent, /not ready.*worktree dirty: 2 files/);
  const buttons = laneCard(byId, 'finished').querySelectorAll('btn');
  assert.ok(!buttons.some((b) => /retire/i.test(b.textContent)), 'retiring is a human act elsewhere');
});

test('the empty board says what to do', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...snapshot, sessions: [], lanes: [], attention: [], box: null });
  assert.equal(errorText(byId), '');
  assert.equal(byId.get('grid').children.length, 0);
  assert.equal(byId.get('grid-empty').hidden, false);
  assert.match(byId.get('grid-empty').textContent, /Launch/);
});

test('the Box shows the dev stack, the CI queue and the slots', () => {
  const { byId, socket, go } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...v3Snapshot([{ id: 'a' }]) });
  go('#box');
  const text = byId.get('box-body').textContent;
  assert.match(text, /Dev stack.*guard ok/s);
  assert.match(text, /api \/api\/health.*200/s);
  assert.match(text, /CI queue.*1 running/s);
  assert.match(text, /lint-and-test/);
  assert.match(text, /slot 2 :15532.*lane a/s);
  assert.equal(errorText(byId), '');
});

test('on the 49" the Box is rail blocks; elsewhere the rail box stays hidden', () => {
  const narrow = mount();
  narrow.socket.emit('open', {});
  send(narrow.socket, { type: 'snapshot', ...v3Snapshot([{ id: 'a' }]) });
  assert.equal(narrow.byId.get('rail-box').hidden, true);

  const wide = mount({ wide: true });
  wide.socket.emit('open', {});
  send(wide.socket, { type: 'snapshot', ...v3Snapshot([{ id: 'a' }]) });
  assert.equal(wide.byId.get('rail-box').hidden, false);
  assert.match(wide.byId.get('rail-box').textContent, /Dev stack.*CI queue.*Agent slots/s);
  const css = read2('styles.css');
  assert.match(css, /@media \(min-width: 2000px\)\s*\{\s*\.view-tab\[data-view="box"\] \{ display: none; \}/, 'the tab hides on the 49"');
});

test('phone: lane cards are one column, rows keep Yes/No, the launch form will not zoom', () => {
  const { byId, socket } = mount();
  socket.emit('open', {});
  send(socket, { type: 'snapshot', ...v3Snapshot([{ id: 'asking', state: 'waiting_permission' }]) });
  const row = laneCard(byId, 'asking').querySelectorAll('card-row')[0];
  assert.ok(row, 'the session is a row inside its lane card');
  const labels = row.querySelectorAll('btn').map((b) => b.textContent);
  assert.ok(labels.includes('Yes') && labels.includes('No'), `Yes/No survive inside a lane card (${labels})`);
  const css = read2('styles.css');
  assert.match(css, /\.grid \{ display: grid; grid-template-columns: 1fr;/, 'one column below 700px');
  const phone = css.slice(css.lastIndexOf('@media (max-width: 699px)'));
  assert.match(phone, /\.launch-form input, \.launch-form select \{ font-size: 16px; \}/);
});

test('the render budget of v2 holds with 3 lanes and 6 sessions', () => {
  // Same proxy as the 20-card test above: a real browser is the only honest
  // 16 ms measurement, but a lane card must not turn a render into something
  // that scales with anything but its own rows.
  const time = (snap) => {
    const { socket } = mount();
    socket.emit('open', {});
    const t0 = process.hrtime.bigint();
    send(socket, { type: 'snapshot', ...snap });
    for (let i = 0; i < 10; i++) send(socket, { type: 'delta', sessions: [snap.sessions[i % snap.sessions.length]], generatedAt: i });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const three = v3Snapshot([{ id: 'a', sessions: 2 }, { id: 'b', sessions: 2 }, { id: 'c', sessions: 2 }]);
  time(three);
  const ms = time(three);
  assert.ok(ms < 50, `a snapshot and ten deltas took ${ms.toFixed(1)} ms in the harness`);
});

test('the launch sheet posts the form and shows the refusal in the server\'s words', async () => {
  const { byId, sandbox } = mount();
  let posted = null;
  sandbox.fetch = (url, opts) => {
    posted = { url, body: JSON.parse(opts.body) };
    return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'no free lane slot (slot 2: lane a; slot 3: lane b; slot 4: lane c)' }) });
  };
  byId.get('lf-lane').value = 'bauplan';
  byId.get('lf-model').value = 'opus';
  await sandbox.submitLaunch({ preventDefault() {} });
  assert.equal(posted.url, '/api/lanes');
  // Empty fields are left out, so the server's defaults (example-repo, feat/<lane>) apply.
  assert.deepEqual(posted.body, { lane: 'bauplan', plan: 'docs/plans/bauplan.md', model: 'opus' });
  assert.match(byId.get('lf-steps').textContent, /refused: no free lane slot \(slot 2: lane a/);
});

test('the mission-control skin kept every panel flat', () => {
  const css = read2('styles.css');
  // Panels get no drop shadow; only things that genuinely float keep one.
  const cardRule = /\.card \{([\s\S]*?)\}/.exec(css);
  assert.ok(cardRule, '.card rule must exist');
  assert.ok(!/box-shadow/.test(cardRule[1]), 'a card is a panel, not a floating tile');
  assert.match(cardRule[1], /background: var\(--bg-surface\)/, 'flat fill, no gradient');
  assert.match(css, /--radius-l: 2px/, 'panels get a 2px radius');
  assert.match(css, /--gap: 8px/, 'the grid tightens from 14px to 8px');
});

test('the accent is spent only on focus and pins', () => {
  // State colour is the only colour that carries meaning. The model name used
  // to take the accent, which left nothing to notice a pin with.
  const css = read2('styles.css');
  const accentUsers = [...css.matchAll(/([^{}]+)\{[^{}]*var\(--accent(?!-)\)/g)]
    .map((m) => m[1].trim().split(/\s+/).pop())
    // :root DEFINES the token (and its aliases); it does not spend it.
    .filter((sel) => (sel.startsWith('.') || sel.startsWith(':')) && sel !== ':root');
  for (const sel of accentUsers) {
    assert.ok(
      // focus, the keyboard cursor, a pin, the active view, an active filter,
      // a drop target, and a filing a human overrode — all of them transient
      // "you did this" marks rather than a property of the data.
      /focus|cursor|dropping|btn\.on|tab|lane-clear|qb-form|foverride/.test(sel),
      `${sel} spends the accent on something that is not focus, a pin or an interaction`
    );
  }
});

test('the phone keeps readable type and 16px inputs', () => {
  // Dense is a desktop idea; iOS zooms the page for any input under 16px.
  const css = read2('styles.css');
  const phone = css.slice(css.indexOf('@media (max-width: 699px)'));
  assert.match(phone, /html, body \{ font-size: 15px; \}/);
  assert.match(css, /font-size: 16px; \/\* 16px stops iOS zooming/);
});

test('the terminal stays opaque and legible', () => {
  const term = read2('terminal.js');
  assert.match(term, /minimumContrastRatio: 4\.5/);
  assert.ok(!/allowTransparency:\s*true/.test(term), 'a transparent xterm costs performance');
});
