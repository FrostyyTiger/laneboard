// The first /ws frame must name the builder as {id, code}: the page's store
// reads that, and without it every action fell back to the legacy routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import WebSocket from 'ws';
import { boot } from './helpers/boot.mjs';
import { helloFrame, stamp } from '../server/ws.mjs';
import { config } from '../server/config.mjs';
import { createStore, ingest, setHello } from '../public/js/core/store.js';
import { createActions } from '../public/js/core/actions.js';

test('helloFrame keeps builder {id, code}; other frames keep the string', () => {
  const h = helloFrame();
  assert.deepEqual(h.builder, { id: config.fleet.id, code: config.fleet.code });
  assert.equal(typeof h.seq, 'number');
  assert.equal(stamp({ type: 'map' }).builder, config.fleet.id);
});

test('real server: the page learns its builder and actions reach the dispatcher', async (t) => {
  const b = await boot({ config: { fleet: { id: 'hello-box', code: 'HB' } } });
  t.after(() => b.stop());
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}/ws`, { headers: { host: `127.0.0.1:${b.port}` } });
  t.after(() => ws.close());
  const first = await new Promise((ok, no) => { ws.once('message', (d) => ok(JSON.parse(d))); ws.once('error', no); });

  const s = createStore();
  assert.equal(ingest(s, first)?.type, 'hello');
  assert.equal(s.source.id, 'hello-box');
  assert.equal(s.source.code, 'HB');
  setHello(s, await (await fetch(`${b.url}/api/v1/hello`)).json());
  assert.ok(s.source.hello.capabilities.includes('actions'));

  const seen = [];
  const fetchImpl = (u, init) => { seen.push(u); return fetch(`${b.url}${u}`, init); };
  const { act } = createActions({ store: s, fetchImpl });
  const r = await act('ghost', 'restart', { confirm: 'ghost' });
  assert.equal(r.code, 'unknown_session', 'the dispatcher answered, past the envelope checks');
  assert.deepEqual([...new Set(seen)], ['/api/v1/actions']);
});

test('the board card sends the confirm the dispatcher requires', () => {
  const src = fs.readFileSync(new URL('../public/js/views/board-card.js', import.meta.url), 'utf8');
  assert.match(src, /act\(k, 'restart', \{ confirm: s\.name \}\)/);
  assert.match(src, /act\(k, 'kill', \{ confirm: s\.name \}\)/);
});
