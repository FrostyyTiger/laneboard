// Static checks on the browser bundle.
//
// These exist because a bad edit during Stage 9 deleted renderGrid,
// renderCard, renderAttention, renderVitals, freshestRateLimits and
// orderedSessions while leaving the calls to them in place. The file still
// parsed, every server test still passed, and the dashboard threw
// "ReferenceError: renderGrid is not defined" on every snapshot and rendered
// nothing. Node cannot import these modules (they need `document`), so the
// guard has to be static.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

/**
 * Strip comments and string/template literals. Without this the scan trips over
 * prose ("no framework (hard rule 7)") and CSS in strings ("rgba(", "scale(").
 */
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i++;
        // Keep code inside ${...} — it can contain real calls.
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += ` ${src.slice(start, i)} `;
        }
        i++;
      }
      i++;
      out += ' "" ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Every name bound anywhere in the module: functions, const/let/var (at any
 * nesting), classes, imports, and parameters. Not a real scope analysis — the
 * point is to catch a whole function body going missing, not to be a linter.
 */
function declaredNames(src) {
  const names = new Set();
  const add = (n) => { if (n) names.add(n); };
  for (const m of src.matchAll(/(?:^|[\s;{(,])(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/g)) add(m[1]);
  for (const m of src.matchAll(/(?:^|[\s;{(])(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) add(m[1]);
  for (const m of src.matchAll(/(?:^|[\s;{(])class\s+([A-Za-z0-9_$]+)/g)) add(m[1]);
  // Destructured bindings, including the for-of form:
  //   const { a, b } = ...   const [a, b] = ...   for (const [k, v] of ...)
  for (const m of src.matchAll(/(?:const|let|var)\s*[{[]([^}\]]+)[}\]]\s*(?:=|of\b|in\b)/g)) {
    for (const raw of m[1].split(',')) add(raw.trim().split(/[:=]/).pop().trim().replace(/^\.\.\./, ''));
  }
  // Parameters, from both function signatures and arrow heads.
  for (const m of src.matchAll(/(?:function\s*[A-Za-z0-9_$]*\s*|=>\s*|\.then\s*|new Promise\s*)?\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const raw of m[1].split(',')) add(raw.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, ''));
  }
  for (const m of src.matchAll(/(?:^|[\s(,])([A-Za-z0-9_$]+)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from/g)) {
    for (const raw of m[1].split(',')) add(raw.trim().split(/\s+as\s+/).pop().trim());
  }
  for (const m of src.matchAll(/import\s+([A-Za-z0-9_$]+)\s+from/g)) add(m[1]);
  return names;
}

/** Every f(...) call appearing anywhere in the source. */
function calledNames(src) {
  const names = new Set();
  for (const m of stripNonCode(src).matchAll(/(?<![.\w$])([a-z][A-Za-z0-9_$]*)\s*\(/g)) names.add(m[1]);
  return names;
}

// Globals and browser APIs that are legitimately not declared in the file.
const AMBIENT = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await',
  'new', 'else', 'do', 'try', 'yield', 'delete', 'void', 'in', 'of', 'case',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'atob', 'btoa', 'matchMedia',
  'addEventListener', 'removeEventListener', 'require', 'confirm', 'alert', 'prompt',
  'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN',
  'queueMicrotask', 'structuredClone', 'reportError', 'open', 'close', 'focus', 'blur',
  'async', 'get', 'set', 'then', 'catch',
]);

for (const file of ['app.js', 'terminal.js']) {
  test(`${file}: every function it calls is defined`, () => {
    const src = read(file);
    const declared = declaredNames(stripNonCode(src));
    const missing = [...calledNames(src)].filter(
      (n) => !declared.has(n) && !AMBIENT.has(n)
    );
    assert.deepEqual(missing, [], `${file} calls undefined function(s): ${missing.join(', ')}`);
  });
}

test('renderAll only calls render functions that exist', () => {
  // The specific shape of the Stage 9 regression.
  const src = read('app.js');
  const body = /function renderAll\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(stripNonCode(src));
  assert.ok(body, 'renderAll must exist');
  const called = [...body[1].matchAll(/(?<![.\w$])([a-z][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]);
  assert.ok(called.length >= 5, `renderAll should orchestrate the render, saw ${called.length} calls`);
  const declared = declaredNames(stripNonCode(src));
  for (const name of called) {
    if (AMBIENT.has(name)) continue;
    assert.ok(declared.has(name), `renderAll calls ${name}(), which is not defined in app.js`);
  }
});

test('no function is declared twice in app.js', () => {
  // A restore that pastes a block back in the wrong place shows up here.
  const src = read('app.js');
  const seen = new Map();
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) {
    seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([n]) => n);
  assert.deepEqual(dupes, [], `duplicated: ${dupes.join(', ')}`);
});

test('the render pipeline is all present', () => {
  const declared = declaredNames(stripNonCode(read('app.js')));
  for (const fn of [
    'renderAll', 'renderGrid', 'renderCard', 'renderAttention', 'renderVitals',
    'renderRateLimits', 'renderTopbar', 'renderDock', 'renderBox',
    'orderedSessions', 'freshestRateLimits',
  ]) {
    assert.ok(declared.has(fn), `${fn} is missing from app.js`);
  }
});

test('index.html references only ids the script actually uses, and vice versa', () => {
  const html = read('index.html');
  const app = read('app.js');
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  // Some nodes are built in JS and given their id there.
  for (const m of app.matchAll(/\.id\s*=\s*'([^']+)'/g)) htmlIds.add(m[1]);
  const wanted = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const missing = [...wanted].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `app.js looks up ids that index.html does not define: ${missing.join(', ')}`);
});

test('the service worker never caches API responses', () => {
  // A cached /api response would show stale session states.
  const sw = read('sw.js');
  assert.ok(!/caches\.(open|match|addAll)/.test(sw), 'sw.js must not use the Cache API');
});

test('styles.css keeps the [hidden] override that the sheet and banner depend on', () => {
  // Without it, .sheet{display:flex} beats the UA rule and covers the page.
  const css = read('styles.css');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

// --- Stage 10 constraints ----------------------------------------------------

test('backdrop-filter is spent on at most three fixed surfaces', () => {
  // Each one costs a GPU readback + blur of the backdrop root every frame the
  // backdrop changes. The plan caps it at three; anything that scrolls or sits
  // above a live terminal must not be on the list.
  const css = read('styles.css');
  const selectors = new Set();
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*backdrop-filter\s*:/g)) {
    for (const sel of m[1].split(',')) {
      const s = sel.trim().split(/\s+/).pop();
      if (s && s.startsWith('.')) selectors.add(s);
    }
  }
  assert.ok(selectors.size <= 3, `backdrop-filter on ${selectors.size} surfaces: ${[...selectors].join(', ')}`);
  for (const banned of ['.card', '.rail', '.quickbar', '.preview', '.term-host', '.term-pane', '.grid']) {
    assert.ok(!selectors.has(banned), `${banned} must never blur`);
  }
});

test('the blur declarations avoid the var() form WebKit drops', () => {
  // If a var() chain inside -webkit-backdrop-filter resolves invalid, WebKit
  // throws the whole declaration away and the surface loses its backing.
  const css = read('styles.css');
  // Only real declarations, not the @supports test line.
  for (const m of css.matchAll(/^\s*(?:-webkit-)?backdrop-filter\s*:([^;]+);/gm)) {
    assert.ok(!m[1].includes('var('), `backdrop-filter must use literals: ${m[1].trim()}`);
  }
});

test('reduced motion and reduced transparency both have fallbacks', () => {
  const css = read('styles.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /prefers-reduced-transparency: no-preference/);
});

test('the three breakpoints survive', () => {
  const css = read('styles.css');
  assert.match(css, /@media \(min-width: 700px\)/, 'desktop');
  assert.match(css, /@media \(min-width: 2000px\)/, 'ultrawide');
  assert.match(css, /@media \(max-width: 699px\)/, 'phone top bar');
});

test('the render path does no per-card layout reads', () => {
  // getBoundingClientRect inside the render forces a synchronous layout per
  // card; visibility is tracked with IntersectionObserver instead.
  const app = stripNonCode(read('app.js'));
  const render = app.slice(app.indexOf('function renderGrid'), app.indexOf('function renderAttention'));
  assert.ok(!render.includes('getBoundingClientRect'), 'renderGrid/renderCard must not measure');
  assert.match(app, /new IntersectionObserver/);
});

test('renders are measured against the 16 ms budget', () => {
  const app = read('app.js');
  assert.match(app, /performance\.mark\('laneboard:render:start'\)/);
  assert.match(app, /performance\.mark\('laneboard:render:end'\)/);
  assert.match(app, /laneboardRenderStats/, 'the timings must be readable from the console');
});

test('no information was lost in the overhaul', () => {
  // Every one of these must still be
  // produced by the client.
  const app = read('app.js');
  const html = read('index.html');
  const both = app + html;
  const required = {
    'session name': /card-name/,
    'state pill': /pill s-/,
    'since time': /card-since/,
    'directory': /shortDir/,
    'branch': /branch/,
    'dirty count': /dirty/,
    'ahead/behind': /ahead/,
    'model': /class.*model|'model'/,
    'context bar': /ctx-label/,
    'context size': /of \$\{Math\.round\(s\.context\.size/,
    'API-equivalent cost': /API-equivalent/,
    'session RSS': /rssMb/,
    'current tool': /tool-line/,
    'last user prompt': /say-user/,
    'last assistant': /lastAssistant/,
    'ANSI preview': /previewHtml/,
    'open action': /'open'/,
    'pin action': /togglePin/,
    'Yes action': /QUICK_KEYS\.yes/,
    'No action': /QUICK_KEYS\.no/,
    'the ⋯ menu': /btn-more/,
    'attention numbers': /'idx'/,
    'attention wait time': /attention-item/,
    'vitals cpu/load': /load \$\{/,
    'vitals mem': /'mem'/,
    'vitals swap': /'swap'/,
    'vitals disk': /'disk'/,
    'vitals claude rss': /claudeRssMb/,
    'vitals session count': /sessionCount/,
    'vitals laneboard rss': /laneboardRssMb/,
    'vitals gpu': /'gpu'/,
    'rate-limit gauges': /freshestRateLimits/,
    'rate-limit resets': /resetsIn/,
    'spend today': /stat-cost/,
    'pinned dock': /dock-body/,
    'sheet quick-bar': /quickbar/,
    'toast': /function toast/,
    'disconnected banner': /id="offline"/,
    'LIVE badge': /id="conn"/,
    'keyboard j/k': /'j'|'k'/,
    'keyboard 1-9': /attention\[Number\(e\.key\)/,
  };
  const missing = Object.entries(required).filter(([, re]) => !re.test(both)).map(([k]) => k);
  assert.deepEqual(missing, [], `the overhaul dropped: ${missing.join(', ')}`);
});

test('figures are tabular, so live metrics do not jitter', () => {
  // Every digit here is a measurement that updates on a 2 s tick; proportional
  // figures make the whole row shuffle sideways each time. Set at the root so
  // a number inside a tool argument or an assistant line is covered too.
  const css = read('styles.css');
  const root = /html,\s*body\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(root, 'html, body rule must exist');
  assert.match(root[1], /font-variant-numeric:\s*tabular-nums/);
  assert.match(root[1], /font-feature-settings:\s*"tnum"/);
});

test('the client reports its own render timings', () => {
  // The 16 ms budget can only be measured in a real browser.
  const app = read('app.js');
  assert.match(app, /\/api\/client-metrics/);
  assert.match(app, /keepalive: true/, 'the last sample must survive a tab close');
});

// --- Stage 0: the view shell -------------------------------------------------

test('all four views exist in the markup, in both navigations', () => {
  const html = read('index.html');
  for (const v of ['board', 'morning', 'credit', 'box']) {
    assert.match(html, new RegExp(`id="view-${v}"`), `view-${v} section is missing`);
    // The top strip (desktop) and the bottom tabs (phone) both list every view.
    const buttons = [...html.matchAll(new RegExp(`data-view="${v}"`, 'g'))];
    assert.equal(buttons.length, 2, `${v} needs a top-strip button and a phone tab`);
  }
});

test('the view chord covers g b / g m / g c / g x, and g k / g f are gone', () => {
  const app = read('app.js');
  const m = /const VIEW_KEYS\s*=\s*\{([^}]*)\}/.exec(app);
  assert.ok(m, 'VIEW_KEYS must exist');
  for (const [key, view] of [['b', 'board'], ['m', 'morning'], ['c', 'credit'], ['x', 'box']]) {
    assert.match(m[1], new RegExp(`${key}:\\s*'${view}'`), `g ${key} should go to ${view}`);
  }
  assert.doesNotMatch(m[1], /\bk:|\bf:/, 'g k and g f went with Machine and Files');
});

test('the board-only shortcuts are gated on the board', () => {
  // j/k/p/Enter/1-9 move a cursor through cards; on the Files view they would
  // scroll something invisible. `g k` must still beat the Board's own `k`.
  const app = read('app.js');
  assert.match(app, /store\.view !== 'board'/, 'the keydown handler must gate on the view');
  const handler = app.slice(app.indexOf("addEventListener('keydown'"));
  assert.ok(
    handler.indexOf('pendingG') < handler.indexOf("store.view !== 'board'"),
    'the g-chord must be resolved before the board shortcuts'
  );
});

test('closing the sheet returns to a view, never to a bare path', () => {
  const app = read('app.js');
  assert.match(app, /replaceState\(null, '', `#\$\{store\.view\}`\)/);
});

test('the phone tab bar and the desktop strip swap at the breakpoint', () => {
  const css = read('styles.css');
  assert.match(css, /@media \(min-width: 700px\) \{ \.tabs \{ display: none; \} \}/);
  assert.match(css, /\.views \{ display: none; \}/);
});

// --- Stage 1: lanes ----------------------------------------------------------

test('orderedSessions is untouched: lane is a colour and a filter, never a sort key', () => {
  // Lanes plan hard rule 1. The grid's sort belongs to attention, which is the
  // product; a lane that could reorder the board would sink a session waiting
  // on a permission prompt below three merrily working ones.
  const app = read('app.js');
  const body = /function orderedSessions\(\)\s*\{([\s\S]*?)\n\}/.exec(stripNonCode(app));
  assert.ok(body, 'orderedSessions must exist');
  assert.ok(!/lane/i.test(body[1]), 'orderedSessions must not mention lanes');
  assert.match(body[1], /waiting_permission: 0/, 'the attention rank must still be the sort');
});

test('the lane filter never leaves the browser', () => {
  // Lanes plan hard rule 5: not on the server, not in SQLite, not in
  // localStorage. A filter you forgot you set is a board that lies to you.
  const app = read('app.js');
  assert.ok(!/localStorage[^\n]*laneFilter|laneFilter[^\n]*localStorage/.test(app));
  // v3 POSTs to /api/lanes to LAUNCH a lane; what it must never send is the
  // filter. So: nothing that talks to the server mentions it.
  assert.ok(!/laneFilter[^\n]*(fetch|post\(|del\(|JSON\.stringify)|(fetch|post\(|del\(|JSON\.stringify)[^\n]*laneFilter/.test(app));
  const launch = /async function submitLaunch\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(app);
  assert.ok(launch, 'submitLaunch must exist');
  assert.ok(!/laneFilter/.test(launch[1]), 'the launch request must not carry the filter');
  assert.match(app, /laneFilter: new Set\(\)/);
});

test('clearing the lane filter does not rebuild the cards', () => {
  // renderGrid() with no argument means "everything changed" and replaces every
  // card; the filter must pass an empty list so only visibility is recomputed.
  const app = stripNonCode(read('app.js'));
  const fn = /function applyLaneFilter\(\)\s*\{([\s\S]*?)\n\}/.exec(app);
  assert.ok(fn, 'applyLaneFilter must exist');
  assert.match(fn[1], /renderGrid\(\[\]\)/, 'the filter must re-render no cards');
  // And nothing else may take the lazy route.
  assert.ok(
    !/laneFilter[\s\S]{0,120}renderGrid\(\)/.test(app),
    'a lane toggle must not call renderGrid() with no argument'
  );
});

test('a lane colour is derived, never stored', () => {
  // Lanes plan hard rule 4: no config file, no database column, no per-lane
  // settings UI. A new worktree gets a colour by existing.
  const lanes = fs.readFileSync(path.join(PUBLIC, '..', 'server/collector/lanes.mjs'), 'utf8');
  assert.match(lanes, /export function hueFor/);
  assert.ok(!/INSERT|CREATE TABLE|kvWrite/.test(lanes), 'lanes must persist nothing');
  // The CSS derives every lane colour from the one hue the server computes.
  const css = read('styles.css');
  assert.match(css, /--lane-hue/);
  assert.match(css, /oklch\([^)]*var\(--lane-hue/);
});

test('an idle lane can never become a card', () => {
  // Lanes plan hard rule 6: separate array, separate render path.
  const app = stripNonCode(read('app.js'));
  const grid = app.slice(app.indexOf('function renderGrid'), app.indexOf('function renderCard'));
  assert.ok(!/store\.lanes/.test(grid), 'renderGrid must build cards from sessions only');
  assert.match(app, /function renderLanes/);
});

test('the lane stripe and chip survive, and the branch stays in card-meta', () => {
  // Lane and branch are usually the same idea but not always, and the one time
  // they diverge is the one time you need to see both.
  const app = read('app.js');
  assert.match(app, /has-lane/, 'the stripe class');
  assert.match(app, /lane-chip/, 'the chip');
  assert.match(app, /meta\.append\(el\('span', 'branch'/, 'the branch stays in the meta row');
});
