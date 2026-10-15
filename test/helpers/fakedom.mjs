// A minimal fake DOM for running the real frontend modules under `node --test`
// (fleet plan §11 X2; QA layer 2 "fake-DOM render").
//
// Extracted from test/render.test.mjs. Only what the page actually touches is
// modelled, but what IS modelled is faithful where a shortcut once hid a bug:
// textContent aggregates descendants and setting it drops the children,
// inserting a node that already has a parent moves it, and setAttribute('class')
// really sets the class.
//
//   makeEl(tag)                 one element
//   elementsFromHtml(html)      Map id -> element for every id="" in a page,
//                               plus the <button>s of id'd <nav>/<div>s and the
//                               real `hidden` attributes
//   makeDocument({byId, root})  a `document` over such a map
//   document                    a ready, empty document (for pure render(model, document) tests)
//   loadEsModules(context, ...) link and evaluate ES modules in a vm context
//                               (needs --experimental-vm-modules)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export function makeEl(tag = 'div') {
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

/**
 * One element per `id="..."` in `html`. The <button>s declared inside an id'd
 * <nav>/<div> (view strip, phone tabs, window pickers) become its children:
 * built from ids alone, a container the page only ever READS from (to mark one
 * child active) would look empty and a check would silently pass on nothing.
 * Deliberately shallow: those containers hold buttons and nothing else. The
 * real `hidden` attributes are honoured, so "did the page reveal this?" is real.
 */
export function elementsFromHtml(html) {
  const byId = new Map();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) byId.set(m[1], makeEl());
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
  for (const m of html.matchAll(/<[^>]*\sid="([^"]+)"[^>]*\shidden[^>]*>/g)) {
    const el = byId.get(m[1]);
    if (el) el.hidden = true;
  }
  return byId;
}

/**
 * A `document` over `byId`. `root` is what document.querySelectorAll searches
 * (default: the body).
 */
export function makeDocument({ byId = new Map(), root = null } = {}) {
  const head = makeEl('head');
  const body = makeEl('body');
  return {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (t) => makeEl(t),
    // The charts are hand-written SVG (no chart library), so namespaced
    // elements are needed too.
    createElementNS: (_ns, t) => makeEl(t),
    createTextNode: (t) => { const n = makeEl('#text'); n.textContent = String(t); return n; },
    querySelectorAll: (sel) => (root ?? body).querySelectorAll(sel),
    head, body, addEventListener() {}, removeEventListener() {},
  };
}

/** A ready document with no ids, for pure `render(model, document)` tests. */
export const document = makeDocument();

/** Every `_text` in the subtree, in document order (what a reader would see, piece by piece). */
export function texts(node) {
  const out = [];
  const walk = (n) => { if (n._text) out.push(n._text); n.children.forEach(walk); };
  walk(node);
  return out;
}

/**
 * Link and evaluate the ES module `entry` (absolute path) and everything it
 * imports inside the vm `context`, reading each file fresh, so no state is
 * shared across contexts. `stubs` maps an absolute path to a plain object of
 * exports that replaces that module. Imports must be relative. Returns
 * ns(rel): the namespace of `<path.dirname(entry)>/<rel>` in that context.
 */
export async function loadEsModules(context, { entry, stubs = {} }) {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('loadEsModules needs node --experimental-vm-modules');
  }
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    let mod;
    if (Object.hasOwn(stubs, file)) {
      const stub = stubs[file];
      mod = new vm.SyntheticModule(Object.keys(stub), function () {
        for (const [k, v] of Object.entries(stub)) this.setExport(k, v);
      }, { context, identifier: file });
    } else {
      mod = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
    }
    cache.set(file, mod);
    return mod;
  };
  const root = load(entry);
  await root.link((specifier, referencing) => {
    if (!specifier.startsWith('.')) {
      throw new Error(`${referencing.identifier}: imports must be relative, got ${specifier}`);
    }
    return load(path.resolve(path.dirname(referencing.identifier), specifier));
  });
  await root.evaluate();
  const base = path.dirname(entry);
  return (rel) => load(path.join(base, rel)).namespace;
}
