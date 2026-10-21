// The annunciator and the event tape (fleet plan §4 2.5 / 2.4, task D7).
// Pure modules only: public/js/core/alarm-tiles.js and the model exports of
// public/js/ui/{annunciator,tape}.js (no document at import time).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  TILES, KIND_TO_TILE, TILE_META, tileOf, alarmP, tileModel, tileLabel, tileParam, tileFromParam,
  alarmKey, tileKeys, ackRequest, tileTone, TILE_FIXED_P, TONE_MARK,
} from '../public/js/core/alarm-tiles.js';
import { tileView } from '../public/js/ui/annunciator.js';
import {
  TAPE_MAX, DRAWER_ROWS, createRing, eventP, tapeItem, filterItems, tapeScope, clip, tapeTime, itemLabel,
  latestItem, emptyLine,
} from '../public/js/ui/tape.js';
import { ALARM_KINDS } from '../server/config/observability.mjs';
import { KIND_TO_TILE as SERVER_KIND_TO_TILE, TILES as SERVER_TILES, KINDS, derive, fleetOfOne } from '../server/fleet/alarms.mjs';
import { checkAck } from '../server/hub/routes/alarms.mjs';
import { ICONS } from '../public/js/core/icons.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let n = 0;
const alarm = (kind, priority, extra = {}) => ({
  id: `${kind}:builder-a:x${++n}`, kind, priority, builder: 'builder-a', target: `lane-${n}`,
  text: 'text', since: 1000 + n, acked: false, ackedBy: null, ackedAt: null, ...extra,
});
const byTile = (model, tile) => model.find((t) => t.tile === tile);

// ---------------------------------------------------------------- tiles

test('the 8 tiles, in the fixed order', () => {
  assert.deepEqual(TILES, ['NEED', 'APPR', 'BLKD', 'STCK', 'CI-F', 'DOWN', 'BUDG', 'CONF']);
  assert.ok(Object.isFrozen(TILES));
  assert.deepEqual(tileModel([]).map((t) => t.tile), TILES);
  assert.deepEqual(tileModel([alarm('conflict', 'P3'), alarm('needs-input', 'P2')]).map((t) => t.tile), TILES);
  for (const t of TILES) {
    assert.ok(TILE_META[t]?.name, `${t} has a long name`);
    assert.ok(ICONS.includes(TILE_META[t].icon), `${t} icon ${TILE_META[t].icon} exists`);
  }
});

test('every §7 alarm kind maps to at most one tile; only review, reboot and health-warn have none', () => {
  const unmapped = [];
  for (const kind of ALARM_KINDS) {
    const tile = tileOf(kind);
    if (tile === null) { unmapped.push(kind); continue; }
    assert.ok(TILES.includes(tile), `${kind} -> ${tile} is a tile`);
    // A plain object maps a key to exactly one value; check no kind is listed twice in the source.
  }
  assert.deepEqual(unmapped, ['health-warn', 'review', 'reboot']);
  const src = read('public/js/core/alarm-tiles.js');
  const block = /KIND_TO_TILE = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(src)[1];
  const keys = [...block.matchAll(/'([a-z-]+)':/g)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'no kind listed twice');
  for (const k of Object.keys(KIND_TO_TILE)) assert.ok(ALARM_KINDS.includes(k), `${k} is a §7 kind`);
  assert.deepEqual(Object.keys(KINDS).sort(), [...ALARM_KINDS].sort());
});

test('the UI map is the server copy (ack-alarm * {tile} acks what the tile shows)', () => {
  assert.deepEqual({ ...KIND_TO_TILE }, { ...SERVER_KIND_TO_TILE });
  assert.deepEqual([...TILES], [...SERVER_TILES]);
});

test('tileOf: own keys only, no inherited members', () => {
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', null, undefined, 42, 'review']) {
    assert.equal(tileOf(k), null, String(k));
  }
  assert.equal(tileOf('audit-fork'), 'DOWN');
  assert.equal(tileOf('review-overdue'), 'NEED');
});

test('alarm priority -> data-p: P1 1, P2 2, P3 3, P4 3', () => {
  assert.equal(alarmP('P1'), 1);
  assert.equal(alarmP('P2'), 2);
  assert.equal(alarmP('P3'), 3);
  assert.equal(alarmP('P4'), 3);
  assert.equal(alarmP('bogus'), 3);
  assert.equal(alarmP(undefined), 3);
});

// ---------------------------------------------------------------- model

test('tileModel: the tile priority is the max over its members', () => {
  const m = tileModel([
    alarm('builder-stale', 'P3'), alarm('health-crit', 'P2'), alarm('builder-down', 'P1'), alarm('audit-fork', 'P1'),
    alarm('budget-warn', 'P4'), alarm('stuck', 'P3'), alarm('stuck', 'P2'),
  ]);
  const down = byTile(m, 'DOWN');
  assert.equal(down.n, 4);
  assert.equal(down.p, 1);
  assert.deepEqual(down.members.map((a) => a.kind), ['builder-down', 'audit-fork', 'health-crit', 'builder-stale'], 'worst first');
  assert.equal(byTile(m, 'BUDG').p, 3, 'P4 shows as 3');
  assert.equal(byTile(m, 'STCK').p, 2);
  assert.equal(byTile(m, 'STCK').n, 2);
  const clear = byTile(m, 'CONF');
  assert.deepEqual({ ...clear, members: clear.members.length }, { tile: 'CONF', p: null, state: 'normal', n: 0, members: 0 });
});

test('tileModel: normal -> unack -> ack, and a new unacked member flashes again', () => {
  const a = alarm('approval', 'P2');
  const b = alarm('approval', 'P2');
  assert.equal(byTile(tileModel([]), 'APPR').state, 'normal');
  assert.equal(byTile(tileModel([a]), 'APPR').state, 'unack');
  assert.equal(byTile(tileModel([{ ...a, acked: true, ackedBy: 'u', ackedAt: 5 }]), 'APPR').state, 'ack');
  assert.equal(byTile(tileModel([{ ...a, acked: true }, b]), 'APPR').state, 'unack', 'one unacked member is enough');
  assert.equal(byTile(tileModel([{ ...a, acked: true }, { ...b, acked: true }]), 'APPR').state, 'ack');
  assert.equal(byTile(tileModel([{ ...a, acked: 'yes' }]), 'APPR').state, 'unack', 'only acked === true counts');
  // A cleared alarm leaves the live set (§7 reconcile): back to normal (rtn is deferred).
  assert.equal(byTile(tileModel([]), 'APPR').state, 'normal');
});

test('tileModel: skips review, unknown kinds, junk entries and repeated ids', () => {
  const a = alarm('conflict', 'P3');
  const m = tileModel([null, 7, 'x', [], { kind: 'review', priority: 'P4' }, { kind: 'nope' }, { kind: 'constructor' }, a, { ...a }]);
  assert.equal(m.reduce((s, t) => s + t.n, 0), 1);
  assert.equal(byTile(m, 'CONF').n, 1);
  assert.equal(tileModel(null).length, 8);
  assert.equal(tileModel({ length: 3 }).length, 8);
});

test('tileLabel and tileView: the accessible name, data-p, count and aria-pressed', () => {
  const m = tileModel([alarm('stuck', 'P2'), alarm('stuck', 'P3')]);
  const st = byTile(m, 'STCK');
  assert.equal(tileLabel(st), 'Stuck: 2 lanes, unacknowledged');
  assert.equal(tileLabel(byTile(tileModel([alarm('stuck', 'P2', { acked: true })]), 'STCK')), 'Stuck: 1 lane, acknowledged');
  assert.equal(tileLabel(byTile(m, 'CONF')), 'Conflict: clear');
  const v = tileView(st, { s: 'stck' });
  assert.equal(v.label, 'STCK');
  assert.equal(v.n, '2');
  assert.equal(v.p, '2');
  assert.equal(v.state, 'unack');
  assert.equal(v.pressed, true);
  assert.equal(tileView(st, { s: 'need' }).pressed, false);
  assert.equal(tileView(st, null).pressed, false);
  const clear = tileView(byTile(m, 'NEED'), {});
  assert.deepEqual([clear.n, clear.p, clear.state], ['', '', 'normal']);
});

test('tileView: the tooltip carries builder text as plain lines, capped', () => {
  const many = Array.from({ length: 9 }, () => alarm('failed', 'P2', { text: '<img src=x onerror=alert(1)>' }));
  const v = tileView(byTile(tileModel(many), 'BLKD'), {});
  const lines = v.title.split('\n');
  assert.equal(lines.length, 1 + 6 + 1);
  assert.equal(lines.at(-1), '+3 more');
  assert.ok(lines[1].includes('<img'), 'kept as text (rendered with textContent / title only)');
});

test('the s= scope param round-trips through the router grammar (lowercase)', () => {
  const STATE_RX = /^[a-z0-9_-]{1,24}(?:,[a-z0-9_-]{1,24}){0,15}$/;
  for (const t of TILES) {
    const p = tileParam(t);
    assert.match(p, STATE_RX, `${t} -> ${p} is a valid s=`);
    assert.equal(tileFromParam(p), t);
  }
  assert.equal(tileParam('nope'), null);
  assert.equal(tileFromParam('working'), null);
  assert.equal(tileFromParam(null), null);
});

test('tileKeys: the fleet keys of a tile, builder-wide alarms have none', () => {
  const m = tileModel([
    alarm('stuck', 'P2', { builder: 'builder-a', target: 'auth' }),
    alarm('stuck', 'P2', { builder: 'b2', target: 'api/x' }),
    alarm('builder-down', 'P1', { builder: 'b2', target: '*' }),
    alarm('stuck', 'P2', { builder: 'Bad Id', target: 'z' }),
  ]);
  assert.deepEqual([...tileKeys(m, 'STCK')].sort(), ['b2/api/x', 'builder-a/auth']);
  assert.deepEqual([...tileKeys(m, 'DOWN')], []);
  assert.equal(alarmKey({ builder: 'builder-a', target: '' }), null);
  assert.equal(alarmKey(null), null);
});

test('ackRequest: target * with {tile, builder?}, accepted by the hub check', () => {
  for (const t of TILES) {
    const r = ackRequest(t);
    assert.deepEqual(r, { target: '*', args: { tile: t } });
    assert.equal(checkAck(r.target, r.args).ok, true, t);
  }
  const scoped = ackRequest('STCK', 'builder-a');
  assert.deepEqual(scoped, { target: '*', args: { tile: 'STCK', builder: 'builder-a' } });
  assert.equal(checkAck(scoped.target, scoped.args).ok, true);
  assert.deepEqual(ackRequest('STCK', 'all'), { target: '*', args: { tile: 'STCK' } });
  assert.deepEqual(ackRequest('STCK', 'Not/AnId'), { target: '*', args: { tile: 'STCK' } });
  assert.equal(ackRequest('stck'), null);
});

test('annunciator.js acks through act() with ack-alarm and filters through the router', () => {
  const src = read('public/js/ui/annunciator.js');
  assert.match(src, /act\(req\.target, 'ack-alarm', req\.args\)/);
  assert.match(src, /navigate\(\{ s:/);
  assert.match(src, /syncFlash\(/, 'the flash is phase-synced');
  assert.match(src, /e\.key !== 'a'/, '`a` on a focused tile acks');
  assert.match(src, /contextmenu/);
});

// ---------------------------------------------------------------- CSS

test('annunciator.css: never filled, the count takes the tone, flash only while unacked, reduced motion steady + UNACK', () => {
  const css = read('public/css/annunciator.css');
  // The flash is a ring on ::after (runs T14): the tile and its count never fade.
  assert.match(css, /\.ann-tile\[data-unack\]\s*\{\s*animation:\s*none;\s*\}/);
  const ring = /\.ann-tile\[data-unack\]::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(ring, /animation:\s*lb-flash 1s linear infinite;/);
  assert.match(ring, /animation-delay:\s*inherit;/, 'the ring takes the phase syncFlash sets on the tile');
  assert.match(ring, /border:\s*var\(--bw\) solid var\(--ann-tone/, 'the ring is 1 px in the tile tone');
  for (const p of [1, 2]) assert.match(css, new RegExp(`\\.ann-tile\\[data-p="${p}"\\] \\{ --ann-tone: var\\(--p${p}\\); \\}`));
  assert.match(css, /\.ann-tile\[data-state="unack"\] \.ann-n,\s*\.ann-tile\[data-state="ack"\] \.ann-n \{ color: var\(--ann-tone/);
  const rm = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(rm, /animation:\s*none/);
  assert.match(rm, /\.ann-tag \{ display: inline; \}/);
  assert.match(read('public/js/ui/annunciator.js'), /'UNACK'/);
});

test('T13: the tiles are grey with a coloured count: no fill, no cyan, no inverse text', () => {
  const css = read('public/css/annunciator.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, sel, body] = m;
    if (!/ann-/.test(sel)) continue;
    const bg = /background(?:-color)?:\s*([^;]+)/.exec(body)?.[1]?.trim();
    if (bg) assert.equal(bg, 'var(--bg-sunken)', `${sel.trim()}: the only tile background is the grey well`);
    assert.doesNotMatch(body, /--p3|--text-inv/, `${sel.trim()}: no cyan, no text on a fill`);
  }
  // Every tile draws amber (wants you) or red (broken), never p3, whatever its members.
  assert.deepEqual(Object.keys(TILE_FIXED_P).sort(), [...TILES].sort());
  for (const t of TILES) assert.equal(TILE_FIXED_P[t], ['BLKD', 'DOWN'].includes(t) ? 1 : 2, t);
  assert.equal(TONE_MARK[1], '\u25a0');
  assert.equal(TONE_MARK[2], '\u25b2');
  const budg = tileView(byTile(tileModel([alarm('budget-warn', 'P3')]), 'BUDG'));
  assert.equal(budg.p, '2', 'BUDG is amber, not the cyan p3');
  assert.equal(budg.mark, '\u25b2');
  assert.equal(budg.n, '1');
  const blkd = tileView(byTile(tileModel([alarm('blocked', 'P2')]), 'BLKD'));
  assert.equal(blkd.p, '1');
  assert.equal(blkd.mark, '\u25a0');
  const empty = tileView(byTile(tileModel([]), 'CONF'));
  assert.deepEqual([empty.n, empty.mark, empty.p, empty.state], ['', '', '', 'normal'], 'an empty tile is plain grey');
});

test('tape.css: severity left bar, 200px drawer', () => {
  const css = read('public/css/tape.css');
  assert.match(css, /border-left: 2px solid/);
  assert.match(css, /height: var\(--tape-h-open\)/);
  assert.match(read('public/css/tokens.css'), /--tape-h-open:\s*200px/);
});

test('both sheets are linked from index.html', () => {
  const html = read('public/index.html');
  assert.match(html, /href="\/css\/tape\.css"/);
  assert.match(html, /href="\/css\/annunciator\.css"/);
});

test('no markup sinks in the D7 modules: builder text goes in as text', () => {
  for (const f of ['public/js/ui/tape.js', 'public/js/ui/annunciator.js', 'public/js/core/alarm-tiles.js']) {
    const src = read(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), f);
    assert.ok(!/setAttribute\(\s*['"]style/.test(src), f);
    assert.ok(!/scrollIntoView|scrollTop\s*=/.test(src), `${f}: the tape never auto-scrolls`);
  }
});

// ---------------------------------------------------------------- tape

test('the ring keeps the newest 500, newest first', () => {
  const r = createRing(TAPE_MAX);
  for (let i = 0; i < 520; i++) r.push(i);
  assert.equal(r.size(), 500);
  assert.equal(r.list()[0], 519);
  assert.equal(r.list().at(-1), 20);
  r.clear();
  assert.equal(r.size(), 0);
  assert.equal(DRAWER_ROWS, 200);
});

test('eventP: the severity of a hook event', () => {
  assert.equal(eventP({ type: 'Notification', subtype: 'permission_prompt' }), '1');
  assert.equal(eventP({ type: 'Notification', subtype: 'idle_prompt' }), '2');
  assert.equal(eventP({ type: 'PostToolUseFailure', subtype: 'Bash' }), '2');
  assert.equal(eventP({ type: 'Stop' }), 'ok');
  assert.equal(eventP({ type: 'SessionStart' }), 'off');
  assert.equal(eventP({ type: 'PreToolUse', subtype: 'Edit' }), 'run');
  assert.equal(eventP(null), 'run');
});

test('tapeItem: builder fields are clipped plain text; the key only when it is a fleet key', () => {
  const s = { builders: new Map([['builder-a', { id: 'builder-a', code: 'B1' }]]) };
  const it = tapeItem({
    ts: Date.UTC(2026, 0, 1, 12, 0, 5), builder: 'builder-a', key: 'builder-a/auth',
    session_name: 'auth\u001b[31m\u202e', type: 'Notification', subtype: 'permission_prompt',
  }, s);
  assert.equal(it.code, 'B1');
  assert.equal(it.name, 'auth [31m');
  assert.equal(it.what, 'Notification · permission_prompt');
  assert.equal(it.p, '1');
  assert.equal(it.key, 'builder-a/auth');
  assert.match(it.time, /^\d\d:\d\d:\d\d$/);
  assert.equal(itemLabel(it), `${it.time} B1 auth [31m Notification · permission_prompt`);
  assert.equal(tapeItem({ key: 'nokey', builder: 'builder-b' }).key, null);
  assert.equal(tapeItem({ builder: 'builder-b' }).code, 'BB', 'derived code when the store has none');
  assert.equal(tapeItem({ session_name: { toString: () => 'x' } }).name, '');
  assert.equal(clip('x'.repeat(200)).length, 80);
  assert.equal(tapeTime(null), '--:--:--');
  assert.notEqual(tapeItem({}).uid, tapeItem({}).uid);
});

test('filterItems / tapeScope: b=, q= and s=<tile> scope the tape', () => {
  const items = [
    tapeItem({ builder: 'builder-a', key: 'builder-a/auth', session_name: 'auth', type: 'Stop' }),
    tapeItem({ builder: 'b2', key: 'b2/api', session_name: 'api', type: 'PreToolUse', subtype: 'Bash' }),
    tapeItem({ builder: 'b2', key: 'b2/web', session_name: 'web', type: 'Stop' }),
  ];
  assert.equal(filterItems(items, {}).length, 3);
  assert.equal(filterItems(items, { b: 'all' }).length, 3);
  assert.deepEqual(filterItems(items, { b: 'b2' }).map((i) => i.name), ['api', 'web']);
  assert.deepEqual(filterItems(items, { q: 'BASH' }).map((i) => i.name), ['api']);
  const al = [alarm('stuck', 'P2', { builder: 'b2', target: 'web' })];
  const scope = tapeScope({ b: null, s: 'stck', q: null }, al);
  assert.deepEqual(filterItems(items, scope).map((i) => i.name), ['web']);
  assert.equal(tapeScope({ s: 'working' }, al).keys, null, 'a non-tile s= is not a tile filter');
  assert.deepEqual(filterItems(items, tapeScope({ s: 'conf' }, al)), []);
});

test('emptyLine (T20): before the first event the line shows the latest session, like the phone peek', () => {
  const since = new Date(2026, 9, 21, 9, 5, 7).getTime();
  const latest = { key: 'builder-a/search', text: 'BA/search working', p: 'run', since };
  const e = emptyLine(0, latest);
  assert.equal(e.kind, 'latest');
  assert.equal(e.item.name, 'BA/search working');
  assert.equal(e.item.time, '09:05:07');
  assert.equal(e.item.key, 'builder-a/search');
  assert.equal(e.item.p, 'run');
  assert.notEqual(e.item.name, 'no events yet');
  // No session either: the line stays empty, never "no events yet".
  assert.deepEqual(emptyLine(0, null), { kind: 'none' });
  // Events exist but the scope hides them.
  assert.deepEqual(emptyLine(3, latest), { kind: 'scope', text: 'no events in this scope' });
  // Junk: no key that is not a fleet key, unknown p falls back to run.
  const j = latestItem({ key: 'nope', text: 'x', p: 'weird' });
  assert.equal(j.key, null);
  assert.equal(j.p, 'run');
  assert.equal(latestItem({ text: '' }), null);
  const src = fs.readFileSync(path.join(ROOT, 'public/js/ui/tape.js'), 'utf8');
  assert.doesNotMatch(src, /no events yet/);
  assert.match(src, /peekModel\(store/);
});

// ---------------------------------------------------------------- T38: one hue for DOWN

test('tileTone: DOWN draws the trouble red (p1) whatever its members, other tiles their fixed tone', () => {
  assert.equal(TILE_FIXED_P.DOWN, 1);
  for (const [kind, pr] of [['builder-down', 'P1'], ['health-crit', 'P2'], ['builder-stale', 'P3'], ['audit-fork', 'P1']]) {
    for (const acked of [false, true]) {
      const t = byTile(tileModel([alarm(kind, pr, { acked })]), 'DOWN');
      assert.equal(tileTone(t), 1, `${kind} ${pr} acked=${acked}`);
      assert.equal(tileView(t).p, '1');
      assert.equal(t.p, alarmP(pr), 'the model keeps the worst priority (order, labels)');
    }
  }
  assert.equal(tileTone(byTile(tileModel([]), 'DOWN')), null, 'clear has no tone');
  assert.equal(tileView(byTile(tileModel([]), 'DOWN')).p, '');
  assert.equal(tileTone(byTile(tileModel([alarm('stuck', 'P3')]), 'STCK')), 2, 'stuck wants you: amber');
});

test('DOWN tile: the pulse never changes the fill, and p1 is the same red hue in both themes', () => {
  const css = read('public/css/annunciator.css');
  // unack and ack share one tone per priority, so the blink phase cannot pick another one.
  assert.match(css, /\.ann-tile\[data-p="1"\] \{ --ann-tone: var\(--p1\); \}/);
  // the blink runs on the ::after ring only; the tile itself has no animation.
  assert.match(css, /\.ann-tile\[data-unack\]\s*\{\s*animation:\s*none;\s*\}/);
  assert.match(css, /\.ann-tile\[data-unack\]::after\s*\{[^}]*animation:\s*lb-flash/);
  const tokens = read('public/css/tokens.css');
  const flash = /@keyframes lb-flash\s*\{([\s\S]*?)\n\}/.exec(tokens)[1];
  assert.doesNotMatch(flash, /background|color|filter/, 'lb-flash changes opacity only');
  const hues = [...tokens.matchAll(/--p1:\s*oklch\(\s*[\d.]+%\s+[\d.]+\s+([\d.]+)\s*\)/g)].map((m) => Number(m[1]));
  assert.ok(hues.length >= 2, 'p1 is set in dark and light');
  assert.equal(new Set(hues).size, 1, `one p1 hue across themes: ${hues}`);
  assert.ok(hues[0] < 40 || hues[0] > 340, 'p1 is a red');
});

// ---------------------------------------------------------------- runs night 4 T38: DOWN on a fresh copy

test('T38: one local builder, link up, no config: DOWN 0 even when the host wants a reboot', () => {
  // A fresh `:memory:` copy on a host with /var/run/reboot-required used to open with a red DOWN 1:
  // the builder's own `reboot` alarm (P4) sat on the DOWN tile while /api/map said `link: "up"`.
  const now = 1_000_000;
  const health = {
    at: now, rebootRequired: true,
    alarms: [
      { key: 'rebootRequired', level: 'warn', text: 'reboot required' },
      { key: 'disk', level: 'warn', text: 'disk / 86% used' },
    ],
  };
  const fleet = fleetOfOne({ sessions: [], lanes: [] }, health, now, { builder: { id: 'builder-a', code: 'BA' } });
  assert.equal(fleet.builders.length, 1);
  assert.equal(fleet.builders[0].state, 'up', 'the link is up');
  const alarms = derive(fleet, now);
  assert.deepEqual(alarms.map((a) => a.kind).sort(), ['health-warn', 'reboot'], 'the host notes are still alarms (the Box shows them)');
  const down = byTile(tileModel(alarms), 'DOWN');
  assert.equal(down.n, 0);
  assert.equal(tileTone(down), null, 'no red count');
  assert.equal(tileView(down).p, '');
  // Nothing at all: every tile is clear.
  assert.ok(tileModel(derive(fleetOfOne({}, null, now), now)).every((t) => t.n === 0));
  // A crit host check and a lost link still count.
  const crit = derive(fleetOfOne({}, { at: now, alarms: [{ key: 'disk', level: 'crit', text: 'disk / 97% used' }] }, now), now);
  assert.equal(byTile(tileModel(crit), 'DOWN').n, 1);
  assert.equal(byTile(tileModel([alarm('builder-down', 'P1')]), 'DOWN').n, 1);
});

test('T38: docs/design.md and README say what DOWN counts', () => {
  for (const f of ['docs/design.md', 'README.md']) {
    const t = read(f).replace(/\s+/g, ' ');
    assert.match(t, /DOWN counts a builder whose link is down or stale, a crit host check and an audit fork/, f);
    assert.match(t, /reboot[^.]*health warning[^.]*Box/i, `${f}: where the reboot hint goes`);
  }
});
