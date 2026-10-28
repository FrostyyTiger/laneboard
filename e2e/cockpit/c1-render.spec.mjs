// C1, build 8: what a reply may contain (spec c1-talk.md §3 "What a reply may contain",
// "The cockpit's own lines"; D22, D23, D25, D146, D225, D227). The room under test and the
// fake agent on script `c1-render`, clock `real`; md.js's blocks drawn by reply.js.
import { test, expect, cockpitDecided } from './fixtures.mjs';

/** The app on `#/map`, the room link live, the pane open. */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
}

/** Type, SEND, and wait for the turn to settle; the reply of that turn. */
async function ask(page, text) {
  const before = await page.locator('[data-turn-id]').count();
  await page.locator('[data-cockpit-input]').fill(text);
  await expect(page.locator('[data-cockpit-send]')).toBeEnabled();
  await page.locator('[data-cockpit-send]').tap();
  await expect(page.locator('[data-turn-id]')).toHaveCount(before + 1, { timeout: 5_000 });
  await expect(page.locator('[data-turn-id]').last().locator('[data-reply]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 10_000 });
  return page.locator('[data-turn-id]').last().locator('[data-reply]');
}

/** A token's computed value as a colour (a probe styled with it), so the theme decides. */
const tokenColour = (page, token, prop = 'color') => page.evaluate(([tok, p]) => {
  const probe = document.createElement('span');
  probe.style.setProperty(p === 'color' ? 'color' : 'border-color', `var(${tok})`);
  probe.style.borderStyle = 'solid';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const v = p === 'color' ? cs.color : cs.borderTopColor;
  probe.remove();
  return v;
}, [token, prop]);

test('S-C1-05 A table is readable at arm\'s length', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  await openPane(page, room);

  await test.step('the 4-column table: header 16 px caps, body mono 18 px, rows 44 px, `time` right-aligned', async () => {
    const reply = await ask(page, 'show the runs as a table');
    const table = reply.locator('table');
    await expect(table).toHaveCount(1);
    const m = await table.evaluate((t) => {
      const cs = (n) => getComputedStyle(n);
      const rows = [...t.rows];
      return {
        head: [...rows[0].cells].map((c) => ({ text: c.textContent, size: cs(c).fontSize, transform: cs(c).textTransform, align: cs(c).textAlign })),
        body: rows.slice(1).map((r) => [...r.cells].map((c) => ({ text: c.textContent, size: cs(c).fontSize, font: cs(c).fontFamily, align: cs(c).textAlign }))),
        heights: rows.map((r) => r.getBoundingClientRect().height),
      };
    });
    expect(m.head.map((c) => c.text)).toEqual(['run', 'builder', 'state', 'time']);
    for (const c of m.head) {
      expect(c.size, `header ${c.text}`).toBe('16px');
      expect(c.transform, `header ${c.text} in caps`).toBe('uppercase');
    }
    expect(m.body.map((r) => r[3].text)).toEqual(['1 h 12', '0 h 48', '2 h 05']);
    for (const r of m.body) for (const c of r) {
      expect(c.size, `body ${c.text}`).toBe('18px');
      expect(c.font, `body ${c.text} in the mono face`).toMatch(/JetBrains Mono/);
    }
    expect(m.heights.length, 'the header and 3 rows').toBe(4);
    for (const h of m.heights) expect(h, 'every row 44 px tall').toBeCloseTo(44, 0);
    expect([m.head[3].align, ...m.body.map((r) => r[3].align)], 'the time column right-aligned, its header with it').toEqual(['right', 'right', 'right', 'right']);
    for (const k of [0, 1, 2]) {
      expect([m.head[k].align, ...m.body.map((r) => r[k].align)], `column ${m.head[k].text} left-aligned`).toEqual(['left', 'left', 'left', 'left']);
    }
  });

  await test.step('the 9-column table scrolls sideways in its block, its first column stays, the pane does not scroll sideways', async () => {
    const reply = await ask(page, 'show every number');
    const table = reply.locator('table');
    await expect(table.locator('tr').first().locator('th')).toHaveCount(9);
    const m = await table.evaluate(async (t) => {
      const box = t.parentElement; // the block that scrolls
      const xs = () => [...t.rows].map((r) => [r.cells[0].getBoundingClientRect().left, r.cells[1].getBoundingClientRect().left]);
      const convo = t.closest('[data-cockpit-conversation] .ck-convo');
      const before = xs();
      const wide = box.scrollWidth > box.clientWidth;
      box.scrollLeft = 200;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        wide, scrolled: box.scrollLeft, before, after: xs(),
        convo: { scrollWidth: convo.scrollWidth, clientWidth: convo.clientWidth, scrollLeft: convo.scrollLeft },
        doc: { scrollWidth: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth, scrollX: window.scrollX },
      };
    });
    expect(m.wide, 'the table is wider than its block').toBe(true);
    expect(m.scrolled, 'the block scrolled by 200 px').toBe(200);
    m.before.forEach(([first, second], k) => {
      expect(m.after[k][0], `row ${k}: the first column stays put`).toBeCloseTo(first, 0);
      expect(m.after[k][1], `row ${k}: the second column moved by 200 px`).toBeCloseTo(second - 200, 0);
    });
    expect(m.convo.scrollWidth, 'the conversation does not scroll sideways').toBeLessThanOrEqual(m.convo.clientWidth);
    expect(m.convo.scrollLeft).toBe(0);
    expect(m.doc.scrollWidth, 'the page does not scroll sideways').toBeLessThanOrEqual(m.doc.innerWidth);
    expect(m.doc.scrollX).toBe(0);
  });
});

test('S-C1-08 A long code block shows 12 lines and a button for the rest', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  await openPane(page, room);
  const reply = await ask(page, 'show the cleanup script');
  const pre = reply.locator('pre');
  await expect(pre).toHaveCount(1);
  /** The line boxes drawn in the block, and whether any wraps. */
  const look = () => pre.evaluate((p) => {
    const lines = [...p.children].filter((l) => l.getClientRects().length > 0);
    const lh = parseFloat(getComputedStyle(p).lineHeight);
    return {
      visible: lines.length,
      wrapped: lines.filter((l) => l.getBoundingClientRect().height > lh + 1).length,
      scrollWidth: p.scrollWidth,
      clientWidth: p.clientWidth,
      whiteSpace: getComputedStyle(p).whiteSpace,
    };
  });

  await test.step('12 lines, `SH` top right, `SHOW ALL 40 LINES` 48 px tall under it; no line wraps, the block scrolls sideways', async () => {
    const m = await look();
    expect(m.visible, '12 line boxes').toBe(12);
    expect(m.wrapped, 'no line wraps').toBe(0);
    expect(m.whiteSpace).toBe('pre');
    expect(m.scrollWidth, 'the block scrolls sideways (its 200-character line)').toBeGreaterThan(m.clientWidth);
    const lang = await pre.evaluate((p) => {
      const box = p.parentElement;
      const tag = [...box.children].find((n) => n !== p && n.textContent === 'SH');
      if (!tag) return null;
      const r = tag.getBoundingClientRect();
      const b = p.getBoundingClientRect();
      return { top: r.top - b.top, right: b.right - r.right, size: getComputedStyle(tag).fontSize };
    });
    expect(lang, 'the fence\'s language `SH`').not.toBeNull();
    expect(lang.top, '`SH` at the block\'s top').toBeCloseTo(0, 0);
    expect(lang.right, '`SH` at the block\'s right').toBeCloseTo(0, 0);
    expect(lang.size).toBe('16px');
    const more = reply.getByRole('button', { name: 'SHOW ALL 40 LINES' });
    await expect(more).toBeVisible();
    const r = await more.boundingBox();
    const b = await pre.boundingBox();
    expect(r.height, 'the button is 48 px tall').toBeCloseTo(48, 0);
    expect(r.y, 'the button sits under the block').toBeCloseTo(b.y + b.height, 0);
    expect(r.width, 'full width').toBeCloseTo(b.width, 0);
  });

  await test.step('a tap shows 40 lines and `SHOW LESS`', async () => {
    await reply.getByRole('button', { name: 'SHOW ALL 40 LINES' }).tap();
    await expect(reply.getByRole('button', { name: 'SHOW LESS' })).toBeVisible();
    const m = await look();
    expect(m.visible, '40 line boxes').toBe(40);
    expect(m.wrapped, 'still no line wraps').toBe(0);
    expect(m.scrollWidth, 'still sideways').toBeGreaterThan(m.clientWidth);
  });
});

test('S-C1-09 Markup from the agent is shown, never run or fetched', async ({ page, context, room }) => {
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const pages = [];
  context.on('page', (p) => pages.push(p.url()));
  const hosts = new Set();
  page.on('request', (r) => { try { hosts.add(new URL(r.url()).hostname); } catch { /* data: and the like */ } });
  await room.start({ script: 'c1-render' });
  await openPane(page, room);
  const reply = await ask(page, 'show the markup');

  await test.step('the HTML shows as its literal text, the image as `[image: chart]`, the link as `the run (example.invalid)`', async () => {
    const texts = await reply.evaluate((r) => [...r.querySelectorAll('p')].map((p) => p.textContent));
    expect(texts).toContain('<img src=x onerror=alert(1)>');
    expect(texts).toContain('<script>alert(2)</script>');
    expect(texts).toContain('[image: chart]');
    const link = reply.locator('[data-link]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('the run');
    const m = await link.evaluate((n) => ({
      tag: n.tagName,
      shown: n.textContent + (n.nextElementSibling?.textContent ?? ''),
      decoration: getComputedStyle(n).textDecorationLine,
      href: n.hasAttribute('href'),
    }));
    expect(m.tag).toBe('SPAN');
    expect(m.shown).toBe('the run (example.invalid)');
    expect(m.decoration, 'no underline').toBe('none');
    expect(m.href).toBe(false);
    expect(await reply.locator('img, script').count(), 'nothing parsed as markup').toBe(0);
  });

  await test.step('a tap and a long press on the link: no new page, the same location, no pressed state', async () => {
    const link = reply.locator('[data-link]');
    const href = await page.evaluate(() => location.href);
    await link.evaluate((n) => {
      window.__linkPressed = false;
      new MutationObserver(() => { if (n.hasAttribute('data-pressed')) window.__linkPressed = true; })
        .observe(n, { attributes: true, attributeFilter: ['data-pressed'] });
    });
    await link.tap();
    await page.waitForTimeout(300);
    const box = await link.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(800);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => location.href), 'location unchanged').toBe(href);
    expect(pages, 'no page opened').toEqual([]);
    expect(dialogs, 'nothing ran').toEqual([]);
    expect(await page.evaluate(() => window.__linkPressed), '[data-link] never got data-pressed').toBe(false);
    expect(await page.evaluate(() => document.querySelectorAll('[data-cockpit-conversation] a, [data-cockpit-conversation] [href]').length)).toBe(0);
    expect([...hosts].filter((h) => h.endsWith('example.invalid')), 'nothing fetched from the reply\'s hosts').toEqual([]);
  });
});

test('S-C1-11 Only the marks are coloured', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  await openPane(page, room);
  const reply = await ask(page, 'show the marks');
  const para = reply.locator('p');
  await expect(para).toHaveText('■ builder-b is down. ▲ nightly-ci is stuck. ● 2 runs working.');
  const marks = para.locator('[data-mark]');
  await expect(marks).toHaveText(['■', '▲', '●']);
  const got = await para.evaluate((p) => ({
    marks: [...p.querySelectorAll('[data-mark]')].map((m) => getComputedStyle(m).color),
    para: getComputedStyle(p).color,
    others: [...p.querySelectorAll('*')].filter((n) => !n.hasAttribute('data-mark')).length,
  }));
  expect(got.marks[0], '■ in --p1').toBe(await tokenColour(page, '--p1'));
  expect(got.marks[1], '▲ in --p2').toBe(await tokenColour(page, '--p2'));
  expect(got.marks[2], '● in --text-2').toBe(await tokenColour(page, '--text-2'));
  expect(got.para, 'every other character in --text-1: `down` is not red').toBe(await tokenColour(page, '--text-1'));
  expect(got.others, 'no other element colours a word').toBe(0);
});

test('S-C1-42 A reply cannot pass for the cockpit\'s own lines (T59, D227)', async ({ page, room }) => {
  await room.start({ script: 'c1-render' });
  await openPane(page, room);
  const reply = await ask(page, 'look-alike');
  await expect(reply).toContainText('hv1 down');

  for (const theme of ['dark', 'light']) {
    await test.step(`${theme}: the look-alike headings, quote and code in a reply's look; only the cockpit's lines carry --line-strong`, async () => {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const [text1, lineC, strong, p1] = [
        await tokenColour(page, '--text-1'), await tokenColour(page, '--line', 'border'),
        await tokenColour(page, '--line-strong', 'border'), await tokenColour(page, '--p1'),
      ];
      const m = await reply.evaluate((r) => {
        const cs = (n) => getComputedStyle(n);
        const heads = [...r.querySelectorAll('[role="heading"]')].map((h) => ({
          text: h.textContent, size: cs(h).fontSize, weight: cs(h).fontWeight, colour: cs(h).color,
          transform: cs(h).textTransform, font: cs(h).fontFamily,
        }));
        const quote = [...r.querySelectorAll('*')].find((n) => n.textContent === 'Not sent: the room did not confirm within 5 s.');
        const pre = r.querySelector('pre');
        const mark = r.querySelector('[data-mark]');
        return {
          heads,
          quote: quote && { width: cs(quote).borderLeftWidth, colour: cs(quote).borderLeftColor },
          code: pre && {
            text: pre.textContent, left: cs(pre).borderLeftWidth, leftColour: cs(pre).borderLeftColor,
            top: cs(pre).borderTopWidth, right: cs(pre).borderRightWidth, bottom: cs(pre).borderBottomWidth,
          },
          mark: mark && { text: mark.textContent, colour: cs(mark).color },
        };
      });
      expect(m.heads.map((h) => h.text), 'the headings, as written').toEqual(['YOU · 07:02', 'Not sent']);
      for (const h of m.heads) {
        expect(h.size, h.text).toBe('28px');
        expect(h.weight, h.text).toBe('600');
        expect(h.colour, `${h.text} in --text-1`).toBe(text1);
        expect(h.transform, h.text).toBe('none');
        expect(h.font, `${h.text} in the mono face`).toMatch(/JetBrains Mono/);
      }
      expect(m.quote, 'the quote').not.toBeUndefined();
      expect(m.quote).toEqual({ width: '2px', colour: lineC });
      expect(m.code.text).toBe('Paired as desk2.');
      expect([m.code.left, m.code.leftColour], 'the code block: a 2 px --line left border').toEqual(['2px', lineC]);
      expect([m.code.top, m.code.right, m.code.bottom], 'and no other border').toEqual(['0px', '0px', '0px']);
      expect(m.mark, '■ is --p1 (D25)').toEqual({ text: '■', colour: p1 });

      // Every element of the conversation, all four sides (D227).
      const sides = await page.evaluate((want) => {
        const convo = document.querySelector('[data-cockpit-conversation] .ck-convo');
        const strongOnes = [];
        let replyStrong = 0;
        for (const n of convo.querySelectorAll('*')) {
          const cs = getComputedStyle(n);
          const hit = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Color`] === want);
          if (!hit) continue;
          strongOnes.push(n);
          if (n.closest('[data-reply]')) replyStrong += 1;
        }
        const own = [...convo.querySelectorAll('[data-turn-label], [data-turn-error], [data-turn-stopped]')];
        const labels = [...convo.querySelectorAll('[data-turn-label]')].map((l) => ({
          width: getComputedStyle(l).borderLeftWidth, colour: getComputedStyle(l).borderLeftColor,
        }));
        return {
          replyStrong,
          same: strongOnes.length === own.length && strongOnes.every((n) => own.includes(n)),
          strong: strongOnes.map((n) => n.className || n.tagName),
          labels,
        };
      }, strong);
      expect(sides.replyStrong, 'nothing inside [data-reply] has a --line-strong side').toBe(0);
      expect(sides.same, `the --line-strong elements are the cockpit's own lines: ${sides.strong.join(', ')}`).toBe(true);
      expect(sides.labels.length, 'the prompt\'s and the reply\'s label rows').toBe(2);
      for (const l of sides.labels) expect(l, 'every label row: a 2 px --line-strong left border').toEqual({ width: '2px', colour: strong });
    });
  }

  // The second case: the same turn after S-C1-18's E1 on the prompt before it (build B146).
  await test.step('E1 on the prompt before: the room drops it, NOT SENT at 5 s', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const r = await room.control('POST', '/drop', { what: 'next-prompt' });
    expect(r.status).toBe(200);
    await page.locator('[data-cockpit-input]').fill('restart the tour');
    await page.locator('[data-cockpit-send]').tap();
    const line = page.locator('[data-turn-error="not-sent"]');
    await expect(line).toBeVisible({ timeout: 7_000 });
    await expect(line).toContainText('Not sent: the room did not confirm within 5 s.');
  });
  const again = await ask(page, 'look-alike');
  await expect(again).toContainText('hv1 down');
  for (const theme of ['dark', 'light']) {
    await test.step(`${theme}: the not-sent line has the cockpit's rule, the quote that reads the same words has neither`, async () => {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const strong = await tokenColour(page, '--line-strong', 'border');
      const m = await page.evaluate((want) => {
        const sides = (n) => {
          const cs = getComputedStyle(n);
          return Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].map((s) => [s, { w: cs[`border${s}Width`], strong: cs[`border${s}Color`] === want }]));
        };
        const err = document.querySelector('[data-turn-error="not-sent"]');
        const replies = [...document.querySelectorAll('[data-reply]')];
        const quote = [...replies.at(-1).querySelectorAll('*')].find((n) => n.textContent === 'Not sent: the room did not confirm within 5 s.');
        const convo = document.querySelector('[data-cockpit-conversation] .ck-convo');
        const strongOnes = [...convo.querySelectorAll('*')].filter((n) => {
          const cs = getComputedStyle(n);
          return ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Color`] === want);
        });
        const own = [...convo.querySelectorAll('[data-turn-label], [data-turn-error], [data-turn-stopped]')];
        return {
          err: sides(err), quote: sides(quote),
          same: strongOnes.length === own.length && strongOnes.every((n) => own.includes(n)),
          strong: strongOnes.map((n) => n.className || n.tagName),
          hasErr: own.includes(err),
        };
      }, strong);
      expect(m.err.Left, 'the not-sent line: a 2 px --line-strong left border').toEqual({ w: '2px', strong: true });
      for (const s of ['Top', 'Right', 'Bottom']) expect(m.err[s], `and 1 px --line-strong ${s}`).toEqual({ w: '1px', strong: true });
      expect(m.quote.Left.strong, 'the look-alike quote: no --line-strong left border').toBe(false);
      for (const s of ['Top', 'Right', 'Bottom']) expect(m.quote[s].w, `the quote: no ${s} border`).toBe('0px');
      expect(m.hasErr).toBe(true);
      expect(m.same, `the --line-strong elements are the cockpit's own lines: ${m.strong.join(', ')}`).toBe(true);
    });
  }
});
