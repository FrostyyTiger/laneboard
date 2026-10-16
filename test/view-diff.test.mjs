// public/js/views/diff.js: the diff view's model and a fake-DOM mount (fleet R11, plan §10 2.12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import { parseUnifiedDiff } from '../server/review/diff.mjs';
import { formatReview } from '../public/js/core/review-format.js';

const HOSTILE = '<img src=x onerror="alert(1)">.js';

// A laneDiff() result, built with R2's own parser so the shape is the real one.
const PATCH = [
  'diff --git a/src/a.js b/src/a.js',
  'index 1111111..2222222 100644',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,4 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = "x";',
  ' // end',
  '\\ No newline at end of file',
].join('\n') + '\n';

function fixture() {
  const [parsed] = parseUnifiedDiff(PATCH);
  return {
    lane: 'lane1', base: 'origin/main', mergeBase: 'a'.repeat(40), head: 'HEAD', headSha: 'b'.repeat(40),
    source: 'worktree', mode: 'all', totals: { files: 4, add: 2, del: 1 }, truncated: true,
    files: [
      { path: 'src/a.js', oldPath: null, status: 'M', add: 2, del: 1, binary: false, generated: false, deferred: false, truncated: false, hunks: parsed.hunks },
      { path: HOSTILE, oldPath: 'old/name.js', status: 'R', add: 0, del: 0, binary: false, generated: false, deferred: false, truncated: false, hunks: [] },
      { path: 'img.png', oldPath: null, status: 'A', add: 0, del: 0, binary: true, generated: false, deferred: false, truncated: false, hunks: [] },
      { path: 'package-lock.json', oldPath: null, status: 'M', add: 900, del: 300, binary: false, generated: true, deferred: true, truncated: false, hunks: [] },
    ],
    untracked: ['notes.txt'], untrackedTruncated: false,
  };
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _m: m,
  };
}

import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'js', 'views', 'diff.js'), 'utf8');

test('S20: the only action is send-review, reached only from the send sheet\'s button', () => {
  const acts = [...SRC.matchAll(/\b(?:act|hubAct|post|del|sendKeys|sendText)\s*\(/g)];
  assert.equal(acts.length, 1, 'one action call in the view');
  assert.match(SRC.slice(acts[0].index - 40, acts[0].index + 60), /act\(key, 'send-review', args\)/);
  const fnAt = SRC.lastIndexOf('async function ', acts[0].index);
  assert.match(SRC.slice(fnAt, fnAt + 30), /^async function doSend\(/, 'inside doSend');
  assert.ok(SRC.indexOf('confirmAction(', fnAt) < acts[0].index, 'after the confirm dialog');
  const callers = [...SRC.matchAll(/doSend\(/g)].map((m) => m.index).filter((i) => !SRC.slice(i - 15, i).includes('function'));
  assert.equal(callers.length, 1, 'doSend has one caller');
  assert.match(SRC.slice(callers[0] - 60, callers[0]), /button\('Send', 'btn--primary', \(\) => $/, 'the Send button of the sheet');
  assert.doesNotMatch(SRC, /fetch\([^)]*method/, 'reads only: fetch never sets a method');
});

const mod = await import('../public/js/views/diff.js');
const {
  baseFromHash, diffUrl, fileRows, flatRows, selectLine, anchorFor, anchorRow, cleanDraft, draftKey,
  loadDrafts, saveDrafts, reviewArgs, reviewText, diffPaths, pullFor, COLLAPSE_LINES,
} = mod;

test('diffUrl: builder path, hub read proxy, encoded values, refused keys', () => {
  assert.equal(diffUrl({ laneId: 'lane1' }), '/api/v1/lanes/lane1/diff');
  assert.equal(diffUrl({ hub: true, builder: 'builder-a', laneId: 'lane1', base: 'origin/main', mode: 'committed' }),
    '/api/fleet/builder-a/v1/lanes/lane1/diff?base=origin%2Fmain&mode=committed');
  assert.equal(diffUrl({ laneId: 'lane1', path: 'a b&c=d/e.js' }), '/api/v1/lanes/lane1/diff?path=a%20b%26c%3Dd%2Fe.js');
  assert.equal(diffUrl({ laneId: 'lane1', base: '--upload-pack=x', mode: 'evil' }), '/api/v1/lanes/lane1/diff', 'bad base/mode are dropped');
  assert.equal(diffUrl({ laneId: '..' }), null);
  assert.equal(diffUrl({ laneId: 'a/b' }), null);
  assert.equal(diffUrl({ hub: true, builder: '../x', laneId: 'lane1' }), null);
});

test('baseFromHash reads a validated base= the router does not keep', () => {
  assert.equal(baseFromHash('#/diff?sel=builder-a%2Flane1&base=origin%2Fdev'), 'origin/dev');
  assert.equal(baseFromHash('#/diff?base=abcdef1'), 'abcdef1');
  assert.equal(baseFromHash('#/diff?base=main'), null);
  assert.equal(baseFromHash('#/diff?base=origin%2F..%2Fx'), null);
  assert.equal(baseFromHash('#/diff?base=%E0%A4%A'), null);
  assert.equal(baseFromHash('#/diff'), null);
});

test('fileRows: status shapes, counts, markers and the collapse threshold', () => {
  const rows = fileRows(fixture());
  assert.deepEqual(rows.map((r) => [r.path, r.shape, r.markers]), [
    ['src/a.js', '~', []],
    [HOSTILE, '→', []],
    ['img.png', '+', ['bin']],
    ['package-lock.json', '~', ['gen', 'deferred']],
  ]);
  assert.equal(rows[0].lines, 6, 'kept diff lines, the no-newline marker included');
  assert.equal(rows[1].oldPath, 'old/name.js');
  assert.equal(rows[3].lines, 1200);
  assert.equal(rows[3].collapsed, false, 'a deferred file shows its load button, not a collapse');
  const big = { path: 'big.js', status: 'M', add: COLLAPSE_LINES + 1, del: 0, hunks: [] };
  assert.equal(fileRows({ files: [big] })[0].collapsed, true, 'over 1000 lines starts collapsed');
  assert.equal(fileRows({ files: [{ ...big, add: COLLAPSE_LINES }] })[0].collapsed, false);
  assert.equal(rows[0].collapsed, false);
  assert.equal(fileRows({ files: [{ path: 'x', status: 'constructor' }] })[0].status, 'M', 'unknown status falls back');
});

test('selection and anchors: new side, old side, ranges, nothing commentable', () => {
  const f = fixture().files[0];
  const rows = flatRows(f);
  assert.deepEqual(rows.map((r) => (r.kind === 'hunk' ? '@' : r.t)), ['@', ' ', '-', '+', '+', ' ', '\\']);

  let sel = selectLine(null, { file: 0, row: 3 });
  assert.deepEqual(sel, { file: 0, anchor: 3, a: 3, b: 3 });
  sel = selectLine(sel, { file: 0, row: 1, shift: true });
  assert.deepEqual(sel, { file: 0, anchor: 3, a: 1, b: 3 });
  assert.deepEqual(selectLine(sel, { file: 2, row: 5, shift: true }), { file: 2, anchor: 5, a: 5, b: 5 }, 'shift in another file starts over');

  assert.deepEqual(anchorFor(f, rows, 3, 4), { path: 'src/a.js', side: 'new', line: 2, endLine: 3, quote: ['const b = 3;', 'const c = "x";'] });
  assert.deepEqual(anchorFor(f, rows, 2, 2), { path: 'src/a.js', side: 'old', line: 2, endLine: 2, quote: ['const b = 2;'] });
  const mixed = anchorFor(f, rows, 1, 5);
  assert.equal(mixed.side, 'new');
  assert.deepEqual([mixed.line, mixed.endLine], [1, 4]);
  assert.equal(anchorFor(f, rows, 0, 0), null, 'a hunk header alone is not commentable');
  assert.equal(anchorFor(f, rows, 6, 6), null);

  assert.equal(anchorRow(rows, { side: 'new', endLine: 3 }), 4);
  assert.equal(anchorRow(rows, { side: 'old', endLine: 2 }), 2);
  assert.equal(anchorRow(rows, { side: 'new', endLine: 99 }), -1);
});

test('drafts: key, save, load, stale fallback, junk tolerated, storage failures swallowed', () => {
  const fk = 'builder-a/lane1';
  const sha1 = 'b'.repeat(40);
  const sha2 = 'c'.repeat(40);
  assert.equal(draftKey(fk, sha1), `lb.review.${fk}.${sha1}`);
  const st = memStorage();
  const d = cleanDraft({ path: 'src/a.js', side: 'new', line: 2, endLine: 3, quote: ['x'], body: 'Rename.', extra: 'dropped' });
  assert.deepEqual(Object.keys(d).sort(), ['body', 'endLine', 'line', 'path', 'quote', 'side']);
  assert.ok(saveDrafts(st, fk, sha1, [d]));
  assert.deepEqual(loadDrafts(st, fk, sha1), { sha: sha1, drafts: [d], stale: false });
  assert.deepEqual(loadDrafts(st, fk, sha2), { sha: sha1, drafts: [d], stale: true }, 'the branch moved: old drafts come back, flagged');
  assert.deepEqual(loadDrafts(st, 'builder-a/other', sha1).drafts, []);
  saveDrafts(st, fk, sha1, []);
  assert.equal(st._m.size, 0, 'an empty list removes the key');

  const junk = memStorage({ [draftKey(fk, sha1)]: '{not json', [draftKey(fk, sha2)]: JSON.stringify([{ path: '', line: 1 }, { path: 'a', line: 0 }, null, { path: 'a', line: 2, endLine: 1, body: 7 }]) });
  assert.deepEqual(loadDrafts(junk, fk, sha1), { sha: sha2, drafts: [{ path: 'a', side: 'new', line: 2, endLine: 2, quote: [], body: '' }], stale: true });

  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); }, key() { throw new Error('x'); }, get length() { throw new Error('x'); } };
  assert.deepEqual(loadDrafts(broken, fk, sha1), { sha: sha1, drafts: [], stale: false });
  assert.equal(saveDrafts(broken, fk, sha1, [d]), false);
  assert.deepEqual(loadDrafts(null, fk, sha1).drafts, []);
});

test('reviewArgs is exactly the send-review schema, and reviewText is formatReview over it', () => {
  const diff = fixture();
  const drafts = [
    { path: 'src/a.js', side: 'new', line: 3, endLine: 3, quote: ['const c = "x";'], body: 'Second.' },
    { path: 'src/a.js', side: 'old', line: 2, endLine: 2, quote: ['const b = 2;'], body: 'First.', junk: 1 },
  ];
  const args = reviewArgs(diff, drafts, '');
  assert.deepEqual(Object.keys(args), ['review']);
  assert.deepEqual(Object.keys(args.review), ['base', 'mergeBase', 'headSha', 'comments']);
  assert.deepEqual(args.review.comments.map((c) => c.line), [2, 3], 'sorted by path then line');
  for (const c of args.review.comments) assert.deepEqual(Object.keys(c).sort(), ['body', 'endLine', 'line', 'path', 'quote', 'side']);
  assert.equal(reviewArgs(diff, [], '  ').review.note, undefined, 'a blank note is left out');
  assert.equal(reviewArgs(diff, [], 'Overall fine.').review.note, 'Overall fine.');

  const r = reviewText({ branch: 'feat/x', diff, drafts, note: '' });
  assert.equal(r.text, formatReview({ branch: 'feat/x', ...args.review, files: diffPaths(diff) }));
  assert.match(r.text, /^REVIEW of feat\/x \(origin\/main @ aaaaaaa \.\. bbbbbbb\), 2 comments\./);
  assert.ok(diffPaths(diff).has('old/name.js'), 'old names of renames are commentable');

  assert.ok(reviewText({ branch: 'feat/x', diff, drafts: [], note: '' }).error, 'nothing to send');
  assert.match(reviewText({ branch: 'feat/x', diff, drafts: [{ path: 'gone.js', line: 1, body: 'x' }], note: '' }).error, /not in the diff/);
});

test('pullFor validates through pullCommands: a hostile lane record yields no command', () => {
  const lane = { id: 'lane1', builder: 'builder-a', branch: 'feat/x', repo: 'acme' };
  const cmds = pullFor(lane, { prFor: () => ({ number: 12, repo: 'acme/web' }), repoFor: () => 'acme' });
  assert.equal(cmds.length, 2);
  assert.match(cmds[0].cmd, /^git fetch origin 'feat\/x'/);
  assert.match(cmds[1].cmd, /gh pr checkout 12 --repo 'acme\/web'/);
  assert.deepEqual(pullFor({ ...lane, branch: '--upload-pack=x' }, {}), []);
  assert.deepEqual(pullFor({ ...lane, repo: '$(id)' }, {}), []);
  assert.deepEqual(pullFor(null), []);
});

// --- fake-DOM mount ---------------------------------------------------------------

function withPage(fetchImpl, fn) {
  const saved = { document: globalThis.document, fetch: globalThis.fetch, location: globalThis.location };
  globalThis.document = makeDocument();
  globalThis.fetch = fetchImpl;
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function find(node, cls, out = []) {
  if (node.classList?.contains(cls)) out.push(node);
  for (const c of node.children ?? []) find(c, cls, out);
  return out;
}

test('mount without a lane: the empty panel, and no request at all', async () => {
  let calls = 0;
  await withPage(() => { calls++; throw new Error('no fetch expected'); }, async () => {
    const view = mod.default;
    const el = globalThis.document.createElement('section');
    view.mount(el, { route: { view: 'diff', b: null, sel: null } });
    await flush();
    assert.ok(el.children[0].classList.contains('panel'));
    assert.match(el.textContent, /Select a lane/);
    view.update(null, { route: { view: 'diff', sel: null } });
    view.unmount();
    assert.equal(el.children.length, 0);
  });
  assert.equal(calls, 0);
});

test('mount with a lane: one GET of the diff, the files rendered as text, nothing sent', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? 'GET' });
    return { ok: true, status: 200, json: async () => fixture() };
  };
  await withPage(fetchImpl, async () => {
    const view = mod.default;
    const el = globalThis.document.createElement('section');
    view.mount(el, { route: { view: 'diff', b: null, sel: 'builder-a/lane1' } });
    await flush();
    await flush();
    assert.deepEqual(seen, [{ url: '/api/v1/lanes/lane1/diff', method: 'GET' }], 'exactly one read, no action');

    const all = texts(el);
    assert.ok(all.includes(HOSTILE), 'the hostile file name is a text node');
    assert.equal(find(el, 'dv-fi').length, 4, 'one list entry per file');
    assert.equal(find(el, 'dv-file').length, 4, 'one section per file');
    assert.ok(find(el, 'hl-keyword').some((n) => n.textContent === 'const'), 'code is highlighted');
    assert.ok(find(el, 'dv-add').length === 2 && find(el, 'dv-del').length === 1);
    assert.ok(all.includes('notes.txt'), 'untracked names are listed');
    assert.ok(all.some((t) => /Generated file/.test(t)), 'the deferred file offers a load');
    assert.ok(all.some((t) => /Send review \(0\)/.test(t)));

    // Nothing in the subtree was built from markup.
    const walk = (n) => { assert.equal(n.innerHTML, '', `${n.tagName} has no innerHTML`); n.children.forEach(walk); };
    walk(el);

    // Store ticks never refetch; another lane in the route does.
    view.update(null, { route: { view: 'diff', sel: 'builder-a/lane1' } });
    await flush();
    assert.equal(seen.length, 1);
    view.update(null, { route: { view: 'diff', sel: 'builder-a/lane2' } });
    await flush();
    assert.equal(seen.length, 2);
    assert.equal(seen[1].url, '/api/v1/lanes/lane2/diff');
    view.unmount();
  });
});

test('a failed read shows the error as text', async () => {
  await withPage(async () => ({ ok: false, status: 404, json: async () => ({ error: '<b>no such lane</b>' }) }), async () => {
    const view = mod.default;
    const el = globalThis.document.createElement('section');
    view.mount(el, { route: { view: 'diff', sel: 'builder-a/lane1' } });
    await flush();
    await flush();
    assert.ok(texts(el).some((t) => t === 'Diff unavailable: <b>no such lane</b>'));
    view.unmount();
  });
});
