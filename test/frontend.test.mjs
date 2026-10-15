// Static checks on the browser bundle.
//
// These exist because a bad edit during Stage 9 deleted renderGrid,
// renderCard, renderAttention, renderVitals, freshestRateLimits and
// orderedSessions while leaving the calls to them in place. The file still
// parsed, every server test still passed, and the dashboard threw
// "ReferenceError: renderGrid is not defined" on every snapshot and rendered
// nothing. The page modules need `document`, so this guard is static; the
// render harness (render.test.mjs) is the one that runs them.
//
// Since fleet F1 the page is ES modules under public/js/**. The scans iterate
// over every one of them, and an imported binding counts as declared.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

/** Every module of the page, relative to public/js. */
const JS_DIR = path.join(PUBLIC, 'js');
const JS_FILES = fs.readdirSync(JS_DIR, { recursive: true })
  .map((f) => f.split(path.sep).join('/'))
  .filter((f) => f.endsWith('.js'))
  .sort();
const readJs = (f) => read(`js/${f}`);

/**
 * The modules split out of the old public/app.js, concatenated: what the
 * content checks below used to read as one file. The files that moved in
 * whole (terminal, motion, the map canvas) and keys.js were never part of it.
 */
const NOT_FROM_APP_JS = new Set(['ui/terminal.js', 'core/motion.js', 'views/map-canvas.js', 'core/keys.js']);
const APP_FILES = JS_FILES.filter((f) => !NOT_FROM_APP_JS.has(f));
const readApp = () => APP_FILES.map(readJs).join('\n');

/**
 * The stylesheets under public/css, in the order index.html links them (fleet
 * F2 split the old styles.css and map.css into contiguous ranges, so the
 * concatenation is the cascade the page gets).
 */
const CSS_LINKS = [...read('index.html').matchAll(/<link rel="stylesheet" href="\/css\/([^"]+)">/g)].map((m) => m[1]);
const readCss = (files = CSS_LINKS) => files.map((f) => read(`css/${f}`)).join('');
/** What used to be styles.css: everything but the map view's sheet. */
const readStyles = () => readCss(CSS_LINKS.filter((f) => f !== 'views/map.css'));

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
  // Dynamic import() is a keyword, and map.js draws with these.
  'import', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
]);

test('the page is split into public/js/{core,ui,views}', () => {
  for (const f of ['app.js', 'core/store.js', 'core/net.js', 'core/router.js', 'ui/render.js', 'ui/terminal.js',
    'core/motion.js', 'views/board.js', 'views/map.js', 'views/map-canvas.js']) {
    assert.ok(JS_FILES.includes(f), `public/js/${f} is missing`);
  }
  for (const gone of ['app.js', 'map.js', 'terminal.js', 'motion.js']) {
    assert.ok(!fs.existsSync(path.join(PUBLIC, gone)), `public/${gone} should have moved under public/js`);
  }
  assert.match(read('index.html'), /<script type="module" src="\/js\/app\.js"><\/script>/);
});

for (const file of JS_FILES) {
  test(`js/${file}: every function it calls is defined`, () => {
    const src = readJs(file);
    const declared = declaredNames(stripNonCode(src));
    const missing = [...calledNames(src)].filter(
      (n) => !declared.has(n) && !AMBIENT.has(n)
    );
    assert.deepEqual(missing, [], `${file} calls undefined function(s): ${missing.join(', ')}`);
  });
}

// --- fleet F1: the module graph ---------------------------------------------

/** Static imports of a module: [{ names: [[imported, local]], spec }]. */
function staticImports(src) {
  const out = [];
  for (const m of src.matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?'([^']+)';/gm)) {
    const names = (m[1] || '').split(',').map((x) => x.trim()).filter(Boolean)
      .map((x) => { const [a, b] = x.split(/\s+as\s+/); return [a.trim(), (b ?? a).trim()]; });
    out.push({ names, spec: m[2] });
  }
  return out;
}

/** Names a module exports with `export function|const|let|class` or `export { … }`. */
function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const raw of m[1].split(',')) if (raw.trim()) names.add(raw.trim().split(/\s+as\s+/).pop().trim());
  }
  return names;
}

/**
 * The code a module runs when it is evaluated: brace depth 0, minus the bodies
 * of arrow functions written without braces. Not a parser; good enough to
 * keep wiring statements inside init() and boot().
 */
function topLevelCode(src) {
  const code = stripNonCode(src);
  let out = '';
  let braces = 0;
  let parens = 0;
  let arrowAt = -1; // paren depth of an expression-bodied arrow being skipped
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '(' || c === '[') parens++;
    else if (c === ')' || c === ']') {
      if (arrowAt >= 0 && parens === arrowAt) arrowAt = -1;
      parens--;
    }
    if (braces === 0 && arrowAt >= 0 && parens === arrowAt && (c === ';' || c === '\n' || c === ',')) arrowAt = -1;
    if (braces === 0 && arrowAt < 0 && c === '=' && code[i + 1] === '>') {
      let j = i + 2;
      while (/\s/.test(code[j] ?? '')) j++;
      if (code[j] !== '{') { arrowAt = parens; out += '=>'; i++; continue; }
    }
    if (braces === 0 && arrowAt < 0 && c !== '}') out += c;
  }
  return out;
}

for (const file of JS_FILES) {
  test(`js/${file}: every relative import resolves to a file that exports the name`, () => {
    const src = readJs(file);
    for (const { names, spec } of staticImports(src)) {
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${file}: import '${spec}' must be relative`);
      const target = path.posix.join(path.posix.dirname(file), spec);
      assert.ok(JS_FILES.includes(target), `${file}: '${spec}' does not resolve to a file under public/js`);
      const exp = exportedNames(readJs(target));
      for (const [name] of names) assert.ok(exp.has(name), `${file}: ${target} does not export ${name}`);
    }
    for (const m of src.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) {
      assert.ok(m[1].startsWith('.'), `${file}: import('${m[1]}') must be relative`);
      const target = path.posix.join(path.posix.dirname(file), m[1]);
      assert.ok(JS_FILES.includes(target), `${file}: import('${m[1]}') does not resolve`);
    }
  });

  test(`js/${file}: touches no DOM and no imported binding at evaluation time`, () => {
    // Circular imports (board <-> net <-> render) are safe only while every
    // cross-module use happens inside a function. Wiring lives in init().
    const src = readJs(file);
    const top = topLevelCode(src).split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
    assert.ok(!/(?<![\w$.])\$\(/.test(top), `${file}: a top-level $( lookup belongs in init()`);
    assert.ok(!/(?<![\w$.])document\./.test(top), `${file}: a top-level document. access belongs in init()`);
    // app.js runs boot(), and boot() is where the imported init()s are called.
    const imported = staticImports(src).flatMap((i) => i.names.map(([, local]) => local));
    for (const name of imported) {
      const used = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(top);
      assert.ok(!used, `${file}: imported ${name} is used at evaluation time`);
    }
  });
}

test('renderAll only calls render functions that exist', () => {
  // The specific shape of the Stage 9 regression.
  const src = readJs('ui/render.js');
  const body = /function renderAll\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(stripNonCode(src));
  assert.ok(body, 'renderAll must exist');
  const called = [...body[1].matchAll(/(?<![.\w$])([a-z][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]);
  assert.ok(called.length >= 5, `renderAll should orchestrate the render, saw ${called.length} calls`);
  const declared = declaredNames(stripNonCode(src));
  for (const name of called) {
    if (AMBIENT.has(name)) continue;
    assert.ok(declared.has(name), `renderAll calls ${name}(), which is neither defined nor imported in ui/render.js`);
  }
});

test('no function is declared twice in the page', () => {
  // A restore that pastes a block back in the wrong place shows up here. Each
  // module has its own init(), so that one name may repeat across modules.
  const seen = new Map();
  for (const file of APP_FILES) {
    for (const m of readJs(file).matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) {
      const key = m[1] === 'init' ? `${file}:init` : m[1];
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([n]) => n);
  assert.deepEqual(dupes, [], `duplicated: ${dupes.join(', ')}`);
});

test('the render pipeline is all present', () => {
  const declared = declaredNames(stripNonCode(readApp()));
  for (const fn of [
    'renderAll', 'renderGrid', 'renderCard', 'renderAttention', 'renderVitals',
    'renderRateLimits', 'renderTopbar', 'renderDock', 'renderBox',
    'orderedSessions', 'freshestRateLimits',
  ]) {
    assert.ok(declared.has(fn), `${fn} is missing from public/js`);
  }
});

test('index.html references only ids the script actually uses, and vice versa', () => {
  const html = read('index.html');
  const app = readApp();
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  // Some nodes are built in JS and given their id there.
  for (const m of app.matchAll(/\.id\s*=\s*'([^']+)'/g)) htmlIds.add(m[1]);
  const wanted = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const missing = [...wanted].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `public/js looks up ids that index.html does not define: ${missing.join(', ')}`);
});

test('the service worker never caches API responses', () => {
  // A cached /api response would show stale session states.
  const sw = read('sw.js');
  assert.ok(!/caches\.(open|match|addAll)/.test(sw), 'sw.js must not use the Cache API');
});

test('the stylesheets keep the [hidden] override that the sheet and banner depend on', () => {
  // Without it, .sheet{display:flex} beats the UA rule and covers the page.
  const css = readStyles();
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

// --- Stage 10 constraints ----------------------------------------------------

test('backdrop-filter is spent on at most three fixed surfaces', () => {
  // Each one costs a GPU readback + blur of the backdrop root every frame the
  // backdrop changes. The plan caps it at three; anything that scrolls or sits
  // above a live terminal must not be on the list.
  const css = readStyles();
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
  const css = readStyles();
  // Only real declarations, not the @supports test line.
  for (const m of css.matchAll(/^\s*(?:-webkit-)?backdrop-filter\s*:([^;]+);/gm)) {
    assert.ok(!m[1].includes('var('), `backdrop-filter must use literals: ${m[1].trim()}`);
  }
});

test('reduced motion and reduced transparency both have fallbacks', () => {
  const css = readStyles();
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /prefers-reduced-transparency: no-preference/);
});

test('the three breakpoints survive', () => {
  const css = readStyles();
  assert.match(css, /@media \(min-width: 700px\)/, 'desktop');
  assert.match(css, /@media \(min-width: 2000px\)/, 'ultrawide');
  assert.match(css, /@media \(max-width: 699px\)/, 'phone top bar');
});

test('the render path does no per-card layout reads', () => {
  // getBoundingClientRect inside the render forces a synchronous layout per
  // card; visibility is tracked with IntersectionObserver instead.
  // The old app.js slice from renderGrid to renderAttention: the rest of the
  // board module and the card module.
  const board = stripNonCode(readJs('views/board.js'));
  const render = board.slice(board.indexOf('function renderGrid')) + stripNonCode(readJs('views/board-card.js'));
  const app = stripNonCode(readApp());
  assert.ok(!render.includes('getBoundingClientRect'), 'renderGrid/renderCard must not measure');
  assert.match(app, /new IntersectionObserver/);
});

test('renders are measured against the 16 ms budget', () => {
  const app = readApp();
  assert.match(app, /performance\.mark\('laneboard:render:start'\)/);
  assert.match(app, /performance\.mark\('laneboard:render:end'\)/);
  assert.match(app, /laneboardRenderStats/, 'the timings must be readable from the console');
});

test('no information was lost in the overhaul', () => {
  // Every one of these must still be
  // produced by the client.
  const app = readApp();
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
  const css = readStyles();
  const root = /html,\s*body\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(root, 'html, body rule must exist');
  assert.match(root[1], /font-variant-numeric:\s*tabular-nums/);
  assert.match(root[1], /font-feature-settings:\s*"tnum"/);
});

test('the client reports its own render timings', () => {
  // The 16 ms budget can only be measured in a real browser.
  const app = readApp();
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
  const app = readApp();
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
  const app = readApp();
  assert.match(app, /store\.view !== 'board'/, 'the keydown handler must gate on the view');
  const handler = app.slice(app.indexOf("addEventListener('keydown'"));
  assert.ok(
    handler.indexOf('pendingG') < handler.indexOf("store.view !== 'board'"),
    'the g-chord must be resolved before the board shortcuts'
  );
});

test('closing the sheet returns to a view, never to a bare path', () => {
  const app = readApp();
  assert.match(app, /replaceState\(null, '', `#\$\{store\.view\}`\)/);
});

test('the phone tab bar and the desktop strip swap at the breakpoint', () => {
  const css = readStyles();
  assert.match(css, /@media \(min-width: 700px\) \{ \.tabs \{ display: none; \} \}/);
  assert.match(css, /\.views \{ display: none; \}/);
});

// --- Stage 1: lanes ----------------------------------------------------------

test('orderedSessions is untouched: lane is a colour and a filter, never a sort key', () => {
  // Lanes plan hard rule 1. The grid's sort belongs to attention, which is the
  // product; a lane that could reorder the board would sink a session waiting
  // on a permission prompt below three merrily working ones.
  const app = readApp();
  const body = /function orderedSessions\(\)\s*\{([\s\S]*?)\n\}/.exec(stripNonCode(app));
  assert.ok(body, 'orderedSessions must exist');
  assert.ok(!/lane/i.test(body[1]), 'orderedSessions must not mention lanes');
  assert.match(body[1], /waiting_permission: 0/, 'the attention rank must still be the sort');
});

test('the lane filter never leaves the browser', () => {
  // Lanes plan hard rule 5: not on the server, not in SQLite, not in
  // localStorage. A filter you forgot you set is a board that lies to you.
  const app = readApp();
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
  const app = stripNonCode(readApp());
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
  const css = readStyles();
  assert.match(css, /--lane-hue/);
  assert.match(css, /oklch\([^)]*var\(--lane-hue/);
});

test('an idle lane can never become a card', () => {
  // Lanes plan hard rule 6: separate array, separate render path.
  const app = stripNonCode(readApp());
  // The old slice from renderGrid to renderCard: the grid, the lane card and its head.
  const board = stripNonCode(readJs('views/board.js'));
  const grid = board.slice(board.indexOf('function renderGrid'), board.indexOf('function renderLanes'));
  assert.ok(!/store\.lanes/.test(grid), 'renderGrid must build cards from sessions only');
  assert.match(app, /function renderLanes/);
});

test('the lane stripe and chip survive, and the branch stays in card-meta', () => {
  // Lane and branch are usually the same idea but not always, and the one time
  // they diverge is the one time you need to see both.
  const app = readApp();
  assert.match(app, /has-lane/, 'the stripe class');
  assert.match(app, /lane-chip/, 'the chip');
  assert.match(app, /meta\.append\(el\('span', 'branch'/, 'the branch stays in the meta row');
});

// --- fleet F1: how the server hands out the modules -----------------------------

/** GET `url` through the real handleRequest; resolves { status, type, headers, body }. */
async function serve(url, repoRoot) {
  // Never read a real config from a bare `node --test`.
  process.env.LANEBOARD_CONFIG ??= path.join(PUBLIC, '..', 'test', 'fixtures', 'empty-config.json');
  const { handleRequest } = await import('../server/http.mjs');
  const { config } = await import('../server/config.mjs');
  const { PassThrough } = await import('node:stream');
  const saved = config.repoRoot;
  if (repoRoot) config.repoRoot = repoRoot;
  try {
    const res = new PassThrough();
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    let status = 0;
    let headers = {};
    res.writeHead = (s, h = {}) => { status = s; headers = h; };
    const done = new Promise((resolve) => res.on('end', resolve));
    await handleRequest({ method: 'GET', url, headers: {} }, res);
    await done;
    return { status, type: headers['content-type'] ?? '', headers, body: Buffer.concat(chunks).toString('utf8') };
  } finally {
    config.repoRoot = saved;
  }
}

test('the page modules are served as JavaScript', async () => {
  const r = await serve('/js/app.js');
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/javascript/);
  assert.match(r.body, /boot\(\)/);
});

test('a missing file with an extension is a 404, not the SPA page', async () => {
  // A bad import used to come back as index.html and show up as a MIME error.
  for (const url of ['/js/core/nope.js', '/app.js', '/nope.css', '/icons/nope.PNG']) {
    const r = await serve(url);
    assert.equal(r.status, 404, url);
    assert.match(r.type, /application\/json/, url);
  }
  // A path without an extension still gets the page (deep links).
  const page = await serve('/board');
  assert.equal(page.status, 200);
  assert.match(page.body, /src="\/js\/app\.js"/);
});

test('an unmapped /vendor/ path falls through to public/vendor/, immutable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-vendor-'));
  try {
    fs.mkdirSync(path.join(root, 'public', 'vendor', 'icons'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public', 'vendor', 'icons', 'sprite.svg'), '<svg/>');
    const hit = await serve('/vendor/icons/sprite.svg', root);
    assert.equal(hit.status, 200);
    assert.equal(hit.type, 'image/svg+xml');
    assert.equal(hit.body, '<svg/>');
    assert.match(hit.headers['cache-control'], /immutable/);
    assert.equal((await serve('/vendor/icons/missing.svg', root)).status, 404);
    // The mapped node_modules files keep working.
    assert.equal((await serve('/vendor/xterm.js')).status, 200);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- fleet F2: the CSS split ---------------------------------------------------

/** The plan's CSS map (01-foundations §2.3), in cascade order. */
const CSS_ORDER = [
  'tokens.css', 'base.css', 'shell.css', 'rail.css', 'board.css', 'terminal.css',
  'misc.css', 'lanes.css', 'views/data.css', 'views/box.css', 'views/map.css',
];

test('index.html links every public/css sheet once, in cascade order, before xterm', () => {
  const onDisk = fs.readdirSync(path.join(PUBLIC, 'css'), { recursive: true })
    .map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.css')).sort();
  assert.deepEqual([...CSS_LINKS].sort(), onDisk, 'every sheet under public/css is linked, and only those');
  assert.equal(new Set(CSS_LINKS).size, CSS_LINKS.length, 'no sheet is linked twice');
  // Later tasks may add sheets; the split's own sheets keep their relative order.
  assert.deepEqual(CSS_LINKS.filter((f) => CSS_ORDER.includes(f)), CSS_ORDER);
  const html = read('index.html');
  assert.ok(!/href="\/(styles|map)\.css"/.test(html), 'the pre-split sheets are not linked');
  assert.ok(html.indexOf('/css/views/map.css') < html.indexOf('/vendor/xterm.css'), 'xterm.css still comes last');
  for (const gone of ['styles.css', 'map.css']) {
    assert.ok(!fs.existsSync(path.join(PUBLIC, gone)), `public/${gone} is gone`);
  }
});

test('no rule in public/ names a legacy token alias', () => {
  // §4 D1 defines --line and --radius again as industrial tokens, so they left the list.
  const rx = /var\(--(bg|bg-raise|bg-card|bg-inset|line-soft|fg|fg-dim|fg-faint|red|amber|blue|green|grey|violet|radius-sm|mono|sans)[,)]/;
  const files = fs.readdirSync(PUBLIC, { recursive: true }).map((f) => f.split(path.sep).join('/'))
    .filter((f) => !f.startsWith('vendor/') && /\.(css|js|html)$/.test(f));
  for (const f of files) {
    const hit = rx.exec(read(f));
    assert.ok(!hit, `${f} uses the removed alias ${hit && hit[0]}`);
  }
  assert.ok(!/--(fg-faint|bg-inset|mono|sans)\s*:/.test(read('css/tokens.css')), 'tokens.css defines no aliases');
});

test('the split is byte-identical to styles.css (minus the aliases) followed by map.css', (t) => {
  // A historical invariant, checked against the commit that created the split,
  // so later restyles (§4) do not trip it. Needs the git history.
  const git = (...args) => execFileSync('git', args, { cwd: PUBLIC, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let commit;
  try {
    commit = git('log', '--diff-filter=A', '--format=%H', '--', 'css/tokens.css').trim().split('\n').pop();
  } catch { /* no git */ }
  if (!commit) {
    // Not committed yet (or no history): compare the working tree against HEAD.
    try { git('cat-file', '-e', 'HEAD:public/styles.css'); } catch { return t.skip('no git history of the split'); }
    const before = git('show', 'HEAD:public/styles.css').split('\n');
    before.splice(84, 20);
    assert.equal(readCss(CSS_ORDER), before.join('\n') + git('show', 'HEAD:public/map.css'));
    return;
  }
  const before = git('show', `${commit}^:public/styles.css`).split('\n');
  assert.match(before[84], /Aliases kept/, 'line 85 opens the alias block');
  assert.equal(before[104], '}', 'line 105 closes :root');
  before.splice(84, 20); // lines 85-104
  const expected = before.join('\n') + git('show', `${commit}^:public/map.css`);
  const actual = CSS_ORDER.map((f) => git('show', `${commit}:public/css/${f}`)).join('');
  assert.equal(actual, expected);
});
