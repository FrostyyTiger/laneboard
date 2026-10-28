// C1, build 9: tool lines (spec c1-talk.md §5, §5.1; D24, D147, D226). The room under
// test and the fake agent on script `c1-render`, clock `real`; the words are
// public/js/core/tool-words.js's (its table is test/tool-words.test.mjs).
import { test, expect, cockpitDecided } from './fixtures.mjs';

/** Every frame the page receives on the room link, parsed, with the test's receive time. */
function recordFrames(page) {
  const frames = [];
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    ws.on('framereceived', ({ payload }) => {
      let msg = null;
      try { msg = JSON.parse(String(payload)); } catch { /* not JSON */ }
      frames.push({ at: Date.now(), msg });
    });
  });
  return frames;
}

/** The app on `#/map`, the room link live, the pane open. */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
}

/**
 * In the page, every 100 ms (the scenarios' poll): the last turn's tool lines (their
 * text and whether the `●` glyph shows) and `data-turn`, with the page's Date.now()
 * (the same clock as the test's frame times here). `tapAt` is the SEND tap.
 */
async function startSampler(page) {
  await page.evaluate(() => {
    const rec = { tapAt: null, samples: [], timer: null };
    const look = () => {
      const turn = [...document.querySelectorAll('[data-cockpit-conversation] [data-turn-label]')].at(-1)?.parentElement;
      const lines = turn ? [...turn.querySelectorAll('[data-tool-line]')] : [];
      rec.samples.push({
        t: Date.now(),
        turn: document.documentElement.dataset.turn,
        lines: lines.map((n) => ({ text: n.textContent, dot: getComputedStyle(n, '::before').content === '"●"' })),
      });
    };
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-cockpit-send]') && rec.tapAt === null) rec.tapAt = Date.now();
    }, true);
    rec.timer = setInterval(look, 100);
    window.__toolRec = rec;
  });
}
async function stopSampler(page) {
  return page.evaluate(() => {
    const rec = window.__toolRec;
    clearInterval(rec.timer);
    delete window.__toolRec;
    return { tapAt: rec.tapAt, samples: rec.samples };
  });
}

/** Type, SEND, wait for the turn to end; the frames of that turn by type. */
async function ask(page, frames, text) {
  const from = frames.length;
  await page.locator('[data-cockpit-input]').fill(text);
  await expect(page.locator('[data-cockpit-send]')).toBeEnabled();
  await page.locator('[data-cockpit-send]').tap();
  await expect.poll(() => frames.slice(from).some((f) => f.msg?.type === 'turn.end'), { timeout: 10_000 }).toBe(true);
  await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle');
  const echo = frames.slice(from).find((f) => f.msg?.type === 'turn.prompt' && f.msg.text === text);
  expect(echo, 'the room echoed the prompt').toBeTruthy();
  const turnId = echo.msg.turnId;
  const of = (type) => frames.slice(from).filter((f) => f.msg?.type === type && f.msg.turnId === turnId);
  return { turnId, of };
}

/** A token's computed colour (a probe styled with it), so the theme decides. */
const tokenColour = (page, token) => page.evaluate((tok) => {
  const p = document.createElement('span');
  p.style.color = `var(${tok})`;
  document.body.append(p);
  const c = getComputedStyle(p).color;
  p.remove();
  return c;
}, token);

/** The words of a line without S-C1-07's ` · k failed` and the running `…`. */
const wordsOf = (text) => text.replace(/…$/u, '').replace(/ · \d+ failed$/u, '');

/** Per call: its tool.start and tool.end frames (receive times and the room's stamps). */
function callTimes(of) {
  const ends = new Map(of('tool.end').map((f) => [f.msg.toolUseId, f]));
  return of('tool.start').map((s) => ({ input: s.msg.input, tool: s.msg.tool, start: s, end: ends.get(s.msg.toolUseId) }));
}

test('S-C1-06 Tool calls fold into one line each, with live counts', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  const frames = recordFrames(page);
  await openPane(page, room);
  await startSampler(page);
  const { turnId, of } = await ask(page, frames, 'check the sites');
  const rec = await stopSampler(page);
  const calls = callTimes(of);
  const fleet = calls.filter((c) => c.tool === 'mcp__laneboard__fleet');
  expect(fleet.map((c) => c.input.site), 'the script\'s three fleet calls').toEqual(['hv1', 'hv2', 'hv3']);
  const ends = of('tool.end');

  await test.step('the first line counts the fleet calls as they start, `●` and `…` while one runs', async () => {
    const first = rec.samples.filter((s) => s.lines.length > 0).map((s) => ({ ...s, line: s.lines[0] }));
    expect(first.length, 'samples with a tool line').toBeGreaterThan(5);
    // Every text the line showed, in order, once each.
    const seen = [];
    for (const s of first) if (seen.at(-1) !== wordsOf(s.line.text)) seen.push(wordsOf(s.line.text));
    expect(seen, `the line's words as the calls start: ${JSON.stringify(first.map((x) => [x.t, x.line.text]))}`).toEqual(['read the feed of hv1', 'read 2 feeds', 'read 3 feeds']);
    const started = (t) => fleet.filter((c) => c.start.at <= t).length;
    // A call ran over the whole poll before the sample: started 100 ms before it, not ended
    // by it (one frame's slack). Between one call's end and the next's start none runs.
    const runningOver = (t) => fleet.some((c) => c.start.at <= t - 100 && (!c.end || c.end.at > t + 20));
    for (const s of first) {
      const n = { 'read the feed of hv1': 1, 'read 2 feeds': 2, 'read 3 feeds': 3 }[wordsOf(s.line.text)];
      // The count follows the tool.start frames, one 100 ms poll of lag at most.
      expect(n, `at ${s.t}: "${s.line.text}"`).toBeGreaterThanOrEqual(started(s.t - 100));
      expect(n, `at ${s.t}: "${s.line.text}"`).toBeLessThanOrEqual(started(s.t + 20));
      if (runningOver(s.t)) {
        expect(s.line.dot, `at ${s.t}: ● while a fleet call runs`).toBe(true);
        expect(s.line.text.endsWith('…'), `at ${s.t}: "${s.line.text}" ends in …`).toBe(true);
      }
    }
    expect(first.some((s) => s.line.dot && s.line.text === 'read the feed of hv1…'), '● read the feed of hv1… was drawn').toBe(true);
    expect(first.some((s) => s.line.dot && wordsOf(s.line.text) === 'read 2 feeds'), '● read 2 feeds… was drawn').toBe(true);
    expect(first.some((s) => s.line.dot && wordsOf(s.line.text) === 'read 3 feeds'), '● read 3 feeds… was drawn').toBe(true);
    const afterThird = first.filter((s) => s.t >= fleet[2].end.at + 100);
    expect(afterThird.length, 'samples after the third call ended').toBeGreaterThan(0);
    for (const s of afterThird) {
      expect(wordsOf(s.line.text)).toBe('read 3 feeds');
      expect(s.line.text.endsWith('…'), 'no … once the third ended').toBe(false);
      expect(s.line.dot, 'no ● once the third ended').toBe(false);
    }
  });

  await test.step('`data-turn` is `working` while a call runs', async () => {
    const running = rec.samples.filter((s) => s.lines.some((l) => l.dot));
    expect(running.length).toBeGreaterThan(0);
    // A tool.end and the next tool.start land together; a sample within 100 ms of an end may
    // see the state and the line drawn one frame apart.
    const nearEnd = (t) => ends.some((e) => Math.abs(e.at - t) <= 100);
    for (const s of running) if (!nearEnd(s.t)) expect(s.turn, `at ${s.t}`).toBe('working');
  });

  await test.step('two tool lines above the text: the fleet line, then `looked at CI on main`', async () => {
    const turn = page.locator(`[data-turn-id="${turnId}"]`);
    const lines = turn.locator('[data-tool-line]');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(1)).toHaveText('looked at CI on main', { useInnerText: false });
    const order = await turn.locator('[data-reply]').evaluate((r) => [...r.children].map((n) => (n.matches('[data-tool-line]') ? 'tool' : n.textContent)));
    expect(order).toEqual(['tool', 'tool', 'hv1 and hv3 are fine; the feed of hv2 did not answer. CI on main is green.']);
    const ci = rec.samples.filter((s) => s.lines.length === 2).map((s) => s.lines[1]);
    expect(ci.some((l) => l.dot && l.text === 'looked at CI on main…'), '● looked at CI on main… while it ran').toBe(true);
    expect(await lines.evaluateAll((ns) => ns.map((n) => getComputedStyle(n, '::before').content)), 'no ● once all ended').not.toContain('"●"');
  });
});

test('S-C1-07 A tool line opens to show its calls; a failure stays grey', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  const frames = recordFrames(page);
  await openPane(page, room);
  const { turnId } = await ask(page, frames, 'check the sites');
  const line = page.locator(`[data-turn-id="${turnId}"] [data-tool-line]`).first();
  const grey = await tokenColour(page, '--text-2');
  const p1 = await tokenColour(page, '--p1');
  const p2 = await tokenColour(page, '--p2');

  await test.step('`read 3 feeds · 1 failed` in --text-2, no --p1 or --p2', async () => {
    await expect(line).toHaveText('read 3 feeds · 1 failed', { useInnerText: false });
    const colours = await line.evaluate((n) => [n, ...n.querySelectorAll('*')].map((e) => getComputedStyle(e).color));
    for (const c of colours) {
      expect(c, 'the line in --text-2').toBe(grey);
      expect([p1, p2]).not.toContain(c);
    }
  });

  await test.step('a tap shows 3 rows with their ms and ok / failed; a second tap hides them', async () => {
    await line.tap();
    const rows = line.locator('[data-tool-row]');
    await expect(rows).toHaveCount(3);
    const texts = await rows.allTextContents();
    expect(texts[0]).toMatch(/^fleet {2}\{"site":"hv1"\} {2}\d+ ms {2}ok$/);
    expect(texts[1]).toMatch(/^fleet {2}\{"site":"hv2"\} {2}\d+ ms {2}failed$/);
    expect(texts[2]).toMatch(/^fleet {2}\{"site":"hv3"\} {2}\d+ ms {2}ok$/);
    expect(await line.evaluate((n) => [...n.children].filter((c) => c.matches('[data-tool-row]')).length), 'the rows are the line\'s children').toBe(3);
    for (const c of await rows.evaluateAll((ns) => ns.map((n) => getComputedStyle(n).color))) expect(c, 'rows in --text-2').toBe(grey);
    expect(await line.evaluate((n) => getComputedStyle(n, '::after').content), 'open: −').toBe('"−"');
    await line.tap();
    await expect(rows).toHaveCount(0);
    expect(await line.evaluate((n) => getComputedStyle(n, '::after').content), 'closed: +').toBe('"+"');
  });

  await test.step('the row is ≥ 48 px tall, its `+`/`−` 20 px --text-2', async () => {
    const m = await line.evaluate((n) => ({
      h: n.getBoundingClientRect().height,
      size: getComputedStyle(n, '::after').fontSize,
      colour: getComputedStyle(n, '::after').color,
      tag: n.tagName, type: n.getAttribute('type'), touch: getComputedStyle(n).touchAction,
    }));
    expect(m.h).toBeGreaterThanOrEqual(48);
    expect(m.size).toBe('20px');
    expect(m.colour).toBe(grey);
    expect([m.tag, m.type, m.touch], 'a <button type="button">, touch-action: manipulation').toEqual(['BUTTON', 'button', 'manipulation']);
  });
});

test('S-C1-25 Parallel calls fold by tool, end in any order, and show their ms', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  const frames = recordFrames(page);
  await openPane(page, room);
  // [case, ends of hv1 / hv2 / ci in the script (ms after the prompt), starts]
  const CASES = [
    ['hv1 ends at 900 ms, hv2 at 400 ms', { hv1: [100, 900], hv2: [110, 400], ci: [120, 600] }],
    ['hv1 ends at 300 ms, hv2 at 900 ms (the ends reordered)', { hv1: [100, 300], hv2: [110, 900], ci: [120, 600] }],
  ];
  for (const [name, span] of CASES) {
    await test.step(name, async () => {
      await startSampler(page);
      const { turnId, of } = await ask(page, frames, 'how is the fleet?');
      const rec = await stopSampler(page);
      expect(rec.tapAt, 'the SEND tap was seen').not.toBeNull();
      const at = (ms) => rec.samples.find((s) => s.t >= rec.tapAt + ms);

      const s300 = at(300);
      expect(s300.lines.map((l) => [l.text, l.dot]), 'by 300 ms: two lines, both ●').toEqual([['read 2 feeds…', true], ['looked at CI on main…', true]]);
      const s700 = at(700);
      expect(s700.lines.map((l) => l.dot), 'at 700 ms only the first has ●').toEqual([true, false]);
      expect(wordsOf(s700.lines[0].text)).toBe('read 2 feeds');
      expect(s700.lines[1].text).toBe('looked at CI on main');

      const lines = page.locator(`[data-turn-id="${turnId}"] [data-tool-line]`);
      await expect(lines).toHaveCount(2);
      await expect(lines.nth(0)).toHaveText('read 2 feeds · 1 failed', { useInnerText: false });
      await expect(lines.nth(1)).toHaveText('looked at CI on main', { useInnerText: false });
      expect(await lines.evaluateAll((ns) => ns.map((n) => getComputedStyle(n, '::before').content)), 'no ● at the end').not.toContain('"●"');

      // The calls' ms: endedAt − startedAt of the room's frames, the scripted span plus at most 100 ms.
      const calls = callTimes(of);
      const ms = (c) => Date.parse(c.end.msg.endedAt) - Date.parse(c.start.msg.startedAt);
      const bySite = Object.fromEntries(calls.filter((c) => c.input.site).map((c) => [c.input.site, c]));
      for (const site of ['hv1', 'hv2']) {
        const [a, b] = span[site];
        expect(ms(bySite[site]), `${site}: at least the scripted ${b - a} ms`).toBeGreaterThanOrEqual(b - a);
        expect(ms(bySite[site]), `${site}: at most 100 ms more`).toBeLessThanOrEqual(b - a + 100);
        const received = bySite[site].end.at - bySite[site].start.at;
        expect(received, `${site}: the frames came the scripted span apart`).toBeGreaterThanOrEqual(b - a - 50);
      }
      await lines.nth(0).tap();
      const rows = lines.nth(0).locator('[data-tool-row]');
      await expect(rows).toHaveCount(2);
      expect(await rows.allTextContents()).toEqual([
        `fleet  {"site":"hv1"}  ${ms(bySite.hv1)} ms  ok`,
        `fleet  {"site":"hv2"}  ${ms(bySite.hv2)} ms  failed`,
      ]);
      await lines.nth(0).tap();
      await expect(rows).toHaveCount(0);
    });
  }
});

test('S-C1-35 Tool lines from odd input, and the words module\'s unit test', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  const frames = recordFrames(page);
  await openPane(page, room);
  const { turnId } = await ask(page, frames, 'read the odd ones');
  const lines = page.locator(`[data-turn-id="${turnId}"] [data-tool-line]`);
  await expect(lines).toHaveCount(4);
  expect(await lines.evaluateAll((ns) => ns.map((n) => n.textContent))).toEqual([
    'read laneboard',
    'looked at run 7',
    'looked at the lanes',
    'looked at CI on ci-fix/very-long-branch-name-for…',
  ]);
  const grey = await tokenColour(page, '--text-2');
  for (const m of await lines.evaluateAll((ns) => ns.map((n) => ({ colour: getComputedStyle(n).color, glyph: getComputedStyle(n, '::before').content })))) {
    expect(m.colour, 'in --text-2').toBe(grey);
    expect(m.glyph, 'no ●').not.toBe('"●"');
  }
});

/** The tool lines of a turn as they stand: words, `data-denied`, colour and the `●` glyph. */
const linesOf = (page, turnId) => page.locator(`[data-turn-id="${turnId}"] [data-tool-line]`).evaluateAll((ns) => ns.map((n) => ({
  text: n.textContent,
  denied: n.getAttribute('data-denied'),
  colour: getComputedStyle(n).color,
  glyph: getComputedStyle(n, '::before').content,
})));

test('S-C1-30 A shell call is refused and shows as a grey `tried` line (pending Q-O23)', async ({ page, room, fakeAgent }) => {
  await room.start({ script: 'c1-render' });
  const frames = recordFrames(page);
  await openPane(page, room);
  await startSampler(page);
  const { turnId, of } = await ask(page, frames, 'clean up the logs');
  const rec = await stopSampler(page);
  const grey = await tokenColour(page, '--text-2');
  const turn = page.locator(`[data-turn-id="${turnId}"]`);
  const denied = turn.locator('[data-tool-line][data-denied="true"]');

  await test.step('by 700 ms: two `tried Bash, not allowed` lines, not folded, then the text', async () => {
    expect(rec.tapAt, 'the SEND tap was seen').not.toBeNull();
    const s700 = rec.samples.find((s) => s.t >= rec.tapAt + 700);
    expect(s700, 'a sample at 700 ms').toBeTruthy();
    expect(s700.lines.map((l) => [l.text, l.dot]), 'at 700 ms').toEqual([['tried Bash, not allowed', false], ['tried Bash, not allowed', false]]);
    await expect(denied).toHaveCount(2);
    await expect(turn.locator('[data-tool-line]')).toHaveCount(2);
    const order = await turn.locator('[data-reply]').evaluate((r) => [...r.children].map((n) => (n.matches('[data-tool-line]') ? 'tool' : n.textContent)));
    expect(order).toEqual(['tool', 'tool', 'I cannot run commands here; I can only look.']);
    expect(of('tool.end').map((f) => f.msg.denied), 'the room marked both calls refused').toEqual([true, true]);
  });

  await test.step('in --text-2, no `●`, no `…`, no ` · failed`', async () => {
    for (const l of await linesOf(page, turnId)) {
      expect(l.text, 'exactly the tried words').toBe('tried Bash, not allowed');
      expect(l.denied).toBe('true');
      expect(l.colour, 'in --text-2').toBe(grey);
      expect(l.glyph, 'no ●').not.toBe('"●"');
    }
  });

  await test.step('`READY` and no line of §10', async () => {
    await expect(page.locator('[data-cockpit-turn]')).toHaveText('READY');
    // §10's lines: an error end line in the turn, the status line (kept in the pane, hidden), the line slot's error.
    await expect(page.locator('[data-turn-error]')).toHaveCount(0);
    await expect(page.locator('[data-cockpit-status]')).toBeHidden();
    await expect(page.locator('[data-cockpit-line][data-line="error"]')).toHaveCount(0);
  });

  await test.step('opened: `Bash  <whole input>  refused`, wrapped inside the text column', async () => {
    await denied.first().tap();
    const row = denied.first().locator('[data-tool-row]');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText('Bash  {"command":"rm -rf /var/log/laneboard/old && echo done"}  refused', { useInnerText: false });
    const fit = await row.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth, ws: getComputedStyle(n).whiteSpace }));
    expect(fit.sw, `scrollWidth ${fit.sw} ≤ clientWidth ${fit.cw}`).toBeLessThanOrEqual(fit.cw);
    expect(fit.ws).toBe('pre-wrap');
  });

  await test.step('the launch line: --strict-mcp-config, --allowedTools, --permission-prompts none, no Bash', async () => {
    const argv = fakeAgent.log().filter((l) => l.kind === 'start')[0]?.argv;
    expect(Array.isArray(argv), 'the fake agent logged its start').toBe(true);
    const strict = argv.indexOf('--strict-mcp-config');
    const allowed = argv.indexOf('--allowedTools');
    const prompts = argv.indexOf('--permission-prompts');
    expect(strict, `--strict-mcp-config in ${JSON.stringify(argv)}`).toBeGreaterThanOrEqual(0);
    expect(allowed, '--allowedTools after --strict-mcp-config').toBeGreaterThan(strict);
    expect(argv[allowed + 1]).toBe('mcp__laneboard__*,Read,Grep,Glob');
    expect(prompts, '--permission-prompts after --allowedTools').toBeGreaterThan(allowed);
    expect(argv[prompts + 1]).toBe('none');
    expect(argv.filter((a) => a.includes('Bash')), 'no argv element holds Bash').toEqual([]);
  });
});

test('S-C1-31 A secret in a tool\'s input never reaches the screen', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  const raw = [];
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    ws.on('framereceived', ({ payload }) => raw.push(String(payload)));
  });
  const frames = recordFrames(page);
  await openPane(page, room);
  await startSampler(page);
  const { turnId, of } = await ask(page, frames, 'find the token');
  const rec = await stopSampler(page);
  const lines = page.locator(`[data-turn-id="${turnId}"] [data-tool-line]`);

  await test.step('by 700 ms: `searched the files` and `tried WebFetch, not allowed`', async () => {
    const s700 = rec.samples.find((s) => s.t >= rec.tapAt + 700);
    expect(s700, 'a sample at 700 ms').toBeTruthy();
    expect(s700.lines.map((l) => l.text)).toEqual(['searched the files', 'tried WebFetch, not allowed']);
    await expect(lines).toHaveCount(2);
    expect(await lines.evaluateAll((ns) => ns.map((n) => n.getAttribute('data-denied')))).toEqual([null, 'true']);
  });

  await test.step('opened, the rows show `[redacted]`, the Grep call its ms', async () => {
    const grep = of('tool.start').find((f) => f.msg.tool === 'Grep');
    const grepEnd = of('tool.end').find((f) => f.msg.toolUseId === grep.msg.toolUseId);
    const ms = Date.parse(grepEnd.msg.endedAt) - Date.parse(grep.msg.startedAt);
    expect(ms, 'at least the scripted 200 ms').toBeGreaterThanOrEqual(200);
    expect(ms, 'at most 300 ms').toBeLessThanOrEqual(300);
    await lines.nth(0).tap();
    await lines.nth(1).tap();
    await expect(lines.nth(0).locator('[data-tool-row]')).toHaveText(
      `Grep  {"pattern":"Authorization: Bearer [redacted]","path":"/etc/laneboard"}  ${ms} ms  ok`, { useInnerText: false });
    await expect(lines.nth(1).locator('[data-tool-row]')).toHaveText(
      'WebFetch  {"url":"https://example.invalid/hook?token=[redacted]&lb_sig=[redacted]"}  refused', { useInnerText: false });
  });

  await test.step('no frame the page received holds a secret', async () => {
    const tools = raw.filter((p) => /"type":"tool\.(start|end)"/.test(p));
    expect(tools.length, 'tool.start and tool.end frames were seen').toBeGreaterThanOrEqual(4);
    for (const secret of ['eyJhbGci', 'abc123DEF', 'Q7wErTy12', 'Zq9Xw4Vr']) {
      expect(raw.filter((p) => p.includes(secret)), `no frame holds ${secret}`).toEqual([]);
    }
    expect(await page.locator('[data-cockpit-conversation]').evaluate((n) => n.textContent)).not.toMatch(/eyJhbGci|abc123DEF|Q7wErTy12|Zq9Xw4Vr/);
  });
});
