// The agent's read tools (docs/cockpit-tools.md): real HTTP, a real board with the fake engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { boot, ROOM_UNDER_TEST, ROOT } from './helpers/boot.mjs';
import { createMcp } from '../server/cockpit/mcp.mjs';

const RUN = 'R-20261101-acme-shop-1';

async function setup(t, opts = {}) {
  const b = await boot({ config: { engines: [{ id: 'demo', kind: 'fake' }] } });
  t.after(() => b.stop());
  const mcp = createMcp({ boardUrl: b.url, ...opts });
  const { port } = await mcp.listen(0);
  t.after(() => mcp.stop());
  const url = `http://127.0.0.1:${port}/mcp`;
  let id = 0;
  const post = (body, headers = { authorization: `Bearer ${mcp.token}` }) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const rpc = async (method, params) => (await post({ jsonrpc: '2.0', id: ++id, method, params })).json();
  const tool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  return { b, mcp, url, post, rpc, tool };
}

test('only with the token, never from a browser, only on loopback', async (t) => {
  let reads = 0;
  const mcp = createMcp({ boardUrl: 'http://127.0.0.1:1', fetchImpl: async () => { reads += 1; throw new Error('x'); } });
  const addr = await mcp.listen(0);
  t.after(() => mcp.stop());
  assert.equal(addr.address, '127.0.0.1');
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'waiting', arguments: {} } });
  assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', body, headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', body, headers: { authorization: `Bearer ${mcp.token}`, origin: 'https://evil.example.invalid' } })).status, 403);
  assert.equal(reads, 0);
});

test('the handshake and the list: three tools, none that acts', async (t) => {
  const { rpc, post } = await setup(t);
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const names = (await rpc('tools/list')).result.tools.map((x) => x.name).sort();
  assert.deepEqual(names, ['focus', 'runs', 'waiting']);
});

test('"what waits for me?" lists the fixture gates, without long text', async (t) => {
  const { tool } = await setup(t);
  const r = await tool('waiting');
  assert.equal(r.isError, undefined);
  const out = r.structuredContent;
  assert.equal(out.asOf[0].source, 'board');
  assert.ok(out.items.some((i) => i.id === 'acme-shop:REQ-5' && i.kind === 'requirement' && i.engine === 'demo'));
  assert.ok(out.items.every((i) => i.title && i.engine === 'demo'));
  const text = r.content[0].text;
  assert.ok(!text.includes('acceptance'), 'requirement bodies stay out');
  assert.ok(!text.includes('sha256:'), 'no revision for an agent to pass on');
});

test('runs: the list, one run with its tree, an unknown run', async (t) => {
  const { tool } = await setup(t);
  const list = (await tool('runs')).structuredContent;
  assert.ok(list.runs.some((r) => r.run === RUN && r.state === 'running' && r.costUsd === 4.38));
  const one = (await tool('runs', { run: `demo/${RUN}` })).structuredContent.run;
  assert.equal(one.node, 'G1.F1.T3');
  assert.ok(one.tree.some((n) => n.id === 'G1.F1'));
  const none = await tool('runs', { run: 'acme-x' });
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /^No run "acme-x"\. Known runs: R-/);
});

test('a bad argument never reaches the board', async (t) => {
  const { rpc } = await setup(t);
  const bad = await rpc('tools/call', { name: 'runs', arguments: { run: '../etc' } });
  assert.equal(bad.error.code, -32602);
  assert.match(bad.error.message, /^run: must match/);
  assert.equal((await rpc('tools/call', { name: 'approve', arguments: {} })).error.code, -32602);
  assert.equal((await rpc('tools/call', { name: 'runs', arguments: { x: '1' } })).error.code, -32602);
});

test('focus: nothing yet, then the run and the prompt that asked', async (t) => {
  const screens = new Map();
  const { tool } = await setup(t, { focusOf: () => screens });
  assert.match((await tool('focus')).content[0].text, /^No screen has said/);
  const entry = { focus: { page: 'app', route: { view: 'runs', run: `demo/${RUN}` } }, at: Date.now() };
  screens.set('me', { live: entry, atPrompt: entry });
  const out = (await tool('focus')).structuredContent;
  assert.equal(out.when, 'prompt');
  assert.equal(out.run.run, RUN);
  assert.equal(out.run.node, 'G1.F1.T3');
  assert.match((await tool('focus', { screen: 'hall2' })).content[0].text, /^No screen "hall2"/);
  screens.set('me', { live: { focus: { page: 'app', route: { view: 'map', sel: 'node:gone' } }, at: Date.now() }, atPrompt: entry });
  const moved = (await tool('focus', { when: 'now' })).structuredContent;
  assert.equal(moved.changedSincePrompt, true);
  assert.deepEqual(moved.selected, { sel: 'node:gone', found: false });
});

test('the board down is one sentence; the 61st read is refused', async (t) => {
  const mcp = createMcp({ boardUrl: 'http://127.0.0.1:1', fetchImpl: async () => { throw new Error('refused'); } });
  const down = await mcp.call('waiting');
  assert.equal(down.isError, true);
  assert.match(down.content[0].text, /did not answer in 5 s/);
  for (let i = 0; i < 59; i += 1) await mcp.call('waiting');
  assert.match((await mcp.call('waiting')).content[0].text, /^Too many/);
});

test('a real room: the files, the agent token, and a prompt the focus tool then sees', { timeout: 60_000 }, async (t) => {
  const fakeDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'lb-mcp-'));
  t.after(() => fs.rmSync(fakeDir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(ROOT, 'test/cockpit/scripts/c1-render.json'), path.join(fakeDir, 'script.json'));
  const fake = path.join(ROOT, 'test/cockpit/stand-ins/fake-agent.mjs');
  const box = await boot({
    mode: 'builder', entry: ROOM_UNDER_TEST,
    config: { engines: [{ id: 'demo', kind: 'fake' }], cockpit: { mcp: { port: 0 }, agent: { command: [process.execPath, fake], env: ['FAKE_AGENT_DIR'], allowSameUser: true, loginCheck: null } } },
    env: { FAKE_AGENT_DIR: fakeDir },
  });
  t.after(() => box.stop());
  const mcpFile = path.join(box.stateDir, 'cockpit-agent/mcp.json');
  for (let i = 0; i < 200 && !fs.existsSync(mcpFile); i += 1) await new Promise((ok) => setTimeout(ok, 25));
  const { url, token } = box.mcp();
  assert.equal(fs.statSync(path.join(box.stateDir, 'cockpit/mcp.token')).mode & 0o777, 0o600);
  const raw = fs.readFileSync(path.join(box.stateDir, 'cockpit-agent/mcp.json'), 'utf8');
  assert.ok(!raw.includes(token), 'mcp.json holds the variable, never the token');

  const ws = new WebSocket(`ws://127.0.0.1:${box.port}/api/cockpit/ws`, { origin: `http://127.0.0.1:${box.port}` });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'hello', seq: 1, page: 'app', protocol: 1 }));
  await once(ws, 'message');
  ws.send(JSON.stringify({ type: 'prompt', seq: 2, clientId: 'p-3c1e0b2a', text: 'here?', source: 'typed', lang: null, about: null, sentAt: Date.now(),
    focus: { page: 'app', route: { view: 'runs', run: `demo/${RUN}` }, wallState: null, layout: null, pane: 'open', inSight: [] } }));

  let out = null;
  for (let i = 0; i < 100 && !out?.structuredContent; i += 1) {
    const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'focus', arguments: {} } }) });
    out = (await r.json()).result;
    if (!out.structuredContent) await new Promise((ok) => setTimeout(ok, 50));
  }
  assert.equal(out.structuredContent.run.run, RUN);
  assert.equal(out.structuredContent.view, 'runs');
});

test('a board with no engine routes says so; it never reads as nothing waiting', async () => {
  const mcp = createMcp({ boardUrl: 'http://x', fetchImpl: async () => new Response('{}', { status: 404 }) });
  const r = await mcp.call('waiting');
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /a hub does not carry engine data/);
});
