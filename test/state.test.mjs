import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTmuxField, normaliseEntry, indexBy } from '../server/collector/registry.mjs';
import { deriveState, paneHeuristic, attentionScore, promptReadiness } from '../server/state.mjs';
import { parseStatus } from '../server/collector/git.mjs';
import { trimBlank, exactTarget } from '../server/collector/tmux.mjs';
import { stripAnsi, isSafeSessionName, encodeProjectDir } from '../server/util.mjs';

test('parseTmuxField handles plain names', () => {
  assert.deepEqual(parseTmuxField('kubic:@22.%22'), { session: 'kubic', windowId: '@22', paneId: '%22' });
});

test('parseTmuxField handles names with spaces and parentheses', () => {
  assert.deepEqual(parseTmuxField('Big research for Treuhand stuff (large):@14.%14'), {
    session: 'Big research for Treuhand stuff (large)',
    windowId: '@14',
    paneId: '%14',
  });
});

test('parseTmuxField handles a name containing a colon', () => {
  // Splitting on the FIRST colon would give "weird" instead of the full name.
  assert.deepEqual(parseTmuxField('weird:name:@3.%9'), { session: 'weird:name', windowId: '@3', paneId: '%9' });
});

test('parseTmuxField tolerates missing and malformed values', () => {
  assert.deepEqual(parseTmuxField(undefined), { session: null, windowId: null, paneId: null });
  assert.deepEqual(parseTmuxField(''), { session: null, windowId: null, paneId: null });
  assert.equal(parseTmuxField('no-tmux-marker').session, 'no-tmux-marker');
  assert.equal(parseTmuxField('half:@7').paneId, null);
});

test('normaliseEntry tolerates missing and extra fields', () => {
  const e = normaliseEntry({ pid: 42, tmux: 'a b:@1.%1', somethingNew: true }, 42);
  assert.equal(e.pid, 42);
  assert.equal(e.tmuxSession, 'a b');
  assert.equal(e.sessionId, null);
  assert.equal(e.status, null);
  assert.equal('somethingNew' in e, false, 'unknown fields are not passed through');
});

test('normaliseEntry falls back to the filename pid and rejects junk', () => {
  assert.equal(normaliseEntry({ tmux: 'x:@1.%1' }, 99).pid, 99);
  assert.equal(normaliseEntry(null, 99), null);
  assert.equal(normaliseEntry({ pid: 'nope' }, NaN), null);
});

test('indexBy keeps the newest entry when two claims collide', () => {
  const map = indexBy(
    [
      { tmuxSession: 'dup', startedAt: 100, pid: 1 },
      { tmuxSession: 'dup', startedAt: 200, pid: 2 },
      { tmuxSession: null, startedAt: 300, pid: 3 },
    ],
    (e) => e.tmuxSession
  );
  assert.equal(map.size, 1);
  assert.equal(map.get('dup').pid, 2);
});

test('deriveState: hooks beat the registry', () => {
  const r = deriveState({
    hook: { state: 'waiting_permission', at: Date.now() },
    registryStatus: 'idle',
    paneCmd: 'claude',
    claudeAlive: true,
    now: Date.now(),
  });
  assert.deepEqual(r, { state: 'waiting_permission', source: 'hook' });
});

test('deriveState: a stale hook falls through to the registry', () => {
  const now = Date.now();
  const r = deriveState({
    hook: { state: 'waiting_permission', at: now - 11 * 60 * 1000 },
    registryStatus: 'busy',
    paneCmd: 'claude',
    claudeAlive: true,
    now,
  });
  assert.deepEqual(r, { state: 'working', source: 'registry' });
});

test('deriveState: registry maps busy/idle/shell', () => {
  const base = { hook: null, paneCmd: 'claude', claudeAlive: true, now: Date.now() };
  assert.equal(deriveState({ ...base, registryStatus: 'busy' }).state, 'working');
  assert.equal(deriveState({ ...base, registryStatus: 'idle' }).state, 'done');
  assert.equal(deriveState({ ...base, registryStatus: 'shell' }).state, 'shell');
});

test('deriveState: a dead claude pid in a live tmux session is dead', () => {
  const r = deriveState({ hook: null, registryStatus: null, paneCmd: 'claude', claudeAlive: false, now: Date.now() });
  assert.deepEqual(r, { state: 'dead', source: 'proc' });
});

test('deriveState: a bare shell pane is shell, not dead', () => {
  const r = deriveState({ hook: null, registryStatus: null, paneCmd: 'bash', claudeAlive: false, now: Date.now() });
  assert.deepEqual(r, { state: 'shell', source: 'pane' });
});

test('deriveState: no registry entry falls back to the pane heuristic', () => {
  const r = deriveState({
    hook: null,
    registryStatus: null,
    paneCmd: 'claude',
    claudeAlive: true,
    paneLines: [' \u001b[94m❯\u001b[39m \u001b[37m1.\u001b[39m Yes, I trust this folder', ' Enter to confirm'],
    now: Date.now(),
  });
  assert.deepEqual(r, { state: 'waiting_permission', source: 'heuristic' });
});

test('paneHeuristic sees through per-word ANSI colouring', () => {
  // tmux `capture-pane -e` splits phrases with escape codes; matching must strip them.
  const line = ' \u001b[37mEnter\u001b[39m \u001b[37mto\u001b[39m \u001b[37mconfirm\u001b[39m';
  assert.equal(paneHeuristic([line]), 'waiting_permission');
});

test('paneHeuristic distinguishes a live spinner from a finished one', () => {
  assert.equal(paneHeuristic(['✻ Composing… (31m 33s · ↓ 26.3k tokens)']), 'working');
  assert.equal(paneHeuristic(['✻ Cooked for 40s', '❯ ']), 'done');
});

test('paneHeuristic finds the idle prompt and gives up gracefully', () => {
  assert.equal(paneHeuristic(['some output', '❯ ']), 'done');
  assert.equal(paneHeuristic([]), null);
  assert.equal(paneHeuristic(['nothing interesting here']), null);
});

test('paneHeuristic only looks at the last 15 non-blank lines', () => {
  const stale = ['Do you want to proceed?', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)];
  assert.notEqual(paneHeuristic(stale), 'waiting_permission');
});

test('attentionScore ranks waiting above a fresh done above a stale done', () => {
  const now = Date.now();
  assert.equal(attentionScore({ state: 'waiting_permission' }, now), 100);
  assert.equal(attentionScore({ state: 'waiting_question' }, now), 90);
  assert.equal(attentionScore({ state: 'done', activity: { lastAssistant: 'hi' }, stateSince: now }, now), 50);
  assert.equal(
    attentionScore({ state: 'done', activity: { lastAssistant: 'hi' }, stateSince: now - 3 * 3600e3 }, now),
    20
  );
  assert.equal(attentionScore({ state: 'done', activity: { lastAssistant: '' }, stateSince: now }, now), 0);
  assert.equal(attentionScore({ state: 'working' }, now), 0);
});

test('a session finished over 24 h ago leaves the attention queue', () => {
  // Stage 4 review amendment: without this the queue listed 13 of 17 sessions.
  const now = Date.now();
  const old = (h) => ({ state: 'done', activity: { lastAssistant: 'hi' }, stateSince: now - h * 3600e3 });
  assert.equal(attentionScore(old(1.9), now), 50);
  assert.equal(attentionScore(old(2.1), now), 20);
  assert.equal(attentionScore(old(23.9), now), 20);
  assert.equal(attentionScore(old(24.1), now), 0);
  assert.equal(attentionScore(old(305), now), 0, 'the 12-day-old sessions on this box must not appear');
});

test('a waiting session never ages out of the queue', () => {
  const now = Date.now();
  assert.equal(attentionScore({ state: 'waiting_permission', stateSince: now - 305 * 3600e3 }, now), 100);
  assert.equal(attentionScore({ state: 'waiting_question', stateSince: now - 305 * 3600e3 }, now), 90);
});

test('parseStatus reads branch, ahead/behind and dirty count', () => {
  const out = [
    '# branch.oid 2fa866ad0000000000000000000000000000',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb file.txt',
    '? untracked.txt',
  ].join('\n');
  const info = parseStatus(out);
  assert.equal(info.branch, 'main');
  assert.equal(info.ahead, 2);
  assert.equal(info.behind, 1);
  assert.equal(info.dirty, 2);
  assert.equal(info.isRepo, true);
});

test('parseStatus labels a detached head', () => {
  const info = parseStatus('# branch.oid abcdef1234\n# branch.head (detached)\n');
  assert.equal(info.branch, 'detached@abcdef12');
});

test('trimBlank drops blank padding around a detached TUI pane', () => {
  assert.deepEqual(trimBlank(['', '  ', 'a', '', 'b', '', '   ']), ['a', '', 'b']);
  assert.deepEqual(trimBlank(['', '']), []);
});

test('stripAnsi removes CSI and OSC 8 hyperlinks', () => {
  const s = ' \u001b[37m\u001b]8;id=x;https://example.com\u001b\\Security guide\u001b[39m\u001b]8;;\u001b\\';
  assert.equal(stripAnsi(s).trim(), 'Security guide');
});

test('isSafeSessionName accepts real names and rejects injection', () => {
  assert.equal(isSafeSessionName('Big research for Treuhand stuff (large)'), true);
  assert.equal(isSafeSessionName('kubic plan a'), true);
  assert.equal(isSafeSessionName('a;rm -rf /'), false);
  assert.equal(isSafeSessionName('$(whoami)'), false);
  assert.equal(isSafeSessionName(''), false);
  assert.equal(isSafeSessionName(null), false);
});

test('encodeProjectDir matches the ~/.claude/projects naming', () => {
  assert.equal(
    encodeProjectDir('/home/user/code/laneboard'),
    '-home-user-code-laneboard'
  );
});

test('exactTarget defeats tmux prefix matching', () => {
  // `-t _laneboard` matches `_laneboard-test` too; `-t =_laneboard` does not.
  assert.equal(exactTarget('_laneboard'), '=_laneboard');
  assert.equal(exactTarget('kubic'), '=kubic');
});

test('promptReadiness refuses to type into the trust dialog', () => {
  // ADCS project has been stuck on exactly this for 13 days; typing a prompt
  // here would answer the dialog, not Claude.
  const trust = [
    ' Quick safety check: Is this a project you created or one you trust?',
    ' \u001b[94m\u276f\u001b[39m 1. Yes, I trust this folder',
    '   2. No, exit',
    ' Enter to confirm \u00b7 Esc to cancel',
  ];
  assert.equal(promptReadiness(trust), 'trust_dialog');
});

test('promptReadiness recognises a settled input box', () => {
  assert.equal(promptReadiness(['some output', '\u2500\u2500\u2500', '\u276f ', '\u2500\u2500\u2500']), 'ready');
});

test('promptReadiness treats a dim placeholder in the box as empty (Claude 2.1.278)', () => {
  // Captured from a fresh session on a real host: prompt char, NBSP,
  // then the suggestion in dim.
  const box = ['\x1b[38;5;244m\u2500\u2500\u2500', '\x1b[39m\u276f\u00a0\x1b[2mTry "how do I log an error?"', '\x1b[0m\u2500\u2500\u2500'];
  assert.equal(promptReadiness(box), 'ready');
  // Text the user typed is not dim, and a box with text in it is not empty.
  assert.equal(promptReadiness(['\u2500\u2500\u2500', '\x1b[39m\u276f\u00a0half a prompt', '\u2500\u2500\u2500']), 'not_ready');
});

test('promptReadiness refuses while a permission dialog is up', () => {
  assert.equal(promptReadiness(['Do you want to proceed?', '\u276f 1. Yes']), 'dialog');
});

test('promptReadiness says not_ready for a still-painting TUI', () => {
  assert.equal(promptReadiness(['\u273b Composing\u2026 (2s)']), 'not_ready');
  assert.equal(promptReadiness([]), 'unknown');
});
