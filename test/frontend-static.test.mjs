// Static checks on the browser bundle (fleet plan §11 QA layer 3, task D4):
// no HTML built from strings, every CSS custom property defined, every icon
// id in the sprite, every import resolvable, a licence next to every vendored
// file, and the CSP header on the builder's and the hub's index page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot } from './helpers/boot.mjs';
import { ICONS } from '../public/js/core/icons.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const read = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
const list = (dir, ext) => fs.readdirSync(path.join(PUBLIC, dir), { recursive: true })
  .map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith(ext)).sort().map((f) => `${dir}/${f}`);

const JS = list('js', '.js');
// Vendored ES modules a page module may import by a relative path (three.js for the Wall's galaxy, D8).
const VENDOR_JS = list('vendor', '.js');
const CSS = list('css', '.css');
const HTML = ['index.html', ...list('dev', '.html')];

/** Comments out, string contents kept (the checks below look for code shapes). */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

test('the scan sees the bundle', () => {
  assert.ok(JS.includes('js/app.js') && JS.includes('js/views/index.js'), 'public/js is scanned');
  assert.ok(CSS.includes('css/tokens.css') && CSS.includes('css/shell.css'), 'public/css is scanned');
  assert.ok(JS.length >= 40, `only ${JS.length} modules found`);
});

// --- no HTML from strings -------------------------------------------------------

test('no innerHTML, outerHTML, insertAdjacentHTML or document.write in public/js', () => {
  const rx = /\.(?:innerHTML|outerHTML)\s*[+]?=|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(|\bcreateContextualFragment\s*\(/;
  const hits = JS.filter((f) => rx.test(stripComments(read(f))));
  assert.deepEqual(hits, []);
});

test('the pages carry no inline script and no inline event handlers (CSP script-src self)', () => {
  for (const f of HTML) {
    const html = read(f);
    for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
      assert.match(m[1], /\ssrc="\/[^"]+"/, `${f}: an inline <script> would be blocked by the CSP`);
    }
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${f}: inline on*= handler`);
    assert.doesNotMatch(html, /\bjavascript:/i, `${f}: javascript: URL`);
  }
});

// --- CSS custom properties ---------------------------------------------------------

/** Custom properties declared anywhere: `--x:` in a sheet or page, or set from JS. */
function definedProps() {
  const out = new Set();
  for (const f of [...CSS, ...HTML]) {
    for (const m of stripComments(read(f)).matchAll(/(?:^|[{;\s"'])(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
  }
  for (const f of JS) {
    for (const m of read(f).matchAll(/setProperty\(\s*['"`](--[A-Za-z0-9_-]+)['"`]/g)) out.add(m[1]);
  }
  return out;
}

test('every var(--x) the CSS and the pages use is defined (tokens.css, a sheet, or set by JS)', () => {
  const defined = definedProps();
  const missing = [];
  for (const f of [...CSS, ...HTML, ...JS]) {
    for (const m of stripComments(read(f)).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      if (!defined.has(m[1])) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('the shell sheet uses only tokens.css properties, plus its own --rail-cur', () => {
  const tokens = new Set([...stripComments(read('css/tokens.css')).matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
  const own = new Set(['--rail-cur']);
  const shell = stripComments(read('css/shell.css'));
  const stray = [...shell.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]).filter((v) => !tokens.has(v) && !own.has(v));
  assert.deepEqual([...new Set(stray)], []);
  for (const m of shell.matchAll(/(?:^|[{;\s])(--[A-Za-z0-9_-]+)\s*:/g)) assert.ok(own.has(m[1]), `shell.css declares ${m[1]}`);
});

// --- icons -------------------------------------------------------------------------

const SPRITE_IDS = new Set([...read('vendor/lucide/sprite.svg').matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));

test('every icon the pages and modules name exists in the sprite and in ICONS', () => {
  assert.ok(SPRITE_IDS.size >= ICONS.length, 'the sprite has a symbol per concept');
  const named = [];
  for (const f of [...HTML, ...JS]) {
    const src = stripComments(read(f));
    for (const m of src.matchAll(/sprite\.svg#(i-[a-z0-9-]+)/g)) named.push([f, m[1].slice(2)]);
    for (const m of src.matchAll(/\bicon\(\s*'([a-z0-9-]+)'/g)) named.push([f, m[1]]);
    for (const m of src.matchAll(/\bicon:\s*'([a-z0-9-]+)'/g)) named.push([f, m[1]]);
  }
  assert.ok(named.length >= 10, `only ${named.length} icon uses found: the scan is broken`);
  const bad = named.filter(([, n]) => !SPRITE_IDS.has(`i-${n}`) || !ICONS.includes(n)).map(([f, n]) => `${f}: ${n}`);
  assert.deepEqual(bad, []);
});

test('the nav icons and the registry agree', async () => {
  const { VIEW_META } = await import('../public/js/views/index.js');
  const html = read('index.html');
  for (const m of html.matchAll(/data-view="([a-z]+)"[^>]*>\s*<svg[^>]*><use href="\/vendor\/lucide\/sprite\.svg#i-([a-z0-9-]+)"/g)) {
    assert.equal(m[2], VIEW_META[m[1]].icon, `${m[1]}: nav icon`);
  }
});

// --- imports ---------------------------------------------------------------------------

/** Exported names of a module, `default` included; re-exports count. */
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const raw of m[1].split(',')) if (raw.trim()) names.add(raw.trim().split(/\s+as\s+/).pop().trim());
  }
  if (/^export\s+default\b/m.test(src)) names.add('default');
  return names;
}

/** Every static import/re-export and dynamic import of a module. */
function importsOf(src) {
  const out = [];
  const code = stripComments(src);
  for (const m of code.matchAll(/^(import|export)\s+([^'";]*?)\s*from\s*'([^']+)';/gm)) {
    const clause = m[2].trim();
    const names = [];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const raw of braces[1].split(',')) if (raw.trim()) names.push(raw.trim().split(/\s+as\s+/)[0].trim());
    }
    const head = clause.replace(/\{[^}]*\}/, '').replace(/,\s*$/, '').trim();
    if (m[1] === 'import' && head && !head.startsWith('*')) names.push('default');
    out.push({ spec: m[3], names });
  }
  for (const m of code.matchAll(/^import\s+'([^']+)';/gm)) out.push({ spec: m[1], names: [] });
  for (const m of code.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push({ spec: m[1], names: [] });
  return out;
}

for (const file of JS) {
  test(`${file}: every import resolves to a module that exports what is asked`, () => {
    for (const { spec, names } of importsOf(read(file))) {
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${file}: '${spec}' must be relative (no bare or remote imports)`);
      const target = path.posix.join(path.posix.dirname(file), spec);
      assert.ok(JS.includes(target) || VENDOR_JS.includes(target), `${file}: '${spec}' does not resolve`);
      const exp = exportsOf(read(target));
      for (const n of names) assert.ok(exp.has(n), `${file}: ${target} does not export ${n}`);
    }
  });
}

test('every local href and src in index.html is a file in public/ (or a mapped vendor file)', () => {
  const html = read('index.html');
  const MAPPED = new Set(['/vendor/xterm.css', '/vendor/xterm.js', '/vendor/addon-fit.js', '/vendor/addon-web-links.js']);
  const refs = [...html.matchAll(/\s(?:href|src)="(\/[^"#?]*)/g)].map((m) => m[1]).filter((u) => !MAPPED.has(u));
  assert.ok(refs.length >= 10, 'the scan found the links');
  const missing = refs.filter((u) => !fs.existsSync(path.join(PUBLIC, u)));
  assert.deepEqual(missing, []);
});

// --- vendored licences -------------------------------------------------------------------

test('every vendored directory carries its licence', () => {
  const vendor = path.join(PUBLIC, 'vendor');
  const dirs = new Set();
  for (const f of fs.readdirSync(vendor, { recursive: true })) {
    const abs = path.join(vendor, f);
    if (fs.statSync(abs).isFile()) dirs.add(path.dirname(abs));
  }
  const bare = [];
  for (const d of dirs) {
    const files = fs.readdirSync(d).filter((n) => fs.statSync(path.join(d, n)).isFile());
    // A directory holding only provenance notes (SOURCES.txt, README) ships no code or asset.
    if (files.every((n) => /^(SOURCES|README)(\.[a-z]+)?$/i.test(n))) continue;
    if (!files.some((n) => /^(LICENSE|LICENCE|OFL|COPYING)(\.[a-z]+)?$/i.test(n))) bare.push(path.relative(PUBLIC, d));
  }
  assert.ok(dirs.size >= 2, 'fonts and the sprite are vendored');
  assert.deepEqual(bare, []);
});

// --- CSP on the real servers ----------------------------------------------------------------

const CSP_DIRECTIVES = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "font-src 'self'", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'",
  "frame-ancestors 'none'", "form-action 'none'",
];

async function cspOf(b) {
  const r = await fetch(`${b.url}/`, { signal: AbortSignal.timeout(5000) });
  const body = await r.text();
  return { status: r.status, csp: r.headers.get('content-security-policy') ?? '', body };
}

function assertCsp({ status, csp, body }, who) {
  assert.equal(status, 200, `${who}: index answers`);
  assert.match(body, /<script type="module" src="\/js\/app\.js"><\/script>/, `${who}: it is the shell page`);
  const parts = csp.split(';').map((p) => p.trim()).filter(Boolean);
  for (const d of CSP_DIRECTIVES) assert.ok(parts.includes(d), `${who}: CSP lacks "${d}" (${csp})`);
  const connect = parts.find((p) => p.startsWith('connect-src'));
  assert.match(connect ?? '', /^connect-src 'self' ws:\/\/\S+ wss:\/\/\S+$/, `${who}: connect-src is self plus ws/wss of the Host`);
  assert.doesNotMatch(csp, /'unsafe-eval'|script-src[^;]*'unsafe-inline'/, `${who}: no unsafe script sources`);
}

test('CSP intact on the builder index page', { timeout: 30_000 }, async () => {
  const b = await boot({ config: { fleet: { id: 'builder-a', code: 'BA' } } });
  try {
    assertCsp(await cspOf(b), 'builder');
  } finally {
    await b.stop();
  }
});

test('CSP intact on the hub index page', { timeout: 30_000 }, async () => {
  const b = await boot({ mode: 'hub', config: { fleet: { builders: [{ id: 'builder-a', url: 'http://127.0.0.1:9' }] } } });
  try {
    assertCsp(await cspOf(b), 'hub');
  } finally {
    await b.stop();
  }
});
