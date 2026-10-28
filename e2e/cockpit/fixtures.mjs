// The cockpit's Playwright fixtures (spec slices.md §2, stand-ins.md §1-§4):
//
//   room       the room under test (stand-ins.md §1): `await room.start({turns: 3})` boots
//              `mode: builder` + `cockpit.agent` through test/helpers/boot.mjs with
//              entry ROOM_UNDER_TEST, the fake agent on `fakeAgent`'s dir, `stt.url: none`
//              (D265) and the demo topology on the Map; stopped after the test
//   fakeAgent  the fake agent's FAKE_AGENT_DIR (stand-ins.md §2.1): `.use('c1-render')`, `.log()`
//   fakeSpeech the fake speech (§3), started on demand: `await fakeSpeech.start('c2-…')`;
//              no C1 test starts it (D265)
//   demoHub    the demo fleet (test/tools/demo-fleet.mjs), started on demand: `await demoHub.start()`
//   clock      one test clock for page and room: `await clock.install(page, room, iso)`,
//              `await clock.advance(ms)` (page.clock.runFor, then the room's POST /clock)
//
// One room per test, not per file (build B112): a scenario often needs a second
// room (S-C1-26 restarts with an empty conversation), and a fresh room keeps one
// test's turns out of the next.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { boot, control, freePort, ROOM_UNDER_TEST, ROOT } from '../../test/helpers/boot.mjs';
import { writeDemoMap } from '../../test/helpers/demo-hub.mjs';
import { readFakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';
import { startFakeSpeech } from '../../test/cockpit/stand-ins/fake-speech.mjs';
import { seededTurns, conversationFiles } from '../../test/cockpit/fixtures/conversation.mjs';

export { expect };

export const FAKE_AGENT = path.join(ROOT, 'test', 'cockpit', 'stand-ins', 'fake-agent.mjs');
export const SCRIPTS = path.join(ROOT, 'test', 'cockpit', 'scripts');
/** The Wall page (screens.md §9.3: the one place its path appears). */
export const WALL_PAGE = '/galaxy.html';
/** The app's views in `VIEWS` (public/js/core/router.js), in the order S-SCR-09 names them. */
export const VIEWS = ['map', 'board', 'inbox', 'packages', 'morning', 'credit', 'box', 'audit', 'runs'];

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function makeFakeAgent() {
  const dir = tmp('lb-fake-agent-');
  return {
    dir,
    /** Copy test/cockpit/scripts/<name>.json to script.json (re-read at every prompt). */
    use(name) { fs.copyFileSync(path.join(SCRIPTS, `${name}.json`), path.join(dir, 'script.json')); },
    /** Change the script in place (stand-ins.md §2.4: the fake reads it each time), e.g. `start.login`. */
    edit(fn) {
      const file = path.join(dir, 'script.json');
      const sc = JSON.parse(fs.readFileSync(file, 'utf8'));
      fn(sc);
      fs.writeFileSync(file, JSON.stringify(sc));
    },
    log: () => readFakeAgentLog(dir),
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

/** The `cockpit` config of stand-ins.md §1.1 for this fake agent. */
export function cockpitConfig({ fakeDir, board = null, stt = { url: 'none' } }) {
  return {
    agent: {
      kind: 'claude-code', command: [process.execPath, FAKE_AGENT], cwd: fakeDir,
      env: ['FAKE_AGENT_DIR'], allowSameUser: true,
      loginCheck: [process.execPath, FAKE_AGENT, 'auth', 'status'],
    },
    stt,
    ...(board ? { board: { url: board } } : {}),
    mcp: { port: 0 },
  };
}

function makeRoom(fakeAgent) {
  const rooms = [];
  const dirs = [];
  let current = null;
  const room = {
    /**
     * Boot a room under test. `turns`: that many seeded done turns (c1-talk.md §6);
     * `empty`: a conversation with no turn; `cockpit: false`: the same board with no
     * cockpit configured (S-SCR-09's second run); `script` the fake agent's script;
     * `clock` `{set, mode}` the room's clock from its first timer on (build B217); `edit(script)`
     * changes the copied script before the boot (S-C1-37's second case); `seeded` the turns
     * themselves in place of `turns` (S-C1-39's t-0101…, seededTurns' options).
     */
    async start({ turns = 0, seeded = null, script = 'c1-render', cockpit = true, board = null, config = {}, clock = null, edit = null } = {}) {
      fakeAgent.use(script);
      if (edit) fakeAgent.edit(edit); // the script changed before the room's first start
      const dir = tmp('lb-room-');
      dirs.push(dir);
      const cfg = {
        hostname: 'hub',
        fleet: { id: 'builder-a', code: 'BA' }, // a demo name, never the machine's (B114)
        map: writeDemoMap(dir),
        ...(cockpit ? { cockpit: cockpitConfig({ fakeDir: fakeAgent.dir, board }) } : {}),
        ...config,
      };
      const booted = await boot({
        mode: 'builder', entry: ROOM_UNDER_TEST, config: cfg,
        env: { FAKE_AGENT_DIR: fakeAgent.dir, ...(clock ? { ROOM_TEST_CLOCK: JSON.stringify(clock) } : {}) },
        stateFiles: cockpit ? conversationFiles({ turns: seeded ?? seededTurns(turns) }) : null,
        timeoutMs: 20_000,
      });
      rooms.push(booted);
      current = booted;
      return room;
    },
    get booted() { return current; },
    get url() { return current.url; },
    /** stand-ins.md §1.2: one call to the control API, `{status, body}`. */
    control: (method, p, body) => control(current, method, p, body),
    async restart(opts) { return current.restart(opts); },
    async stopAll() {
      await Promise.allSettled(rooms.map((r) => r.stop()));
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    },
  };
  return room;
}

/**
 * Hold back the room's outbound frames on the page's room link from the first
 * frame of `type` for `ms`, then deliver them in order: what the room's outbound
 * fault hook does to `welcome` in S-C1-26 (stand-ins.md §1.1), done at the
 * page's end of the link with Playwright's WebSocket route (build B113).
 */
export async function holdOutbound(page, { type, ms }) {
  await page.routeWebSocket(/\/api\/cockpit\/ws$/, (ws) => {
    const server = ws.connectToServer();
    let queue = null;
    let held = false;
    server.onMessage((m) => {
      if (queue) { queue.push(m); return; }
      let t = null;
      try { t = JSON.parse(String(m)).type; } catch { /* not JSON: pass it on */ }
      if (!held && t === type) {
        held = true;
        queue = [m];
        setTimeout(() => { const q = queue; queue = null; for (const x of q) ws.send(x); }, ms);
        return;
      }
      ws.send(m);
    });
  });
}

function makeDemoHub() {
  let child = null;
  let url = null;
  return {
    /** Start the demo fleet on a free port; resolves with its URL. */
    async start() {
      if (url) return url;
      const port = await freePort();
      child = spawn(process.execPath, [path.join(ROOT, 'test', 'tools', 'demo-fleet.mjs'), '--port', String(port)], {
        cwd: ROOT, stdio: 'ignore', detached: true,
      });
      const u = `http://127.0.0.1:${port}`;
      const until = Date.now() + 30_000;
      for (;;) {
        try { const r = await fetch(`${u}/`); if (r.ok) break; } catch { /* not up yet */ }
        if (Date.now() > until) throw new Error('the demo fleet did not answer within 30 s');
        await new Promise((r) => setTimeout(r, 200));
      }
      url = u;
      return url;
    },
    get url() { return url; },
    stop() {
      if (!child) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
      child = null;
      url = null;
    },
  };
}

function makeClock() {
  let page = null;
  let room = null;
  return {
    /** page.clock.install at `time` (before the load); the room's clock set to the same time. */
    async install(p, r, time) {
      page = p;
      room = r;
      await page.clock.install({ time: new Date(time) });
      if (room) await room.control('POST', '/clock', { set: new Date(time).toISOString() });
    },
    /** stand-ins.md §1.1 advance(ms): the page's clock, then the room's (manual mode). */
    async advance(ms) {
      await page.clock.runFor(ms);
      if (room) {
        const r = await room.control('POST', '/clock', { advanceMs: ms });
        if (r.status !== 200) throw new Error(`advance: the room's clock answered ${r.status} ${JSON.stringify(r.body)}`);
      }
    },
  };
}

export const test = base.extend({
  fakeAgent: async ({}, use) => {
    const a = makeFakeAgent();
    await use(a);
    a.cleanup();
  },
  room: async ({ fakeAgent }, use) => {
    const r = makeRoom(fakeAgent);
    try {
      await use(r);
    } finally {
      await r.stopAll();
    }
  },
  fakeSpeech: async ({}, use) => {
    let speech = null;
    const f = {
      async start(script) { speech = await startFakeSpeech({ script }); return speech; },
      get url() { return speech?.url ?? null; },
    };
    try {
      await use(f);
    } finally {
      await speech?.close();
    }
  },
  demoHub: async ({}, use) => {
    const h = makeDemoHub();
    try {
      await use(h);
    } finally {
      h.stop();
    }
  },
  clock: async ({}, use) => {
    await use(makeClock());
  },
});

// --- helpers the specs share -------------------------------------------------

/** A rect as the spec writes it: {x1, x2, y1, y2} in CSS px, rounded to 0.5 px. */
export async function rectOf(page, selector) {
  return page.evaluate((sel) => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const q = (v) => Math.round(v * 2) / 2;
    return { x1: q(r.left), x2: q(r.right), y1: q(r.top), y2: q(r.bottom) };
  }, selector);
}

/**
 * A lane on the page's board (build B114): the room under test reads an empty
 * HOME, so its board has no lane, and the inspector opens only on one. The test
 * hands the page's store one lane snapshot, as the builder would send it.
 */
export async function seedLane(page, { builder = 'builder-a', lane = 'auth' } = {}) {
  await page.evaluate(async ({ b, l }) => {
    const st = await import('/js/core/store.js');
    const rd = await import('/js/ui/render.js');
    st.ingest(st.store, {
      type: 'snapshot', builder: b,
      sessions: [{ name: l, lane: l, state: 'working', cwd: `/w/${l}` }],
      lanes: [{ id: l, root: `/w/${l}`, branch: `feat/${l}`, sessions: [l], isMain: false }],
    });
    rd.renderAll();
  }, { b: builder, l: lane });
  return `${builder}/${lane}`;
}

/** Wait until the cockpit has decided (data-cockpit present on the root). */
export async function cockpitDecided(page) {
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-cockpit'));
}

/** Rects intersect (touching edges do not). */
export const intersects = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** The computed colour of `selector` and of a probe styled `color: var(<token>)`, to compare. */
export async function colourVsToken(page, selector, token) {
  return page.evaluate(([sel, tok]) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${tok})`;
    document.body.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return { got: getComputedStyle(document.querySelector(sel)).color, want };
  }, [selector, token]);
}
