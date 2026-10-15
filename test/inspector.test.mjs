// The inspector (L3, fleet plan §4 D6): the pure selection and model, the tab
// registry, the touch message (README §3.4, §7 O10), the L4 mode, the hairline
// geometry, the action bar stub (ui/actionbar.js, §8 C14 takes it over), and a
// fake-DOM render that keeps builder text out of markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDocument, makeEl, texts } from './helpers/fakedom.mjs';
import {
  STATE_WORD, TAB_SLOTS, TOUCH_HOW, SPARK_SAMPLES,
  selKey, resolveSel, inspectorModel, modelFor, prFor, pushSample,
  registerTab, unregisterTab, registeredTabs, tabsModel, _resetTabs,
  touchMessage, shouldTouch, l4Mode, hairline,
  renderHeader, renderOverview, applyRoute, anchorEl, selected, bindMap,
} from '../public/js/ui/inspector.js';
import {
  ACTIONBAR_BUTTONS, actionBarModel, actionList, actionTarget, registerAction, unregisterAction,
  renderActionBar, runAction, _resetActions,
} from '../public/js/ui/actionbar.js';
import { createStore, store } from '../public/js/core/store.js';
import { HOWS } from '../server/hub/reviewwait.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EVIL = '<img src=x onerror=alert(1)>';

// --- fixtures -------------------------------------------------------------------------

function sess(builder, name, extra = {}) {
  return { key: `${builder}/${name}`, name, builder, state: 'working', stateSince: 1000, ...extra };
}

/** A fleet-keyed store with builder-a (lane auth: sessions auth + auth-2) and builder-b. */
function fleetStore() {
  const s = createStore({ keyMode: 'fkey' });
  s.source.kind = 'hub';
  const a1 = sess('builder-a', 'auth', { lane: 'auth', laneKey: 'builder-a/auth', state: 'working', context: { usedPct: 70, size: 200000 }, cost: { usd: 1.5, usdToday: 0.5 } });
  const a2 = sess('builder-a', 'auth-2', { lane: 'auth', laneKey: 'builder-a/auth', state: 'waiting_permission', awaitingApproval: '6f1c1a8e-0000-4000-8000-000000000001' });
  const b1 = sess('builder-b', 'web', { state: 'idle' });
  for (const x of [a1, a2, b1]) s.sessions.set(x.key, x);
  s.lanes = [
    { id: 'auth', key: 'builder-a/auth', builder: 'builder-a', root: '/w/auth', branch: 'feat/auth', sessions: ['auth', 'auth-2'], progress: { n: 3, m: 7 }, isMain: false },
    { id: 'docs', key: 'builder-a/docs', builder: 'builder-a', root: '/w/docs', branch: 'main', sessions: [], isMain: true },
  ];
  s.builders.set('builder-a', {
    id: 'builder-a', code: 'B1', status: 'live', sessions: new Map(),
    box: { prs: { auth: { number: 142, state: 'OPEN', url: 'https://example.invalid/acme/pull/142', verdict: 'red', checks: { passed: 2, failed: 1, pending: 0, total: 3, failedNames: ['lint'] } } } },
  });
  s.builders.set('builder-b', { id: 'builder-b', code: 'B2', status: 'down', sessions: new Map() });
  return s;
}

// --- selection --------------------------------------------------------------------------

test('selKey strips the Map node-id prefixes and keeps fleet keys', () => {
  assert.equal(selKey('builder-a/auth'), 'builder-a/auth');
  assert.equal(selKey('lane:builder-a/auth'), 'builder-a/auth');
  assert.equal(selKey('sess:builder-a/auth-2'), 'builder-a/auth-2');
  assert.equal(selKey('builder:builder-a'), 'builder:builder-a');
  assert.equal(selKey(''), null);
  assert.equal(selKey(null), null);
});

test('resolveSel: a session wins, a lane resolves to its worst session, unknown keeps the names', () => {
  const s = fleetStore();
  const r1 = resolveSel(s, 'builder-a/auth');
  assert.equal(r1.sessionKey, 'builder-a/auth', 'the session of the same name wins over the lane');
  assert.equal(r1.lane.id, 'auth');
  const r2 = resolveSel(s, 'builder-a/docs');
  assert.equal(r2.lane.id, 'docs');
  assert.equal(r2.session, null, 'a lane with no live session');
  s.sessions.delete('builder-a/auth');
  const r3 = resolveSel(s, 'lane:builder-a/auth');
  assert.equal(r3.sessionKey, 'builder-a/auth-2', 'the lead session is the worst state');
  const r4 = resolveSel(s, 'builder-c/ghost');
  assert.equal(r4.session, null);
  assert.equal(r4.lane, null);
  assert.equal(r4.builder, 'builder-c');
  assert.equal(r4.name, 'ghost');
});

test('resolveSel works in keyMode name (a standalone builder before hello)', () => {
  const s = createStore({ keyMode: 'name' });
  s.sessions.set('auth', { name: 'auth', state: 'idle' });
  assert.equal(resolveSel(s, 'local/auth').sessionKey, 'auth');
  assert.equal(resolveSel(s, 'auth').sessionKey, 'auth');
});

// --- the model ------------------------------------------------------------------------------

test('inspectorModel: header, data block, flags and approval from the lane and its session', () => {
  const s = fleetStore();
  const m = modelFor(s, 'builder-a/auth-2');
  assert.equal(m.found, true);
  assert.equal(m.code, 'B1');
  assert.equal(m.title, 'auth', 'the lane id titles the panel');
  assert.equal(m.sessionName, 'auth-2');
  assert.equal(m.word, 'PERM');
  assert.equal(m.p, '1');
  assert.deepEqual(m.stage, { n: 3, m: 7 });
  assert.equal(m.branch, 'feat/auth');
  assert.equal(m.approvalId, '6f1c1a8e-0000-4000-8000-000000000001');
  assert.ok(m.flags.some((f) => f.id === 'approval'));
  assert.equal(m.laneKey, 'builder-a/auth');
  assert.equal(m.pr.number, 142);
  assert.equal(m.pr.verdict, 'red');
  assert.deepEqual(m.pr.failing, ['lint']);
  const w = modelFor(s, 'builder-a/auth');
  assert.equal(w.ctx, 70);
  assert.equal(w.usd, 1.5);
  assert.deepEqual(w.ctxHistory, [70]);
  assert.equal(w.word, 'WORK');
});

test('inspectorModel: every state has a four-letter word; nothing found says so', () => {
  for (const [st, w] of Object.entries(STATE_WORD)) {
    assert.equal(w.length, 4);
    assert.equal(inspectorModel(null, { session: { name: 'x', state: st } }).word, w);
  }
  const none = inspectorModel(null, { key: 'builder-c/ghost' });
  assert.equal(none.found, false);
  assert.equal(none.title, 'builder-c/ghost');
  assert.equal(none.stateLabel, 'not found');
  const laneOnly = inspectorModel({ id: 'docs', builder: 'builder-a', sessions: [], isMain: true });
  assert.equal(laneOnly.word, 'LANE');
  assert.equal(laneOnly.sessionKey, null);
});

test('inspectorModel keeps builder text as plain strings, caps it, and only follows https PR links', () => {
  const long = 'x'.repeat(5000);
  const m = inspectorModel(null, {
    session: {
      name: EVIL, state: 'working', builder: 'builder-a',
      activity: { lastUserPrompt: EVIL, lastAssistant: long, tool: 'Edit', toolInput: EVIL },
      previewLines: [...Array.from({ length: 100 }, (_, i) => `l${i}`), 42],
      danger: { reason: EVIL },
    },
    pr: { number: 7, state: 'OPEN', url: 'javascript:alert(1)' },
  });
  assert.equal(m.sessionName, EVIL);
  assert.equal(m.prompt, EVIL);
  assert.ok(m.assistant.length <= 2001);
  assert.equal(m.previewLines.length, 60, 'the preview keeps the last 60 string lines');
  assert.ok(m.previewLines.every((l) => typeof l === 'string'));
  assert.equal(m.pr.url, null, 'a non-https PR link is not followed');
  assert.equal(inspectorModel(null, { session: { name: 'a' }, pr: { number: 7, url: 'https://example.invalid/p/7' } }).pr.url, 'https://example.invalid/p/7');
  assert.equal(m.flags[0].id, 'danger');
});

test('prFor reads the lane PR from its builder box (the standalone box on one builder)', () => {
  const s = fleetStore();
  assert.equal(prFor(s, 'builder-a', 'auth').number, 142);
  assert.equal(prFor(s, 'builder-b', 'auth'), null);
  const one = createStore();
  one.box = { prs: { auth: { number: 1 } } };
  assert.equal(prFor(one, null, 'auth').number, 1);
});

test('builderDown: a down builder on the hub is flagged for the action bar', () => {
  const s = fleetStore();
  assert.equal(modelFor(s, 'builder-b/web').builderDown, true);
  assert.equal(modelFor(s, 'builder-a/auth').builderDown, false);
});

test('pushSample keeps a bounded series and drops repeats', () => {
  const h = new Map();
  for (let i = 0; i < 50; i++) pushSample(h, 'k', { ctx: i, usd: 1 });
  assert.equal(h.get('k').ctx.length, SPARK_SAMPLES);
  assert.equal(h.get('k').ctx.at(-1), 49);
  assert.deepEqual(h.get('k').usd, [1]);
  pushSample(h, 'k', { ctx: NaN });
  assert.equal(h.get('k').ctx.length, SPARK_SAMPLES);
  assert.equal(pushSample(h, null, {}), null);
});

// --- tab registry ------------------------------------------------------------------------------

test('registerTab: slots in order (overview, peek, diff, transcript), then others; unregister', () => {
  _resetTabs();
  assert.deepEqual(TAB_SLOTS, ['overview', 'peek', 'diff', 'transcript']);
  const mount = () => {};
  const offX = registerTab({ id: 'extra', title: 'XTRA', mount, unmount() {} });
  registerTab({ id: 'transcript', title: 'TRSC', mount, unmount() {} });
  registerTab({ id: 'diff', title: 'DIFF', mount, unmount() {} });
  registerTab({ id: 'peek', title: 'PEEK', mount, unmount() {} });
  assert.deepEqual(registeredTabs().map((t) => t.id), ['peek', 'diff', 'transcript', 'extra']);
  const tabs = tabsModel(registeredTabs(), 'diff');
  assert.deepEqual(tabs.map((t) => t.id), ['overview', 'peek', 'diff', 'transcript', 'extra']);
  assert.equal(tabs.find((t) => t.active).id, 'diff');
  assert.ok(tabs.every((t) => t.label.length <= 5), 'tab labels are at most 5 characters');
  offX();
  assert.equal(registeredTabs().length, 3);
  assert.equal(unregisterTab('peek'), true);
  assert.equal(tabsModel(registeredTabs(), 'peek').find((t) => t.active).id, 'overview', 'an unregistered tab falls back');
  assert.throws(() => registerTab({ id: 'overview', mount }), /built in/);
  assert.throws(() => registerTab({ id: 'Bad Id', mount }), /bad id/);
  assert.throws(() => registerTab({ id: 'nomount' }), /mount/);
  _resetTabs();
});

// --- touch, L4, hairline --------------------------------------------------------------------------

test('touch: {type:touch, fkey, how:inspect}, a how the hub review-wait accepts, once per selection on the hub', () => {
  assert.deepEqual(touchMessage('builder-a/auth'), { type: 'touch', fkey: 'builder-a/auth', how: 'inspect' });
  assert.ok(HOWS.includes(TOUCH_HOW), 'O10 records this how');
  assert.equal(shouldTouch(null, 'builder-a/auth', 'hub'), true);
  assert.equal(shouldTouch('builder-a/auth', 'builder-a/auth', 'hub'), false);
  assert.equal(shouldTouch(null, 'builder-a/auth', 'local'), false, 'a builder /ws has no review-wait');
  assert.equal(shouldTouch(null, 'not-a-key', 'hub'), false);
  assert.equal(shouldTouch(null, null, 'hub'), false);
});

test('L4 opens in the centre on desktop and as the full sheet below it', () => {
  assert.equal(l4Mode(1600), 'centre');
  assert.equal(l4Mode(1200), 'centre');
  assert.equal(l4Mode(900), 'sheet');
  assert.equal(l4Mode(400), 'sheet');
});

test('hairline: from the node to the panel edge at its height, clamped; none under the panel', () => {
  const rect = { left: 1000, top: 0, bottom: 800 };
  const h = hairline({ x: 400, y: 300 }, rect);
  assert.equal(h.x, 400);
  assert.equal(h.y, 300);
  assert.equal(h.len, 600);
  assert.equal(h.angle, 0);
  const up = hairline({ x: 400, y: -100 }, rect);
  assert.ok(up.angle > 0, 'a node above the panel aims down to its top edge');
  assert.equal(Math.round(up.len), Math.round(Math.hypot(600, 108)));
  assert.equal(hairline({ x: 1100, y: 300 }, rect), null);
  assert.equal(hairline(null, rect), null);
  assert.equal(hairline({ x: 1, y: 1 }, null), null);
});

// --- action bar ---------------------------------------------------------------------------------------

test('the action bar stub lists the plan buttons in order', () => {
  _resetActions();
  assert.deepEqual(ACTIONBAR_BUTTONS, ['resume', 'pause', 'approve', 'deny', 'terminal', 'interrupt', 'restart', 'kill', 'retire']);
  assert.deepEqual(actionList().map((a) => a.id), ACTIONBAR_BUTTONS);
});

test('actionBarModel: approve/deny only with a pending approval, resume vs pause, reasons, tiers', () => {
  _resetActions();
  const s = fleetStore();
  const tier = (a) => ({ kill: 'confirm', retire: 'confirm' }[a] ?? 'click');
  const pend = actionBarModel(modelFor(s, 'builder-a/auth-2'), { tierOf: tier });
  assert.deepEqual(pend.map((x) => x.id), ['pause', 'approve', 'deny', 'terminal', 'interrupt', 'restart', 'kill', 'retire']);
  assert.equal(pend.find((x) => x.id === 'kill').tier, 'confirm');
  assert.equal(pend.find((x) => x.id === 'terminal').tier, 'read');
  const plain = actionBarModel(modelFor(s, 'builder-a/auth'), { tierOf: tier }).map((x) => x.id);
  assert.ok(!plain.includes('approve') && !plain.includes('deny'));
  s.sessions.get('builder-a/auth').paused = { scope: 'session', by: 'builder-a' };
  const paused = actionBarModel(modelFor(s, 'builder-a/auth'), { tierOf: tier }).map((x) => x.id);
  assert.ok(paused.includes('resume') && !paused.includes('pause'));
  const docs = actionBarModel(modelFor(s, 'builder-a/docs'), { tierOf: tier });
  assert.equal(docs.find((x) => x.id === 'kill').reason, 'no session');
  assert.match(docs.find((x) => x.id === 'retire').reason, /main checkout/);
  const down = actionBarModel(modelFor(s, 'builder-b/web'), { tierOf: tier });
  assert.ok(down.every((x) => x.disabled), 'a down builder disables the bar');
  assert.match(down[0].reason, /not reachable/);
  assert.deepEqual(actionBarModel(modelFor(s, 'builder-c/ghost')), []);
});

test('registerAction: C14 can add, replace and drop buttons', () => {
  _resetActions();
  const off = registerAction({ id: 'budget', icon: 'budget', label: 'Budget', action: 'set-budget' });
  assert.equal(actionList().at(-1).id, 'budget');
  registerAction({ id: 'kill', icon: 'kill', label: 'Kill…', run: () => {} });
  assert.equal(actionList().findIndex((a) => a.id === 'kill'), ACTIONBAR_BUTTONS.indexOf('kill'), 'a replaced button keeps its place');
  off();
  assert.ok(!actionList().some((a) => a.id === 'budget'));
  assert.equal(unregisterAction('retire'), true);
  assert.throws(() => registerAction({ id: 'x y', icon: 'kill', label: 'x', action: 'kill' }), /bad id/);
  assert.throws(() => registerAction({ id: 'noop', icon: 'kill', label: 'x' }), /action or a run/);
  _resetActions();
});

test('runAction: asks by tier, Cancel sends nothing, confirm and approvalId reach act()', async () => {
  _resetActions();
  const s = fleetStore();
  const m = modelFor(s, 'builder-a/auth-2');
  const items = actionBarModel(m, { tierOf: (a) => (a === 'kill' || a === 'retire' ? 'confirm' : 'click') });
  const sent = [];
  const ctx = (answer) => ({
    confirmAction: async (q) => { sent.push(['ask', q.action, q.targets[0], q.tier]); return answer; },
    act: async (k, action, args) => { sent.push(['act', k, action, args]); return { ok: true }; },
    openTerminal: (k) => sent.push(['term', k]),
  });
  const cancelled = await runAction(items.find((x) => x.id === 'kill'), m, ctx({ ok: false }));
  assert.equal(cancelled.cancelled, true);
  assert.ok(!sent.some((x) => x[0] === 'act'), 'Cancel sends nothing');
  sent.length = 0;
  await runAction(items.find((x) => x.id === 'kill'), m, ctx({ ok: true, confirm: 'auth-2' }));
  assert.deepEqual(sent.at(-1), ['act', 'builder-a/auth-2', 'kill', { confirm: 'auth-2' }]);
  await runAction(items.find((x) => x.id === 'approve'), m, ctx({ ok: true, confirm: 'auth-2' }));
  assert.deepEqual(sent.at(-1), ['act', 'builder-a/auth-2', 'approve', { approvalId: '6f1c1a8e-0000-4000-8000-000000000001' }]);
  await runAction(items.find((x) => x.id === 'retire'), m, ctx({ ok: true, confirm: 'auth' }));
  assert.deepEqual(sent.at(-1), ['act', 'builder-a/auth', 'retire', { confirm: 'auth' }], 'retire addresses the lane');
  await runAction(items.find((x) => x.id === 'terminal'), m, ctx({ ok: true }));
  assert.deepEqual(sent.at(-1), ['term', 'builder-a/auth-2']);
  const off = await runAction({ ...items[0], disabled: true, reason: 'nope' }, m, ctx({ ok: true }));
  assert.equal(off.ok, false);
  assert.equal(actionTarget({ target: 'lane' }, m), 'builder-a/auth');
});

// --- fake DOM ------------------------------------------------------------------------------------------

async function withPage(ids, { width = 1400, hash = '#/map' } = {}, fn) {
  const byId = new Map(ids.map((id) => [id, makeEl('div')]));
  const saved = {};
  const set = (k, v) => { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
  const storage = {};
  set('document', makeDocument({ byId }));
  set('location', { hash, protocol: 'http:', host: 'x', pathname: '/' });
  set('history', { replaceState(_s, _t, url) { globalThis.location.hash = url; } });
  set('localStorage', { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = String(v); } });
  set('innerWidth', width);
  set('setTimeout', () => 0);
  set('clearTimeout', () => {});
  set('setInterval', () => 0);
  set('clearInterval', () => {});
  try {
    return await fn(byId);
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
}

const noInnerHtml = (n) => { assert.equal(n.innerHTML, '', 'no innerHTML'); n.children.forEach(noInnerHtml); };

test('header, overview and action bar carry builder text as text, with icon + aria-label buttons', async () => {
  await withPage([], {}, () => {
    _resetActions();
    const m = inspectorModel({ id: EVIL, builder: 'builder-a', sessions: [EVIL], progress: { n: 1, m: 2 } }, {
      session: {
        key: 'builder-a/x', name: EVIL, state: 'waiting_permission', builder: 'builder-a', stateSince: Date.now(),
        activity: { lastUserPrompt: EVIL, lastAssistant: EVIL, tool: EVIL, toolInput: EVIL },
        previewLines: [`\x1b[31m${EVIL}\x1b[0m`], danger: { reason: EVIL }, branch: EVIL,
        context: { usedPct: 90 }, cost: { usd: 2 },
      },
      sessionKey: 'builder-a/x',
      builderInfo: { code: 'B1' },
    });
    const head = renderHeader(m);
    assert.ok(texts(head).includes(EVIL));
    assert.ok(head.classList.contains('sel'), 'the header carries the selection brackets');
    assert.ok(texts(head).includes('B1'), 'the builder plate');
    assert.ok(texts(head).includes('PERM'));
    const ovw = renderOverview(m, globalThis.document);
    const t = texts(ovw);
    assert.ok(t.filter((x) => x.includes(EVIL)).length >= 5, 'prompt, assistant, tool, danger, preview as text');
    const bar = makeEl('div');
    const items = renderActionBar(bar, { model: m });
    assert.equal(bar.attrs.role, 'toolbar');
    assert.equal(bar.children.length, items.length);
    for (const b of bar.children) {
      assert.ok(b.attrs['aria-label'], 'every button has an aria-label');
      assert.equal(b.children[0].tagName, 'SVG', 'every button is an icon');
    }
    for (const n of [head, ovw, bar]) noInnerHtml(n);
  });
});

test('applyRoute opens on sel=, closes on sel=null; anchorEl follows; the map gets its inset', async () => {
  const saved = { sessions: store.sessions, lanes: store.lanes, keyMode: store.keyMode, builders: store.builders, kind: store.source.kind };
  const f = fleetStore();
  store.sessions = f.sessions;
  store.lanes = f.lanes;
  store.builders = f.builders;
  store.keyMode = 'fkey';
  store.source.kind = 'local';
  try {
    await withPage(['shell', 'shell-insp', 'shell-main', 'map-root'], {}, (byId) => {
      const insp = byId.get('shell-insp');
      insp.hidden = true;
      // init() is not run here (it wires listeners); applyRoute needs the root.
      const insets = [];
      bindMap({ setInsets: (x) => insets.push(x.right), screenOf: () => ({ x: 10, y: 20 }) }, { root: byId.get('map-root') });
      assert.equal(anchorEl(), null, 'closed: no tether target');
      applyRoute({ view: 'map', sel: 'builder-a/auth' });
      assert.equal(selected(), 'builder-a/auth');
      assert.equal(byId.get('shell').dataset.insp, 'open');
      assert.equal(insp.hidden, false);
      assert.equal(anchorEl(), insp, 'open: the panel is the tether target');
      assert.ok(texts(insp).includes('auth'), 'the panel rendered the lane');
      assert.ok(texts(insp).includes('B1'));
      assert.ok(insets.length >= 1);
      noInnerHtml(insp);
      applyRoute({ view: 'map', sel: null });
      assert.equal(selected(), null);
      assert.equal(byId.get('shell').dataset.insp, 'closed');
      assert.equal(insp.hidden, true);
      assert.equal(anchorEl(), null);
      assert.equal(insets.at(-1), 0, 'the inset goes back to 0');
      bindMap(null);
    });
  } finally {
    store.sessions = saved.sessions;
    store.lanes = saved.lanes;
    store.builders = saved.builders;
    store.keyMode = saved.keyMode;
    store.source.kind = saved.kind;
  }
});

// --- static ----------------------------------------------------------------------------------------------

test('the page wires the inspector: app.js init before the first route, index.html links its sheet', () => {
  const app = read('public/js/app.js');
  assert.match(app, /import \{ init as initInspector \} from '\.\/ui\/inspector\.js'/);
  assert.ok(app.indexOf('initInspector();') > app.indexOf('initRouter();'), 'after the router');
  assert.ok(app.indexOf('initInspector();') < app.indexOf('applyHash();'), 'before the first applyHash');
  const html = read('public/index.html');
  assert.match(html, /<link rel="stylesheet" href="\/css\/inspector\.css">/);
  assert.ok(html.indexOf('/css/inspector.css') > html.indexOf('/css/shell.css'), 'after the shell sheet');
  assert.match(html, /id="shell-insp"/);
});

test('inspector.css: 1px tether, tokens only, slide-in from the shell transform', () => {
  const css = read('public/css/inspector.css');
  assert.match(css, /\.insp-tether\s*\{[^}]*border-top:\s*var\(--bw\)/);
  assert.match(css, /@starting-style/);
  assert.ok(!/#[0-9a-f]{3,8}\b|oklch\(|rgba?\(/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no colour literals');
});

test('the inspector modules use no HTML sinks', () => {
  for (const f of ['public/js/ui/inspector.js', 'public/js/ui/actionbar.js']) {
    const src = read(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), f);
  }
});
