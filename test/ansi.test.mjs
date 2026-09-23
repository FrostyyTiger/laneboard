import test from 'node:test';
import assert from 'node:assert/strict';

import { ansiLineToHtml, escapeHtml, collapseRules, previewLineToHtml } from '../server/ansi.mjs';

const ESC = '\u001b';

test('plain text passes through unchanged', () => {
  assert.equal(ansiLineToHtml('hello world'), 'hello world');
  assert.equal(ansiLineToHtml(''), '');
});

test('HTML is escaped — pane content is untrusted', () => {
  assert.equal(ansiLineToHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(ansiLineToHtml(`${ESC}[31m<b>&</b>`), '<span style="color:#e06c75">&lt;b&gt;&amp;&lt;/b&gt;</span>');
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});

test('the basic 30-37 colours render', () => {
  assert.equal(ansiLineToHtml(`${ESC}[32mgreen${ESC}[0m`), '<span style="color:#98c379">green</span>');
});

test('bright 90-97 colours are distinct from 30-37', () => {
  const dim = ansiLineToHtml(`${ESC}[31mx`);
  const bright = ansiLineToHtml(`${ESC}[91mx`);
  assert.notEqual(dim, bright);
});

test('bold, dim, italic and underline map to CSS', () => {
  assert.match(ansiLineToHtml(`${ESC}[1mx`), /font-weight:600/);
  assert.match(ansiLineToHtml(`${ESC}[2mx`), /opacity:\.65/);
  assert.match(ansiLineToHtml(`${ESC}[3mx`), /font-style:italic/);
  assert.match(ansiLineToHtml(`${ESC}[4mx`), /text-decoration:underline/);
});

test('reset and the individual off-codes clear state', () => {
  assert.equal(ansiLineToHtml(`${ESC}[31ma${ESC}[0mb`), '<span style="color:#e06c75">a</span>b');
  assert.equal(ansiLineToHtml(`${ESC}[1ma${ESC}[22mb`), '<span style="font-weight:600">a</span>b');
  assert.equal(ansiLineToHtml(`${ESC}[31ma${ESC}[39mb`), '<span style="color:#e06c75">a</span>b');
});

test('background colours render and 49 clears them', () => {
  assert.match(ansiLineToHtml(`${ESC}[41mx`), /background:#e06c75/);
  assert.equal(ansiLineToHtml(`${ESC}[41ma${ESC}[49mb`), '<span style="background:#e06c75">a</span>b');
});

test('256-colour and truecolour forms are understood', () => {
  assert.match(ansiLineToHtml(`${ESC}[38;5;196mx`), /color:rgb\(255,0,0\)/);
  assert.match(ansiLineToHtml(`${ESC}[38;2;10;20;30mx`), /color:rgb\(10,20,30\)/);
  assert.match(ansiLineToHtml(`${ESC}[38;5;250mx`), /color:rgb\(188,188,188\)/);
});

test('inverse swaps foreground and background', () => {
  assert.match(ansiLineToHtml(`${ESC}[31m${ESC}[7mx`), /background:#e06c75/);
});

test('non-SGR escapes are dropped, not printed', () => {
  // Cursor moves, erase-line and OSC 8 hyperlinks all appear in captured panes.
  assert.equal(ansiLineToHtml(`${ESC}[2Kclean`), 'clean');
  assert.equal(ansiLineToHtml(`${ESC}[10;5Hclean`), 'clean');
  assert.equal(ansiLineToHtml(`${ESC}]8;id=x;https://e.com${ESC}\\link${ESC}]8;;${ESC}\\`), 'link');
});

test('per-word colouring reassembles into readable text', () => {
  // This is exactly what `tmux capture-pane -e` produces.
  const line = `${ESC}[37mEnter${ESC}[39m ${ESC}[37mto${ESC}[39m ${ESC}[37mconfirm${ESC}[39m`;
  const html = ansiLineToHtml(line);
  assert.equal(html.replace(/<[^>]+>/g, ''), 'Enter to confirm');
});

test('style never leaks between lines', () => {
  // Each line is converted independently, so an unterminated colour cannot
  // bleed down the whole preview block.
  assert.equal(ansiLineToHtml('after'), 'after');
  ansiLineToHtml(`${ESC}[31munterminated`);
  assert.equal(ansiLineToHtml('after'), 'after');
});

test('malformed escapes do not throw or hang', () => {
  assert.doesNotThrow(() => ansiLineToHtml(`${ESC}[`));
  assert.doesNotThrow(() => ansiLineToHtml(`${ESC}[999999m x`));
  assert.doesNotThrow(() => ansiLineToHtml(`${ESC}]8;unterminated`));
  assert.doesNotThrow(() => ansiLineToHtml(`${ESC}`));
});

test('a full-width rule is collapsed so a card cannot scroll sideways', () => {
  const rule = '─'.repeat(160);
  assert.equal(collapseRules(rule).length, 48);
  assert.equal(collapseRules(rule, 20).length, 20);
});

test('collapseRules leaves short runs and normal text alone', () => {
  assert.equal(collapseRules('ab───cd'), 'ab───cd');
  assert.equal(collapseRules('no box drawing here'), 'no box drawing here');
  assert.equal(collapseRules(''), '');
});

test('collapseRules handles every rule character Claude draws', () => {
  for (const ch of ['─', '━', '═', '┄', '╬']) {
    assert.equal(collapseRules(ch.repeat(100), 10).length, 10, ch);
  }
});

test('collapseRules does not merge runs of different characters', () => {
  const mixed = '─'.repeat(20) + '═'.repeat(20);
  assert.equal(collapseRules(mixed, 5), '─'.repeat(5) + '═'.repeat(5));
});

test('previewLineToHtml right-trims, collapses and escapes', () => {
  const line = `─`.repeat(120) + '   ';
  const html = previewLineToHtml(line, 12);
  assert.equal(html, '─'.repeat(12));
  assert.equal(previewLineToHtml('<b>   '), '&lt;b&gt;');
});
